import AppKit

/// 原生菜单栏：应用、编辑、窗口三个菜单，窗口菜单放在最后。
@MainActor
enum HostMenu {
    static func make(aboutTarget: AnyObject?, aboutAction: Selector?, updateItem: NSMenuItem) -> NSMenu {
        let menu = NSMenu()
        let appItem = NSMenuItem()
        menu.addItem(appItem)
        appItem.submenu = NSMenu()
        let aboutItem = appItem.submenu?.addItem(withTitle: HostL10n.t("menu.about"), action: aboutAction, keyEquivalent: "")
        aboutItem?.target = aboutTarget
        appItem.submenu?.addItem(updateItem)
        appItem.submenu?.addItem(.separator())
        // 隐藏（⌘H）、隐藏其他（⌥⌘H）与全部显示，和系统里其他应用一致。
        appItem.submenu?.addItem(withTitle: HostL10n.t("menu.hide"), action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appItem.submenu?.addItem(withTitle: HostL10n.t("menu.hideOthers"), action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h").keyEquivalentModifierMask = [.command, .option]
        appItem.submenu?.addItem(withTitle: HostL10n.t("menu.showAll"), action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        appItem.submenu?.addItem(.separator())
        appItem.submenu?.addItem(withTitle: HostL10n.t("menu.quit"), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        // 编辑菜单：WKWebView 里的撤销、重做与剪贴板快捷键都经菜单项转给网页的输入框；网页自己处理（preventDefault）的按键不会走到这里。
        // 键位写大写 Z 即 ⇧⌘Z。
        let edit = NSMenuItem()
        menu.addItem(edit)
        edit.submenu = NSMenu(title: HostL10n.t("menu.edit"))
        for (title, action, key) in [(HostL10n.t("menu.undo"), "undo:", "z"), (HostL10n.t("menu.redo"), "redo:", "Z"), ("", "", ""), (HostL10n.t("menu.cut"), "cut:", "x"), (HostL10n.t("menu.copy"), "copy:", "c"), (HostL10n.t("menu.paste"), "paste:", "v"), (HostL10n.t("menu.selectAll"), "selectAll:", "a")] {
            if action.isEmpty { edit.submenu?.addItem(.separator()); continue }
            edit.submenu?.addItem(withTitle: title, action: Selector(action), keyEquivalent: key)
        }
        // 窗口菜单：没有单独的“文件”“显示”菜单，关闭窗口（⌘W）与全屏（⌃⌘F）也放在这里；关闭后点程序坞图标重新打开。
        let windowItem = NSMenuItem()
        menu.addItem(windowItem)
        windowItem.submenu = NSMenu(title: HostL10n.t("menu.window"))
        windowItem.submenu?.addItem(withTitle: HostL10n.t("menu.minimize"), action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowItem.submenu?.addItem(withTitle: HostL10n.t("menu.zoom"), action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        windowItem.submenu?.addItem(withTitle: HostL10n.t("menu.fullScreen"), action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f").keyEquivalentModifierMask = [.command, .control]
        windowItem.submenu?.addItem(.separator())
        windowItem.submenu?.addItem(withTitle: HostL10n.t("menu.close"), action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        return menu
    }

    // 界面语言变化后刷新菜单文案；“检查更新”由更新器按自身状态刷新。
    static func localize(_ menu: NSMenu) {
        if let appMenu = menu.item(at: 0)?.submenu {
            appMenu.item(at: 0)?.title = HostL10n.t("menu.about")
            appMenu.items.last?.title = HostL10n.t("menu.quit")
        }
    }
}
