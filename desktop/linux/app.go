package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
	"unsafe"

	"github.com/ebitengine/purego"
)

// app 是唯一的主窗口：标题栏开关、承载界面的 WebKitGTK 视图，以及退出、服务恢复流程。
// GTK 对象只在主线程访问；后台 goroutine 通过 ui/uiWait 进入主线程。
type app struct {
	root string
	svc  *localService

	window, header, content, status uintptr
	web                             uintptr
	sidebarButton, ochoButton       uintptr
	inspectorButton                 uintptr
	ghost                           uintptr
	ghostFrames                     []uintptr
	ghostFrame                      int

	mu               sync.Mutex
	replies          map[string]chan json.RawMessage
	closing          bool
	shutdownComplete bool
	storageRelocated bool
	restartRequested bool
	recovering       bool
	smokeStarted     bool
}

var theApp *app

const (
	toggleSidebar = iota + 1
	toggleAssistant
	toggleInspector
)

var (
	deleteCallback = purego.NewCallback(func(widget, event, data uintptr) bool {
		if theApp.finished() {
			return false
		}
		go theApp.requestExit()
		return true
	})
	buttonCallback = purego.NewCallback(func(button, data uintptr) {
		events := map[uintptr]string{toggleSidebar: "workbench-toggle-sidebar", toggleAssistant: "workbench-toggle-assistant", toggleInspector: "workbench-toggle-inspector"}
		theApp.eval("window.dispatchEvent(new Event('" + events[data] + "'))")
	})
	ghostCallback = purego.NewCallback(func(data uintptr) int32 {
		a := theApp
		if len(a.ghostFrames) > 1 {
			a.ghostFrame = (a.ghostFrame + 1) % len(a.ghostFrames)
			gtkImageSetFromPixbuf(a.ghost, a.ghostFrames[a.ghostFrame])
		}
		return 1 // G_SOURCE_CONTINUE
	})
	messageCallback = purego.NewCallback(func(manager, result, data uintptr) {
		theApp.receive(takeString(jscValueToString(webkitJavascriptResultGetJSValue(result))))
	})
	// 只允许在本地服务的页面内导航；用户点击打开的外部链接（如获取 AI 密钥）交给系统浏览器。
	policyCallback = purego.NewCallback(func(view, decision uintptr, kind int32, data uintptr) bool {
		if kind != 0 && kind != 1 { // NAVIGATION_ACTION、NEW_WINDOW_ACTION
			return false
		}
		action := webkitNavigationPolicyDecisionGetNavigationAction(decision)
		target := webkitURIRequestGetURI(webkitNavigationActionGetRequest(action))
		if kind == 0 && theApp.trusted(target) {
			webkitPolicyDecisionUse(decision)
			return true
		}
		webkitPolicyDecisionIgnore(decision)
		if kind == 1 && externalLink(target) && webkitNavigationActionIsUserGesture(action) && theApp.trusted(webkitWebViewGetURI(view)) {
			_ = openPath(target)
		}
		return true
	})
	// 只为本地页面开放麦克风，用于录制参考音色；摄像头等其余请求一律拒绝。
	permissionCallback = purego.NewCallback(func(view, request, data uintptr) bool {
		if gTypeCheckInstanceIsA(request, webkitUserMediaPermissionRequestGetType()) &&
			webkitUserMediaPermissionIsForAudioDevice(request) && !webkitUserMediaPermissionIsForVideoDevice(request) &&
			theApp.trusted(webkitWebViewGetURI(view)) {
			webkitPermissionRequestAllow(request)
		} else {
			webkitPermissionRequestDeny(request)
		}
		return true
	})
	// 页面进程崩溃时重新加载，任务和草稿继续由 Go 服务持有。
	crashCallback = purego.NewCallback(func(view uintptr, reason int32, data uintptr) {
		hostLog(theApp.root, "web.process_terminated", fmt.Errorf("reason %d", reason))
		webkitWebViewReload(view)
	})
	cookieCallback = purego.NewCallback(func(source, result, data uintptr) {
		a := theApp
		if origin := a.svc.Origin(); origin != "" && a.web != 0 {
			webkitWebViewLoadURI(a.web, origin+"/index.html")
		}
	})
	loadCallback = purego.NewCallback(func(view uintptr, event int32, data uintptr) {
		if event == 3 { // WEBKIT_LOAD_FINISHED
			theApp.runSmoke()
		}
	})
)

