import Foundation

struct UpdateRelease: Decodable {
    struct Asset: Decodable {
        let name: String
        let browser_download_url: URL
    }

    let tag_name: String
    let draft: Bool
    let prerelease: Bool
    let assets: [Asset]

    var version: String { String(tag_name.dropFirst()) }

    func package(newerThan current: String) throws -> Asset? {
        guard !draft, !prerelease else { return nil }
        guard tag_name.hasPrefix("v"), Self.parts(version) != nil,
              Self.parts(current) != nil else { throw Self.failure("更新版本号无效。") }
        guard version.compare(current, options: .numeric) == .orderedDescending else { return nil }
        return try asset(named: "yovoice-\(tag_name)-macos-arm64.zip")
    }

    func asset(named name: String) throws -> Asset {
        let matches = assets.filter { $0.name == name }
        guard matches.count == 1, let asset = matches.first,
              asset.browser_download_url.scheme == "https",
              asset.browser_download_url.host == "github.com",
              asset.browser_download_url.user == nil,
              asset.browser_download_url.password == nil,
              asset.browser_download_url.port == nil,
              asset.browser_download_url.path == "/leemysw/yovoice/releases/download/\(tag_name)/\(name)" else {
            throw Self.failure("当前版本缺少有效的更新包或校验文件，请从 GitHub 下载。")
        }
        return asset
    }

    static func checksum(_ text: String, for name: String) throws -> String {
        let hashes = text.split(whereSeparator: \.isNewline).compactMap { line -> String? in
            let fields = line.split(maxSplits: 1, whereSeparator: \.isWhitespace)
            guard fields.count == 2 else { return nil }
            var filename = String(fields[1]).trimmingCharacters(in: .whitespaces)
            if filename.hasPrefix("*") { filename.removeFirst() }
            if filename.hasPrefix("./") { filename.removeFirst(2) }
            guard filename == name else { return nil }
            return String(fields[0]).lowercased()
        }
        guard hashes.count == 1, let hash = hashes.first,
              hash.count == 64, hash.allSatisfy({ "0123456789abcdef".contains($0) }) else {
            throw failure("更新包的 SHA-256 校验信息无效。")
        }
        return hash
    }

    private static func parts(_ version: String) -> [Int]? {
        let parts = version.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3, parts.allSatisfy({ !$0.isEmpty && $0.allSatisfy(\.isASCII) && $0.allSatisfy(\.isNumber) && Int($0) != nil }) else { return nil }
        return parts.compactMap { Int($0) }
    }

    static func failure(_ message: String) -> NSError {
        NSError(domain: "yovoice.Update", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
}
