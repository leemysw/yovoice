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

    func testChecksumMustMatchExactFilenameOnce() throws {
        let hash = String(repeating: "a", count: 64)
        let other = String(repeating: "b", count: 64)
        let name = "yovoice-v0.10.0-macos-arm64.zip"
        XCTAssertEqual(try UpdateRelease.checksum("\(other)  ./windows.zip\n\(hash)  ./\(name)\n", for: name), hash)
        XCTAssertThrowsError(try UpdateRelease.checksum("\(hash)  ./windows.zip", for: name))
        XCTAssertThrowsError(try UpdateRelease.checksum("\(hash)  \(name)\n\(other)  \(name)", for: name))
        XCTAssertThrowsError(try UpdateRelease.checksum("invalid  \(name)", for: name))
    }
}