func newApp(root string) *app {
	a := &app{root: root, svc: newLocalService(root), replies: map[string]chan json.RawMessage{}}
	a.svc.failed = func(err error) { go a.recoverService(err) }
	theApp = a
	return a
}

// applyWebLanguages 把系统语言交给 WebKit：系统未安装对应 C 语言环境时，navigator.language
// 会退回 en-US，新数据目录的界面语言随之选错。
func applyWebLanguages() {
	languages := systemLanguages()
	if len(languages) == 0 {
		return
	}
	buffers := make([][]byte, len(languages))
	pointers := make([]uintptr, len(languages)+1)
	for i, language := range languages {
		buffers[i] = append([]byte(language), 0)
		pointers[i] = uintptr(unsafe.Pointer(&buffers[i][0]))
	}
	webkitWebContextSetPreferredLanguages(webkitWebContextGetDefault(), &pointers[0])
	runtime.KeepAlive(buffers)
}

// build 创建主窗口与标题栏；界面在本地服务就绪后加载。
func (a *app) build() {
	applyWebLanguages()
	applyStyle()
	a.window = gtkWindowNew(0)
	addClass(a.window, "yovoice")
	gtkWindowSetTitle(a.window, "yovoice")
	gtkWindowSetDefaultSize(a.window, 1280, 820)
	gtkWidgetSetSizeRequest(a.window, 960, 640)
	gtkWindowSetIconFromFile(a.window, filepath.Join(installDir(), "resources", "yovoice.png"), 0)
	connect(a.window, "delete-event", deleteCallback)

	a.header = gtkHeaderBarNew()
	addClass(a.header, "yovoice-titlebar")
	gtkHeaderBarSetShowCloseButton(a.header, true)
	gtkHeaderBarSetTitle(a.header, "yovoice")
	a.sidebarButton = a.headerButton("sidebar-show-symbolic", toggleSidebar)
	gtkHeaderBarPackStart(a.header, a.sidebarButton)
	a.inspectorButton = a.headerButton("sidebar-show-right-symbolic", toggleInspector)
	gtkHeaderBarPackEnd(a.header, a.inspectorButton)
	a.ochoButton = a.ghostButton()
	gtkHeaderBarPackEnd(a.header, a.ochoButton)
	gtkWindowSetTitlebar(a.window, a.header)

	a.content = gtkBoxNew(1, 0) // GTK_ORIENTATION_VERTICAL
	gtkContainerAdd(a.window, a.content)
	a.showStatus(T("正在打开 yovoice…", "Opening yovoice…"))
	a.applyLocale()
	gtkWidgetShowAll(a.window)
	// 两个开关等界面告知可用时再显示，与 Windows 标题栏一致。
	gtkWidgetSetVisible(a.inspectorButton, false)
	gtkWidgetSetVisible(a.ochoButton, false)
	gtkWidgetSetSensitive(a.sidebarButton, false)
}

// windowStyle 让标题栏与网页底色连成一片（与 macOS 透明标题栏一致）：去掉分隔线、渐变和阴影，
// 工具按钮无边框，只在悬停时显示浅色底。界面只有浅色，标题栏同样固定浅色，不随系统暗色主题变黑。
const windowStyle = `
window.yovoice, window.yovoice > box { background-color: #F7F7F7; }
headerbar.yovoice-titlebar, headerbar.yovoice-titlebar:backdrop {
  background: #F7F7F7; border: none; box-shadow: none;
  min-height: 38px; padding: 0 8px; color: #1F1F1F;
}
headerbar.yovoice-titlebar .title { font-weight: 500; font-size: 13px; color: #6B6B6B; }
headerbar.yovoice-titlebar:backdrop .title { color: #A0A0A0; }
button.yovoice-tool {
  background: none; border: none; box-shadow: none; border-radius: 6px;
  min-width: 28px; min-height: 28px; padding: 0; color: #3A3A3A; -gtk-icon-shadow: none;
}
button.yovoice-tool:hover { background-color: rgba(0, 0, 0, 0.06); }
button.yovoice-tool:active { background-color: rgba(0, 0, 0, 0.1); }
button.yovoice-tool:disabled { color: #C4C4C4; }
headerbar.yovoice-titlebar:backdrop button.yovoice-tool { color: #9A9A9A; }
label.yovoice-status { color: #8A8A8A; }
`

