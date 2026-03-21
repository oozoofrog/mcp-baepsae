import AppKit
import CoreGraphics
import Foundation

func handleDescribeUI(_ parsed: ParsedOptions) throws -> Int32 {
    let target = try resolveTarget(from: parsed)
    try ensureAccessibilityTrusted()
    try activateTarget(target)

    let appRoot = try accessibilityRootElement(for: target)
    var targetRoot = appRoot
    var usedSimulatorContentScope = false

    switch target {
    case .simulator:
        // Default behavior: Focus on in-app content group unless --all is specified
        if !parsed.flags.contains("--all") {
            if let contentGroup = simulatorContentRootElement(from: appRoot) {
                targetRoot = contentGroup
                usedSimulatorContentScope = true
            }
        }
    case .macApp:
        // For macOS apps, start from window level, no iOSContentGroup filtering
        if !parsed.flags.contains("--all") {
            let windows = Children(appRoot)
            if let firstWindow = windows.first {
                targetRoot = firstWindow
            }
        }
    }

    // Override focus if --focus-id is provided
    if let focusId = parsed.options["--focus-id"] {
        if let found = findAccessibilityElement(in: appRoot, identifier: focusId, label: nil) {
            targetRoot = found
            usedSimulatorContentScope = false
        } else {
            throw NativeError.commandFailed("Could not find element with id: \(focusId)")
        }
    }

    // Override root if --root-element-id is provided (subtree exploration)
    if let rootElementId = parsed.options["--root-element-id"] {
        if let found = findAccessibilityElement(in: appRoot, identifier: rootElementId, label: nil) {
            targetRoot = found
            usedSimulatorContentScope = false
        } else {
            throw NativeError.commandFailed("Could not find element with id: \(rootElementId)")
        }
    }

    // Build describe options
    var descOpts = DescribeOptions()
    if let maxDepthStr = parsed.options["--max-depth"], let maxDepthVal = Int(maxDepthStr) {
        descOpts.maxDepth = maxDepthVal
    }
    if let offsetStr = parsed.options["--offset"], let offsetVal = Int(offsetStr) {
        descOpts.offset = offsetVal
    }
    if let limitStr = parsed.options["--limit"], let limitVal = Int(limitStr) {
        descOpts.limit = limitVal
    }
    descOpts.roleFilter = parsed.options["--role"]
    descOpts.summary = parsed.flags.contains("--summary")
    if parsed.flags.contains("--visible-only") {
        descOpts.visibleOnly = true
        if let bounds = windowBounds(for: target) {
            descOpts.screenBounds = bounds
        } else if let mainScreen = NSScreen.main {
            descOpts.screenBounds = mainScreen.frame
        }
    }

    var lines = describeAccessibilityTree(from: targetRoot, options: descOpts)
    if lines.isEmpty {
        throw NativeError.commandFailed("No accessibility elements found.")
    }
    if usedSimulatorContentScope {
        let auxiliaryLabels = simulatorAuxiliaryContainerLabels(from: appRoot, excluding: targetRoot)
        if let hint = formatSimulatorAuxiliaryContainerHint(auxiliaryLabels) {
            lines.append(hint)
        }
    }
    let report = lines.joined(separator: "\n")

    if let output = parsed.options["--output"] {
        do {
            try report.write(toFile: output, atomically: true, encoding: .utf8)
            print("UI hierarchy saved to: \(output)")
        } catch {
            throw NativeError.commandFailed("Failed to write hierarchy output: \(error.localizedDescription)")
        }
    }

    print(report)
    return 0
}

