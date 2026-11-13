package workbench

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"
	"yovoice/internal/audio"
	"yovoice/internal/community"
	"yovoice/internal/diag"
	"yovoice/internal/msg"
	"yovoice/internal/schema"
)

// communityPrivateKey 是登录令牌在私有设置里的键；令牌不进入状态，也不广播给界面。
const communityPrivateKey = "community"

type communitySession struct {
	Token    string `json:"token"`
	Nickname string `json:"nickname"`
	Email    string `json:"email"`
}

// communityState 记录进行中的登录轮询和分享；同一时间各只有一个。
type communityState struct {
	mu          sync.Mutex
	loginCancel context.CancelFunc
	shareCancel context.CancelFunc
	shareID     string
	wait        sync.WaitGroup
}

// CommunityShareRequest 是界面填写的分享信息；分享的是一首歌的某个版本。
type CommunityShareRequest struct {
	GenerationID string   `json:"generationId"`
	Title        string   `json:"title"`
	Description  string   `json:"description"`
	Tags         []string `json:"tags"`
	License      string   `json:"license"`
	AcceptTerms  bool     `json:"acceptTerms"`
	// Lyrics 是界面按这个版本的对齐结果算好的逐行歌词时间；没对齐时为空。
	Lyrics []community.LyricLine `json:"lyrics"`
}

func (w *Workbench) publishCommunity(change func(*schema.CommunityState)) {
	_ = w.Store.Update(func(s *schema.State) {
		next := schema.CommunityState{}
		if s.Community != nil {
			next = *s.Community
		}
		change(&next)
		s.Community = &next
	}, false)
}

// restoreCommunity 在启动时按保存的令牌恢复账号显示；令牌是否仍有效要到下次请求才知道。
func (w *Workbench) restoreCommunity() {
	var session communitySession
	if ok, _ := w.Store.Private(communityPrivateKey, &session); ok && session.Token != "" {
		w.publishCommunity(func(c *schema.CommunityState) {
			c.Account = &schema.CommunityAccount{Nickname: session.Nickname, Email: session.Email}
		})
	}
}

// communityClient 返回带当前令牌的客户端；requireLogin 时没有令牌即报未登录。
func (w *Workbench) communityClient(requireLogin bool) (*community.Client, error) {
	var session communitySession
	if _, e := w.Store.Private(communityPrivateKey, &session); e != nil {
		return nil, e
	}
	if requireLogin && session.Token == "" {
		return nil, msg.Err(msg.ErrCommunityLogin, nil)
	}
	return &community.Client{Base: community.Base(), Token: session.Token, HTTP: w.client}, nil
}

// communityExpired 在服务端不再认令牌时清掉本机登录，界面回到未登录状态。
func (w *Workbench) communityExpired(e error) error {
	var ce *msg.CallError
	if errors.As(e, &ce) && ce.Code == msg.ErrCommunityLogin {
		_ = w.Store.SetPrivate(communityPrivateKey, nil)
		w.publishCommunity(func(c *schema.CommunityState) { c.Account = nil })
	}
	return e
}

// CommunityLogin 发起设备登录并在后台等待用户在浏览器里确认；再次调用会换一个新的确认码。
func (w *Workbench) CommunityLogin() (schema.CommunityLogin, error) {
	client, e := w.communityClient(false)
	if e != nil {
		return schema.CommunityLogin{}, e
	}
	start, cancelStart := context.WithTimeout(context.Background(), 30*time.Second)
	device, e := client.DeviceStart(start)
	cancelStart()
	if e != nil {
		return schema.CommunityLogin{}, e
	}
	if device.Interval < 1 {
		device.Interval = 3
	}
	login := schema.CommunityLogin{Code: device.UserCode, URL: device.VerificationURL, ExpiresAt: time.Now().UTC().Add(time.Duration(device.ExpiresIn) * time.Second)}
	ctx, cancel := context.WithDeadline(context.Background(), login.ExpiresAt)
	w.community.mu.Lock()
	if w.community.loginCancel != nil {
		w.community.loginCancel()
	}
	w.community.loginCancel = cancel
	w.community.wait.Add(1)
	w.community.mu.Unlock()
	w.publishCommunity(func(c *schema.CommunityState) { c.Login = &login })
	go func() {
		defer w.community.wait.Done()
		defer cancel()
		session, e := pollDevice(ctx, client, device)
		// 被新的登录或取消替换时什么都不改，状态由替换它的一方负责。
		if errors.Is(ctx.Err(), context.Canceled) {
			return
		}
		if e != nil {
			diag.Log(w.Store.Root, "community.login_failed", "error", diag.Error(e))
			w.publishCommunity(func(c *schema.CommunityState) {
				if c.Login != nil && c.Login.Code == login.Code {
					expired := *c.Login
					expired.Expired = true
					c.Login = &expired
				}
			})
			return
		}
		if e = w.Store.SetPrivate(communityPrivateKey, session); e != nil {
			return
		}
		diag.Log(w.Store.Root, "community.logged_in")
		w.publishCommunity(func(c *schema.CommunityState) {
			c.Login, c.Account = nil, &schema.CommunityAccount{Nickname: session.Nickname, Email: session.Email}
		})
	}()
	return login, nil
}

