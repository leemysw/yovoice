import WebKit
import XCTest
@testable import VoiceWorkbenchMac

@MainActor
final class FrameOriginTests: XCTestCase, WKScriptMessageHandler {
    private var receivedFrame: WKFrameInfo?
    private var frameReceived: XCTestExpectation?

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        receivedFrame = message.frameInfo
        frameReceived?.fulfill()
    }

    func testOriginValidationAndDenyBeforeServiceStarts() async throws {
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(self, name: "test")
        defer { configuration.userContentController.removeScriptMessageHandler(forName: "test") }
        let webView = WKWebView(frame: .zero, configuration: configuration)
        let received = expectation(description: "收到真实 WebKit frame")
        frameReceived = received
        let localOrigin = URL(string: "http://127.0.0.1:54321")!
        webView.loadHTMLString("<script>window.webkit.messageHandlers.test.postMessage('ready')</script>", baseURL: localOrigin)
        await fulfillment(of: [received], timeout: 10)
        let frame = try XCTUnwrap(receivedFrame)
        XCTAssertTrue(frame.isMainFrame)
        XCTAssertTrue(AppDelegate.trusted(frame.securityOrigin, localOrigin: localOrigin))
        for address in ["https://127.0.0.1:54321", "http://localhost:54321", "http://127.0.0.1:54322", "http://127.0.0.1"] {
            XCTAssertFalse(AppDelegate.trusted(frame.securityOrigin, localOrigin: URL(string: address)), address)
        }
        XCTAssertFalse(AppDelegate.trusted(frame.securityOrigin, localOrigin: nil))

        // 尚未启动本地服务时，回调必须直接拒绝，不请求系统麦克风权限。
        var decision: WKPermissionDecision?
        AppDelegate().webView(webView, requestMediaCapturePermissionFor: frame.securityOrigin,
                              initiatedByFrame: frame, type: .microphone) { decision = $0 }
        XCTAssertEqual(decision, .deny)
    }
}