func handleSearchUI(_ parsed: ParsedOptions) throws -> Int32 {
    let target = try resolveTarget(from: parsed)
    let query = try requiredOption("--query", from: parsed)
    try ensureAccessibilityTrusted()
    try activateTarget(target)

    let appRoot = try accessibilityRootElement(for: target)
    var searchRoot = appRoot
    var simulatorContentRoot: UIElement? = nil
    if case .simulator = target {
        if let contentGroup = simulatorContentRootElement(from: appRoot) {
            simulatorContentRoot = contentGroup
            searchRoot = contentGroup
        }
    }

    // Build search options
    var searchOpts = SearchOptions()
    if let maxDepthStr = parsed.options["--max-depth"], let maxDepthVal = Int(maxDepthStr) {
        searchOpts.maxDepth = maxDepthVal
    }
    searchOpts.roleFilter = parsed.options["--role"]
    if parsed.flags.contains("--visible-only") {
        searchOpts.visibleOnly = true
        if let bounds = windowBounds(for: target) {
            searchOpts.screenBounds = bounds
        } else if let mainScreen = NSScreen.main {
            searchOpts.screenBounds = mainScreen.frame
        }
    }

    let results = searchAccessibilityElements(in: searchRoot, query: query, options: searchOpts)
    if results.isEmpty, case .simulator = target, let simulatorContentRoot {
        let auxiliaryCandidates = simulatorAuxiliaryContainerCandidates(from: appRoot, excluding: simulatorContentRoot)
        let auxiliaryResults = searchAccessibilityElements(
            in: auxiliaryCandidates.map(\.element),
            query: query,
            options: searchOpts
        )
        if auxiliaryResults.isEmpty {
            print("No elements found matching query: \(query) in simulator app content or auxiliary containers.")
            if let hint = formatSimulatorAuxiliaryContainerHint(auxiliaryCandidates.map(\.label)) {
                print(hint)
            }
        } else {
            print("[Fallback] No matches in simulator content scope; searched auxiliary containers outside iOSContentGroup.")
            print(auxiliaryResults.joined(separator: "\n"))
        }
    } else if results.isEmpty {
        print("No elements found matching query: \(query)")
    } else {
        print(results.joined(separator: "\n"))
    }
    return 0
}

func handleTap(_ parsed: ParsedOptions) throws -> Int32 {
    let target = try resolveTarget(from: parsed)
    let accessibilityId = parsed.options["--id"]
    let accessibilityLabel = parsed.options["--label"]
    let isDouble = parsed.flags.contains("--double")
    let includeAll = parsed.flags.contains("--all")
    if accessibilityId != nil || accessibilityLabel != nil {
        let preDelay = try optionalDoubleOption("--pre-delay", from: parsed) ?? 0
        let postDelay = try optionalDoubleOption("--post-delay", from: parsed) ?? 0

        try ensureAccessibilityTrusted()
        try activateTarget(target)
        if preDelay > 0 {
            Thread.sleep(forTimeInterval: preDelay)
        }

        let root = try accessibilityRootElement(for: target)
        let simulatorContentRoot = simulatorContentRootElement(from: root)
        let searchRoots: [UIElement]
        if case .simulator = target, !includeAll {
            if let contentRoot = simulatorContentRoot {
                let auxiliaryRoots = simulatorAuxiliaryContainerCandidates(from: root, excluding: contentRoot).map(\.element)
                searchRoots = [contentRoot] + auxiliaryRoots
            } else {
                searchRoots = [root]
            }
        } else {
            searchRoots = [root]
        }

        guard let matchedElement = findAccessibilityElement(
            in: searchRoots,
            identifier: accessibilityId,
            label: accessibilityLabel
        ) else {
            var selectors: [String] = []
            if let accessibilityId {
                selectors.append("id='\(accessibilityId)'")
            }
            if let accessibilityLabel {
                selectors.append("label='\(accessibilityLabel)'")
            }
            let selectorText = selectors.joined(separator: " and ")
            if case .simulator = target, !includeAll {
                let auxiliaryLabels = simulatorContentRoot.map {
                    simulatorAuxiliaryContainerLabels(from: root, excluding: $0)
                } ?? []
                throw NativeError.commandFailed(simulatorSelectorNotFoundMessage(selectorText: selectorText, auxiliaryLabels: auxiliaryLabels))
            }
            throw NativeError.commandFailed("No accessibility element matched \(selectorText).")
        }

        if isDouble {
            guard let frame = FrameAttribute(matchedElement) else {
                throw NativeError.commandFailed("Matched accessibility element has no frame for double-click.")
            }
            sendDoubleClick(at: CGPoint(x: frame.midX, y: frame.midY))
        } else {
            let actions = ActionNames(matchedElement)
            if actions.contains(kAXPressAction as String) {
                let status = AXUIElementPerformAction(matchedElement, kAXPressAction as CFString)
                if status != .success {
                    throw NativeError.commandFailed("Matched accessibility element but AXPress failed with status \(status.rawValue).")
                }
            } else if let frame = FrameAttribute(matchedElement) {
                let point = CGPoint(x: frame.midX, y: frame.midY)
                sendClick(at: point)
            } else {
                throw NativeError.commandFailed("Matched accessibility element has no AXPress action or frame for fallback click.")
            }
        }

        if postDelay > 0 {
            Thread.sleep(forTimeInterval: postDelay)
        }
        return 0
    }

    let xRaw = parsed.options["-x"]
    let yRaw = parsed.options["-y"]
    guard let xRaw, let yRaw, let x = Double(xRaw), let y = Double(yRaw) else {
        throw NativeError.invalidArguments("tap requires -x and -y coordinates.")
    }
    let preDelay = try optionalDoubleOption("--pre-delay", from: parsed) ?? 0
    let postDelay = try optionalDoubleOption("--post-delay", from: parsed) ?? 0
    try ensureAccessibilityTrusted()
    try activateTarget(target)
    if preDelay > 0 {
        Thread.sleep(forTimeInterval: preDelay)
    }
    let backend = resolveInputBackend(for: target)
    switch backend {
    case .indigoHID(let client):
        if isDouble {
            _ = client.tap(x: x, y: y)
            Thread.sleep(forTimeInterval: 0.1)
            _ = client.tap(x: x, y: y)
        } else {
            _ = client.tap(x: x, y: y)
        }
    case .cgevent:
        let point = try pointInWindow(x: x, y: y, for: target)
        if isDouble {
            sendDoubleClick(at: point)
        } else {
            sendClick(at: point)
        }
    }
    if postDelay > 0 {
        Thread.sleep(forTimeInterval: postDelay)
    }
    return 0
}

