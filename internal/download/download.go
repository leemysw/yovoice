// Package download 提供断点续传、校验、安全解包与下载代理。
package download

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"
	"yovoice/internal/msg"
	"yovoice/internal/platform"
)

// 下载健壮性参数：等待响应头或读取响应体超过 stallTimeout 没有新字节即视为停滞，取消本次请求后重试；
// 临时错误最多重试 maxRetries 次，退避依次为 retryDelay 的 1、2、4 倍。测试里会把两个时长改短。
var (
	stallTimeout = 60 * time.Second
	retryDelay   = time.Second
)

const maxRetries = 3

// partialMeta 记录 .part 的来源，续传前据此判断服务器上是否还是同一份文件。
type partialMeta struct {
	URL          string `json:"url"`
	ETag         string `json:"etag"`
	LastModified string `json:"lastModified"`
}

func metaPath(partial string) string { return partial + ".meta" }

func writeMeta(partial string, m partialMeta) error {
	b, e := json.Marshal(m)
	if e != nil {
		return e
	}
	return platform.WriteFileAtomic(metaPath(partial), b, 0600)
}

// removePartial 一并删除 .part 与旁边的 .meta；文件本就不存在不算错误。
func removePartial(partial string) error {
	e := os.Remove(partial)
	me := os.Remove(metaPath(partial))
	if e != nil && !os.IsNotExist(e) {
		return e
	}
	if me != nil && !os.IsNotExist(me) {
		return me
	}
	return nil
}

// finishPartial 把校验通过的 .part 改名为目标文件；改名成功后 .meta 不再有用。
func finishPartial(partial, destination string) error {
	if e := os.Rename(partial, destination); e != nil {
		return e
	}
	_ = os.Remove(metaPath(partial))
	return nil
}

// hashErr 把校验 .part 时的错误转成应返回给调用方的错误：上下文取消优先于读文件错误。
func hashErr(ctx context.Context, e error) error {
	if ce := ctx.Err(); ce != nil {
		return ce
	}
	return e
}