// pollDevice 按服务端给的间隔查询，直到用户确认、确认码失效或 ctx 结束；网络抖动时继续等。
func pollDevice(ctx context.Context, client *community.Client, device community.Device) (communitySession, error) {
	ticker := time.NewTicker(time.Duration(device.Interval) * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return communitySession{}, ctx.Err()
		case <-ticker.C:
		}
		token, account, pending, e := client.DeviceToken(ctx, device.DeviceCode)
		var ce *msg.CallError
		if errors.As(e, &ce) && ce.Code == msg.ErrCommunityNetwork {
			continue
		}
		if e != nil {
			return communitySession{}, e
		}
		if !pending && token != "" {
			return communitySession{Token: token, Nickname: account.Nickname, Email: account.Email}, nil
		}
	}
}

// CommunityCancelLogin 放弃等待中的登录。
func (w *Workbench) CommunityCancelLogin() {
	w.community.mu.Lock()
	if w.community.loginCancel != nil {
		w.community.loginCancel()
		w.community.loginCancel = nil
	}
	w.community.mu.Unlock()
	w.publishCommunity(func(c *schema.CommunityState) { c.Login = nil })
}

// CommunityLogout 删除本机保存的登录；已经分享的作品不受影响。
func (w *Workbench) CommunityLogout() error {
	w.CommunityCancelLogin()
	if e := w.Store.SetPrivate(communityPrivateKey, nil); e != nil {
		return e
	}
	w.publishCommunity(func(c *schema.CommunityState) { c.Account = nil })
	return nil
}

// CommunityShare 把一首歌的某个版本分享到社区：打包、编码试听、上传并提交审核，在后台进行。
// 进度写在状态的 community.share 里；同一时间只进行一个分享。
func (w *Workbench) CommunityShare(r CommunityShareRequest) (schema.CommunityShare, error) {
	s := w.Store.Read()
	i := slices.IndexFunc(s.History, func(g schema.Generation) bool { return g.ID == r.GenerationID })
	if i < 0 || s.History[i].Settings.Kind != "music" || s.History[i].StemOf != "" {
		return schema.CommunityShare{}, msg.Err(msg.ErrCommunitySource, nil)
	}
	g := s.History[i]
	client, e := w.communityClient(true)
	if e != nil {
		return schema.CommunityShare{}, e
	}
	converter, e := audio.Converter()
	if e != nil {
		return schema.CommunityShare{}, e
	}
	share := schema.CommunityShare{ID: schema.NewID(), GenerationID: g.ID, Status: "running", Stage: "packing"}
	ctx, cancel := context.WithCancel(context.Background())
	w.community.mu.Lock()
	if w.community.shareCancel != nil {
		w.community.mu.Unlock()
		cancel()
		return schema.CommunityShare{}, msg.Err(msg.ErrBusy, nil)
	}
	w.community.shareCancel, w.community.shareID = cancel, share.ID
	w.community.wait.Add(1)
	w.community.mu.Unlock()
	w.publishCommunity(func(c *schema.CommunityState) { c.Share = &share })
	go func() {
		defer w.community.wait.Done()
		defer cancel()
		err := diag.Catch(w.Store.Root, "community.share", func() error { return w.shareSong(ctx, client, converter, g, r, share.ID) })
		err = w.communityExpired(err)
		status := "completed"
		if errors.Is(err, context.Canceled) {
			status = "cancelled"
		} else if err != nil {
			status = "failed"
		}
		diag.Log(w.Store.Root, "community.share_finished", "status", status, "error", diag.Error(err))
		w.community.mu.Lock()
		w.community.shareCancel, w.community.shareID = nil, ""
		w.community.mu.Unlock()
		w.updateShare(share.ID, func(c *schema.CommunityShare) {
			c.Status = status
			var ce *msg.CallError
			if errors.As(err, &ce) {
				c.ErrorCode, c.ErrorParams = ce.Code, ce.Params
			} else if status == "failed" {
				c.ErrorCode, c.ErrorParams = msg.ErrUnknown, msg.Params{"detail": err.Error()}
			}
		})
	}()
	return share, nil
}

func (w *Workbench) updateShare(id string, change func(*schema.CommunityShare)) {
	w.publishCommunity(func(c *schema.CommunityState) {
		if c.Share == nil || c.Share.ID != id {
			return
		}
		share := *c.Share
		change(&share)
		c.Share = &share
	})
}

// songPack 是分享出去的作品包：只含这一个版本和生成它的设置。
// 参考音色、角色和时间线不随歌曲分享——那是别人的声音样本或本机上的其它素材。
func songPack(g schema.Generation) projectArchive {
	g.StemOf, g.Stem, g.PatchOf, g.PatchBars = "", "", "", nil
	d := &g.Settings
	d.Timeline, d.Subtitles, d.Performance, d.CharacterID = nil, nil, nil, ""
	d.VoiceID, d.EmotionVoiceID, d.SourceGenerationID = nil, nil, ""
	return projectArchive{Version: 1, Draft: g.Settings, History: []schema.Generation{g}}
}