func handleTapTab(_ parsed: ParsedOptions) throws -> Int32 {
    let target = try resolveTarget(from: parsed)
    guard let indexStr = parsed.options["--index"], let index = Int(indexStr) else {
        throw NativeError.invalidArguments("tap-tab requires --index <N>.")
    }

    let preDelay = try optionalDoubleOption("--pre-delay", from: parsed) ?? 0
    let postDelay = try optionalDoubleOption("--post-delay", from: parsed) ?? 0

    try ensureAccessibilityTrusted()
    try activateTarget(target)

    let appRoot = try accessibilityRootElement(for: target)
    let searchRoot: UIElement = appRoot

    guard let tabBar = findTabBarElement(in: searchRoot) else {
        throw NativeError.commandFailed("No tab bar found in the application UI. Ensure the app has a visible tab bar.")
    }

    guard let frame = FrameAttribute(tabBar) else {
        throw NativeError.commandFailed("Tab bar element has no frame attribute.")
    }

    let tabCount: Int
    if let tabCountStr = parsed.options["--tab-count"], let tc = Int(tabCountStr) {
        tabCount = tc
    } else {
        let children = Children(tabBar)
        tabCount = children.count
    }

    guard tabCount > 0 else {
        throw NativeError.commandFailed("Tab bar has no children and --tab-count was not specified.")
    }

    guard index >= 0 && index < tabCount else {
        throw NativeError.invalidArguments("Tab index \(index) is out of range. Valid range: 0..\(tabCount - 1)")
    }

    let tabWidth = frame.width / CGFloat(tabCount)
    let tapX = frame.origin.x + tabWidth * CGFloat(index) + tabWidth / 2.0
    let tapY = frame.origin.y + frame.height / 2.0

    if preDelay > 0 {
        Thread.sleep(forTimeInterval: preDelay)
    }

    let backend = resolveInputBackend(for: target)
    switch backend {
    case .indigoHID(let client):
        // IndigoHID normalizes coordinates against simulator screen dimensions.
        // Since tapX/tapY are screen-absolute (from AXFrame), subtract the content
        // area origin to make them content-relative before normalization.
        guard let contentBounds = simulatorContentBounds() else {
            throw NativeError.commandFailed("Cannot determine simulator content bounds for IndigoHID coordinate conversion. Ensure Simulator is running.")
        }
        let relX = Double(tapX) - Double(contentBounds.origin.x)
        let relY = Double(tapY) - Double(contentBounds.origin.y)
        if !client.tap(x: relX, y: relY) {
            throw NativeError.commandFailed("IndigoHID tap failed. The simulator may not be responding.")
        }
    case .cgevent:
        sendClick(at: CGPoint(x: tapX, y: tapY))
    }

    if postDelay > 0 {
        Thread.sleep(forTimeInterval: postDelay)
    }
    return 0
}