func applyStyle() {
	provider := gtkCssProviderNew()
	if gtkCssProviderLoadFromData(provider, windowStyle, len(windowStyle), 0) {
		gtkStyleContextAddProviderForScreen(gdkScreenGetDefault(), provider, 600) // GTK_STYLE_PROVIDER_PRIORITY_APPLICATION
	}
}

func addClass(widget uintptr, class string) {
	gtkStyleContextAddClass(gtkWidgetGetStyleContext(widget), class)
}

func (a *app) headerButton(icon string, action uintptr) uintptr {
	button := gtkButtonNewFromIconName(icon, 1) // GTK_ICON_SIZE_MENU
	gtkButtonSetRelief(button, 2)               // GTK_RELIEF_NONE
	addClass(button, "yovoice-tool")
	gSignalConnectData(button, "clicked", buttonCallback, action, 0, 0)
	return button
}

// ghostButton 是标题栏里的 Ocho：把帧序列切成单帧，以 10 帧/秒循环播放。
func (a *app) ghostButton() uintptr {
	button := gtkButtonNew()
	gtkButtonSetRelief(button, 2) // GTK_RELIEF_NONE
	addClass(button, "yovoice-tool")
	a.ghost = gtkImageNew()
	if strip := gdkPixbufNewFromFile(filepath.Join(installDir(), "resources", "ocho-ghost.png"), 0); strip != 0 {
		side := gdkPixbufGetHeight(strip)
		for x := int32(0); side > 0 && x+side <= gdkPixbufGetWidth(strip); x += side {
			frame := gdkPixbufNewSubpixbuf(strip, x, 0, side, side)
			a.ghostFrames = append(a.ghostFrames, gdkPixbufScaleSimple(frame, 22, 22, 2)) // GDK_INTERP_BILINEAR
			gObjectUnref(frame)
		}
	}
	if len(a.ghostFrames) > 0 {
		gtkImageSetFromPixbuf(a.ghost, a.ghostFrames[0])
		gTimeoutAdd(100, ghostCallback, 0)
	}
	gtkButtonSetImage(button, a.ghost)
	gSignalConnectData(button, "clicked", buttonCallback, toggleAssistant, 0, 0)
	return button
}

// applyLocale 刷新标题栏提示文字，界面语言切换后立即生效。
func (a *app) applyLocale() {
	gtkWidgetSetTooltipText(a.sidebarButton, T("切换侧栏", "Toggle Sidebar"))
	gtkWidgetSetTooltipText(a.ochoButton, T("切换 Ocho", "Toggle Ocho"))
	gtkWidgetSetTooltipText(a.inspectorButton, T("切换右侧面板", "Toggle Inspector"))
}

// showStatus 用一行文字替换内容区，用于启动中或界面无法打开时。
func (a *app) showStatus(text string) {
	a.clearContent()
	a.status = gtkLabelNew(text)
	addClass(a.status, "yovoice-status")
	gtkLabelSetLineWrap(a.status, true)
	gtkWidgetSetHalign(a.status, 3) // GTK_ALIGN_CENTER
	gtkWidgetSetValign(a.status, 3)
	gtkBoxPackStart(a.content, a.status, true, true, 24)
	gtkWidgetShowAll(a.status)
}

func (a *app) clearContent() {
	if a.status != 0 {
		gtkWidgetDestroy(a.status)
		a.status = 0
	}
	if a.web != 0 {
		gtkWidgetDestroy(a.web)
		a.web = 0
	}
}

func (a *app) finished() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.shutdownComplete
}

func (a *app) trusted(target string) bool {
	origin := a.svc.Origin()
	return origin != "" && (target == origin || strings.HasPrefix(target, origin+"/"))
}

