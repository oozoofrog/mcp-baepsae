import AppKit
import CoreGraphics
import Foundation

func handleRightClick(_ parsed: ParsedOptions) throws -> Int32 {
    let target = try resolveTarget(from: parsed)
    try activateTarget(target)
    try ensureAccessibilityTrusted()
    let accessibilityId = parsed.options["--id"]
    let accessibilityLabel = parsed.options["--label"]
    let preDelay = try optionalDoubleOption("--pre-delay", from: parsed) ?? 0
    let postDelay = try optionalDoubleOption("--post-delay", from: parsed) ?? 0
    if preDelay > 0 {
        Thread.sleep(forTimeInterval: preDelay)
    }
    if accessibilityId != nil || accessibilityLabel != nil {
        let root = try accessibilityRootElement(for: target)
        guard let matchedElement = findAccessibilityElement(
            in: root,
            identifier: accessibilityId,
            label: accessibilityLabel
        ) else {
            var selectors: [String] = []
            if let accessibilityId { selectors.append("id='\(accessibilityId)'") }
            if let accessibilityLabel { selectors.append("label='\(accessibilityLabel)'") }
            throw NativeError.commandFailed("No accessibility element matched \(selectors.joined(separator: " and ")).")
        }
        guard let frame = FrameAttribute(matchedElement) else {
            throw NativeError.commandFailed("Matched element has no frame for right-click.")
        }
        sendRightClick(at: CGPoint(x: frame.midX, y: frame.midY))
    } else {
        let xRaw = parsed.options["-x"]
        let yRaw = parsed.options["-y"]
        guard let xRaw, let yRaw, let x = Double(xRaw), let y = Double(yRaw) else {
            throw NativeError.invalidArguments("right-click requires --id/--label or -x/-y coordinates.")
        }
        let point = try pointInWindow(x: x, y: y, for: target)
        sendRightClick(at: point)
    }
    if postDelay > 0 {
        Thread.sleep(forTimeInterval: postDelay)
    }
    return 0
}

func handleDragDrop(_ parsed: ParsedOptions) throws -> Int32 {
    let target = try resolveTarget(from: parsed)
    try activateTarget(target)
    let startX = try requiredOption("--start-x", from: parsed)
    let startY = try requiredOption("--start-y", from: parsed)
    let endX = try requiredOption("--end-x", from: parsed)
    let endY = try requiredOption("--end-y", from: parsed)
    guard let startXVal = Double(startX),
          let startYVal = Double(startY),
          let endXVal = Double(endX),
          let endYVal = Double(endY) else {
        throw NativeError.invalidArguments("drag-drop requires numeric start/end coordinates.")
    }
    let duration = try optionalDoubleOption("--duration", from: parsed) ?? 0.5
    let preDelay = try optionalDoubleOption("--pre-delay", from: parsed) ?? 0
    let postDelay = try optionalDoubleOption("--post-delay", from: parsed) ?? 0
    if preDelay > 0 {
        Thread.sleep(forTimeInterval: preDelay)
    }
    let start = try pointInWindow(x: startXVal, y: startYVal, for: target)
    let end = try pointInWindow(x: endXVal, y: endYVal, for: target)
    sendSwipe(from: start, to: end, duration: duration)
    if postDelay > 0 {
        Thread.sleep(forTimeInterval: postDelay)
    }
    return 0
}