func (w *Workbench) shareSong(ctx context.Context, client *community.Client, converter string, g schema.Generation, r CommunityShareRequest, shareID string) error {
	work, e := w.workDir("share-")
	if e != nil {
		return e
	}
	defer os.RemoveAll(work)
	limits, e := client.Limits(ctx)
	if e != nil {
		return e
	}
	pack, preview := filepath.Join(work, "song.yovoice"), filepath.Join(work, "preview.m4a")
	if e = w.writeArchive(songPack(g), pack); e != nil {
		return e
	}
	source, e := w.Store.MediaPath("outputs", g.FileName)
	if e != nil {
		return e
	}
	encode, stop := context.WithTimeout(ctx, 10*time.Minute)
	e = audio.Encode(encode, converter, source, preview, "m4a", audio.Tags{Title: strings.TrimSpace(r.Title), Comment: w.generatedComment(g.ID)}, nil)
	stop()
	if e != nil {
		return e
	}
	packInfo, e := os.Stat(pack)
	if e != nil {
		return e
	}
	previewInfo, e := os.Stat(preview)
	if e != nil {
		return e
	}
	if packInfo.Size() > limits.SongMaxSize {
		return msg.Err(msg.ErrCommunityTooLarge, msg.Params{"limit": limits.SongMaxSize >> 20})
	}
	if previewInfo.Size() > limits.PreviewMax {
		return msg.Err(msg.ErrCommunityTooLarge, msg.Params{"limit": limits.PreviewMax >> 20})
	}
	// 封面按这首歌的响度起伏来画，配色和构图按版本编号定，和应用里的封面是同一张；
	// 读不出采样时不带响度，社区页按版本编号推一条起伏。
	gene, _ := w.GenerationGene(g.ID)
	ticket, e := client.Create(ctx, community.CreateInput{
		Gene: gene, CoverSeed: g.ID, Lyrics: r.Lyrics,
		Kind: "song", Title: r.Title, Description: r.Description, Tags: r.Tags, Language: g.Settings.Language, Model: g.Settings.ModelID,
		License: r.License, TermsVersion: limits.TermsVersion, AcceptTerms: r.AcceptTerms,
		PackSize: packInfo.Size(), PreviewSize: previewInfo.Size(), Duration: g.Duration,
	})
	if e != nil {
		return e
	}
	total := packInfo.Size() + previewInfo.Size()
	w.updateShare(shareID, func(c *schema.CommunityShare) { c.Stage, c.Total = "uploading", total })
	// 进度按秒广播，避免每读一块就推一次状态。
	var last time.Time
	report := func(base int64) func(int64) {
		return func(sent int64) {
			if now := time.Now(); now.Sub(last) >= 500*time.Millisecond || base+sent == total {
				last = now
				w.updateShare(shareID, func(c *schema.CommunityShare) { c.Received = base + sent })
			}
		}
	}
	e = client.Put(ctx, ticket.Preview, preview, report(0))
	if e == nil {
		e = client.Put(ctx, ticket.Pack, pack, report(previewInfo.Size()))
	}
	if e == nil {
		w.updateShare(shareID, func(c *schema.CommunityShare) { c.Stage = "submitting" })
		e = client.Submit(ctx, ticket.ID)
	}
	if e != nil {
		// 没传完的草稿不留在服务端占名额；清理失败也无妨，服务端会按期回收。
		clean, stop := context.WithTimeout(context.Background(), 15*time.Second)
		_ = client.Delete(clean, ticket.ID)
		stop()
	}
	return e
}

// CommunityCloseShare 取消进行中的分享，或在结束后收起它的结果。
func (w *Workbench) CommunityCloseShare() {
	w.community.mu.Lock()
	cancel := w.community.shareCancel
	w.community.mu.Unlock()
	if cancel != nil {
		cancel()
		return
	}
	w.publishCommunity(func(c *schema.CommunityState) { c.Share = nil })
}

// CommunityMine 列出自己分享过的作品和审核状态。
func (w *Workbench) CommunityMine(ctx context.Context) ([]community.Item, error) {
	client, e := w.communityClient(true)
	if e != nil {
		return nil, e
	}
	items, e := client.Mine(ctx)
	return items, w.communityExpired(e)
}

// CommunityDelete 从社区删除自己的一个分享。
func (w *Workbench) CommunityDelete(ctx context.Context, id string) error {
	if !schema.ValidID(strings.ReplaceAll(id, "-", "")) {
		return msg.Err(msg.ErrRequestInvalid, nil)
	}
	client, e := w.communityClient(true)
	if e != nil {
		return e
	}
	return w.communityExpired(client.Delete(ctx, id))
}

// stopCommunity 在关闭时结束登录轮询和分享并等它们退出。
func (w *Workbench) stopCommunity() {
	w.community.mu.Lock()
	for _, cancel := range []context.CancelFunc{w.community.loginCancel, w.community.shareCancel} {
		if cancel != nil {
			cancel()
		}
	}
	w.community.mu.Unlock()
	w.community.wait.Wait()
}