// start 在后台启动本地服务，就绪后在主线程加载界面。
func (a *app) start() {
	if err := a.svc.Start(); err != nil {
		hostLog(a.root, "service.start_failed", err)
		ui(func() {
			a.showStatus(T("界面无法打开。", "The interface couldn't open.") + "\n" + err.Error())
			if alert(a.window, T("无法启动本地服务", "Couldn't Start the Local Service"), err.Error(), T("重试", "Try Again"), T("退出", "Quit")) == 0 {
				a.showStatus(T("正在打开 yovoice…", "Opening yovoice…"))
				go a.start()
				return
			}
			a.mu.Lock()
			a.shutdownComplete = true
			a.mu.Unlock()
			gtkMainQuit()
		})
		return
	}
	ui(a.loadWeb)
}

func (a *app) sidebarScript() string {
	saved, _ := os.ReadFile(filepath.Join(a.root, "sidebar.json"))
	encoded, _ := json.Marshal(string(saved))
	// 本地服务端口每次启动会变化，localStorage 随之清空，因此由宿主恢复侧栏偏好。
	return `const savedSidebar = ` + string(encoded) + `;
if (savedSidebar) localStorage.setItem('astryx-resizable:workbench-sidebar', savedSidebar);
window.__workbenchPlatform = 'linux';
window.__workbenchMediaBase = '/media/';
// WebKitGTK 2.52 的 GTK 3 版执行视图过渡时宿主进程会空指针崩溃（Xvfb 冒烟稳定复现）；
// 隐藏该接口，界面按“不支持视图过渡”直接切换，结果一致，只是没有过渡动画。
delete Document.prototype.startViewTransition;
// 桌面应用不显示浏览器默认右键菜单。
window.addEventListener('contextmenu', event => event.preventDefault(), true);
const callbacks = new Set();
window.__workbenchReceive = data => callbacks.forEach(fn => fn({data}));
const host = window.webkit.messageHandlers.workbench;
window.chrome = {webview: {postMessage: data => host.postMessage(JSON.stringify(data)), addEventListener: (name, fn) => callbacks.add(fn)}};
window.addEventListener('DOMContentLoaded', () => {
  const events = new EventSource('/api/state-events');
  events.onmessage = event => window.__workbenchReceive(JSON.parse(event.data));
          events.onerror = () => window.__workbenchReceive({event: 'audio-disconnected'});
});`
}

// loadWeb 重建网页视图：服务重启后端口与凭证都会变化，旧页面不能复用。
func (a *app) loadWeb() {
	a.clearContent()
	if _, err := os.Stat(filepath.Join(installDir(), "web", "index.html")); err != nil {
		a.showStatus(T("界面文件缺失，请重新安装应用。", "Interface files are missing. Reinstall the app."))
		return
	}
	manager := webkitUserContentManagerNew()
	webkitUserContentManagerRegisterHandler(manager, "workbench")
	connect(manager, "script-message-received::workbench", messageCallback)
	script := webkitUserScriptNew(a.sidebarScript(), 1, 0, 0, 0) // 仅顶层框架、文档开始时
	webkitUserContentManagerAddScript(manager, script)
	webkitUserScriptUnref(script)
	a.web = webkitWebViewNewWithUserContentManager(manager)
	gObjectUnref(manager)
	settings := webkitWebViewGetSettings(a.web)
	webkitSettingsSetEnableDeveloperExtras(settings, os.Getenv("WORKBENCH_DEBUG") == "1")
	webkitSettingsSetEnableMediaStream(settings, true)
	webkitSettingsSetMediaPlaybackRequiresUserGesture(settings, false)
	background := [4]float64{247.0 / 255, 247.0 / 255, 247.0 / 255, 1}
	webkitWebViewSetBackgroundColor(a.web, &background)
	connect(a.web, "decide-policy", policyCallback)
	connect(a.web, "permission-request", permissionCallback)
	connect(a.web, "web-process-terminated", crashCallback)
	connect(a.web, "load-changed", loadCallback)
	gtkBoxPackStart(a.content, a.web, true, true, 0)
	gtkWidgetShowAll(a.web)
	gtkWidgetSetSensitive(a.sidebarButton, true)
	gtkWidgetGrabFocus(a.web)
	// 会话凭证以 HttpOnly Cookie 交给页面，写入完成后再加载，避免首个请求被拒。
	cookie := soupCookieNew(a.svc.cookieName(), a.svc.token, "127.0.0.1", "/", -1)
	soupCookieSetHTTPOnly(cookie, true)
	webkitCookieManagerAddCookie(webkitWebContextGetCookieManager(webkitWebViewGetContext(a.web)), cookie, 0, cookieCallback, 0)
	soupCookieFree(cookie)
}

