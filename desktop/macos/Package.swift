// swift-tools-version: 5.9
import PackageDescription
let package = Package(name: "VoiceWorkbenchMac", platforms: [.macOS(.v14)], products: [.executable(name: "VoiceWorkbenchMac", targets: ["VoiceWorkbenchMac"])], targets: [.executableTarget(name: "VoiceWorkbenchMac")])
