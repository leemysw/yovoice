import AppKit
import CryptoKit

// 推送给界面的更新状态；字段与 web/src/features/update/app-update.ts 的 AppUpdate 一致。
struct UpdateSnapshot {
    var current: String
    var status = "disabled"
    var version: String?
    var notes: String?
    var publishedAt: String?
    var received: Int64 = 0
    var total: Int64 = 0
    var error: String?
    var checkedAt: String?
    var updatedFrom: String?

    var json: [String: Any] {
        func value(_ text: String?) -> Any { text.map { $0 as Any } ?? NSNull() }
        return ["current": current, "status": status, "version": value(version), "notes": value(notes),
                "publishedAt": value(publishedAt), "received": received, "total": total, "error": value(error),
                "checkedAt": value(checkedAt), "updatedFrom": value(updatedFrom)]
    }
}

@MainActor
final class AppUpdater {
    private let menuItem: NSMenuItem
    private let root: URL
    private let currentVersion = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
    private let releases = URL(string: "https://github.com/leemysw/yovoice/releases/latest")!
    private var operation: Task<Void, Never>?
    private var timer: Timer?
    private var ready: (app: URL, version: String)?
    private var installRequested = false
    private var installer: Process?
    private var showResult = false
    private(set) var snapshot: UpdateSnapshot
    // 状态变化时通知界面。
    var onChange: ((UpdateSnapshot) -> Void)?
    // 菜单检查交给界面展示时返回 true；界面不可用时回退到原生对话框。
    var showInApp: (() -> Bool)?

    init(menuItem: NSMenuItem, root: URL) {
        self.menuItem = menuItem
        self.root = root
        snapshot = UpdateSnapshot(current: currentVersion)
        menuItem.target = self
        menuItem.action = #selector(checkFromMenu)
    }

