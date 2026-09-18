import AppKit
import CryptoKit

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

    init(menuItem: NSMenuItem, root: URL) {
        self.menuItem = menuItem
        self.root = root
        menuItem.target = self
        menuItem.action = #selector(checkFromMenu)
    }

    func start() {
        // 本地冒烟测试和直接运行 Swift 可执行文件不访问更新服务。
        guard Bundle.main.bundleURL.pathExtension == "app",
              ProcessInfo.processInfo.environment["WORKBENCH_DATA"] == nil else { return }
        check()
        timer = Timer.scheduledTimer(withTimeInterval: 4 * 60 * 60, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.check() }
        }
    }

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
        if ready != nil { promptInstall(); return }
        showResult = true
        check()
    }

    private func check() {
        guard operation == nil, ready == nil, !installRequested else { return }
        operation = Task {
            defer { operation = nil; showResult = false }
            menuItem.title = HostL10n.t("menu.checkingUpdates")
            do {
                let url = URL(string: "https://api.github.com/repos/leemysw/yovoice/releases/latest")!
                let (data, response) = try await URLSession.shared.data(for: request(url))
                if (response as? HTTPURLResponse)?.statusCode == 404 {
                    menuItem.title = HostL10n.t("menu.checkUpdates")
                    if showResult { inform(HostL10n.t("alert.noUpdate.title"), HostL10n.t("alert.noUpdate.body")) }
                    return
                }
                try Self.validate(response)
                let release = try JSONDecoder().decode(UpdateRelease.self, from: data)
                guard let asset = try release.package(newerThan: currentVersion) else {
                    menuItem.title = HostL10n.t("menu.checkUpdates")
                    if showResult { inform(HostL10n.t("alert.upToDate.title"), HostL10n.t("alert.upToDate.body", currentVersion)) }
                    return
                }
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
                    let (download, downloadResponse) = try await URLSession.shared.download(for: request(asset.browser_download_url, timeout: 600))
                    defer { try? FileManager.default.removeItem(at: download) }
                    try Self.validate(downloadResponse)
                    try FileManager.default.moveItem(at: download, to: archive)
                }
                menuItem.title = HostL10n.t("menu.verifyingUpdate")
                let app = try await Task.detached(priority: .utility) {
                    try Self.prepare(archive: archive, hash: expected, version: release.version, team: team)
                }.value
                ready = (app, release.version)
                menuItem.title = HostL10n.t("menu.restartUpdate", release.version)
                // 后台检查只更新菜单，不打断正在进行的创作。
                if showResult { promptInstall() }
            } catch {
                menuItem.title = HostL10n.t("menu.checkUpdates")
                log(error)
                if showResult { showFailure(error) }
            }
        }
    }

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
        if alert.runModal() == .alertFirstButtonReturn {
            installRequested = true
            NSApp.terminate(nil)
        }
    }

    func cancelInstall() {
        installRequested = false
        if let installer, installer.isRunning { installer.terminate() }
        installer = nil
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
