import AppKit

/// 原生菜单栏：应用、编辑、窗口三个菜单，窗口菜单放在最后。
/// 每个带文案的菜单项把文案键记在 identifier 上，切换界面语言时按键重新取文案，整套菜单立即换语言。
@MainActor
enum HostMenu {
    static func make(aboutTarget: AnyObject?, aboutAction: Selector?, updateItem: NSMenuItem) -> NSMenu {
        let about = item("menu.about", aboutAction)
        about.target = aboutTarget
        let menu = NSMenu()
        // 应用菜单的标题由系统显示为应用名。
        let app = NSMenuItem()
        app.submenu = NSMenu()
        app.submenu?.items = [
            about,
            updateItem,
            .separator(),
            // 隐藏（⌘H）、隐藏其他（⌥⌘H）与全部显示，和系统里其他应用一致。
            item("menu.hide", #selector(NSApplication.hide(_:)), "h"),
            item("menu.hideOthers", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]),
            item("menu.showAll", #selector(NSApplication.unhideAllApplications(_:))),
            .separator(),
            item("menu.quit", #selector(NSApplication.terminate(_:)), "q"),
        ]
        menu.items = [
            app,
            // 编辑菜单：WKWebView 里的撤销、重做与剪贴板快捷键都经菜单项转给网页的输入框；网页自己处理（preventDefault）的按键不会走到这里。
            // 键位写大写 Z 即 ⇧⌘Z。
            submenu("menu.edit", [
                item("menu.undo", Selector(("undo:")), "z"),
                item("menu.redo", Selector(("redo:")), "Z"),
                .separator(),
                item("menu.cut", #selector(NSText.cut(_:)), "x"),
                item("menu.copy", #selector(NSText.copy(_:)), "c"),
                item("menu.paste", #selector(NSText.paste(_:)), "v"),
                item("menu.selectAll", #selector(NSText.selectAll(_:)), "a"),
            ]),
            // 窗口菜单：没有单独的“文件”“显示”菜单，关闭窗口（⌘W）与全屏（⌃⌘F）也放在这里；关闭后点程序坞图标重新打开。
            submenu("menu.window", [
                item("menu.minimize", #selector(NSWindow.performMiniaturize(_:)), "m"),
                item("menu.zoom", #selector(NSWindow.performZoom(_:))),
                item("menu.fullScreen", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]),
                .separator(),
                item("menu.close", #selector(NSWindow.performClose(_:)), "w"),
            ]),
        ]
        return menu
    }

    /// 按 identifier 记下的文案键重设标题；系统插入的菜单项和“检查更新”（由更新器按自身状态刷新）不在文案表里，保持原样。
    static func localize(_ menu: NSMenu) {
        for item in menu.items {
            if let key = item.identifier?.rawValue, HostL10n.has(key) {
                item.title = HostL10n.t(key)
                item.submenu?.title = item.title
            }
            if let submenu = item.submenu { localize(submenu) }
        }
    }

    private static func item(_ key: String, _ action: Selector?, _ keyEquivalent: String = "", _ modifiers: NSEvent.ModifierFlags = .command) -> NSMenuItem {
        let item = NSMenuItem(title: HostL10n.t(key), action: action, keyEquivalent: keyEquivalent)
        item.identifier = NSUserInterfaceItemIdentifier(key)
        item.keyEquivalentModifierMask = modifiers
        return item
    }

    private static func submenu(_ key: String, _ items: [NSMenuItem]) -> NSMenuItem {
        let item = item(key, nil)
        item.submenu = NSMenu(title: item.title)
        item.submenu?.items = items
        return item
    }
}
