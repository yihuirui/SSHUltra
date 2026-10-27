import AppKit

let project = CommandLine.arguments[1]
let output = project + "/assets"
try FileManager.default.createDirectory(atPath: output, withIntermediateDirectories: true)
let image = NSImage(size: NSSize(width: 1024, height: 1024))
image.lockFocus()
NSColor.clear.setFill()
NSRect(x: 0, y: 0, width: 1024, height: 1024).fill()
let square = NSBezierPath(roundedRect: NSRect(x: 60, y: 60, width: 904, height: 904), xRadius: 200, yRadius: 200)
NSGradient(starting: NSColor(calibratedRed: 0.16, green: 0.29, blue: 0.32, alpha: 1), ending: NSColor(calibratedRed: 0.06, green: 0.10, blue: 0.16, alpha: 1))!.draw(in: square, angle: -65)
NSColor(calibratedRed: 0.40, green: 0.71, blue: 0.66, alpha: 0.3).setStroke()
square.lineWidth = 3; square.stroke()
let terminal = NSBezierPath(roundedRect: NSRect(x: 205, y: 255, width: 614, height: 514), xRadius: 64, yRadius: 64)
NSColor(calibratedRed: 0.03, green: 0.08, blue: 0.12, alpha: 0.8).setFill(); terminal.fill()
NSColor(calibratedRed: 0.44, green: 0.86, blue: 0.75, alpha: 1).setStroke()
terminal.lineWidth = 20; terminal.stroke()
let arrow = NSBezierPath()
arrow.move(to: NSPoint(x: 325, y: 584)); arrow.line(to: NSPoint(x: 433, y: 502)); arrow.line(to: NSPoint(x: 325, y: 420))
arrow.lineWidth = 36; arrow.lineCapStyle = .round; arrow.lineJoinStyle = .round; arrow.stroke()
let line = NSBezierPath(); line.move(to: NSPoint(x: 515, y: 420)); line.line(to: NSPoint(x: 670, y: 420)); line.lineWidth = 36; line.lineCapStyle = .round; line.stroke()
NSColor(calibratedRed: 0.47, green: 0.64, blue: 0.67, alpha: 0.8).setFill()
for x in [270, 315, 360] { NSBezierPath(ovalIn: NSRect(x: x, y: 690, width: 17, height: 17)).fill() }
image.unlockFocus()
let rep = NSBitmapImageRep(data: image.tiffRepresentation!)!
try rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: output + "/icon.png"))
print("Icon generated: " + output + "/icon.png")
