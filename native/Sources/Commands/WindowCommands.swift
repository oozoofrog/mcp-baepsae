import AppKit
import CoreGraphics
import Foundation

func handleRightClick(_ parsed: ParsedOptions) throws -> Int32 {
    let target = try resolveTarget(from: parsed)
    try ensureAccessibilityTrusted()
    try activateTarget(target)
    let accessibilityId = parsed.options["--id"]
    let accessibilityLabel = parsed.options["--label"]
    let includeAll = parsed.flags.contains("--all")
    let preDelay = try optionalDoubleOption("--pre-delay", from: parsed) ?? 0
    let postDelay = try optionalDoubleOption("--post-delay", from: parsed) ?? 0
    if preDelay > 0 {
        Thread.sleep(forTimeInterval: preDelay)
    }
    if accessibilityId != nil || accessibilityLabel != nil {
        let root = try accessibilityRootElement(for: target)
        let searchRoot: UIElement
        if case .simulator = target, !includeAll {
            searchRoot = simulatorContentRootElement(from: root, udid: simulatorUdid(from: target)) ?? root
        } else {
            searchRoot = root
        }

        guard let matchedElement = findAccessibilityElement(
            in: searchRoot,
            identifier: accessibilityId,
            label: accessibilityLabel
        ) else {
            var selectors: [String] = []
            if let accessibilityId { selectors.append("id='\(accessibilityId)'") }
            if let accessibilityLabel { selectors.append("label='\(accessibilityLabel)'") }
            let selectorText = selectors.joined(separator: " and ")
            if case .simulator = target, !includeAll {
                throw NativeError.commandFailed("No accessibility element matched \(selectorText) in simulator app content. Try --all to include Simulator chrome UI.")
            }
            throw NativeError.commandFailed("No accessibility element matched \(selectorText).")
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
    try ensureAccessibilityTrusted()
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
    let holdDuration = try optionalDoubleOption("--hold-duration", from: parsed) ?? 0.7
    let preDelay = try optionalDoubleOption("--pre-delay", from: parsed) ?? 0
    let postDelay = try optionalDoubleOption("--post-delay", from: parsed) ?? 0
    if preDelay > 0 {
        Thread.sleep(forTimeInterval: preDelay)
    }
    let backend = resolveInputBackend(for: target)
    switch backend {
    case .indigoHID(let client):
        _ = client.drag(fromX: startXVal, fromY: startYVal, toX: endXVal, toY: endYVal, holdDuration: holdDuration, moveDuration: duration)
    case .cgevent:
        let start = try pointForInput(x: startXVal, y: startYVal, for: target)
        let end = try pointForInput(x: endXVal, y: endYVal, for: target)
        sendDrag(from: start, to: end, holdDuration: holdDuration, moveDuration: duration)
    }
    if postDelay > 0 {
        Thread.sleep(forTimeInterval: postDelay)
    }
    return 0
}
