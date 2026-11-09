import Foundation

/// UI locale for native menus and alerts. Mirrors Preferences.uiLocale (not TTS Draft.language).
/// 原生文案只备中英两份：中文界面语言用中文，其余界面语言用英文；旧数据没有该字段时视为中文。
enum HostUiLocale: String {
    case zhCN = "zh-CN"
    case en = "en"

    static func parse(_ raw: String?) -> HostUiLocale {
        guard let raw else { return .zhCN }
        return raw.hasPrefix("zh") ? .zhCN : .en
    }

    static func fromNavigatorLike(_ language: String) -> HostUiLocale {
        language.lowercased().hasPrefix("zh") ? .zhCN : .en
    }
}

/// Native string table keyed by stable ids. Follows preferences.uiLocale from host-preferences.json / SSE.
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
        let root = DataRoot.resolve()
        // 服务把界面语言写在 host-preferences.json；尚未被新版服务打开过的数据目录仍读旧版 state.json。
        let candidates = ["host-preferences.json", "state.json"].map { root.appendingPathComponent($0) }
        guard let data = candidates.lazy.compactMap({ try? Data(contentsOf: $0) }).first,
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
            "inspector.toggle": "切换右侧面板",
            "inspector.tooltip": "收起或展开右侧面板",
            "assistant.toggle": "切换 Ocho",
            "assistant.tooltip": "打开或关闭 Ocho（⌘J）",
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
            "err.serviceStopped": "本地服务意外停止（%d）。可以重新启动服务继续使用，诊断记录保存在日志目录。",
            "err.serviceTimeout": "本地服务启动超时，请退出后重新打开。",
            "err.invalidAddress": "本地服务返回了无效地址。",
            "err.sidebarInvalid": "侧栏设置无效。",
            "err.audioPath": "无法读取音频位置。",
            "err.audioMissing": "音频文件不存在。",
            "err.textExportInvalid": "导出文件格式无效或超过大小限制。",
            "err.modelDirRead": "无法读取模型保存位置。",
            "err.modelDirOpen": "无法打开模型保存目录。",
            "err.serviceNotReady": "本地服务尚未就绪。",
            "err.serviceRequest": "本地服务请求失败。",
            "alert.storageConfigBroken.title": "无法读取存储配置",
            "alert.dataRootMissing.title": "找不到数据目录",
            "alert.dataRootMissing.body": "%@ 不存在。可能是外置磁盘未连接，或目录已被移动、删除。\n\n连接磁盘后点“重试”；确认不再需要原数据时，可在原位置新建空的数据目录。",
            "alert.dataRootMissing.retry": "重试",
            "alert.dataRootMissing.quit": "退出",
            "alert.dataRootMissing.create": "新建空目录",
            "alert.dataRootMissing.createFailed": "无法创建数据目录",
            "err.dataRootMissing": "数据目录已不存在：%@",
            "alert.exitSaveFailed.title": "作品保存失败",
            "alert.exitSaveFailed.body": "%@\n\n数据目录可能已被删除或无法写入。可以备份当前作品后退出、直接退出，或返回继续编辑。",
            "alert.exitSaveFailed.backup": "备份后退出",
            "alert.exitSaveFailed.return": "返回编辑",
            "alert.exitSaveFailed.quit": "直接退出",
            "alert.exitSaveFailed.backupFailed": "备份失败",
            "alert.quitFailed.title": "未能安全退出",
            "alert.quitFailed.body": "%@\n\n可以稍后重试，或直接结束本地服务后退出；未保存的编辑可能丢失。",
            "alert.quitFailed.force": "仍要退出",
            "alert.quitFailed.back": "返回",
            "alert.serviceStopped.title": "本地服务已停止",
            "alert.serviceStopped.restart": "重新启动",
            "alert.serviceStopped.quit": "退出",
            "alert.pageFailed.title": "界面未能加载",
            "alert.pageFailed.retry": "重试",
            "alert.pageFailed.logs": "打开日志目录",
            "err.pageFailed": "窗口内容没有显示出来（%@）。可以重试；仍然空白时请把日志目录中的文件提供给我们排查。",
            "err.pageCrashed": "网页进程反复崩溃",
            "alert.restoreDraftFailed.title": "未能恢复未保存的修改",
            "alert.restoreDraftFailed.body": "%@\n\n可以把当前作品备份到文件保留下来；放弃后这些修改将丢失。",
            "alert.restoreDraftFailed.backup": "备份到文件",
            "alert.restoreDraftFailed.discard": "放弃修改",
            "err.diskFull": "磁盘空间不足，内容未能保存。请清理磁盘空间后重试。",
            "alert.relocated.title": "数据迁移完成",
            "alert.relocated.body": "数据已复制到新目录，yovoice 将自动重启以使用新目录；旧目录会在重启后自动删除。",
            "alert.relocated.restart": "立即重启",
            "err.relaunch": "未能自动重新打开 yovoice，数据已迁移完成，请手动打开应用。",
            "err.updateVersion": "更新版本号无效。",
            "err.updateMissing": "当前版本缺少有效的更新包或校验文件，请从 GitHub 下载。",
            "err.updateSha": "更新包的 SHA-256 校验信息无效。",
            "err.updateWritable": "请将 yovoice 安装到可写的 Applications 文件夹后再更新。",
            "err.updateReplace": "当前应用位置不可替换，请从 GitHub 下载更新。",
            "err.updateUnavailable": "更新服务暂时不可用，请稍后重试。",
            "err.updateNetwork": "无法连接更新服务，请检查网络或代理后重试。",
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
            "inspector.toggle": "Toggle Right Panel",
            "inspector.tooltip": "Collapse or expand the right panel",
            "assistant.toggle": "Toggle Ocho",
            "assistant.tooltip": "Open or close Ocho (⌘J)",
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
            "err.serviceStopped": "The local service stopped unexpectedly (%d). Restart it to keep working. Diagnostics are in the logs folder.",
            "err.serviceTimeout": "Local service timed out while starting. Quit and reopen.",
            "err.invalidAddress": "Local service returned an invalid address.",
            "err.sidebarInvalid": "Invalid sidebar settings.",
            "err.audioPath": "Could not read the audio location.",
            "err.audioMissing": "Audio file does not exist.",
            "err.textExportInvalid": "The exported file is invalid or exceeds the size limit.",
            "err.modelDirRead": "Could not read the model save location.",
            "err.modelDirOpen": "Could not open the model save folder.",
            "err.serviceNotReady": "Local service is not ready yet.",
            "err.serviceRequest": "Local service request failed.",
            "alert.storageConfigBroken.title": "Could Not Read Storage Settings",
            "alert.dataRootMissing.title": "Data Folder Not Found",
            "alert.dataRootMissing.body": "%@ does not exist. The external drive may be disconnected, or the folder was moved or deleted.\n\nConnect the drive and click Retry. If you no longer need the original data, create a new empty data folder at this location.",
            "alert.dataRootMissing.retry": "Retry",
            "alert.dataRootMissing.quit": "Quit",
            "alert.dataRootMissing.create": "Create Empty Folder",
            "alert.dataRootMissing.createFailed": "Could Not Create Data Folder",
            "err.dataRootMissing": "The data folder no longer exists: %@",
            "alert.exitSaveFailed.title": "Could Not Save Your Work",
            "alert.exitSaveFailed.body": "%@\n\nThe data folder may have been deleted or is not writable. Back up the current work and quit, quit without saving, or return to editing.",
            "alert.exitSaveFailed.backup": "Back Up and Quit",
            "alert.exitSaveFailed.return": "Return to Editing",
            "alert.exitSaveFailed.quit": "Quit Without Saving",
            "alert.exitSaveFailed.backupFailed": "Backup Failed",
            "alert.quitFailed.title": "Couldn't Quit Safely",
            "alert.quitFailed.body": "%@\n\nTry again later, or stop the local service and quit now; unsaved edits may be lost.",
            "alert.quitFailed.force": "Quit Anyway",
            "alert.quitFailed.back": "Back",
            "alert.serviceStopped.title": "Local Service Stopped",
            "alert.serviceStopped.restart": "Restart",
            "alert.serviceStopped.quit": "Quit",
            "alert.pageFailed.title": "The Interface Didn't Load",
            "alert.pageFailed.retry": "Retry",
            "alert.pageFailed.logs": "Open Logs Folder",
            "err.pageFailed": "The window content could not be shown (%@). Try again; if it stays blank, please send us the files in the logs folder.",
            "err.pageCrashed": "the web content process kept crashing",
            "alert.restoreDraftFailed.title": "Could Not Restore Unsaved Changes",
            "alert.restoreDraftFailed.body": "%@\n\nBack up the current work to a file to keep it, or discard these changes.",
            "alert.restoreDraftFailed.backup": "Back Up to File",
            "alert.restoreDraftFailed.discard": "Discard Changes",
            "err.diskFull": "The disk is full, so the change could not be saved. Free up disk space and try again.",
            "alert.relocated.title": "Data Moved",
            "alert.relocated.body": "Your data was copied to the new folder. yovoice will restart to use it; the old folder is deleted after restart.",
            "alert.relocated.restart": "Restart Now",
            "err.relaunch": "Could not reopen yovoice automatically. Your data has moved; open the app manually.",
            "err.updateVersion": "Invalid update version.",
            "err.updateMissing": "This build has no valid update package or checksum. Download from GitHub.",
            "err.updateSha": "Update package SHA-256 checksum is invalid.",
            "err.updateWritable": "Install yovoice into a writable Applications folder before updating.",
            "err.updateReplace": "The current app location cannot be replaced. Download the update from GitHub.",
            "err.updateUnavailable": "Update service is temporarily unavailable. Try again later.",
            "err.updateNetwork": "Cannot reach the update service. Check your network or proxy and try again.",
            "err.updateDevBuild": "Development builds cannot auto-replace. Install a release build.",
            "err.updateChecksum": "Update checksum failed. The download was deleted. Try again.",
            "err.updateIdentity": "Update package identity or version does not match.",
            "err.updateCodesign": "Update verification failed (%@): %@",
        ],
    ]
}