func handleType(_ parsed: ParsedOptions) throws -> Int32 {
    let target = try resolveTarget(from: parsed)
    try ensureAccessibilityTrusted()
    try activateTarget(target)
    let text: String
    if parsed.flags.contains("--stdin") {
        text = readStdinText()
    } else if let filePath = parsed.options["--file"] {
        text = try readFileText(filePath)
    } else {
        text = parsed.positionals.joined(separator: " ")
    }
    if text.isEmpty {
        throw NativeError.invalidArguments("type requires text input.")
    }

    let methodStr = parsed.options["--method"] ?? "auto"
    let usePaste: Bool
    switch methodStr {
    case "paste":
        usePaste = true
    case "keyboard":
        usePaste = false
    default: // auto
        if case .simulator = target {
            usePaste = true
        } else {
            usePaste = false
        }
    }

    if usePaste {
        try pasteText(text, target: target)
    } else {
        let backend = resolveInputBackend(for: target)
        switch backend {
        case .indigoHID(let client):
            _ = client.typeText(text)
        case .cgevent:
            sendText(text)
        }
    }
    return 0
}

func pasteText(_ text: String, target: TargetApp) throws {
    switch target {
    case .simulator(let udid):
        try setSimulatorPasteboard(text, udid: udid)
        // Cmd+V: Command keycode=55, V keycode=9
        sendKeyCombo(modifiers: [55], key: 9)
        Thread.sleep(forTimeInterval: 0.2)
    case .macApp:
        let pasteboard = NSPasteboard.general
        let original = pasteboard.string(forType: .string)

        pasteboard.clearContents()
        pasteboard.setString(text, forType: .string)

        // Cmd+V: Command keycode=55, V keycode=9
        sendKeyCombo(modifiers: [55], key: 9)
        Thread.sleep(forTimeInterval: 0.15)

        // Restore original clipboard content
        pasteboard.clearContents()
        if let original = original {
            pasteboard.setString(original, forType: .string)
        }
    }
}

func setSimulatorPasteboard(_ text: String, udid: String) throws {
    let status = try runProcess("/usr/bin/xcrun", ["simctl", "pbcopy", udid], stdinText: text)
    if status != 0 {
        throw NativeError.commandFailed("Failed to set simulator pasteboard (exit code \(status)).")
    }
}

func handleSwipe(_ parsed: ParsedOptions) throws -> Int32 {
    let target = try resolveTarget(from: parsed)
    let startX = try requiredOption("--start-x", from: parsed)
    let startY = try requiredOption("--start-y", from: parsed)
    let endX = try requiredOption("--end-x", from: parsed)
    let endY = try requiredOption("--end-y", from: parsed)
    guard let startXValue = Double(startX),
          let startYValue = Double(startY),
          let endXValue = Double(endX),
          let endYValue = Double(endY) else {
        throw NativeError.invalidArguments("swipe requires numeric start/end coordinates.")
    }
    let duration = try optionalDoubleOption("--duration", from: parsed)
    let preDelay = try optionalDoubleOption("--pre-delay", from: parsed) ?? 0
    let postDelay = try optionalDoubleOption("--post-delay", from: parsed) ?? 0
    try ensureAccessibilityTrusted()
    try activateTarget(target)
    if preDelay > 0 {
        Thread.sleep(forTimeInterval: preDelay)
    }
    let backend = resolveInputBackend(for: target)
    switch backend {
    case .indigoHID(let client):
        _ = client.swipe(fromX: startXValue, fromY: startYValue, toX: endXValue, toY: endYValue, duration: duration)
    case .cgevent:
        let start = try pointInWindow(x: startXValue, y: startYValue, for: target)
        let end = try pointInWindow(x: endXValue, y: endYValue, for: target)
        sendSwipe(from: start, to: end, duration: duration)
    }
    if postDelay > 0 {
        Thread.sleep(forTimeInterval: postDelay)
    }
    return 0
}

func handleScroll(_ parsed: ParsedOptions) throws -> Int32 {
    let target = try resolveTarget(from: parsed)
    try ensureAccessibilityTrusted()
    try activateTarget(target)
    let deltaX = try optionalDoubleOption("--delta-x", from: parsed) ?? 0
    let deltaY = try optionalDoubleOption("--delta-y", from: parsed) ?? 0
    if deltaX == 0 && deltaY == 0 {
        throw NativeError.invalidArguments("scroll requires --delta-x and/or --delta-y.")
    }
    var scrollPoint: CGPoint? = nil
    let xRaw = parsed.options["-x"]
    let yRaw = parsed.options["-y"]
    if let xRaw, let yRaw, let x = Double(xRaw), let y = Double(yRaw) {
        scrollPoint = try pointInWindow(x: x, y: y, for: target)
    }
    sendScrollWheel(at: scrollPoint, deltaX: Int32(deltaX), deltaY: Int32(deltaY))
    return 0
}
