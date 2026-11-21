import AppKit
import XCTest
@testable import VoiceWorkbenchMac

@MainActor
final class HostMenuTests: XCTestCase {
    // 切换界面语言后整套菜单栏立即换成新语言，与直接用新语言建出的菜单一致，不需要重启应用。
    func testLocalizeRetitlesWholeMenuAfterLocaleChange() {
        let original = HostL10n.locale
        defer { HostL10n.setLocale(original) }
        for (from, to) in [(HostUiLocale.en, HostUiLocale.zhCN), (.zhCN, .en)] {
            HostL10n.setLocale(from)
            let menu = makeMenu()
            HostL10n.setLocale(to)
            HostMenu.localize(menu)
            XCTAssertEqual(titles(menu), titles(makeMenu()), "\(from.rawValue) → \(to.rawValue)")
        }
    }

    private func makeMenu() -> NSMenu {
        HostMenu.make(aboutTarget: nil, aboutAction: nil, updateItem: NSMenuItem())
    }

    // 按层级展开菜单栏标题、各子菜单标题和全部菜单项标题。
    private func titles(_ menu: NSMenu, depth: Int = 0) -> [String] {
        [String(repeating: "  ", count: depth) + menu.title] + menu.items.flatMap { item -> [String] in
            let line = String(repeating: "  ", count: depth + 1) + item.title
            guard let submenu = item.submenu else { return [line] }
            return [line] + titles(submenu, depth: depth + 2)
        }
    }
}