// sleepContext 退避等待，期间响应调用方取消。
func sleepContext(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

type contextReader struct {
	ctx context.Context
	r   io.Reader
}

func (r contextReader) Read(p []byte) (int, error) {
	if e := r.ctx.Err(); e != nil {
		return 0, e
	}
	return r.r.Read(p)
}
func Hash(ctx context.Context, path string) (string, error) {
	f, e := os.Open(path)
	if e != nil {
		return "", e
	}
	defer f.Close()
	h := sha256.New()
	if _, e = io.Copy(h, contextReader{ctx, f}); e != nil {
		return "", e
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
func FileSize(path string) int64 {
	if s, e := os.Stat(path); e == nil {
		return s.Size()
	}
	return 0
}

// File 把 url 下载到 destination 并按 sha256 校验；中途失败的数据留在 destination+".part"，下次调用从断点续传。
// 网络抖动、服务器临时错误（429/5xx）、停滞与半途断开会在内部指数退避重试，每次重试都从 .part 续传；
// 校验不符、范围或大小不对、调用方取消与本地文件系统错误不重试。
func File(ctx context.Context, client *http.Client, url, destination, hash string, expected int64, progress func(int64, int64)) error {
	if e := os.MkdirAll(filepath.Dir(destination), 0700); e != nil {
		return e
	}
	if h, e := Hash(ctx, destination); e == nil && h == hash {
		return nil
	}
	partial := destination + ".part"
	for i := 0; ; i++ {
		retry, e := attempt(ctx, client, url, destination, partial, hash, expected, progress)
		if e == nil || !retry || i >= maxRetries {
			return e
		}
		if e = sleepContext(ctx, retryDelay<<i); e != nil {
			return e
		}
	}
}

// attempt 完成一次“发请求→写 .part→校验→改名”的尝试。retry 为真表示错误是临时的，File 会退避后再试。
func attempt(ctx context.Context, client *http.Client, url, destination, partial, hash string, expected int64, progress func(int64, int64)) (retry bool, err error) {
	offset := FileSize(partial)
	if expected > 0 && offset >= expected {
		// 已经下完的 .part 只做复核：哈希读不完整（例如调用方取消）时原样保留，不能当作校验不符删掉。
		h, e := Hash(ctx, partial)
		if e != nil {
			return false, hashErr(ctx, e)
		}
		if h == hash && offset == expected {
			return false, finishPartial(partial, destination)
		}
		if e = removePartial(partial); e != nil {
			return false, e
		}
		offset = 0
	}
	var meta partialMeta
	hasMeta := false
	if offset > 0 {
		b, e := os.ReadFile(metaPath(partial))
		switch {
		case os.IsNotExist(e):
			// 旧版本留下的 .part 没有来源记录：仍按偏移续传但不带 If-Range，靠最终哈希兜底。
		case e != nil || json.Unmarshal(b, &meta) != nil || meta.URL != url:
			// 来源不明或已换了地址，续传的字节无法保证一致，从零开始。
			if e = removePartial(partial); e != nil {
				return false, e
			}
			offset = 0
		default:
			hasMeta = true
		}
	}
	if offset == 0 {
		if e := os.Remove(metaPath(partial)); e != nil && !os.IsNotExist(e) {
			return false, e
		}
	}
	// 看门狗：超过 stallTimeout 没有收到响应头或新字节就取消本次请求；stalled 用于区分停滞取消与调用方取消。
	reqCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	var stalled atomic.Bool
	watchdog := time.AfterFunc(stallTimeout, func() {
		stalled.Store(true)
		cancel()
	})
	defer watchdog.Stop()
	// transient 把请求或读取阶段的错误归类：调用方取消不重试，停滞按“下载未完成”重试，其余网络错误重试。
	transient := func(e error) (bool, error) {
		if ce := ctx.Err(); ce != nil {
			return false, ce
		}
		if stalled.Load() {
			return true, msg.Err(msg.ErrDownloadIncomplete, nil)
		}
		return true, e
	}
	req, e := http.NewRequestWithContext(reqCtx, "GET", url, nil)
	if e != nil {
		return false, e
	}
	req.Header.Set("User-Agent", "yovoice/0.1")
	if offset > 0 {
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-", offset))
		// If-Range 只认强 ETag，弱 ETag 退回 Last-Modified；服务器发现文件已变会回 200，下面按从零重写处理。
		if meta.ETag != "" && !strings.HasPrefix(meta.ETag, "W/") {
			req.Header.Set("If-Range", meta.ETag)
		} else if meta.LastModified != "" {
			req.Header.Set("If-Range", meta.LastModified)
		}
	}
	res, e := client.Do(req)
	if e != nil {
		return transient(e)
	}
	defer res.Body.Close()
	watchdog.Reset(stallTimeout)
	if res.StatusCode == 416 {
		h, e := Hash(ctx, partial)
		if e != nil {
			return false, hashErr(ctx, e)
		}
		if h == hash {
			return false, finishPartial(partial, destination)
		}
		_ = removePartial(partial)
		return false, msg.Err(msg.ErrDownloadStale, nil)
	}
	if res.StatusCode != 200 && res.StatusCode != 206 {
		return res.StatusCode == 429 || res.StatusCode >= 500, msg.Err(msg.ErrDownloadHTTP, msg.Params{"status": res.StatusCode})
	}
	var rangeTotal int64
	if res.StatusCode == 206 {
		var start, end int64
		n, _ := fmt.Sscanf(res.Header.Get("Content-Range"), "bytes %d-%d/%d", &start, &end, &rangeTotal)
		if n != 3 || start != offset || end < start || rangeTotal <= end {
			return false, msg.Err(msg.ErrDownloadRange, nil)
		}
	} else {
		offset = 0
	}
	total := expected
	if total == 0 {
		total = rangeTotal
		if total == 0 && res.ContentLength > 0 {
			total = offset + res.ContentLength
		}
	}
	if expected > 0 && res.ContentLength >= 0 && offset+res.ContentLength != expected {
		return false, msg.Err(msg.ErrDownloadSize, nil)
	}
	flags := os.O_CREATE | os.O_WRONLY | os.O_TRUNC
	if offset > 0 {
		flags = os.O_CREATE | os.O_WRONLY | os.O_APPEND
	}
	f, e := os.OpenFile(partial, flags, 0600)
	if e != nil {
		return false, e
	}
	// 先截断再记录来源，崩溃时最多留下来源过期的 .part，下次 If-Range 不匹配会被服务器拒绝续传。
	fresh := partialMeta{URL: url, ETag: res.Header.Get("ETag"), LastModified: res.Header.Get("Last-Modified")}
	if offset == 0 || !hasMeta || (meta.ETag == "" && meta.LastModified == "" && (fresh.ETag != "" || fresh.LastModified != "")) {
		if e = writeMeta(partial, fresh); e != nil {
			f.Close()
			return false, e
		}
	}
	received := offset
	last := time.Now()
	buffer := make([]byte, 131072)
	retry, e = func() (bool, error) {
		defer f.Close()
		for {
			n, readErr := res.Body.Read(buffer)
			if n > 0 {
				watchdog.Reset(stallTimeout)
				received += int64(n)
				if total > 0 && received > total {
					return false, msg.Err(msg.ErrDownloadOversized, nil)
				}
				if _, e := f.Write(buffer[:n]); e != nil {
					return false, e
				}
				if time.Since(last) > 200*time.Millisecond {
					progress(received, total)
					last = time.Now()
				}
			}
			if readErr == io.EOF {
				break
			}
			if readErr != nil {
				return transient(readErr)
			}
		}
		return false, f.Sync()
	}()
	if e != nil {
		return retry, e
	}
	watchdog.Stop()
	progress(received, total)
	if expected > 0 && received != expected {
		// 服务器提前结束了响应，.part 已保存收到的部分，重试时续传。
		return true, msg.Err(msg.ErrDownloadIncomplete, nil)
	}
	h, e := Hash(ctx, partial)
	if e != nil {
		return false, hashErr(ctx, e)
	}
	if h != hash {
		_ = removePartial(partial)
		return false, msg.Err(msg.ErrDownloadChecksum, nil)
	}
	if e = ctx.Err(); e != nil {
		return false, e
	}
	return false, finishPartial(partial, destination)
}
func Extract(ctx context.Context, archive, destination string) error {
	return ExtractFiles(ctx, archive, destination, nil)
}

// ExtractFiles 只解出 pick 返回非空路径的条目，并写到该相对路径；pick 为空时解出全部条目。
func ExtractFiles(ctx context.Context, archive, destination string, pick func(name string) string) error {
	if e := os.MkdirAll(destination, 0700); e != nil {
		return e
	}
	root, e := os.OpenRoot(destination)
	if e != nil {
		return e
	}
	defer root.Close()
	var total int64
	write := func(name string, size int64, mode os.FileMode, r io.Reader) error {
		if e := ctx.Err(); e != nil {
			return e
		}
		name = strings.ReplaceAll(name, "\\", "/")
		name = strings.TrimPrefix(name, "./")
		if pick != nil {
			if name = pick(name); name == "" {
				return nil
			}
		}
		if !filepath.IsLocal(name) || strings.Contains(name, ":") || strings.Contains(name, "\x00") {
			return msg.Err(msg.ErrRuntimeArchivePath, nil)
		}
		// Windows 的 os.Root 不接受目录名末尾的分隔符，校验后统一为本机路径。
		name = filepath.Clean(name)
		if mode.IsDir() {
			return root.MkdirAll(name, 0755)
		}
		if !mode.IsRegular() {
			return msg.Err(msg.ErrRuntimeArchiveLink, nil)
		}
		total += size
		if size < 0 || total > 8<<30 {
			return msg.Err(msg.ErrRuntimeArchiveSize, nil)
		}
		if e := root.MkdirAll(filepath.Dir(name), 0755); e != nil {
			return e
		}
		f, e := root.OpenFile(name, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, mode.Perm()|0600)
		if e != nil {
			return e
		}
		_, e = io.CopyN(f, contextReader{ctx, r}, size)
		ce := f.Close()
		if e != nil {
			return e
		}
		return ce
	}
	if strings.HasSuffix(archive, ".tar.gz") {
		f, e := os.Open(archive)
		if e != nil {
			return e
		}
		defer f.Close()
		gz, e := gzip.NewReader(f)
		if e != nil {
			return e
		}
		defer gz.Close()
		tr := tar.NewReader(gz)
		for {
			h, e := tr.Next()
			if e == io.EOF {
				return nil
			}
			if e != nil {
				return e
			}
			if h.Name == "./" && h.Typeflag == tar.TypeDir {
				continue
			}
			if h.Typeflag != tar.TypeReg && h.Typeflag != tar.TypeRegA && h.Typeflag != tar.TypeDir {
				return msg.Err(msg.ErrRuntimeArchiveLink, nil)
			}
			if e = write(h.Name, h.Size, h.FileInfo().Mode(), tr); e != nil {
				return e
			}
		}
	}
	z, e := zip.OpenReader(archive)
	if e != nil {
		return e
	}
	defer z.Close()
	for _, entry := range z.File {
		r, e := entry.Open()
		if e != nil {
			return e
		}
		e = write(entry.Name, int64(entry.UncompressedSize64), entry.Mode(), r)
		r.Close()
		if e != nil {
			return e
		}
	}
	return nil
}