// eval 在页面中执行脚本，不等待结果。
func (a *app) eval(script string) {
	if a.web == 0 {
		return
	}
	if webkitWebViewEvaluateJavascript != nil {
		webkitWebViewEvaluateJavascript(a.web, script, len(script), 0, 0, 0, 0, 0)
	} else {
		webkitWebViewRunJavascript(a.web, script, 0, 0, 0)
	}
}

// post 把回复或推送交给页面的 chrome.webview 监听器；可在任意线程调用。
func (a *app) post(value any) {
	b, err := json.Marshal(value)
	if err != nil {
		return
	}
	ui(func() { a.eval("window.__workbenchReceive(" + string(b) + ")") })
}

type message struct {
	ID     string          `json:"id"`
	Method string          `json:"method"`
	Data   json.RawMessage `json:"data"`
}

// receive 在主线程收到页面消息：宿主自己的回执直接交给等待者，其余在后台处理，避免对话框和服务调用阻塞界面。
func (a *app) receive(raw string) {
	if a.web == 0 || !a.trusted(webkitWebViewGetURI(a.web)) || len(raw) > 28*1024*1024 {
		return
	}
	var m message
	if json.Unmarshal([]byte(raw), &m) != nil || m.ID == "" {
		return
	}
	if m.Method == "host.reply" {
		a.mu.Lock()
		reply := a.replies[m.ID]
		delete(a.replies, m.ID)
		a.mu.Unlock()
		if reply != nil {
			reply <- m.Data
		}
		return
	}
	if len(m.Data) == 0 {
		m.Data = json.RawMessage("{}")
	}
	go a.handle(m)
}

// read 在页面中求值表达式并取回 JSON 结果；页面不可用或超时返回 null。只能在后台 goroutine 中调用。
func (a *app) read(expression string) json.RawMessage {
	if !uiWait(func() bool { return a.web != 0 }) {
		return json.RawMessage("null")
	}
	id := newID()
	reply := make(chan json.RawMessage, 1)
	a.mu.Lock()
	a.replies[id] = reply
	a.mu.Unlock()
	defer func() { a.mu.Lock(); delete(a.replies, id); a.mu.Unlock() }()
	ui(func() {
		a.eval(`(async () => { let data = null; try { data = await (` + expression + `); } catch {} window.webkit.messageHandlers.workbench.postMessage(JSON.stringify({id: '` + id + `', method: 'host.reply', data: data ?? null})); })()`)
	})
	select {
	case data := <-reply:
		if len(data) == 0 {
			return json.RawMessage("null")
		}
		return data
	case <-time.After(5 * time.Second):
		return json.RawMessage("null")
	}
}

// draft 取出界面里尚在自动保存防抖窗口内的正文，没有未保存修改时为 null。
func (a *app) draft() json.RawMessage { return a.read("window.__workbenchDraft") }

// backupDraft 让用户选择位置保存当前正文的恢复备份；取消或写入失败返回 false。
// 备份不走业务校验，保留导致保存失败的原始作品，且不改动已有状态文件。
func (a *app) backupDraft(draft json.RawMessage) bool {
	path := uiWait(func() string {
		return choose(a.window, chooseSave, T("保存作品恢复备份", "Save Work Recovery Backup"), "yovoice-recovery-"+time.Now().Format("20060102-150405")+".json", fileFilter{T("作品恢复备份", "Work Recovery Backup"), []string{"json"}})
	})
	if path == "" {
		return false
	}
	if err := writeAtomic(path, draft); err != nil {
		uiWait(func() int { return alert(a.window, T("备份失败", "Backup Failed"), err.Error()) })
		return false
	}
	hostLog(a.root, "draft.backup_completed", nil)
	return true
}