    func start() {
        // 本地冒烟测试和直接运行 Swift 可执行文件不访问更新服务。
        guard Bundle.main.bundleURL.pathExtension == "app",
              ProcessInfo.processInfo.environment["WORKBENCH_DATA"] == nil else { return }
        snapshot.status = "idle"
        snapshot.updatedFrom = recordLaunchVersion()
        publish()
        check()
        timer = Timer.scheduledTimer(withTimeInterval: 4 * 60 * 60, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.check() }
        }
    }

    // 记录本次启动的版本；版本升高说明刚完成更新，界面据此展示“已更新”。
    private func recordLaunchVersion() -> String? {
        let file = root.appendingPathComponent("last-version.txt")
        let previous = (try? String(contentsOf: file, encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines)
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try? currentVersion.write(to: file, atomically: true, encoding: .utf8)
        guard let previous, !previous.isEmpty, currentVersion.compare(previous, options: .numeric) == .orderedDescending else { return nil }
        return previous
    }

    private func publish() { onChange?(snapshot) }

    func applyLocaleTitles() {
        if ready != nil {
            menuItem.title = HostL10n.t("menu.restartUpdate", ready!.version)
        } else if operation != nil {
            menuItem.title = HostL10n.t("menu.checkingUpdates")
        } else {
            menuItem.title = HostL10n.t("menu.checkUpdates")
        }
    }

    @objc private func checkFromMenu() {
        if showInApp?() == true { check(); return }
        if ready != nil { promptInstall(); return }
        showResult = true
        check()
    }

    // 界面主动检查：结果在界面展示，不弹原生对话框。
    func checkFromApp() { check() }

    private func check() {
        guard operation == nil, ready == nil, !installRequested else { return }
        operation = Task {
            defer { operation = nil; showResult = false }
            menuItem.title = HostL10n.t("menu.checkingUpdates")
            snapshot.status = "checking"
            snapshot.error = nil
            snapshot.received = 0
            snapshot.total = 0
            publish()
            do {
                let url = URL(string: "https://api.github.com/repos/leemysw/yovoice/releases/latest")!
                let (data, response) = try await URLSession.shared.data(for: request(url))
                if (response as? HTTPURLResponse)?.statusCode == 404 {
                    menuItem.title = HostL10n.t("menu.checkUpdates")
                    snapshot.status = "latest"
                    snapshot.checkedAt = Self.now()
                    publish()
                    if showResult { inform(HostL10n.t("alert.noUpdate.title"), HostL10n.t("alert.noUpdate.body")) }
                    return
                }
                try Self.validate(response)
                let release = try JSONDecoder().decode(UpdateRelease.self, from: data)
                let asset = try release.package(newerThan: currentVersion)
                // 版本号已校验，过时版本的安装包与解压副本不再保留。
                Self.removeStaleUpdates(in: root, keeping: release.tag_name)
                guard let asset else {
                    menuItem.title = HostL10n.t("menu.checkUpdates")
                    // 已是最新时仍带上当前正式版的说明，供刚更新后的“新功能”展示。
                    let same = release.version == currentVersion
                    snapshot.status = "latest"
                    snapshot.version = same ? release.version : nil
                    snapshot.notes = same ? release.notes : nil
                    snapshot.publishedAt = same ? release.published_at : nil
                    snapshot.checkedAt = Self.now()
                    publish()
                    if showResult { inform(HostL10n.t("alert.upToDate.title"), HostL10n.t("alert.upToDate.body", currentVersion)) }
                    return
                }
                snapshot.status = "downloading"
                snapshot.version = release.version
                snapshot.notes = release.notes
                snapshot.publishedAt = release.published_at
                snapshot.checkedAt = Self.now()
                publish()
                let target = Bundle.main.bundleURL
                guard Self.canReplace(target) else {
                    throw UpdateRelease.failure(HostL10n.t("err.updateWritable"))
                }
                // 只接受与当前正式应用相同开发者签名的更新。
                let team = try await Task.detached(priority: .utility) { try Self.signingTeam(target) }.value
                let checksums = try release.asset(named: "SHA256SUMS.txt")
                let (hashData, hashResponse) = try await URLSession.shared.data(for: request(checksums.browser_download_url))
                try Self.validate(hashResponse)
                let expected = try UpdateRelease.checksum(String(decoding: hashData, as: UTF8.self), for: asset.name)
                let directory = root.appendingPathComponent("updates/\(release.tag_name)", isDirectory: true)
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                let archive = directory.appendingPathComponent(asset.name)
                menuItem.title = HostL10n.t("menu.downloadingUpdate", release.version)
                if !FileManager.default.fileExists(atPath: archive.path) {
                    // 外层检查任务在下载期间本就持有 self，进度回调直接引用即可（AppUpdater 运行在主线程，可跨线程传递）。
                    try await UpdateDownload.run(request(asset.browser_download_url, timeout: 600), to: archive) { received, total in
                        Task { @MainActor in self.progress(received, total) }
                    }
                }
                menuItem.title = HostL10n.t("menu.verifyingUpdate")
                snapshot.status = "verifying"
                publish()
                let app = try await Task.detached(priority: .utility) {
                    try Self.prepare(archive: archive, hash: expected, version: release.version, team: team)
                }.value
                ready = (app, release.version)
                menuItem.title = HostL10n.t("menu.restartUpdate", release.version)
                snapshot.status = "ready"
                publish()
                // 后台检查只更新菜单和界面提示，不打断正在进行的创作。
                if showResult { promptInstall() }
            } catch {
                menuItem.title = HostL10n.t("menu.checkUpdates")
                log(error)
                snapshot.status = "failed"
                snapshot.error = (error as? URLError) != nil ? HostL10n.t("err.updateNetwork") : error.localizedDescription
                snapshot.checkedAt = Self.now()
                publish()
                if showResult { showFailure(error) }
            }
        }
    }

    private func progress(_ received: Int64, _ total: Int64) {
        guard snapshot.status == "downloading" else { return }
        snapshot.received = received
        snapshot.total = total
        publish()
    }

    nonisolated private static func now() -> String { ISO8601DateFormatter().string(from: Date()) }

    private func request(_ url: URL, timeout: TimeInterval = 20) -> URLRequest {
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
        request.setValue("yovoice-macOS/\(currentVersion)", forHTTPHeaderField: "User-Agent")
        return request
    }

    private func promptInstall() {
        guard let ready, !installRequested else { return }
        let alert = NSAlert()
        alert.messageText = HostL10n.t("alert.updateReady.title", ready.version)
        alert.informativeText = HostL10n.t("alert.updateReady.body")
        alert.addButton(withTitle: HostL10n.t("alert.updateReady.restart"))
        alert.addButton(withTitle: HostL10n.t("alert.updateReady.later"))
        if alert.runModal() == .alertFirstButtonReturn { install() }
    }

    // 界面上的“重启并更新”已是明确确认，直接进入保存并退出流程。
    @discardableResult
    func install() -> Bool {
        guard ready != nil, !installRequested else { return false }
        installRequested = true
        snapshot.status = "installing"
        publish()
        // 先回复界面调用，再进入退出流程。
        DispatchQueue.main.async { NSApp.terminate(nil) }
        return true
    }

    func cancelInstall() {
        let wasRequested = installRequested
        installRequested = false
        if let installer, installer.isRunning { installer.terminate() }
        installer = nil
        // 用户取消退出后更新仍可再次安装。
        if wasRequested, ready != nil {
            snapshot.status = "ready"
            publish()
        }
    }

    // 保存草稿后启动助手；助手等待宿主退出，关闭服务失败时会取消助手。
    func installBeforeTermination() throws {
        guard installRequested, let ready else { return }
        let target = Bundle.main.bundleURL
        guard Self.canReplace(target), let resource = Bundle.main.resourceURL else {
            throw UpdateRelease.failure(HostL10n.t("err.updateReplace"))
        }
        let directory = ready.app.deletingLastPathComponent()
        let helper = directory.appendingPathComponent("install-update.sh")
        try? FileManager.default.removeItem(at: helper)
        try FileManager.default.copyItem(at: resource.appendingPathComponent("install-update.sh"), to: helper)
        let logs = root.appendingPathComponent("logs")
        try FileManager.default.createDirectory(at: logs, withIntermediateDirectories: true)
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/bash")
        process.arguments = [helper.path, String(ProcessInfo.processInfo.processIdentifier), ready.app.path,
                             target.path, directory.path, logs.appendingPathComponent("update-install.log").path]
        process.environment = ["PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "HOME": FileManager.default.homeDirectoryForCurrentUser.path]
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try process.run()
        installer = process
    }

    private func inform(_ title: String, _ message: String) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = message
        alert.runModal()
    }

    private func showFailure(_ error: Error) {
        let alert = NSAlert()
        alert.messageText = HostL10n.t("alert.updateFailed.title")
        alert.informativeText = error.localizedDescription
        alert.addButton(withTitle: HostL10n.t("alert.updateReady.later"))
        alert.addButton(withTitle: HostL10n.t("alert.updateFailed.open"))
        if alert.runModal() == .alertSecondButtonReturn { NSWorkspace.shared.open(releases) }
    }

    private func log(_ error: Error) {
        let logs = root.appendingPathComponent("logs")
        try? FileManager.default.createDirectory(at: logs, withIntermediateDirectories: true)
        try? "\(Date()): \(error.localizedDescription)\n".write(to: logs.appendingPathComponent("update-check.log"), atomically: true, encoding: .utf8)
    }

    nonisolated private static func removeStaleUpdates(in root: URL, keeping tag: String) {
        let updates = root.appendingPathComponent("updates", isDirectory: true)
        guard let items = try? FileManager.default.contentsOfDirectory(at: updates, includingPropertiesForKeys: nil) else { return }
        for item in items where item.lastPathComponent != tag {
            try? FileManager.default.removeItem(at: item)
        }
    }

    nonisolated private static func validate(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw UpdateRelease.failure(HostL10n.t("err.updateUnavailable"))
        }
    }

    nonisolated private static func canReplace(_ target: URL) -> Bool {
        target.pathExtension == "app" && !target.path.hasPrefix("/Volumes/") &&
            !target.path.contains("/AppTranslocation/") &&
            FileManager.default.isWritableFile(atPath: target.deletingLastPathComponent().path)
    }

    nonisolated private static func signingTeam(_ app: URL) throws -> String {
        let signature = try run("/usr/bin/codesign", ["-dv", "--verbose=4", app.path])
        guard let line = signature.split(separator: "\n").first(where: { $0.hasPrefix("TeamIdentifier=") }) else {
            throw UpdateRelease.failure(HostL10n.t("err.updateDevBuild"))
        }
        let team = String(line.dropFirst("TeamIdentifier=".count))
        guard team.count == 10, team.allSatisfy({ "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".contains($0) }) else {
            throw UpdateRelease.failure(HostL10n.t("err.updateDevBuild"))
        }
        return team
    }

    nonisolated static func prepare(archive: URL, hash: String, version: String, team: String) throws -> URL {
        let file = try FileHandle(forReadingFrom: archive)
        defer { try? file.close() }
        var digest = SHA256()
        while let data = try file.read(upToCount: 1024 * 1024), !data.isEmpty { digest.update(data: data) }
        guard digest.finalize().map({ String(format: "%02x", $0) }).joined() == hash else {
            try? FileManager.default.removeItem(at: archive)
            throw UpdateRelease.failure(HostL10n.t("err.updateChecksum"))
        }
        let directory = archive.deletingLastPathComponent()
        let app = directory.appendingPathComponent("yovoice.app")
        try? FileManager.default.removeItem(at: app)
        _ = try run("/usr/bin/ditto", ["-x", "-k", archive.path, directory.path])
        guard let bundle = Bundle(url: app), bundle.bundleIdentifier == "app.voiceworkbench.desktop",
              bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String == version else {
            throw UpdateRelease.failure(HostL10n.t("err.updateIdentity"))
        }
        try verifyArchitecture(app.appendingPathComponent("Contents/MacOS/VoiceWorkbenchMac"))
        _ = try run("/usr/bin/codesign", ["--verify", "--deep", "--strict", "-R", "anchor apple generic and certificate leaf[subject.OU] = \"\(team)\"", app.path])
        _ = try run("/usr/sbin/spctl", ["--assess", "--type", "execute", app.path])
        return app
    }

    nonisolated static func verifyArchitecture(_ executable: URL) throws {
        // 架构列表必须放在最后，否则 lipo 会把文件路径解析为架构名称。
        _ = try run("/usr/bin/lipo", [executable.path, "-verify_arch", "arm64"])
    }

    nonisolated private static func run(_ executable: String, _ arguments: [String]) throws -> String {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        try process.run()
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        let output = String(decoding: data, as: UTF8.self)
        guard process.terminationStatus == 0 else {
            throw UpdateRelease.failure(HostL10n.t("err.updateCodesign", URL(fileURLWithPath: executable).lastPathComponent, String(output.prefix(500))))
        }
        return output
    }
}

