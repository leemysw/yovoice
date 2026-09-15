import AppKit

// 以双倍像素生成背景，TIFF 保留逻辑尺寸，适配 Retina Finder 窗口。
let output = CommandLine.arguments[1]
let size = NSSize(width: 720, height: 460)
let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 1440, pixelsHigh: 920,
    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
    colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
bitmap.size = size
let bitmapContext = NSGraphicsContext(bitmapImageRep: bitmap)!
let context = NSGraphicsContext(cgContext: bitmapContext.cgContext, flipped: true)
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = context
context.cgContext.translateBy(x: 0, y: size.height)
context.cgContext.scaleBy(x: 1, y: -1)
let paper = NSColor(srgbRed: 0.982, green: 0.977, blue: 0.988, alpha: 1)
let ink = NSColor(srgbRed: 0.17, green: 0.15, blue: 0.20, alpha: 1)
let muted = NSColor(srgbRed: 0.48, green: 0.45, blue: 0.51, alpha: 1)
let accent = NSColor(srgbRed: 0.62, green: 0.47, blue: 0.70, alpha: 1)
paper.setFill()
NSBezierPath(rect: NSRect(origin: .zero, size: size)).fill()
func text(_ value: String, x: CGFloat, y: CGFloat, width: CGFloat, font: CGFloat, color: NSColor, bold: Bool = false, center: Bool = false) {
    let paragraph = NSMutableParagraphStyle()
    paragraph.alignment = center ? .center : .left
    (value as NSString).draw(with: NSRect(x: x, y: y, width: width, height: 44), options: [.usesLineFragmentOrigin],
        attributes: [.font: NSFont.systemFont(ofSize: font, weight: bold ? .semibold : .regular), .foregroundColor: color, .paragraphStyle: paragraph],
        context: nil)
}
// 文字在翻转后的坐标中绘制，图形和 Finder 图标共用左上角原点。
text("让文字，有了声音。", x: 44, y: 38, width: 480, font: 27, color: ink, bold: true)
text("将 yovoice 拖入 Applications，即可开始创作", x: 44, y: 84, width: 610, font: 14, color: muted)
text("yovoice", x: 586, y: 47, width: 100, font: 17, color: accent, bold: true)
for x: CGFloat in [180, 540] {
    NSColor.white.withAlphaComponent(0.72).setFill()
    let tile = NSBezierPath(roundedRect: NSRect(x: x - 70, y: 154, width: 140, height: 140), xRadius: 30, yRadius: 30)
    tile.fill()
    accent.withAlphaComponent(0.10).setStroke()
    tile.lineWidth = 1
    tile.stroke()
}
// 声波逐渐收束成箭头，既是品牌细节，也是拖拽方向提示。
for i in 0..<19 {
    let x = CGFloat(290 + i * 6)
    let amplitude = CGFloat(4 + 18 * pow(sin(Double(i) / 18 * .pi), 2) * (0.45 + 0.55 * abs(sin(Double(i) * 1.4))))
    let bar = NSBezierPath()
    bar.move(to: NSPoint(x: x, y: 220 - amplitude))
    bar.line(to: NSPoint(x: x, y: 220 + amplitude))
    bar.lineWidth = 2.5
    bar.lineCapStyle = .round
    accent.withAlphaComponent(0.65).setStroke()
    bar.stroke()
}
let arrow = NSBezierPath()
arrow.move(to: NSPoint(x: 407, y: 212))
arrow.line(to: NSPoint(x: 416, y: 220))
arrow.line(to: NSPoint(x: 407, y: 228))
arrow.lineWidth = 2
arrow.lineCapStyle = .round
accent.setStroke()
arrow.stroke()
// 文案分列背景资源两侧，为居中的文件夹保留空间。
text("下一句，由你发声。", x: 32, y: 365, width: 250, font: 14, color: muted, center: true)
text("本地创作 · 自在表达", x: 438, y: 365, width: 250, font: 14, color: muted, center: true)
NSGraphicsContext.restoreGraphicsState()
try bitmap.representation(using: .tiff, properties: [:])!.write(to: URL(fileURLWithPath: output))
// PNG 仅用于审阅背景，不放入最终安装包。
try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: output).deletingPathExtension().appendingPathExtension("png"))
