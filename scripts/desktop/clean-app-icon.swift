import AppKit

// 在仓库根目录运行：swift scripts/desktop/clean-app-icon.swift。
// 只重建当前素材的透明蒙版，保留底板和声波的原始颜色。
let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
    .deletingLastPathComponent().deletingLastPathComponent()
let url = root.appendingPathComponent("desktop/icon/voice-workbench-app-icon-v1.png")
let bitmap = NSBitmapImageRep(data: try Data(contentsOf: url))!
let size = 1254
precondition(bitmap.pixelsWide == size && bitmap.pixelsHigh == size,
             "素材尺寸变化，请重新校准轮廓")
precondition(bitmap.bitsPerSample == 8 && bitmap.samplesPerPixel == 4
             && !bitmap.isPlanar && bitmap.bitmapFormat == .alphaNonpremultiplied,
             "素材必须是非预乘 RGBA PNG")

// 根据原图圆角拟合连续曲线，向内收约 3 像素，避开生成素材的毛边。
let low: CGFloat = 30
let high: CGFloat = 1224
let radius: CGFloat = 347
let control = radius * (1 - 0.594)
let path = CGMutablePath()
path.move(to: CGPoint(x: low + radius, y: low))
path.addLine(to: CGPoint(x: high - radius, y: low))
path.addCurve(to: CGPoint(x: high, y: low + radius),
              control1: CGPoint(x: high - control, y: low),
              control2: CGPoint(x: high, y: low + control))
path.addLine(to: CGPoint(x: high, y: high - radius))
path.addCurve(to: CGPoint(x: high - radius, y: high),
              control1: CGPoint(x: high, y: high - control),
              control2: CGPoint(x: high - control, y: high))
path.addLine(to: CGPoint(x: low + radius, y: high))
path.addCurve(to: CGPoint(x: low, y: high - radius),
              control1: CGPoint(x: low + control, y: high),
              control2: CGPoint(x: low, y: high - control))
path.addLine(to: CGPoint(x: low, y: low + radius))
path.addCurve(to: CGPoint(x: low + radius, y: low),
              control1: CGPoint(x: low, y: low + control),
              control2: CGPoint(x: low + control, y: low))
path.closeSubpath()

let mask = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8,
                     bytesPerRow: size * 4, space: CGColorSpaceCreateDeviceRGB(),
                     bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
mask.setFillColor(CGColor(gray: 1, alpha: 1))
mask.addPath(path)
mask.fillPath()
let alpha = mask.data!.assumingMemoryBound(to: UInt8.self)
let pixels = bitmap.bitmapData!
for y in 0..<size {
    for x in 0..<size {
        let index = y * bitmap.bytesPerRow + x * 4
        let value = alpha[(y * size + x) * 4 + 3]
        // 新轮廓只能落在原底板内，不能将透明区的杂色变成不透明像素。
        precondition(value == 0 || pixels[index + 3] >= 128 || pixels[index + 3] == value,
                     "蒙版超出素材底板，请重新校准轮廓")
        pixels[index + 3] = value
        if value == 0 {
            pixels[index] = 0
            pixels[index + 1] = 0
            pixels[index + 2] = 0
        }
    }
}
precondition(pixels[(size / 2) * bitmap.bytesPerRow + (size / 2) * 4 + 3] == 255)
// 不写 gAMA：AppKit 会带上读入时的伽马值，Safari、Firefox 等会按它改亮度，各浏览器看到的底色不一致。
bitmap.setProperty(.gamma, withValue: nil)
try bitmap.representation(using: .png, properties: [:])!.write(to: url, options: .atomic)
print("已重建透明蒙版：底板完全不透明，轮廓外透明，仅边缘保留抗锯齿。")