func (a *app) ask(title, body string, buttons ...string) int {
	return uiWait(func() int { gtkWindowPresent(a.window); return alert(a.window, title, body, buttons...) })
}

// requestExit 关闭窗口即退出：Linux 没有统一可用的托盘，隐藏窗口会让用户找不回应用。
// 先确认运行中的操作，保存正文，再请求服务关停；任何一步失败都留出直接退出的路径。
func (a *app) requestExit() {
	a.mu.Lock()
	if a.closing || a.shutdownComplete {
		a.mu.Unlock()
		return
	}
	a.closing = true
	relocated := a.storageRelocated
	a.mu.Unlock()
	cancel := func() { a.mu.Lock(); a.closing = false; a.mu.Unlock() }
	hostLog(a.root, "exit.requested", nil)
	if a.svc.Alive() && a.svc.Running() && a.ask(T("退出 yovoice？", "Quit yovoice?"), T("当前操作尚未结束。退出将取消操作，已下载的部分文件和正文会保留。", "An operation is still running. Quitting will cancel it; partially downloaded files and your text are kept."), T("退出", "Quit"), T("继续使用", "Keep Using")) != 0 {
		cancel()
		return
	}
	// 关闭前读取最新正文，避免自动保存的防抖窗口丢字；迁移完成后旧目录冻结写入，不再保存。
	if draft := a.draft(); !relocated && string(draft) != "null" {
		var err error
		if !a.svc.Alive() {
			err = fmt.Errorf("%s", T("本地服务尚未就绪。", "The local service isn't ready."))
		} else if _, err = a.svc.Call("draft.save", draft, 0); err == nil {
			hostLog(a.root, "exit.save_completed", nil)
		}
		var ce *callError
		if err != nil && !(asCallError(err, &ce) && ce.Code() == storageRestartRequired) {
			hostLog(a.root, "exit.save_failed", err)
			if !a.confirmUnsaved(err, draft) {
				cancel()
				return
			}
		}
	}
	if err := a.svc.Shutdown(); err != nil {
		hostLog(a.root, "exit.failed", err)
		if a.ask(T("未能安全退出", "Couldn't Quit Safely"), err.Error()+T("\n\n可以稍后重试，或直接结束本地服务后退出；未保存的编辑可能丢失。", "\n\nTry again later, or stop the local service and quit now; unsaved edits may be lost."), T("仍要退出", "Quit Anyway"), T("返回", "Back")) != 0 {
			cancel()
			return
		}
		a.svc.Stop()
	}
	hostLog(a.root, "exit.completed", nil)
	a.mu.Lock()
	a.shutdownComplete = true
	restart := a.restartRequested
	a.mu.Unlock()
	if restart {
		a.relaunch()
	}
	ui(gtkMainQuit)
}

// confirmUnsaved 在保存失败时提供备份后退出、直接退出或返回编辑；返回 true 表示继续退出。
func (a *app) confirmUnsaved(err error, draft json.RawMessage) bool {
	for {
		switch a.ask(T("作品保存失败", "Couldn't Save Your Work"), err.Error()+T("\n\n可以备份当前作品后退出，也可以直接退出或返回编辑。", "\n\nYou can back up your work and quit, quit without saving, or go back to editing."), T("备份后退出", "Back Up and Quit"), T("返回编辑", "Back to Editing"), T("直接退出", "Quit Anyway")) {
		case 0:
			if a.backupDraft(draft) {
				return true
			}
		case 2:
			hostLog(a.root, "exit.save_discarded", nil)
			return true
		default:
			return false
		}
	}
}

