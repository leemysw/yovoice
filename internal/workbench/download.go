package workbench

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

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
func fileSize(path string) int64 {
	if s, e := os.Stat(path); e == nil {
		return s.Size()
	}
	return 0
}
func Download(ctx context.Context, client *http.Client, url, destination, hash string, expected int64, progress func(int64, int64)) error {
	if e := os.MkdirAll(filepath.Dir(destination), 0700); e != nil {
		return e
	}
	if h, e := Hash(ctx, destination); e == nil && h == hash {
		return nil
	}
	partial := destination + ".part"
	offset := fileSize(partial)
	if expected > 0 && offset >= expected {
		if h, e := Hash(ctx, partial); e == nil && h == hash && offset == expected {
			return os.Rename(partial, destination)
		}
		if e := os.Remove(partial); e != nil {
			return e
		}
		offset = 0
	}
	req, e := http.NewRequestWithContext(ctx, "GET", url, nil)
	if e != nil {
		return e
	}
	req.Header.Set("User-Agent", "yovoice/0.1")
	if offset > 0 {
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-", offset))
	}
	res, e := client.Do(req)
	if e != nil {
		return e
	}
	defer res.Body.Close()
	if res.StatusCode == 416 {
		if h, e := Hash(ctx, partial); e == nil && h == hash {
			return os.Rename(partial, destination)
		}
		_ = os.Remove(partial)
		return Err(MsgErrDownloadStale, nil)
	}
	if res.StatusCode != 200 && res.StatusCode != 206 {
		return Err(MsgErrDownloadHTTP, MessageParams{"status": res.StatusCode})
	}
	var rangeTotal int64
	if res.StatusCode == 206 {
		var start, end int64
		n, _ := fmt.Sscanf(res.Header.Get("Content-Range"), "bytes %d-%d/%d", &start, &end, &rangeTotal)
		if n != 3 || start != offset || end < start || rangeTotal <= end {
			return Err(MsgErrDownloadRange, nil)
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
		return Err(MsgErrDownloadSize, nil)
	}
	flags := os.O_CREATE | os.O_WRONLY | os.O_TRUNC
	if offset > 0 {
		flags = os.O_CREATE | os.O_WRONLY | os.O_APPEND
	}
	f, e := os.OpenFile(partial, flags, 0600)
	if e != nil {
		return e
	}
	received := offset
	last := time.Now()
	buffer := make([]byte, 131072)
	e = func() error {
		defer f.Close()
		for {
			n, readErr := res.Body.Read(buffer)
			if n > 0 {
				received += int64(n)
				if total > 0 && received > total {
					return Err(MsgErrDownloadOversized, nil)
				}
				if _, e := f.Write(buffer[:n]); e != nil {
					return e
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
				return readErr
			}
		}
		return f.Sync()
	}()
	if e != nil {
		return e
	}
	progress(received, total)
	if expected > 0 && received != expected {
		return Err(MsgErrDownloadIncomplete, nil)
	}
	h, e := Hash(ctx, partial)
	if e != nil {
		return e
	}
	if h != hash {
		_ = os.Remove(partial)
		return Err(MsgErrDownloadChecksum, nil)
	}
	if e = ctx.Err(); e != nil {
		return e
	}
	return os.Rename(partial, destination)
}
func Extract(ctx context.Context, archive, destination string) error {
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
		if !filepath.IsLocal(name) || strings.Contains(name, ":") || strings.Contains(name, "\x00") {
			return Err(MsgErrRuntimeArchivePath, nil)
		}
		if mode.IsDir() {
			return root.MkdirAll(name, 0755)
		}
		if !mode.IsRegular() {
			return Err(MsgErrRuntimeArchiveLink, nil)
		}
		total += size
		if size < 0 || total > 8<<30 {
			return Err(MsgErrRuntimeArchiveSize, nil)
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
				return Err(MsgErrRuntimeArchiveLink, nil)
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
