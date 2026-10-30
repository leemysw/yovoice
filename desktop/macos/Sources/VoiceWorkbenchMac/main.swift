import AppKit
import AVFoundation
import WebKit
import UniformTypeIdentifiers

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    private var window: NSWindow!
    private var web: WKWebView!
    private var assistantButton: NSButton?
    private var inspectorVisible = false
    private var assistantEntryVisible = false
    private var ghostTimer: Timer?
    private var inspectorButton: NSButton?
    // 服务崩溃后可在应用内重新启动：Process 只能运行一次，每次启动都换新的进程与管道。
    private var service = Process()
    private var input = Pipe()
    private var origin: URL?
    private var restartingService = false
    // 服务重启前页面里尚未落盘的修改，新服务就绪后先补存再刷新页面。
    private var pendingDraft: [String: Any]?
    private let token = UUID().uuidString + UUID().uuidString
    private var closing = false
    private var shutdownComplete = false
    // 数据目录迁移完成后旧目录已冻结写入：退出时不再保存正文，并在退出后自动重新打开应用。
    private var storageRelocated = false
    private var relaunchOnExit = false
    private var updater: AppUpdater?
    // 延迟到单实例检查之后解析，数据目录缺失时才弹出处理选项。
    private lazy var root: URL = DataRoot.confirmAvailable(DataRoot.resolve())
    private var cookieName: String { "vw-" + token.prefix(12) }

    func applicationDidFinishLaunching(_ notification: Notification) {
        if let identifier = Bundle.main.bundleIdentifier,
           let existing = NSRunningApplication.runningApplications(withBundleIdentifier: identifier).first(where: { $0.processIdentifier != ProcessInfo.processInfo.processIdentifier }) {
            existing.activate(options: [.activateAllWindows])
            shutdownComplete = true
            NSApp.terminate(nil)
            return
        }
        NSApp.setActivationPolicy(.regular)
        makeMenu()
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 840), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "yovoice"
        window.titlebarSeparatorStyle = .none
        window.titlebarAppearsTransparent = true
        window.backgroundColor = NSColor(srgbRed: 247.0 / 255.0, green: 247.0 / 255.0, blue: 247.0 / 255.0, alpha: 1.0)
        let accessory = NSTitlebarAccessoryViewController()
        accessory.layoutAttribute = .left
        let sidebarButton = NSButton(image: NSImage(systemSymbolName: "sidebar.left", accessibilityDescription: HostL10n.t("sidebar.toggle"))!, target: self, action: #selector(toggleSidebar))
        sidebarButton.isBordered = false
        sidebarButton.toolTip = HostL10n.t("sidebar.tooltip")
        sidebarButton.frame = NSRect(x: 0, y: 0, width: 32, height: 28)
        // 按钮不能直接当附件视图：macOS 26 上按钮的固有尺寸会与标题栏布局互相拉扯，布局无法收敛而抛异常崩溃。
        // 与右侧一样放进固定大小的普通容器里，由容器 frame 决定附件尺寸。
        let sidebarContainer = NSView(frame: NSRect(x: 0, y: 0, width: 32, height: 28))
        sidebarContainer.addSubview(sidebarButton)
        accessory.view = sidebarContainer
        window.addTitlebarAccessoryViewController(accessory)
        let rightAccessory = NSTitlebarAccessoryViewController()
        rightAccessory.layoutAttribute = .right
        let inspectorButton = NSButton(image: NSImage(systemSymbolName: "sidebar.right", accessibilityDescription: HostL10n.t("inspector.toggle"))!, target: self, action: #selector(toggleInspector))
        inspectorButton.isBordered = false
        inspectorButton.toolTip = HostL10n.t("inspector.tooltip")
        inspectorButton.frame = NSRect(x: 0, y: 0, width: 32, height: 28)
        // 助手按钮只在网页右下角入口被移走后出现，面板开关状态由前端统一管理。
        let assistantButton = NSButton(image: Self.ghostOutline(), target: self, action: #selector(toggleAssistant))
        assistantButton.setAccessibilityLabel(HostL10n.t("assistant.toggle"))
        assistantButton.imageScaling = .scaleProportionallyDown
        animateGhost(assistantButton)
        assistantButton.isBordered = false
        assistantButton.toolTip = HostL10n.t("assistant.tooltip")
        assistantButton.frame = NSRect(x: 0, y: 0, width: 32, height: 28)
        // 标题栏附件按 view 的 frame 定尺寸，用固定大小的容器手动排布；NSStackView 在这里会被压成零宽而看不见。
        let titleButtons = NSView(frame: NSRect(x: 0, y: 0, width: 66, height: 28))
        titleButtons.addSubview(assistantButton)
        titleButtons.addSubview(inspectorButton)
        rightAccessory.view = titleButtons
        window.addTitlebarAccessoryViewController(rightAccessory)
        self.assistantButton = assistantButton
        self.inspectorButton = inspectorButton
        // 两个按钮都由前端通知显隐：右侧面板按钮只在工作区出现，助手按钮只在右下角入口移走后出现。
        layoutTitleButtons()
        window.minSize = NSSize(width: 960, height: 600)
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.center()
        // 本地服务启动前的占位：与网页启动动画同底色，文字居中，避免先闪一下左下角的系统样式。
        let loading = NSTextField(labelWithString: HostL10n.t("loading"))
        loading.textColor = .secondaryLabelColor
        loading.alignment = .center
        loading.translatesAutoresizingMaskIntoConstraints = false
        if let content = window.contentView {
            content.addSubview(loading)
            NSLayoutConstraint.activate([loading.centerXAnchor.constraint(equalTo: content.centerXAnchor), loading.centerYAnchor.constraint(equalTo: content.centerYAnchor)])
        }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        do { try startService() } catch { showError(error) }
        updater?.start()
    }

    @objc private func toggleSidebar() {
        // 侧栏状态由前端统一管理，标题栏仅发送切换事件。
        web?.evaluateJavaScript("window.dispatchEvent(new Event('workbench-toggle-sidebar'))", completionHandler: nil)
    }

    @objc private func toggleInspector() {
        // 检查器状态由前端统一管理，标题栏仅发送切换事件。
        web?.evaluateJavaScript("window.dispatchEvent(new Event('workbench-toggle-inspector'))", completionHandler: nil)
    }

    // 标题栏里的 Ocho：逐帧播放与界面一致的毛绒小幽灵（帧序列由网页里的 bot-avatars 录制，见 Resources/ocho-ghost.png）。
    // 资源缺失时（如未打包直接运行）退回一张静态的幽灵线稿。
    private static func ghostFrames() -> [NSImage] {
        guard let url = Bundle.main.url(forResource: "ocho-ghost", withExtension: "png"),
              let strip = NSImage(contentsOf: url)?.cgImage(forProposedRect: nil, context: nil, hints: nil), strip.height > 0 else { return [ghostOutline()] }
        let side = strip.height
        return (0..<(strip.width / side)).compactMap { index in
            strip.cropping(to: CGRect(x: index * side, y: 0, width: side, height: side)).map { NSImage(cgImage: $0, size: NSSize(width: 20, height: 20)) }
        }
    }

    private static func ghostOutline() -> NSImage {
        let image = NSImage(size: NSSize(width: 16, height: 16), flipped: true) { _ in
            NSColor.black.setStroke()
            NSColor.black.setFill()
            let body = NSBezierPath()
            body.move(to: NSPoint(x: 8, y: 1.5))
            body.curve(to: NSPoint(x: 2.5, y: 7.5), controlPoint1: NSPoint(x: 4.4, y: 1.5), controlPoint2: NSPoint(x: 2.5, y: 4))
            body.line(to: NSPoint(x: 2.5, y: 14.5))
            for (x, y) in [(4.3, 13.0), (6.1, 14.5), (8.0, 13.0), (9.9, 14.5), (11.7, 13.0), (13.5, 14.5)] { body.line(to: NSPoint(x: x, y: y)) }
            body.line(to: NSPoint(x: 13.5, y: 7.5))
            body.curve(to: NSPoint(x: 8, y: 1.5), controlPoint1: NSPoint(x: 13.5, y: 4), controlPoint2: NSPoint(x: 11.6, y: 1.5))
            body.close()
            body.lineWidth = 1.2
            body.lineJoinStyle = .round
            body.stroke()
            NSBezierPath(ovalIn: NSRect(x: 5.4, y: 6, width: 1.8, height: 2.2)).fill()
            NSBezierPath(ovalIn: NSRect(x: 8.8, y: 6, width: 1.8, height: 2.2)).fill()
            return true
        }
        image.isTemplate = true
        return image
    }

    // animateGhost 以 10 帧/秒循环播放；系统开启“减弱动态效果”时停在第一帧。
    private func animateGhost(_ button: NSButton) {
        let frames = Self.ghostFrames()
        button.image = frames.first
        guard frames.count > 1, !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion else { return }
        var index = 0
        ghostTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak button] _ in
            index = (index + 1) % frames.count
            button?.image = frames[index]
        }
    }

    @objc private func toggleAssistant() {
        // 助手面板状态由前端统一管理，标题栏仅发送切换事件。
        web?.evaluateJavaScript("window.dispatchEvent(new Event('workbench-toggle-assistant'))", completionHandler: nil)
    }

    // 右侧面板按钮贴最右；不在工作区时隐藏，助手按钮补到最右，避免留空位。
    // 播放页打开时网页铺到标题栏下面，标题栏与播放页背景融为一体，只留红绿灯；
    // chrome 为假（播放中静置、控件隐藏）时红绿灯也隐藏，录屏画面里没有窗口按钮。关闭播放页后恢复原样。
    private func setImmersive(_ active: Bool, chrome: Bool) {
        if active { window.styleMask.insert(.fullSizeContentView) } else { window.styleMask.remove(.fullSizeContentView) }
        window.titleVisibility = active ? .hidden : .visible
        window.titlebarAccessoryViewControllers.forEach { $0.isHidden = active }
        for kind in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton] { window.standardWindowButton(kind)?.isHidden = active && !chrome }
    }
    private func layoutTitleButtons() {
        inspectorButton?.isHidden = !inspectorVisible
        assistantButton?.isHidden = !assistantEntryVisible
        inspectorButton?.frame = NSRect(x: 34, y: 0, width: 32, height: 28)
        assistantButton?.frame = NSRect(x: inspectorVisible ? 0 : 34, y: 0, width: 32, height: 28)
    }

    @objc private func showAbout() {
        let repository = "https://github.com/leemysw/yovoice"
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = .center
        let credits = NSMutableAttributedString(
            string: HostL10n.t("about.credits"),
            attributes: [.font: NSFont.systemFont(ofSize: NSFont.systemFontSize), .paragraphStyle: paragraph]
        )
        credits.append(NSAttributedString(
            string: repository,
            attributes: [.link: repository, .paragraphStyle: paragraph]
        ))
        NSApp.orderFrontStandardAboutPanel(options: [.credits: credits])
    }

    private func makeMenu() {
        let menu = NSMenu()
        let appItem = NSMenuItem()
        menu.addItem(appItem)
        appItem.submenu = NSMenu()
        let aboutItem = appItem.submenu?.addItem(withTitle: HostL10n.t("menu.about"), action: #selector(showAbout), keyEquivalent: "")
        aboutItem?.target = self
        let updateItem = NSMenuItem(title: HostL10n.t("menu.checkUpdates"), action: nil, keyEquivalent: "")
        appItem.submenu?.addItem(updateItem)
        updater = AppUpdater(menuItem: updateItem, root: root)
        updater?.onChange = { [weak self] snapshot in
            guard let self, self.web != nil else { return }
            self.post(["event": "update", "update": snapshot.json])
        }
        // 菜单“检查更新”在界面内打开更新详情；界面尚未就绪时由更新器弹原生对话框。
        updater?.showInApp = { [weak self] in
            guard let self, let web = self.web, web.url != nil else { return false }
            self.window.makeKeyAndOrderFront(nil)
            web.evaluateJavaScript("window.dispatchEvent(new Event('workbench-show-update'))", completionHandler: nil)
            return true
        }
        appItem.submenu?.addItem(.separator())
        appItem.submenu?.addItem(withTitle: HostL10n.t("menu.quit"), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let edit = NSMenuItem()
        menu.addItem(edit)
        edit.submenu = NSMenu(title: HostL10n.t("menu.edit"))
        for (title, action, key) in [(HostL10n.t("menu.undo"), "undo:", "z"), (HostL10n.t("menu.cut"), "cut:", "x"), (HostL10n.t("menu.copy"), "copy:", "c"), (HostL10n.t("menu.paste"), "paste:", "v"), (HostL10n.t("menu.selectAll"), "selectAll:", "a")] {
            edit.submenu?.addItem(withTitle: title, action: Selector(action), keyEquivalent: key)
        }
        let windowItem = NSMenuItem()
        menu.addItem(windowItem)
        windowItem.submenu = NSMenu(title: HostL10n.t("menu.window"))
        windowItem.submenu?.addItem(withTitle: HostL10n.t("menu.minimize"), action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        NSApp.windowsMenu = windowItem.submenu
        NSApp.mainMenu = menu
    }

    private func startService() throws {
        let resources = Bundle.main.resourceURL!
        let executable = resources.appendingPathComponent("service/yovoice-service")
        guard FileManager.default.isExecutableFile(atPath: executable.path) else { throw failure(HostL10n.t("err.serviceMissing")) }
        if ProcessInfo.processInfo.environment["WORKBENCH_DATA"] == nil {
            let migration = Process()
            migration.executableURL = executable
            migration.arguments = ["--prepare-data"]
            let errors = Pipe()
            migration.standardError = errors
            try migration.run()
            migration.waitUntilExit()
            guard migration.terminationStatus == 0 else { throw failure(HostL10n.t("err.migrateFailed")) }
        }
        try FileManager.default.createDirectory(at: root.appendingPathComponent("logs"), withIntermediateDirectories: true)
        self.service = Process()
        self.input = Pipe()
        let service = self.service, input = self.input
        service.executableURL = executable
        var environment = ProcessInfo.processInfo.environment
        environment["WORKBENCH_DATA"] = root.path
        environment["WORKBENCH_WEB"] = resources.appendingPathComponent("web").path
        environment["WORKBENCH_TOKEN"] = token
        environment["WORKBENCH_ENGINE"] = resources.appendingPathComponent("engine/audiocpp_server").path
        service.environment = environment
        service.standardInput = input
        let output = Pipe()
        service.standardOutput = output
        let log = root.appendingPathComponent("logs/host-service.log")
        // 服务日志追加写入同一文件，超过 5MB 才滚动为 .1；崩溃后重启时上一轮的出错原因仍在文件中。
        let size = (try? FileManager.default.attributesOfItem(atPath: log.path)[.size] as? NSNumber)?.int64Value ?? 0
        if size >= 5 * 1024 * 1024 {
            let previous = root.appendingPathComponent("logs/host-service.log.1")
            try? FileManager.default.removeItem(at: previous)
            try? FileManager.default.moveItem(at: log, to: previous)
        }
        if !FileManager.default.fileExists(atPath: log.path) { FileManager.default.createFile(atPath: log.path, contents: nil) }
        let handle = try FileHandle(forWritingTo: log)
        _ = handle.seekToEndOfFile()
        handle.write("\n===== \(ISO8601DateFormatter().string(from: Date())) service =====\n".data(using: .utf8)!)
        service.standardError = handle
        service.terminationHandler = { [weak self] process in
            Task { @MainActor in
                guard let self, !self.closing, process === self.service else { return }
                self.serviceStopped(process.terminationStatus)
            }
        }
        try service.run()
        // 子进程已继承日志文件，宿主侧的句柄随即关闭，避免每次重启服务都泄漏一个。
        try? handle.close()
        Task {
            try? await Task.sleep(for: .seconds(30))
            if origin == nil && service.isRunning && service === self.service && !closing {
                try? input.fileHandleForWriting.close()
                showError(failure(HostL10n.t("err.serviceTimeout")))
            }
        }
        // 仅首行输出启动地址，其余日志写入文件，避免把凭证暴露给前端或日志。
        DispatchQueue.global().async { [weak self] in
            var buffer = Data()
            while true {
                let data = output.fileHandleForReading.availableData
                if data.isEmpty { break }
                buffer.append(data)
                if let end = buffer.firstIndex(of: 10) {
                    let line = String(decoding: buffer[..<end], as: UTF8.self)
                    Task { @MainActor in self?.loadWeb(line) }
                    break
                }
            }
        }
    }

    private func loadWeb(_ address: String) {
        guard let url = URL(string: address), url.host == "127.0.0.1", url.scheme == "http" else { showError(failure(HostL10n.t("err.invalidAddress"))); return }
        origin = url
        // 服务重启后重建页面，先解除旧页面对宿主的引用。
        web?.configuration.userContentController.removeScriptMessageHandler(forName: "workbench")
        let configuration = WKWebViewConfiguration()
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.userContentController.add(self, name: "workbench")
        let savedSidebar = UserDefaults.standard.string(forKey: "sidebar-layout") ?? ""
        let sidebarJSON = String(data: try! JSONSerialization.data(withJSONObject: [savedSidebar]), encoding: .utf8)!
        let script = """
        // 本地服务端口每次启动会变化，因此由宿主恢复侧栏偏好。
        const savedSidebar = \(sidebarJSON)[0];
        if (savedSidebar) localStorage.setItem('astryx-resizable:workbench-sidebar', savedSidebar);
        window.__workbenchPlatform = 'macos';
        window.__workbenchMediaBase = '/media/';
        // 桌面应用不显示浏览器默认右键菜单。
        window.addEventListener('contextmenu', event => event.preventDefault(), true);
        const callbacks = new Set();
        window.__workbenchReceive = data => callbacks.forEach(fn => fn({data}));
        window.chrome = {webview: {postMessage: data => window.webkit.messageHandlers.workbench.postMessage(data), addEventListener: (name, fn) => callbacks.add(fn)}};
        window.addEventListener('DOMContentLoaded', () => {
          const events = new EventSource('/api/state-events');
          events.onmessage = event => window.__workbenchReceive(JSON.parse(event.data));
        });
        """
        configuration.userContentController.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        web = WKWebView(frame: window.contentView!.bounds, configuration: configuration)
        web.autoresizingMask = [.width, .height]
        web.navigationDelegate = self
        web.uiDelegate = self
        web.isInspectable = ProcessInfo.processInfo.environment["WORKBENCH_DEBUG"] == "1"
        web.underPageBackgroundColor = window.backgroundColor
        let cookie = HTTPCookie(properties: [.name: cookieName, .value: token, .domain: "127.0.0.1", .path: "/", .init("HttpOnly"): "TRUE"])!
        configuration.websiteDataStore.httpCookieStore.setCookie(cookie) { [weak self] in
            Task { @MainActor in
                guard let self else { return }
                await self.restorePendingDraft()
                self.window.contentView = self.web
                self.web.load(URLRequest(url: url))
            }
        }
    }

    private func trusted(_ url: URL?) -> Bool {
        guard let url, let origin else { return false }
        return url.scheme == origin.scheme && url.host == origin.host && url.port == origin.port
    }
    static func trusted(_ securityOrigin: WKSecurityOrigin, localOrigin: URL?) -> Bool {
        guard let localOrigin else { return false }
        return securityOrigin.protocol == localOrigin.scheme && securityOrigin.host == localOrigin.host && securityOrigin.port == localOrigin.port
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(trusted(navigationAction.request.url) ? .allow : .cancel)
    }
    // 页面不开新窗口；本地页面打开的 https 链接（如获取 AI 密钥）交给系统浏览器。
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, url.scheme == "https", trusted(webView.url) { NSWorkspace.shared.open(url) }
        return nil
    }
    #if DEBUG
    // 本地原生冒烟测试使用独立数据目录；发行构建不开放脚本入口。
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard let scriptPath = ProcessInfo.processInfo.environment["WORKBENCH_SMOKE_SCRIPT"] else { return }
        Task {
            do {
                let script = try String(contentsOfFile: scriptPath, encoding: .utf8)
                let result = try await webView.callAsyncJavaScript(script, arguments: [:], in: nil, contentWorld: .page)
                let data = try JSONSerialization.data(withJSONObject: result ?? [:], options: [.prettyPrinted])
                try data.write(to: root.appendingPathComponent("smoke-result.json"))
                let snapshot = try await webView.takeSnapshot(configuration: nil)
                if let tiff = snapshot.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff), let png = bitmap.representation(using: .png, properties: [:]) {
                    try png.write(to: root.appendingPathComponent("smoke.png"))
                }
            } catch {
                try? error.localizedDescription.write(to: root.appendingPathComponent("smoke-error.txt"), atomically: true, encoding: .utf8)
            }
            NSApp.terminate(nil)
        }
    }
    #endif
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        guard frame.isMainFrame, Self.trusted(frame.securityOrigin, localOrigin: origin) else { completionHandler(nil); return }
        let panel = NSOpenPanel()
        panel.title = HostL10n.t("panel.pickAudioOrSubtitles")
        panel.allowedContentTypes = [.audio] + ["srt", "vtt", "ass", "ssa"].compactMap { UTType(filenameExtension: $0) }
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.beginSheetModal(for: window) { response in completionHandler(response == .OK ? panel.urls : nil) }
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        // WebKit 620.1.16 的媒体授权回调留空 request，但保留请求页面的 securityOrigin。
        // 读取 frame.request 会在 Swift URLRequest 桥接时崩溃，必须直接校验安全来源。
        guard frame.isMainFrame, Self.trusted(frame.securityOrigin, localOrigin: self.origin), type == .microphone,
              Self.trusted(origin, localOrigin: self.origin), trusted(webView.url) else {
            decisionHandler(.deny)
            return
        }
        // 由系统请求 App 麦克风权限，避免再显示本地网页的授权弹窗。
        Task { @MainActor in
            let allowed = await AVCaptureDevice.requestAccess(for: .audio)
            decisionHandler(allowed && trusted(webView.url) ? .grant : .deny)
        }
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, Self.trusted(message.frameInfo.securityOrigin, localOrigin: origin), let body = message.body as? [String: Any], let id = body["id"] as? String else { return }
        Task {
            do {
                post(try await handle(body))
                if body["method"] as? String == "storage.directory", storageRelocated, !closing { promptRelaunch() }
            }
            catch { post(["id": id, "error": error.localizedDescription]) }
        }
    }

    private func handle(_ message: [String: Any]) async throws -> [String: Any] {
        var message = message
        var data = message["data"] as? [String: Any] ?? [:]
        let method = message["method"] as? String ?? ""
        if method == "inspector.available" {
            inspectorVisible = data["available"] as? Bool == true
            layoutTitleButtons()
            return ["id": message["id"]!, "result": true]
        }
        if method == "window.immersive" {
            setImmersive(data["active"] as? Bool == true, chrome: data["chrome"] as? Bool != false)
            return ["id": message["id"]!, "result": true]
        }
        if method == "assistant.entry" {
            assistantEntryVisible = data["visible"] as? Bool == true
            layoutTitleButtons()
            return ["id": message["id"]!, "result": true]
        }
        if method == "sidebar.save" {
            guard let size = data["size"] as? Double, size.isFinite, (180...360).contains(size), let collapsed = data["isCollapsed"] as? Bool else { throw failure(HostL10n.t("err.sidebarInvalid")) }
            let saved = try JSONSerialization.data(withJSONObject: ["size": size, "isCollapsed": collapsed])
            UserDefaults.standard.set(String(data: saved, encoding: .utf8), forKey: "sidebar-layout")
            return ["id": message["id"]!, "result": true]
        }
        if method == "project.export" {
            let panel = NSSavePanel()
            panel.allowedContentTypes = [UTType(filenameExtension: "yovoice") ?? .data]
            panel.nameFieldStringValue = (data["name"] as? String ?? "project") + ".yovoice"
            let response = await withCheckedContinuation { continuation in panel.beginSheetModal(for: window) { continuation.resume(returning: $0) } }
            guard response == .OK, let url = panel.url else { return ["id": message["id"]!, "result": false] }
            data["path"] = url.path
            message["data"] = data
        }
        if method == "logs.export" {
            // 诊断包由本地服务打包写入，宿主只负责选择保存位置。
            let panel = NSSavePanel()
            panel.allowedContentTypes = [.zip]
            let stamp = DateFormatter()
            stamp.dateFormat = "yyyyMMdd-HHmmss"
            panel.nameFieldStringValue = "yovoice-diagnostics-" + stamp.string(from: Date()) + ".zip"
            let response = await withCheckedContinuation { continuation in panel.beginSheetModal(for: window) { continuation.resume(returning: $0) } }
            guard response == .OK, let url = panel.url else { return ["id": message["id"]!, "result": false] }
            data["path"] = url.path
            message["data"] = data
        }
        if method == "score.export" {
            // 编曲导出 MIDI 或乐谱 JSON，扩展名由界面指定，写文件交给本地服务。
            let format = (data["format"] as? String) == "json" ? "json" : "mid"
            let panel = NSSavePanel()
            panel.allowedContentTypes = [UTType(filenameExtension: format) ?? .data]
            panel.nameFieldStringValue = (data["name"] as? String ?? "score") + "." + format
            let response = await withCheckedContinuation { continuation in panel.beginSheetModal(for: window) { continuation.resume(returning: $0) } }
            guard response == .OK, let url = panel.url else { return ["id": message["id"]!, "result": false] }
            data["path"] = url.path
            message["data"] = data
        }
        if method == "score.import" {
            let panel = NSOpenPanel()
            panel.allowedContentTypes = ["mid", "midi", "json"].compactMap { UTType(filenameExtension: $0) }
            panel.allowsMultipleSelection = false
            let response = await withCheckedContinuation { continuation in panel.beginSheetModal(for: window) { continuation.resume(returning: $0) } }
            guard response == .OK, let url = panel.url else { return ["id": message["id"]!, "result": NSNull()] }
            data["path"] = url.path
            message["data"] = data
        }
        if method == "project.import" {
            let panel = NSOpenPanel()
            panel.allowedContentTypes = [UTType(filenameExtension: "yovoice") ?? .data]
            panel.allowsMultipleSelection = false
            let response = await withCheckedContinuation { continuation in panel.beginSheetModal(for: window) { continuation.resume(returning: $0) } }
            guard response == .OK, let url = panel.url else { return ["id": message["id"]!, "result": NSNull()] }
            data["path"] = url.path
            message["data"] = data
        }
        if method == "audio.export" {
            // 时间线合成的音频已由网页上传到本地服务的临时文件，这里只选位置并复制，用完即删。
            let response = try await request("api/call", body: ["id": "export-path", "method": "export.path", "data": ["id": data["id"] ?? ""]])
            guard let source = response["result"] as? String else { throw failure(Self.hostErrorMessage(response["error"]) ?? HostL10n.t("err.audioPath")) }
            defer { try? FileManager.default.removeItem(atPath: source) }
            let panel = NSSavePanel()
            panel.allowedContentTypes = [UTType(filenameExtension: "wav") ?? .audio]
            panel.nameFieldStringValue = (data["name"] as? String ?? "yovoice.wav")
            let choice = await withCheckedContinuation { continuation in panel.beginSheetModal(for: window) { continuation.resume(returning: $0) } }
            guard choice == .OK, let url = panel.url else { return ["id": message["id"]!, "result": false] }
            try Data(contentsOf: URL(fileURLWithPath: source)).write(to: url, options: .atomic)
            return ["id": message["id"]!, "result": true]
        }
        if method == "output.export" {
            // 已生成的版本直接复制 outputs 中的文件，不经网页传音频字节，长歌也不受消息大小限制。
            let response = try await request("api/call", body: ["id": "media-path", "method": "media.path", "data": ["kind": "outputs", "id": data["id"] ?? ""]])
            guard let source = response["result"] as? String else { throw failure(Self.hostErrorMessage(response["error"]) ?? HostL10n.t("err.audioPath")) }
            guard FileManager.default.fileExists(atPath: source) else { throw failure(HostL10n.t("err.audioMissing")) }
            let panel = NSSavePanel()
            panel.allowedContentTypes = [UTType(filenameExtension: "wav") ?? .audio]
            panel.nameFieldStringValue = (data["name"] as? String ?? "yovoice.wav")
            let choice = await withCheckedContinuation { continuation in panel.beginSheetModal(for: window) { continuation.resume(returning: $0) } }
            guard choice == .OK, let url = panel.url else { return ["id": message["id"]!, "result": false] }
            try Data(contentsOf: URL(fileURLWithPath: source)).write(to: url, options: .atomic)
            return ["id": message["id"]!, "result": true]
        }
        if method == "text.export" {
            // 字幕（SRT/VTT）、歌词（LRC）与旋律谱（ABC）是界面生成的 UTF-8 文本，宿主只负责选位置并写文件。
            let format = data["format"] as? String ?? ""
            guard ["srt", "vtt", "lrc", "abc"].contains(format), let text = data["text"] as? String, text.utf8.count <= 20_000_000 else { throw failure(HostL10n.t("err.textExportInvalid")) }
            let panel = NSSavePanel()
            panel.allowedContentTypes = [UTType(filenameExtension: format) ?? .plainText]
            panel.nameFieldStringValue = (data["name"] as? String ?? "yovoice." + format)
            let response = await withCheckedContinuation { continuation in panel.beginSheetModal(for: window) { continuation.resume(returning: $0) } }
            guard response == .OK, let url = panel.url else { return ["id": message["id"]!, "result": false] }
            try Data(text.utf8).write(to: url, options: .atomic)
            return ["id": message["id"]!, "result": true]
        }
        if method == "media.reveal" {
            let response = try await request("api/call", body: ["id": "media-path", "method": "media.path", "data": data])
            guard let path = response["result"] as? String else { throw failure(Self.hostErrorMessage(response["error"]) ?? HostL10n.t("err.audioPath")) }
            guard FileManager.default.fileExists(atPath: path) else { throw failure(HostL10n.t("err.audioMissing")) }
            NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)])
            return ["id": message["id"]!, "result": true]
        }
        if ["model.directory", "storage.directory"].contains(method) {
            let panel = NSOpenPanel()
            panel.canChooseDirectories = true
            panel.canChooseFiles = false
            panel.allowsMultipleSelection = false
            let response = await withCheckedContinuation { continuation in panel.beginSheetModal(for: window) { continuation.resume(returning: $0) } }
            guard response == .OK, let url = panel.url else { return ["id": message["id"]!, "result": NSNull()] }
            data["path"] = url.path
            message["data"] = data
            if method == "storage.directory" {
                // 迁移以服务端当前状态为准，先保存界面里尚在防抖窗口内的正文，避免迁移后丢字。
                if let draft = try await web.evaluateJavaScript("window.__workbenchDraft ?? null") as? [String: Any] {
                    let saved = try await request("api/call", body: ["id": "relocate-save", "method": "draft.save", "data": draft])
                    if saved["error"] != nil { return ["id": message["id"]!, "error": saved["error"]!] }
                }
                // 跨盘复制模型可能远超普通请求的 120 秒上限，进度通过状态推送展示。
                let relocated = try await request("api/call", body: ["id": message["id"]!, "method": "storage.relocate", "data": data], timeout: 24 * 60 * 60)
                if relocated["error"] == nil { storageRelocated = true }
                return relocated
            }
        }
        if method == "storage.directory.open" {
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
            guard NSWorkspace.shared.open(root) else { throw failure(HostL10n.t("err.modelDirOpen")) }
            return ["id": message["id"]!, "result": true]
        }
        if method == "model.directory.open" {
            let response = try await request("api/call", body: ["id": "model-directory", "method": "state.get", "data": [:]])
            guard let result = response["result"] as? [String: Any],
                  let state = result["state"] as? [String: Any],
                  let preferences = state["preferences"] as? [String: Any] else { throw failure(HostL10n.t("err.modelDirRead")) }
            let directory = (preferences["modelDirectory"] as? String).map { URL(fileURLWithPath: $0, isDirectory: true) } ?? root.appendingPathComponent("models", isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            guard NSWorkspace.shared.open(directory) else { throw failure(HostL10n.t("err.modelDirOpen")) }
            return ["id": message["id"]!, "result": true]
        }
        if method == "app.update.get" {
            return ["id": message["id"]!, "result": updater.map { $0.snapshot.json as Any } ?? NSNull()]
        }
        if method == "app.update.check" {
            updater?.checkFromApp()
            return ["id": message["id"]!, "result": true]
        }
        if method == "app.update.install" {
            return ["id": message["id"]!, "result": updater?.install() ?? false]
        }
        if method == "logs.open" {
            NSWorkspace.shared.open(root.appendingPathComponent("logs"))
            return ["id": message["id"]!, "result": true]
        }
        if method == "preferences.save" {
            let response = try await request("api/call", body: message)
            if response["error"] == nil {
                HostL10n.applyPreferences(message["data"] as? [String: Any])
                refreshHostMenus()
            }
            return response
        }
        return try await request("api/call", body: message)
    }
    private func request(_ path: String, body: [String: Any], timeout: TimeInterval = 120) async throws -> [String: Any] {
        guard let origin else { throw failure(HostL10n.t("err.serviceNotReady")) }
        var request = URLRequest(url: origin.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("\(cookieName)=\(token)", forHTTPHeaderField: "Cookie")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        // AI 写作在服务端后台运行，调用立即返回，普通请求统一 120 秒上限。
        request.timeoutInterval = timeout
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw failure(HostL10n.t("err.serviceRequest")) }
        if data.isEmpty { return [:] }
        return (try JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
    }
    private func post(_ message: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: message), let json = String(data: data, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.__workbenchReceive(\(json))", completionHandler: nil)
    }
    private static let storageRestartRequired = "@yovoice.error.storageRestartRequired"
    private static func hostErrorMessage(_ error: Any?) -> String? {
        if let text = error as? String { return text }
        if let object = error as? [String: Any], let code = object["code"] as? String {
            if code == "@yovoice.error.dataRootMissing", let path = (object["params"] as? [String: Any])?["path"] as? String { return HostL10n.t("err.dataRootMissing", path) }
            if code == "@yovoice.error.diskFull" { return HostL10n.t("err.diskFull") }
            if let detail = (object["params"] as? [String: Any])?["detail"] as? String, !detail.isEmpty { return code + "\n" + detail }
            return code
        }
        return nil
    }
    private static func hostErrorCode(_ error: Any?) -> String? {
        (error as? [String: Any])?["code"] as? String
    }
    // 本地服务意外退出：提供重新启动或退出，不再要求用户自行重开应用。
    private func serviceStopped(_ status: Int32) {
        guard !restartingService else { return }
        restartingService = true
        Task { @MainActor in
            defer { restartingService = false }
            var draft: [String: Any]?
            if web != nil { draft = try? await web.evaluateJavaScript("window.__workbenchDraft ?? null") as? [String: Any] }
            var message = HostL10n.t("err.serviceStopped", status)
            while !closing {
                let alert = NSAlert()
                alert.alertStyle = .warning
                alert.messageText = HostL10n.t("alert.serviceStopped.title")
                alert.informativeText = message
                alert.addButton(withTitle: HostL10n.t("alert.serviceStopped.restart"))
                alert.addButton(withTitle: HostL10n.t("alert.serviceStopped.quit"))
                guard alert.runModal() == .alertFirstButtonReturn else {
                    // 退出流程会对未保存的修改提供备份。
                    NSApp.terminate(nil)
                    return
                }
                pendingDraft = draft
                origin = nil
                do {
                    try startService()
                    return
                } catch {
                    message = error.localizedDescription
                }
            }
        }
    }
    // 新服务就绪后补存重启前未落盘的修改；保存失败时允许备份到文件，避免刷新页面丢字。
    private func restorePendingDraft() async {
        guard let draft = pendingDraft else { return }
        pendingDraft = nil
        var message = HostL10n.t("err.serviceRequest")
        if let saved = try? await request("api/call", body: ["id": "restart-save", "method": "draft.save", "data": draft]) {
            guard let error = Self.hostErrorMessage(saved["error"]) else { return }
            message = error
        }
        while true {
            let alert = NSAlert()
            alert.alertStyle = .warning
            alert.messageText = HostL10n.t("alert.restoreDraftFailed.title")
            alert.informativeText = HostL10n.t("alert.restoreDraftFailed.body", message)
            alert.addButton(withTitle: HostL10n.t("alert.restoreDraftFailed.backup"))
            alert.addButton(withTitle: HostL10n.t("alert.restoreDraftFailed.discard")).hasDestructiveAction = true
            if alert.runModal() != .alertFirstButtonReturn || backupDraft(draft) { return }
        }
    }
    // 把作品正文另存为恢复文件；用户取消或写入失败时返回 false。
    private func backupDraft(_ draft: [String: Any]) -> Bool {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.json]
        let stamp = DateFormatter()
        stamp.dateFormat = "yyyyMMdd-HHmmss"
        panel.nameFieldStringValue = "yovoice-recovery-\(stamp.string(from: Date())).json"
        guard panel.runModal() == .OK, let url = panel.url else { return false }
        do {
            try JSONSerialization.data(withJSONObject: draft, options: [.prettyPrinted, .sortedKeys]).write(to: url, options: .atomic)
            return true
        } catch {
            let failed = NSAlert()
            failed.messageText = HostL10n.t("alert.exitSaveFailed.backupFailed")
            failed.informativeText = error.localizedDescription
            failed.runModal()
            return false
        }
    }
    // 退出保存失败时与 Windows 一致：可备份正文后退出、直接退出或返回编辑。
    private func confirmExitAfterSaveFailure(_ error: String, draft: [String: Any]) -> Bool {
        while true {
            let alert = NSAlert()
            alert.alertStyle = .warning
            alert.messageText = HostL10n.t("alert.exitSaveFailed.title")
            alert.informativeText = HostL10n.t("alert.exitSaveFailed.body", error)
            alert.addButton(withTitle: HostL10n.t("alert.exitSaveFailed.backup"))
            alert.addButton(withTitle: HostL10n.t("alert.exitSaveFailed.return"))
            alert.addButton(withTitle: HostL10n.t("alert.exitSaveFailed.quit")).hasDestructiveAction = true
            switch alert.runModal() {
            case .alertFirstButtonReturn:
                if backupDraft(draft) { return true }
            case .alertThirdButtonReturn:
                return true
            default:
                return false
            }
        }
    }
    private func refreshHostMenus() {
        guard let menu = NSApp.mainMenu else { return }
        if let appMenu = menu.item(at: 0)?.submenu {
            appMenu.item(at: 0)?.title = HostL10n.t("menu.about")
            if appMenu.numberOfItems > 1 { appMenu.item(at: 1)?.title = HostL10n.t("menu.checkUpdates") }
            appMenu.items.last?.title = HostL10n.t("menu.quit")
        }
        updater?.applyLocaleTitles()
    }
    private func failure(_ message: String) -> NSError { NSError(domain: "VoiceWorkbench", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
    private func showError(_ error: Error) {
        try? error.localizedDescription.write(to: root.appendingPathComponent("logs/last-host-error.txt"), atomically: true, encoding: .utf8)
        let alert = NSAlert()
        alert.messageText = HostL10n.t("alert.hostError.title")
        alert.informativeText = error.localizedDescription
        alert.beginSheetModal(for: window)
    }
    // 迁移完成后提示并自动重启，让新数据目录立即生效。
    private func promptRelaunch() {
        let alert = NSAlert()
        alert.messageText = HostL10n.t("alert.relocated.title")
        alert.informativeText = HostL10n.t("alert.relocated.body")
        alert.addButton(withTitle: HostL10n.t("alert.relocated.restart"))
        alert.runModal()
        relaunchOnExit = true
        NSApp.terminate(nil)
    }
    // 由独立的 shell 等待当前进程退出后再打开应用，避免 LaunchServices 只激活正在退出的旧实例。
    private func scheduleRelaunch() {
        let relauncher = Process()
        relauncher.executableURL = URL(fileURLWithPath: "/bin/sh")
        relauncher.arguments = ["-c", "while kill -0 \"$1\" 2>/dev/null; do sleep 0.2; done; exec /usr/bin/open \"$2\"", "yovoice-relaunch", String(ProcessInfo.processInfo.processIdentifier), Bundle.main.bundleURL.path]
        do { try relauncher.run() } catch {
            let alert = NSAlert()
            alert.messageText = HostL10n.t("err.relaunch")
            alert.runModal()
        }
    }
    // 关闭窗口后保留应用和后台任务，退出仍由菜单或 Command-Q 触发。
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { window.makeKeyAndOrderFront(nil); return true }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if shutdownComplete { return .terminateNow }
        if closing { return .terminateCancel }
        closing = true
        Task {
            do {
                if service.isRunning, web != nil {
                    let response = try await request("api/call", body: ["id": "exit-state", "method": "state.get", "data": [:]])
                    let result = response["result"] as? [String: Any]
                    // 生成与模型下载分别记录，任一进行中都需要确认。
                    let state = result?["state"] as? [String: Any]
                    let running = ["activity", "modelActivity"].contains { ((state?[$0] as? [String: Any])?["status"] as? String) == "running" }
                    if running {
                        let alert = NSAlert()
                        alert.messageText = HostL10n.t("alert.quitBusy.title")
                        alert.informativeText = HostL10n.t("alert.quitBusy.body")
                        alert.addButton(withTitle: HostL10n.t("alert.quitBusy.quit"))
                        alert.addButton(withTitle: HostL10n.t("alert.quitBusy.continue"))
                        if alert.runModal() != .alertFirstButtonReturn { closing = false; updater?.cancelInstall(); return }
                    }
                    // 读取最新编辑内容，避免自动保存的防抖窗口丢失最后输入。
                    if !storageRelocated, let draft = try await web.evaluateJavaScript("window.__workbenchDraft ?? null") as? [String: Any] {
                        let saved = try await request("api/call", body: ["id": "exit-save", "method": "draft.save", "data": draft])
                        // 迁移完成后旧目录冻结写入，此时保存必然失败且没有意义，不能因此挡住退出。
                        if let error = Self.hostErrorMessage(saved["error"]), Self.hostErrorCode(saved["error"]) != Self.storageRestartRequired {
                            // 数据目录被删除、磁盘已满或外置盘断开时保存会一直失败，必须给出退出路径，而不是只能强制结束。
                            guard confirmExitAfterSaveFailure(error, draft: draft) else { closing = false; updater?.cancelInstall(); return }
                            updater?.cancelInstall()
                        }
                    }
                }
                // 本地服务已停止时无法保存，页面里还有未保存的修改就提供备份，不能静默丢弃。
                if !service.isRunning, web != nil, !storageRelocated,
                   let draft = try? await web.evaluateJavaScript("window.__workbenchDraft ?? null") as? [String: Any] {
                    guard confirmExitAfterSaveFailure(HostL10n.t("err.serviceNotReady"), draft: draft) else { closing = false; updater?.cancelInstall(); return }
                    updater?.cancelInstall()
                }
                // 先确认更新助手可启动，再关闭服务；失败时仍可继续使用应用。
                try updater?.installBeforeTermination()
                if service.isRunning { _ = try await request("shutdown", body: [:]) }
                try? input.fileHandleForWriting.close()
                if relaunchOnExit { scheduleRelaunch() }
                shutdownComplete = true
                NSApp.terminate(nil)
            } catch {
                updater?.cancelInstall()
                try? error.localizedDescription.write(to: root.appendingPathComponent("logs/last-host-error.txt"), atomically: true, encoding: .utf8)
                // 服务无响应或更新准备失败时必须留出退出路径，否则只能强制结束应用。
                let alert = NSAlert()
                alert.alertStyle = .warning
                alert.messageText = HostL10n.t("alert.quitFailed.title")
                alert.informativeText = HostL10n.t("alert.quitFailed.body", error.localizedDescription)
                alert.addButton(withTitle: HostL10n.t("alert.quitFailed.force"))
                alert.addButton(withTitle: HostL10n.t("alert.quitFailed.back"))
                guard alert.runModal() == .alertFirstButtonReturn else { closing = false; return }
                try? input.fileHandleForWriting.close()
                if service.isRunning { service.terminate() }
                if relaunchOnExit { scheduleRelaunch() }
                shutdownComplete = true
                NSApp.terminate(nil)
            }
        }
        // 先返回事件循环，异步保存完成后再次退出，避免 AppKit 终止循环阻塞 Swift 任务。
        return .terminateCancel
    }
}
MainActor.assumeIsolated {
    let app = NSApplication.shared
    let delegate = AppDelegate()
    app.delegate = delegate
    app.run()
}