// 带进度的下载：URLSession 的异步下载接口不报告进度，因此使用独立会话与代理。
final class UpdateDownload: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
    private let destination: URL
    private let progress: @Sendable (Int64, Int64) -> Void
    private var continuation: CheckedContinuation<Void, Error>?
    private var failure: Error?
    private var reported = Date.distantPast

    private init(destination: URL, progress: @escaping @Sendable (Int64, Int64) -> Void) {
        self.destination = destination
        self.progress = progress
    }

    static func run(_ request: URLRequest, to destination: URL, progress: @escaping @Sendable (Int64, Int64) -> Void) async throws {
        let delegate = UpdateDownload(destination: destination, progress: progress)
        let queue = OperationQueue()
        queue.maxConcurrentOperationCount = 1
        let session = URLSession(configuration: .default, delegate: delegate, delegateQueue: queue)
        defer { session.finishTasksAndInvalidate() }
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                delegate.continuation = continuation
                session.downloadTask(with: request).resume()
            }
        } onCancel: {
            session.invalidateAndCancel()
        }
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        // 进度最多每 200 毫秒推送一次，避免频繁刷新界面。
        let now = Date()
        guard now.timeIntervalSince(reported) >= 0.2 else { return }
        reported = now
        progress(totalBytesWritten, max(totalBytesExpectedToWrite, 0))
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        // 临时文件在回调返回后删除，必须在这里移走。
        guard (downloadTask.response as? HTTPURLResponse)?.statusCode == 200 else {
            failure = UpdateRelease.failure(HostL10n.t("err.updateUnavailable"))
            return
        }
        do {
            try? FileManager.default.removeItem(at: destination)
            try FileManager.default.moveItem(at: location, to: destination)
            progress(downloadTask.countOfBytesReceived, max(downloadTask.countOfBytesExpectedToReceive, downloadTask.countOfBytesReceived))
        } catch {
            failure = error
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let continuation = self.continuation
        self.continuation = nil
        if let error = error ?? failure { continuation?.resume(throwing: error) } else { continuation?.resume() }
    }
}
