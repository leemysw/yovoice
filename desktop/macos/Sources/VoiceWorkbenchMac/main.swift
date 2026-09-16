import AppKit
import WebKit
import UniformTypeIdentifiers

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    private var window: NSWindow!
    private var web: WKWebView!
    private let service = Process()
    private let input = Pipe()
    private var origin: URL?
    private let token = UUID().uuidString + UUID().uuidString
    private var closing = false
    private var shutdownComplete = false
    private var updater: AppUpdater?
    private let root = ProcessInfo.processInfo.environment["WORKBENCH_DATA"].map { URL(fileURLWithPath: $0, isDirectory: true) } ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".yovoice", isDirectory: true)
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
        let accessory = NSTitlebarAccessoryViewController()
        accessory.layoutAttribute = .left
        let sidebarButton = NSButton(image: NSImage(systemSymbolName: "sidebar.left", accessibilityDescription: "切换侧栏")!, target: self, action: #selector(toggleSidebar))
        sidebarButton.isBordered = false
        sidebarButton.toolTip = "收起或展开侧栏"
        sidebarButton.frame = NSRect(x: 0, y: 0, width: 32, height: 28)
        accessory.view = sidebarButton
        window.addTitlebarAccessoryViewController(accessory)
        window.minSize = NSSize(width: 390, height: 600)
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.center()
        let loading = NSTextField(labelWithString: "正在打开 yovoice…")
        loading.frame = NSRect(x: 40, y: 40, width: 400, height: 30)
        window.contentView?.addSubview(loading)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        do { try startService() } catch { showError(error) }
        updater?.start()
    }

    @objc private func toggleSidebar() {
        // 侧栏状态由前端统一管理，标题栏仅发送切换事件。
        web?.evaluateJavaScript("window.dispatchEvent(new Event('workbench-toggle-sidebar'))", completionHandler: nil)
    }

    @objc private func showAbout() {
        let repository = "https://github.com/leemysw/yovoice"
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = .center
        let credits = NSMutableAttributedString(
            string: "如果 yovoice 对你有帮助，欢迎给项目点个 Star。\n\n",
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
        let aboutItem = appItem.submenu?.addItem(withTitle: "关于 yovoice", action: #selector(showAbout), keyEquivalent: "")
        aboutItem?.target = self
        let updateItem = NSMenuItem(title: "检查更新…", action: nil, keyEquivalent: "")
        appItem.submenu?.addItem(updateItem)
        updater = AppUpdater(menuItem: updateItem, root: root)
        appItem.submenu?.addItem(.separator())
        appItem.submenu?.addItem(withTitle: "退出 yovoice", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let edit = NSMenuItem()
        menu.addItem(edit)
        edit.submenu = NSMenu(title: "编辑")
        for (title, action, key) in [("撤销", "undo:", "z"), ("剪切", "cut:", "x"), ("复制", "copy:", "c"), ("粘贴", "paste:", "v"), ("全选", "selectAll:", "a")] {
            edit.submenu?.addItem(withTitle: title, action: Selector(action), keyEquivalent: key)
        }
        let windowItem = NSMenuItem()
        menu.addItem(windowItem)
        windowItem.submenu = NSMenu(title: "窗口")
        windowItem.submenu?.addItem(withTitle: "最小化", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        NSApp.windowsMenu = windowItem.submenu
        NSApp.mainMenu = menu
    }

    private func startService() throws {
        let resources = Bundle.main.resourceURL!
        let executable = resources.appendingPathComponent("service/yovoice-service")
        guard FileManager.default.isExecutableFile(atPath: executable.path) else { throw failure("本地服务缺失，请重新构建或安装应用。") }
        if ProcessInfo.processInfo.environment["WORKBENCH_DATA"] == nil {
            let migration = Process()
            migration.executableURL = executable
            migration.arguments = ["--prepare-data"]
            let errors = Pipe()
            migration.standardError = errors
            try migration.run()
            migration.waitUntilExit()
            guard migration.terminationStatus == 0 else { throw failure("数据目录迁移失败，请先退出旧版应用。原数据保留在旧目录。") }
        }
        try FileManager.default.createDirectory(at: root.appendingPathComponent("logs"), withIntermediateDirectories: true)
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
        FileManager.default.createFile(atPath: log.path, contents: nil)
        service.standardError = try FileHandle(forWritingTo: log)
        service.terminationHandler = { [weak self] process in
            Task { @MainActor in
                guard let self, !self.closing else { return }
                self.showError(self.failure("本地服务已停止（\(process.terminationStatus)）。请退出后重新打开，诊断记录保存在日志目录。"))
            }
        }
        try service.run()
        Task {
            try? await Task.sleep(for: .seconds(30))
            if origin == nil && service.isRunning && !closing {
                try? input.fileHandleForWriting.close()
                showError(failure("本地服务启动超时，请退出后重新打开。"))
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
        guard let url = URL(string: address), url.host == "127.0.0.1", url.scheme == "http" else { showError(failure("本地服务返回了无效地址。")); return }
        origin = url
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
        let cookie = HTTPCookie(properties: [.name: cookieName, .value: token, .domain: "127.0.0.1", .path: "/", .init("HttpOnly"): "TRUE"])!
        configuration.websiteDataStore.httpCookieStore.setCookie(cookie) { [weak self] in
            Task { @MainActor in
                guard let self else { return }
                self.window.contentView = self.web
                self.web.load(URLRequest(url: url))
            }
        }
    }

    private func trusted(_ url: URL?) -> Bool {
        guard let url, let origin else { return false }
        return url.scheme == origin.scheme && url.host == origin.host && url.port == origin.port
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(trusted(navigationAction.request.url) ? .allow : .cancel)
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
        guard frame.isMainFrame, trusted(frame.request.url) else { completionHandler(nil); return }
        let panel = NSOpenPanel()
        panel.title = "选择参考音频"
        panel.allowedContentTypes = [.audio]
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.beginSheetModal(for: window) { response in completionHandler(response == .OK ? panel.urls : nil) }
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(trusted(frame.request.url) && type == .microphone ? .prompt : .deny)
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, trusted(message.frameInfo.request.url), let body = message.body as? [String: Any], let id = body["id"] as? String else { return }
        Task {
            do { post(try await handle(body)) }
            catch { post(["id": id, "error": error.localizedDescription]) }
        }
    }

    private func handle(_ message: [String: Any]) async throws -> [String: Any] {
        var message = message
        var data = message["data"] as? [String: Any] ?? [:]
        let method = message["method"] as? String ?? ""
        if method == "sidebar.save" {
            guard let size = data["size"] as? Double, size.isFinite, (180...360).contains(size), let collapsed = data["isCollapsed"] as? Bool else { throw failure("侧栏设置无效。") }
            let saved = try JSONSerialization.data(withJSONObject: ["size": size, "isCollapsed": collapsed])
            UserDefaults.standard.set(String(data: saved, encoding: .utf8), forKey: "sidebar-layout")
            return ["id": message["id"]!, "result": true]
        }
        if method == "media.reveal" {
            let response = try await request("api/call", body: ["id": "media-path", "method": "media.path", "data": data])
            guard let path = response["result"] as? String else { throw failure(response["error"] as? String ?? "无法读取音频位置。") }
            guard FileManager.default.fileExists(atPath: path) else { throw failure("音频文件不存在。") }
            NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)])
            return ["id": message["id"]!, "result": true]
        }
        if ["voice.import", "model.import", "model.directory"].contains(method) {
            let panel = NSOpenPanel()
            panel.canChooseDirectories = method == "model.directory" || (data["directory"] as? Bool == true)
            panel.canChooseFiles = !panel.canChooseDirectories
            panel.allowsMultipleSelection = false
            if panel.canChooseFiles { panel.allowedContentTypes = method == "voice.import" ? [.wav] : [UTType(filenameExtension: "gguf") ?? .data] }
            let response = await withCheckedContinuation { continuation in panel.beginSheetModal(for: window) { continuation.resume(returning: $0) } }
            guard response == .OK, let url = panel.url else { return ["id": message["id"]!, "result": NSNull()] }
            data["path"] = url.path
            message["data"] = data
        }
        if method == "model.directory.open" {
            let response = try await request("api/call", body: ["id": "model-directory", "method": "state.get", "data": [:]])
            guard let result = response["result"] as? [String: Any],
                  let state = result["state"] as? [String: Any],
                  let preferences = state["preferences"] as? [String: Any] else { throw failure("无法读取模型保存位置。") }
            let directory = (preferences["modelDirectory"] as? String).map { URL(fileURLWithPath: $0, isDirectory: true) } ?? root.appendingPathComponent("models", isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            guard NSWorkspace.shared.open(directory) else { throw failure("无法打开模型保存目录。") }
            return ["id": message["id"]!, "result": true]
        }
        if method == "logs.open" {
            NSWorkspace.shared.open(root.appendingPathComponent("logs"))
            return ["id": message["id"]!, "result": true]
        }
        return try await request("api/call", body: message)
    }
    private func request(_ path: String, body: [String: Any]) async throws -> [String: Any] {
        guard let origin else { throw failure("本地服务尚未就绪。") }
        var request = URLRequest(url: origin.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("\(cookieName)=\(token)", forHTTPHeaderField: "Cookie")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        request.timeoutInterval = 120
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw failure("本地服务请求失败。") }
        if data.isEmpty { return [:] }
        return (try JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
    }
    private func post(_ message: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: message), let json = String(data: data, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.__workbenchReceive(\(json))", completionHandler: nil)
    }
    private func failure(_ message: String) -> NSError { NSError(domain: "VoiceWorkbench", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
    private func showError(_ error: Error) {
        try? error.localizedDescription.write(to: root.appendingPathComponent("logs/last-host-error.txt"), atomically: true, encoding: .utf8)
        let alert = NSAlert()
        alert.messageText = "yovoice 未能完成操作"
        alert.informativeText = error.localizedDescription
        alert.beginSheetModal(for: window)
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
                    let state = try await request("api/call", body: ["id": "exit-state", "method": "state.get", "data": [:]])
                    let result = state["result"] as? [String: Any]
                    let activity = (result?["state"] as? [String: Any])?["activity"] as? [String: Any]
                    if activity?["status"] as? String == "running" {
                        let alert = NSAlert()
                        alert.messageText = "退出并取消当前操作？"
                        alert.informativeText = "正文与已下载的部分文件会保留。"
                        alert.addButton(withTitle: "退出")
                        alert.addButton(withTitle: "继续操作")
                        if alert.runModal() != .alertFirstButtonReturn { closing = false; updater?.cancelInstall(); return }
                    }
                    // 读取最新编辑内容，避免自动保存的防抖窗口丢失最后输入。
                    if let draft = try await web.evaluateJavaScript("window.__workbenchDraft ?? null") as? [String: Any] {
                        let saved = try await request("api/call", body: ["id": "exit-save", "method": "draft.save", "data": draft])
                        if let error = saved["error"] as? String { throw failure(error) }
                    }
                }
                // 先确认更新助手可启动，再关闭服务；失败时仍可继续使用应用。
                try updater?.installBeforeTermination()
                if service.isRunning { _ = try await request("shutdown", body: [:]) }
                try? input.fileHandleForWriting.close()
                shutdownComplete = true
                NSApp.terminate(nil)
            } catch {
                closing = false
                updater?.cancelInstall()
                showError(error)

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
