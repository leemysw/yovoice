import XCTest
@testable import VoiceWorkbenchMac

final class UpdateReleaseTests: XCTestCase {
    func testOnlyNewStableMatchingPackageIsSelected() throws {
        let package = UpdateRelease.Asset(name: "yovoice-v0.10.0-macos-arm64.zip", browser_download_url: URL(string: "https://github.com/leemysw/yovoice/releases/download/v0.10.0/yovoice-v0.10.0-macos-arm64.zip")!)
        let release = UpdateRelease(tag_name: "v0.10.0", draft: false, prerelease: false, assets: [package])
        XCTAssertEqual(try release.package(newerThan: "0.9.9")?.name, package.name)
        XCTAssertNil(try release.package(newerThan: "0.10.0"))
        XCTAssertNil(try release.package(newerThan: "1.0.0"))
        XCTAssertNil(try UpdateRelease(tag_name: "v0.11.0-beta", draft: false, prerelease: true, assets: []).package(newerThan: "0.10.0"))
        XCTAssertThrowsError(try UpdateRelease(tag_name: "v../../1.0.0", draft: false, prerelease: false, assets: []).package(newerThan: "0.10.0"))
        XCTAssertThrowsError(try UpdateRelease(tag_name: "v0.11.0", draft: false, prerelease: false, assets: []).package(newerThan: "0.10.0"))
        let foreign = UpdateRelease.Asset(name: package.name, browser_download_url: URL(string: "https://example.com/\(package.name)")!)
        XCTAssertThrowsError(try UpdateRelease(tag_name: release.tag_name, draft: false, prerelease: false, assets: [foreign]).package(newerThan: "0.9.9"))
    }

    func testReleaseNotesAreDecodedForDisplay() throws {
        let json = #"{"tag_name":"v0.10.0","draft":false,"prerelease":false,"assets":[],"body":"English\n- New","published_at":"2026-10-11T08:00:00Z"}"#
        let release = try JSONDecoder().decode(UpdateRelease.self, from: Data(json.utf8))
        XCTAssertEqual(release.notes, "English\n- New")
        XCTAssertEqual(release.published_at, "2026-10-11T08:00:00Z")
        XCTAssertNil(UpdateRelease(tag_name: "v0.10.0", draft: false, prerelease: false, assets: []).notes)
        XCTAssertEqual(UpdateRelease(tag_name: "v0.10.0", draft: false, prerelease: false, assets: [], body: String(repeating: "x", count: 30000)).notes?.count, 20000)
    }

    func testCorruptDownloadIsDeletedBeforeExtraction() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let archive = directory.appendingPathComponent("update.zip")
        try Data("damaged download".utf8).write(to: archive)
        XCTAssertThrowsError(try AppUpdater.prepare(archive: archive, hash: String(repeating: "0", count: 64), version: "1.0.0", team: "TESTTEAM00"))
        XCTAssertFalse(FileManager.default.fileExists(atPath: archive.path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.appendingPathComponent("yovoice.app").path))
    }

    func testArchitectureCheckUsesRealLipo() throws {
        let executable = try XCTUnwrap(Bundle(for: UpdateReleaseTests.self).executableURL)
        try AppUpdater.verifyArchitecture(executable)
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("invalid binary \(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: file) }
        try Data("not a Mach-O binary".utf8).write(to: file)
        XCTAssertThrowsError(try AppUpdater.verifyArchitecture(file))
    }

    func testSignatureCheckParsesTeamRequirement() throws {
        // 系统自带的 codesign 由 Apple 签名，不属于任何开发者团队：应因不满足要求而失败，而不是要求本身无法解析。
        XCTAssertThrowsError(try AppUpdater.verifySignature(URL(fileURLWithPath: "/usr/bin/codesign"), team: "TESTTEAM00")) { error in
            let message = error.localizedDescription
            XCTAssertFalse(message.contains("invalid requirement"), message)
            XCTAssertFalse(message.contains("No such file"), message)
        }
    }

    func testChecksumMustMatchExactFilenameOnce() throws {
        let hash = String(repeating: "a", count: 64)
        let other = String(repeating: "b", count: 64)
        let name = "yovoice-v0.10.0-macos-arm64.zip"
        XCTAssertEqual(try UpdateRelease.checksum("\(other)  ./windows.zip\n\(hash)  ./\(name)\n", for: name), hash)
        XCTAssertThrowsError(try UpdateRelease.checksum("\(hash)  ./windows.zip", for: name))
        XCTAssertThrowsError(try UpdateRelease.checksum("\(hash)  \(name)\n\(other)  \(name)", for: name))
        XCTAssertThrowsError(try UpdateRelease.checksum("invalid  \(name)", for: name))
    }

    func testReleaseManifestDecodesLikeReleaseApi() throws {
        // 与 scripts/release-manifest.py 生成的 latest.json 同形。
        let json = #"{"tag_name":"v0.10.0","draft":false,"prerelease":false,"published_at":"2026-11-24T08:00:00Z","body":"## [0.10.0]","assets":[{"name":"SHA256SUMS.txt","browser_download_url":"https://github.com/leemysw/yovoice/releases/download/v0.10.0/SHA256SUMS.txt"},{"name":"yovoice-v0.10.0-macos-arm64.zip","browser_download_url":"https://github.com/leemysw/yovoice/releases/download/v0.10.0/yovoice-v0.10.0-macos-arm64.zip"}]}"#
        let release = try JSONDecoder().decode(UpdateRelease.self, from: Data(json.utf8))
        XCTAssertEqual(try release.package(newerThan: "0.9.0")?.name, "yovoice-v0.10.0-macos-arm64.zip")
        XCTAssertEqual(try release.asset(named: "SHA256SUMS.txt").name, "SHA256SUMS.txt")
        XCTAssertEqual(release.notes, "## [0.10.0]")
    }

    func testRateLimitedResponsesExplainWhenToRetry() {
        let original = HostL10n.locale
        defer { HostL10n.setLocale(original) }
        HostL10n.setLocale(.en)
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        func response(_ status: Int, _ headers: [String: String] = [:]) -> HTTPURLResponse {
            HTTPURLResponse(url: URL(string: "https://api.github.com/repos/leemysw/yovoice/releases/latest")!, statusCode: status, httpVersion: nil, headerFields: headers)!
        }
        XCTAssertEqual(UpdateRelease.serviceError(response(403, ["x-ratelimit-remaining": "0", "x-ratelimit-reset": "1800001450"]), now: now),
                       "GitHub is temporarily limiting update checks. Try again in about 25 min.")
        XCTAssertEqual(UpdateRelease.serviceError(response(403, ["Retry-After": "30"]), now: now),
                       "GitHub is temporarily limiting update checks. Try again in about 1 min.")
        // now 是 2027-01-15 08:00:00 GMT。
        XCTAssertEqual(UpdateRelease.serviceError(response(429, ["Retry-After": "Fri, 15 Jan 2027 08:10:00 GMT"]), now: now),
                       "GitHub is temporarily limiting update checks. Try again in about 10 min.")
        XCTAssertEqual(UpdateRelease.serviceError(response(429), now: now), "GitHub is temporarily limiting update checks. Try again later.")
        XCTAssertEqual(UpdateRelease.serviceError(response(403, ["x-ratelimit-remaining": "12"]), now: now),
                       "The update service is temporarily unavailable (HTTP 403). Try again later.")
        XCTAssertEqual(UpdateRelease.serviceError(response(502), now: now),
                       "The update service is temporarily unavailable (HTTP 502). Try again later.")
    }
}
