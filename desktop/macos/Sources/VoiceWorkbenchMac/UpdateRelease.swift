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
    // 发布说明与日期只用于界面展示，缺失时不影响更新。
    var body: String?
    var published_at: String?

    var version: String { String(tag_name.dropFirst()) }
    // 界面最多展示的发布说明长度，避免异常长的正文撑大消息。
    var notes: String? { body.map { String($0.prefix(20000)) } }

    func package(newerThan current: String) throws -> Asset? {
        guard !draft, !prerelease else { return nil }
        guard tag_name.hasPrefix("v"), Self.parts(version) != nil,
              Self.parts(current) != nil else { throw Self.failure(HostL10n.t("err.updateVersion")) }
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
            throw Self.failure(HostL10n.t("err.updateMissing"))
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
            throw failure(HostL10n.t("err.updateSha"))
        }
        return hash
    }

    // 更新服务返回错误状态时的说明：GitHub 未登录接口限流时返回 403 或 429，说明原因与可重试时间，
    // 不笼统地报“暂时不可用”；其他状态带上状态码，便于排查。
    static func serviceError(_ response: HTTPURLResponse, now: Date) -> String {
        let exhausted = response.value(forHTTPHeaderField: "x-ratelimit-remaining") == "0"
        let retryAfter = response.value(forHTTPHeaderField: "Retry-After")
        let limited = response.statusCode == 429 || response.statusCode == 403 && (exhausted || retryAfter != nil)
        guard limited else { return HostL10n.t("err.updateUnavailableStatus", response.statusCode) }
        var retry: Date?
        if let retryAfter {
            if let seconds = TimeInterval(retryAfter.trimmingCharacters(in: .whitespaces)) {
                retry = now.addingTimeInterval(seconds)
            } else {
                let formatter = DateFormatter()
                formatter.locale = Locale(identifier: "en_US_POSIX")
                formatter.timeZone = TimeZone(identifier: "GMT")
                formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss zzz"
                retry = formatter.date(from: retryAfter)
            }
        } else if exhausted, let reset = response.value(forHTTPHeaderField: "x-ratelimit-reset").flatMap(TimeInterval.init) {
            retry = Date(timeIntervalSince1970: reset)
        }
        guard let retry else { return HostL10n.t("err.updateRateLimited") }
        let minutes = max(1, Int((retry.timeIntervalSince(now) / 60).rounded(.up)))
        return HostL10n.t("err.updateRateLimitedRetry", minutes)
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
