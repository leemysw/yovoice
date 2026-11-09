import Network
import XCTest
@testable import VoiceWorkbenchMac

final class LoadProbeTests: XCTestCase {
    // 本地服务正常回应时只记状态行；被替换成非 HTTP 内容时记下开头的字节。
    func testDirectFetchReportsStatusOrRawBytes() async throws {
        let ok = try await serve(Data("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n".utf8))
        let result = await LoadProbe.run(origin: ok.url, cookie: "vw-x=y")
        ok.listener.cancel()
        XCTAssertTrue(result.contains("直连本地服务 HTTP/1.1 200 OK；"), result)

        let bad = try await serve(Data([0x05, 0xff, 0x00]))
        let garbled = await LoadProbe.run(origin: bad.url, cookie: "vw-x=y")
        bad.listener.cancel()
        XCTAssertTrue(garbled.contains("收到非 HTTP 回应（3 字节）：\\x05\\xff\\x00"), garbled)
    }

    // 起一个只回固定内容的本地监听，返回它的地址。
    private func serve(_ reply: Data) async throws -> (listener: NWListener, url: URL) {
        let listener = try NWListener(using: .tcp, on: .any)
        listener.newConnectionHandler = { connection in
            connection.start(queue: .global())
            connection.receive(minimumIncompleteLength: 1, maximumLength: 4096) { _, _, _, _ in
                connection.send(content: reply, completion: .contentProcessed { _ in connection.cancel() })
            }
        }
        let ready = expectation(description: "listening")
        listener.stateUpdateHandler = { if case .ready = $0 { ready.fulfill() } }
        listener.start(queue: .global())
        await fulfillment(of: [ready], timeout: 3)
        return (listener, URL(string: "http://127.0.0.1:\(listener.port!.rawValue)/")!)
    }
}
