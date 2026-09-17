import Foundation

/// UI locale for native menus and alerts. Mirrors Preferences.uiLocale (not TTS Draft.language).
enum HostUiLocale: String {
    case zhCN = "zh-CN"
    case en = "en"

    static func parse(_ raw: String?) -> HostUiLocale {
        switch raw {
        case "en": return .en
        default: return .zhCN
        }
    }

    static func fromNavigatorLike(_ language: String) -> HostUiLocale {
        language.lowercased().hasPrefix("zh") ? .zhCN : .en
    }
}

/// Native string table keyed by stable ids. Follows preferences.uiLocale from state.json / SSE.
enum HostL10n {
    // Updated from MainActor when preferences change; read from host error paths too.
    nonisolated(unsafe) private(set) static var locale: HostUiLocale = {
        if let prefs = readStoredUiLocale() { return prefs }
        let preferred = Locale.preferredLanguages.first ?? "en"
        return HostUiLocale.fromNavigatorLike(preferred)
    }()

    static func setLocale(_ next: HostUiLocale) {
        locale = next
    }

    static func applyPreferences(_ preferences: [String: Any]?) {
        guard let raw = preferences?["uiLocale"] as? String else { return }
        setLocale(HostUiLocale.parse(raw))
    }

    nonisolated static func t(_ key: String, _ args: CVarArg...) -> String {
        let template = table[locale]?[key] ?? table[.en]?[key] ?? key
        guard !args.isEmpty else { return template }
        return String(format: template, locale: Locale(identifier: locale == .en ? "en_US" : "zh_CN"), arguments: args)
    }

