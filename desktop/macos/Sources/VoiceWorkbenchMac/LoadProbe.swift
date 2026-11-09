import CFNetwork
import Foundation
import Network

// 页面加载失败时的自检：绕过 WebKit 直接用 TCP 向本地服务要一次首页，并记下系统代理对这个地址的处理方式。
// 直连能拿到正常的 HTTP 回应，说明服务没问题，是 WebKit 这条路被代理或安全软件截住；直连也拿不到，问题在服务或系统网络本身。
enum LoadProbe {
    static func run(origin: URL, cookie: String) async -> String {
        let direct = await fetch(origin: origin, cookie: cookie)
        return "加载自检：直连本地服务 \(direct)；系统代理 \(proxies(for: origin))"
    }

    // 用原始 TCP 发一次 GET，最多读 512 字节、等 3 秒，不经过任何代理设置。
    private static func fetch(origin: URL, cookie: String) async -> String {
        guard let host = origin.host, let port = origin.port, let endpoint = NWEndpoint.Port(rawValue: UInt16(clamping: port)) else { return "地址无效" }
        let connection = NWConnection(host: NWEndpoint.Host(host), port: endpoint, using: .tcp)
        let once = Once()
        return await withCheckedContinuation { continuation in
            let finish: @Sendable (String) -> Void = { result in
                guard once.claim() else { return }
                connection.cancel()
                continuation.resume(returning: result)
            }
            connection.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    let request = "GET / HTTP/1.1\r\nHost: \(host):\(port)\r\nCookie: \(cookie)\r\nConnection: close\r\n\r\n"
                    connection.send(content: Data(request.utf8), completion: .contentProcessed { error in
                        if let error { finish("发送失败：\(error)"); return }
                        connection.receive(minimumIncompleteLength: 1, maximumLength: 512) { data, _, _, error in
                            if let data, !data.isEmpty { finish(describe(data)) } else { finish("没有回应\(error.map { "：\($0)" } ?? "")") }
                        }
                    })
                case .failed(let error): finish("连接失败：\(error)")
                case .waiting(let error): finish("无法连接：\(error)")
                default: break
                }
            }
            connection.start(queue: .global())
            DispatchQueue.global().asyncAfter(deadline: .now() + 3) { finish("超时") }
        }
    }

    // 回应以 HTTP 状态行开头时只记状态行；否则记下前 64 字节，方便看出是被什么截住（如代理返回的非 HTTP 内容）。
    static func describe(_ data: Data) -> String {
        let text = String(decoding: data, as: UTF8.self)
        if text.hasPrefix("HTTP/"), let line = text.split(separator: "\r\n", maxSplits: 1, omittingEmptySubsequences: false).first {
            return String(line)
        }
        let head = data.prefix(64).map { byte -> String in
            (0x20..<0x7f).contains(byte) ? String(UnicodeScalar(byte)) : String(format: "\\x%02x", byte)
        }.joined()
        return "收到非 HTTP 回应（\(data.count) 字节）：\(head)"
    }

    // 系统代理设置对这个地址给出的路由：DIRECT 表示不走代理。
    private static func proxies(for url: URL) -> String {
        guard let settings = CFNetworkCopySystemProxySettings()?.takeRetainedValue(),
              let list = CFNetworkCopyProxiesForURL(url as CFURL, settings).takeRetainedValue() as? [[String: Any]] else { return "未知" }
        return list.map { proxy -> String in
            let type = (proxy[kCFProxyTypeKey as String] as? String ?? "?").replacingOccurrences(of: "kCFProxyType", with: "")
            guard let host = proxy[kCFProxyHostNameKey as String] as? String else { return type == "None" ? "DIRECT" : type }
            return "\(type) \(host):\(proxy[kCFProxyPortNumberKey as String] as? Int ?? 0)"
        }.joined(separator: ", ")
    }
}

// 连接状态回调与超时可能同时到达，只认第一个结果。
private final class Once: @unchecked Sendable {
    private let lock = NSLock()
    private var done = false
    func claim() -> Bool {
        lock.lock(); defer { lock.unlock() }
        if done { return false }
        done = true
        return true
    }
}