// recoverService 在本地服务意外停止后取出未保存的正文，由用户选择重新启动或退出；
// 重启成功后补存正文再重新加载界面，补存失败时提供备份，避免修改丢失。
func (a *app) recoverService(cause error) {
	a.mu.Lock()
	if a.recovering || a.closing || a.shutdownComplete {
		a.mu.Unlock()
		return
	}
	a.recovering = true
	a.mu.Unlock()
	defer func() { a.mu.Lock(); a.recovering = false; a.mu.Unlock() }()
	draft := a.draft()
	text := cause.Error()
	for {
		if a.ask(T("本地服务已停止", "Local Service Stopped"), text+T("\n\n可以重新启动本地服务继续使用，未保存的修改会在重启后补存。", "\n\nRestart the local service to keep working; unsaved changes will be saved after it restarts."), T("重新启动", "Restart"), T("退出", "Quit")) != 0 {
			a.mu.Lock()
			a.recovering = false
			a.mu.Unlock()
			a.requestExit()
			return
		}
		err := a.svc.Start()
		if err == nil {
			hostLog(a.root, "service.restarted", nil)
			break
		}
		hostLog(a.root, "service.restart_failed", err)
		text = T("本地服务重新启动失败：", "The local service couldn't restart: ") + err.Error()
	}
	if string(draft) != "null" {
		if _, err := a.svc.Call("draft.save", draft, 0); err != nil {
			hostLog(a.root, "service.draft_restore_failed", err)
			for a.ask(T("未能补存修改", "Couldn't Restore Your Changes"), err.Error()+T("\n\n可以将重启前的作品另存为恢复备份；放弃后界面将显示上次保存的内容。", "\n\nYou can save the work from before the restart as a recovery backup. If you discard it, the last saved version will be shown."), T("备份", "Back Up"), T("放弃", "Discard")) == 0 {
				if a.backupDraft(draft) {
					break
				}
			}
		}
	}
	ui(a.loadWeb)
}

// relaunch 由独立的 shell 等待当前进程退出、释放单实例锁后再打开应用，用于数据目录迁移后重启。
func (a *app) relaunch() {
	executable, err := os.Executable()
	if err == nil {
		cmd := exec.Command("/bin/sh", "-c", `while kill -0 "$1" 2>/dev/null; do sleep 0.2; done; exec "$2"`, "yovoice-relaunch", strconv.Itoa(os.Getpid()), executable)
		cmd.Stdin, cmd.Stdout, cmd.Stderr = nil, nil, nil
		if err = cmd.Start(); err == nil {
			hostLog(a.root, "restart.launched", nil)
			return
		}
	}
	hostLog(a.root, "restart.failed", err)
}

// runSmoke 在 CI 中验证真实 WebKitGTK 里的桥接与保存：执行脚本、写出结果后正常退出。
func (a *app) runSmoke() {
	path := os.Getenv("WORKBENCH_SMOKE_SCRIPT")
	if path == "" || a.smokeStarted {
		return
	}
	a.smokeStarted = true
	go func() {
		source, err := os.ReadFile(path)
		var result json.RawMessage
		if err == nil {
			id := newID()
			reply := make(chan json.RawMessage, 1)
			a.mu.Lock()
			a.replies[id] = reply
			a.mu.Unlock()
			ui(func() {
				a.eval(`(async () => { let data; try { data = {result: await (async () => {` + string(source) + `})()}; } catch (error) { data = {error: String(error) + '\n' + (error && error.stack || '')}; } window.webkit.messageHandlers.workbench.postMessage(JSON.stringify({id: '` + id + `', method: 'host.reply', data})); })()`)
			})
			select {
			case result = <-reply:
			case <-time.After(60 * time.Second):
				err = fmt.Errorf("smoke script timed out")
			}
		}
		var outcome struct {
			Result json.RawMessage `json:"result"`
			Error  string          `json:"error"`
		}
		if err == nil {
			if err = json.Unmarshal(result, &outcome); err == nil && outcome.Error != "" {
				err = fmt.Errorf("%s", outcome.Error)
			}
		}
		if err != nil {
			_ = os.WriteFile(filepath.Join(a.root, "smoke-error.txt"), []byte(err.Error()), 0600)
		} else {
			_ = os.WriteFile(filepath.Join(a.root, "smoke-result.json"), outcome.Result, 0600)
		}
		a.requestExit()
	}()
}

// externalLink 判断链接能否交给系统浏览器：https，或回环地址的 http（连本机的社区服务调试时，登录确认页在 localhost 上）。
func externalLink(target string) bool {
	if strings.HasPrefix(target, "https://") {
		return true
	}
	rest, ok := strings.CutPrefix(target, "http://")
	if !ok {
		return false
	}
	host, _, _ := strings.Cut(rest, "/")
	host, _, _ = strings.Cut(host, ":")
	return host == "localhost" || host == "127.0.0.1"
}
