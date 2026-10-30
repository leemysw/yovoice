import AppKit
import ImageIO

// 在仓库根目录运行：swift scripts/desktop/build-macos-icon.swift。
// 保留原图像素内容；传统 macOS 图标需要把透明留白写进资源。
let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
    .deletingLastPathComponent().deletingLastPathComponent()
let sourceURL = root.appendingPathComponent("desktop/icon/voice-workbench-app-icon-v1.png")
let source = CGImageSourceCreateWithURL(sourceURL as CFURL, nil)!
let image = CGImageSourceCreateImageAtIndex(source, 0, nil)!
// 当前素材的底板边界；先去掉不对称留白，再适配 macOS 的图标画布。
// 更换源图时需要重新校准，不能沿用这组裁切坐标。
precondition(image.width == 1254 && image.height == 1254, "源图尺寸变化，请重新校准底板边界")
let artwork = image.cropping(to: CGRect(x: 30, y: 30, width: 1194, height: 1194))!
let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
let iconset = temporary.appendingPathComponent("AppIcon.iconset")
try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)
defer { try? FileManager.default.removeItem(at: temporary) }

// 传统 macOS 圆角底板使用 1024 画布、824 主体、四边各 100 的基准。
// 小尺寸将留白对齐到整像素；已对照 Apple Icon Composer 自带的旧版 icns。
// 各分辨率直接从同一原图采样，避免反复缩放导致小图标模糊。
for points in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let pixels = points * scale
        let context = CGContext(
            data: nil, width: pixels, height: pixels, bitsPerComponent: 8,
            bytesPerRow: pixels * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        let inset = (CGFloat(pixels) * 100 / 1024).rounded()
        context.interpolationQuality = .high
        context.draw(artwork, in: CGRect(
            x: inset, y: inset, width: CGFloat(pixels) - inset * 2,
            height: CGFloat(pixels) - inset * 2))
        let bitmap = NSBitmapImageRep(cgImage: context.makeImage()!)
        // 主体四边中点必须落在目标边界，避免重复添加留白而缩小图标。
        let edge = Int(inset)
        let center = pixels / 2
        for (x, y) in [(edge, center), (pixels - edge - 1, center),
                       (center, edge), (center, pixels - edge - 1)] {
            precondition(bitmap.colorAt(x: x, y: y)!.alphaComponent >= 0.5,
                         "图标主体没有对齐目标边界")
        }
        // 最外圈必须透明，防止下次更新素材时再次铺满画布。
        for coordinate in 0..<pixels {
            for (x, y) in [(coordinate, 0), (coordinate, pixels - 1),
                           (0, coordinate), (pixels - 1, coordinate)] {
                precondition(bitmap.colorAt(x: x, y: y)!.alphaComponent == 0)
            }
        }
        let suffix = scale == 2 ? "@2x" : ""
        let file = iconset.appendingPathComponent("icon_\(points)x\(points)\(suffix).png")
        try bitmap.representation(using: .png, properties: [:])!.write(to: file)
    }
}

let output = temporary.appendingPathComponent("AppIcon.icns")
let process = Process()
process.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
process.arguments = ["-c", "icns", iconset.path, "-o", output.path]
try process.run()
process.waitUntilExit()
precondition(process.terminationStatus == 0, "图标打包失败")
try Data(contentsOf: output).write(
    to: root.appendingPathComponent("desktop/macos/Resources/AppIcon.icns"), options: .atomic)
print("已生成带透明留白的 macOS 图标。")