    nonisolated private static func readStoredUiLocale() -> HostUiLocale? {
        let root = ProcessInfo.processInfo.environment["WORKBENCH_DATA"].map { URL(fileURLWithPath: $0, isDirectory: true) }
            ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".yovoice", isDirectory: true)
        let stateURL = root.appendingPathComponent("state.json")
        guard let data = try? Data(contentsOf: stateURL),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let preferences = json["preferences"] as? [String: Any],
              let raw = preferences["uiLocale"] as? String else { return nil }
        return HostUiLocale.parse(raw)
    }

    private static let table: [HostUiLocale: [String: String]] = [
        .zhCN: [
            "menu.about": "关于 yovoice",
            "menu.checkUpdates": "检查更新…",
            "menu.quit": "退出 yovoice",
            "menu.edit": "编辑",
            "menu.undo": "撤销",
            "menu.cut": "剪切",
            "menu.copy": "复制",
            "menu.paste": "粘贴",
            "menu.selectAll": "全选",
            "menu.window": "窗口",
            "menu.minimize": "最小化",
            "menu.checkingUpdates": "正在检查更新…",
            "menu.downloadingUpdate": "正在后台下载 %@…",
            "menu.verifyingUpdate": "正在校验更新…",
            "menu.restartUpdate": "重启并更新至 %@…",
            "sidebar.toggle": "切换侧栏",
            "sidebar.tooltip": "收起或展开侧栏",
            "loading": "正在打开 yovoice…",
            "about.credits": "如果 yovoice 对你有帮助，欢迎给项目点个 Star。\n\n",
            "panel.pickAudio": "选择参考音频",
            "alert.updateReady.title": "yovoice %@ 已准备好",
            "alert.updateReady.body": "更新已下载并通过校验。重启前会保存当前作品。",
            "alert.updateReady.restart": "重启并更新",
            "alert.updateReady.later": "稍后",
            "alert.updateFailed.title": "未能完成更新",
            "alert.updateFailed.later": "稍后",
            "alert.updateFailed.open": "打开下载页",
            "alert.noUpdate.title": "暂无可用更新",
            "alert.noUpdate.body": "GitHub 上尚无可用的正式版本。",
            "alert.upToDate.title": "yovoice 已是最新版本",
            "alert.upToDate.body": "当前版本：%@",
            "alert.hostError.title": "yovoice",
            "err.serviceMissing": "本地服务缺失，请重新构建或安装应用。",
            "err.migrateFailed": "数据目录迁移失败，请先退出旧版应用。原数据保留在旧目录。",
            "err.serviceStopped": "本地服务已停止（%d）。请退出后重新打开，诊断记录保存在日志目录。",
            "err.serviceTimeout": "本地服务启动超时，请退出后重新打开。",
            "err.invalidAddress": "本地服务返回了无效地址。",
            "err.sidebarInvalid": "侧栏设置无效。",
            "err.audioPath": "无法读取音频位置。",
            "err.audioMissing": "音频文件不存在。",
            "err.modelDirRead": "无法读取模型保存位置。",
            "err.modelDirOpen": "无法打开模型保存目录。",
            "err.serviceNotReady": "本地服务尚未就绪。",
            "err.serviceRequest": "本地服务请求失败。",
            "err.updateVersion": "更新版本号无效。",
            "err.updateMissing": "当前版本缺少有效的更新包或校验文件，请从 GitHub 下载。",
            "err.updateSha": "更新包的 SHA-256 校验信息无效。",
            "err.updateWritable": "请将 yovoice 安装到可写的 Applications 文件夹后再更新。",
            "err.updateReplace": "当前应用位置不可替换，请从 GitHub 下载更新。",
            "err.updateUnavailable": "更新服务暂时不可用，请稍后重试。",
            "err.updateDevBuild": "开发构建不支持自动替换，请安装正式发布版本。",
            "err.updateChecksum": "更新包校验失败，已删除下载文件，请重试。",
            "err.updateIdentity": "更新包的应用标识或版本不匹配。",
            "err.updateCodesign": "更新校验失败（%@）：%@",
            "alert.quitBusy.continue": "继续操作",
            "alert.quitBusy.quit": "退出",
            "alert.quitBusy.body": "正文与已下载的部分文件会保留。",
            "alert.quitBusy.title": "退出并取消当前操作？",
        ],
        .en: [
            "menu.about": "About yovoice",
            "menu.checkUpdates": "Check for Updates…",
            "menu.quit": "Quit yovoice",
            "menu.edit": "Edit",
            "menu.undo": "Undo",
            "menu.cut": "Cut",
            "menu.copy": "Copy",
            "menu.paste": "Paste",
            "menu.selectAll": "Select All",
            "menu.window": "Window",
            "menu.minimize": "Minimize",
            "menu.checkingUpdates": "Checking for Updates…",
            "menu.downloadingUpdate": "Downloading %@ in the background…",
            "menu.verifyingUpdate": "Verifying update…",
            "menu.restartUpdate": "Restart and Update to %@…",
            "sidebar.toggle": "Toggle Sidebar",
            "sidebar.tooltip": "Collapse or expand the sidebar",
            "loading": "Opening yovoice…",
            "about.credits": "If yovoice helps you, consider starring the project.\n\n",
            "panel.pickAudio": "Choose Reference Audio",
            "alert.updateReady.title": "yovoice %@ is ready",
            "alert.updateReady.body": "The update downloaded and verified. Your work will be saved before restart.",
            "alert.updateReady.restart": "Restart and Update",
            "alert.updateReady.later": "Later",
            "alert.updateFailed.title": "Update could not finish",
            "alert.updateFailed.later": "Later",
            "alert.updateFailed.open": "Open Download Page",
            "alert.noUpdate.title": "No updates available",
            "alert.noUpdate.body": "There is no published release on GitHub yet.",
            "alert.upToDate.title": "yovoice is up to date",
            "alert.upToDate.body": "Current version: %@",
            "alert.hostError.title": "yovoice",
            "err.serviceMissing": "Local service is missing. Rebuild or reinstall the app.",
            "err.migrateFailed": "Data folder migration failed. Quit the old app first. Original data stays in the old folder.",
            "err.serviceStopped": "Local service stopped (%d). Quit and reopen. Diagnostics are in the logs folder.",
            "err.serviceTimeout": "Local service timed out while starting. Quit and reopen.",
            "err.invalidAddress": "Local service returned an invalid address.",
            "err.sidebarInvalid": "Invalid sidebar settings.",
            "err.audioPath": "Could not read the audio location.",
            "err.audioMissing": "Audio file does not exist.",
            "err.modelDirRead": "Could not read the model save location.",
            "err.modelDirOpen": "Could not open the model save folder.",
            "err.serviceNotReady": "Local service is not ready yet.",
            "err.serviceRequest": "Local service request failed.",
            "err.updateVersion": "Invalid update version.",
            "err.updateMissing": "This build has no valid update package or checksum. Download from GitHub.",
            "err.updateSha": "Update package SHA-256 checksum is invalid.",
            "err.updateWritable": "Install yovoice into a writable Applications folder before updating.",
            "err.updateReplace": "The current app location cannot be replaced. Download the update from GitHub.",
            "err.updateUnavailable": "Update service is temporarily unavailable. Try again later.",
            "err.updateDevBuild": "Development builds cannot auto-replace. Install a release build.",
            "err.updateChecksum": "Update checksum failed. The download was deleted. Try again.",
            "err.updateIdentity": "Update package identity or version does not match.",
            "err.updateCodesign": "Update verification failed (%@): %@",
        ],
    ]
}
