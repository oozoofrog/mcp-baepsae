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
    case .simulator(let udid):
        // Default behavior: Focus on in-app content group unless --all is specified
        if !parsed.flags.contains("--all") {
            if let contentGroup = simulatorContentRootElement(from: appRoot, udid: udid) {
                targetRoot = contentGroup
                usedSimulatorContentScope = true
            }
        }
    case .macApp:
        // For macOS apps, start from window level, no iOSContentGroup filtering
        if !parsed.flags.contains("--all") {
            let windows = Children(appRoot)
            if let windowSelector = parsed.options["--window"] {
                if let idx = Int(windowSelector), idx < windows.count {
                    targetRoot = windows[idx]
                } else {
                    targetRoot = windows.first(where: {
                        let title = StringAttribute($0, kAXTitleAttribute as CFString) ?? ""
                        return title.localizedCaseInsensitiveContains(windowSelector)
                    }) ?? windows.first ?? appRoot
                }
            } else if let firstWindow = windows.first {
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
        let targetUdid = simulatorUdid(from: target)
        let auxiliaryLabels = simulatorAuxiliaryContainerLabels(from: appRoot, excluding: targetRoot, udid: targetUdid)
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
    if case .simulator(let udid) = target {
        if let contentGroup = simulatorContentRootElement(from: appRoot, udid: udid) {
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
        let targetUdid = simulatorUdid(from: target)
        let auxiliaryCandidates = simulatorAuxiliaryContainerCandidates(from: appRoot, excluding: simulatorContentRoot, udid: targetUdid)
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
        let targetUdid = simulatorUdid(from: target)
        let simulatorContentRoot = simulatorContentRootElement(from: root, udid: targetUdid)
        let searchRoots: [UIElement]
        if case .simulator = target, !includeAll {
            if let contentRoot = simulatorContentRoot {
                let auxiliaryRoots = simulatorAuxiliaryContainerCandidates(from: root, excluding: contentRoot, udid: targetUdid).map(\.element)
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
                    simulatorAuxiliaryContainerLabels(from: root, excluding: $0, udid: targetUdid)
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
            try performPrimaryAction(on: matchedElement)
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
    let targetUdid = simulatorUdid(from: target)
    let searchRoot: UIElement = appRoot

    guard let tabBar = findTabBarElement(in: searchRoot, simulatorUdid: targetUdid) else {
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

    if preDelay > 0 {
        Thread.sleep(forTimeInterval: preDelay)
    }

    let actionableItems = actionableTabBarItems(in: tabBar)
    if actionableItems.count == tabCount {
        try performPrimaryAction(on: actionableItems[index])
        if postDelay > 0 {
            Thread.sleep(forTimeInterval: postDelay)
        }
        return 0
    }

    if case .simulator = target,
       let contentRoot = simulatorContentRootElement(from: appRoot, udid: targetUdid) {
        let proxyItems = semanticProxyTabButtons(in: contentRoot, excluding: tabBar, expectedCount: tabCount)
        if proxyItems.count == tabCount {
            try performPrimaryAction(on: proxyItems[index])
            if postDelay > 0 {
                Thread.sleep(forTimeInterval: postDelay)
            }
            return 0
        }
    }

    let tabWidth = frame.width / CGFloat(tabCount)
    let tapX = frame.origin.x + tabWidth * CGFloat(index) + tabWidth / 2.0
    let tapY = frame.origin.y + frame.height / 2.0

    let backend = resolveInputBackend(for: target)
    switch backend {
    case .indigoHID(let client):
        guard let contentBounds = simulatorContentBounds(udid: targetUdid) else {
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

    if methodStr == "ax" {
        let appRoot = try accessibilityRootElement(for: target)
        var focusedRef: CFTypeRef?
        let status = AXUIElementCopyAttributeValue(
            appRoot,
            "AXFocusedUIElement" as CFString,
            &focusedRef
        )
        if status == .success, let focused = focusedRef {
            let setResult = AXUIElementSetAttributeValue(
                focused as! AXUIElement,
                kAXValueAttribute as CFString,
                text as CFTypeRef
            )
            if setResult == .success {
                print("Set value via AX API.")
                return 0
            }
            fputs("AX setValue failed (status \(setResult.rawValue)), falling back to paste\n", stderr)
        } else {
            fputs("No focused element found, falling back to paste\n", stderr)
        }
        // Fallback to paste
        try pasteText(text, target: target)
        return 0
    }

    let usePaste: Bool
    switch methodStr {
    case "paste":
        usePaste = true
    case "keyboard":
        usePaste = false
    default: // auto
        usePaste = true  // paste is more reliable for all targets including CJK
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
        Thread.sleep(forTimeInterval: 0.3)

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
        let start = try pointForInput(x: startXValue, y: startYValue, for: target)
        let end = try pointForInput(x: endXValue, y: endYValue, for: target)
        sendSwipe(from: start, to: end, duration: duration)
    }
    if postDelay > 0 {
        Thread.sleep(forTimeInterval: postDelay)
    }
    return 0
}

// MARK: - detect-dialog

func handleDetectDialog(_ parsed: ParsedOptions) throws -> Int32 {
    let target = try resolveTarget(from: parsed)
    try ensureAccessibilityTrusted()
    try activateTarget(target)
    let appRoot = try accessibilityRootElement(for: target)
    let windows = Children(appRoot)

    var dialogs: [[String: Any]] = []
    for window in windows {
        let subrole = StringAttribute(window, kAXSubroleAttribute as CFString) ?? ""
        let isDialog = ["AXDialog", "AXSheet", "AXSystemDialog", "AXSystemFloatingWindow"].contains(subrole)

        var modalRef: CFTypeRef?
        let modalStatus = AXUIElementCopyAttributeValue(window, kAXModalAttribute as CFString, &modalRef)
        let isModal = (modalStatus == .success && (modalRef as? Bool) == true)

        if isDialog || isModal {
            let title = StringAttribute(window, kAXTitleAttribute as CFString) ?? ""
            var buttons: [String] = []

            func findButtons(in elements: [UIElement]) {
                for element in elements {
                    let role = StringAttribute(element, kAXRoleAttribute as CFString)
                    if role == "AXButton" {
                        if let btnTitle = StringAttribute(element, kAXTitleAttribute as CFString), !btnTitle.isEmpty {
                            buttons.append(btnTitle)
                        }
                    }
                    findButtons(in: Children(element))
                }
            }
            findButtons(in: Children(window))

            dialogs.append([
                "type": subrole.isEmpty ? "modal" : subrole,
                "title": title,
                "isModal": isModal,
                "buttons": buttons,
            ])
        }
    }

    if dialogs.isEmpty {
        print("{\"hasDialog\":false,\"dialogs\":[]}")
    } else {
        var jsonParts: [String] = []
        for d in dialogs {
            let type = d["type"] as? String ?? ""
            let title = (d["title"] as? String ?? "").replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
            let isModal = d["isModal"] as? Bool ?? false
            let btns = d["buttons"] as? [String] ?? []
            let btnsJson = "[" + btns.map { "\"\($0.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\""))\"" }.joined(separator: ",") + "]"
            jsonParts.append("{\"type\":\"\(type)\",\"title\":\"\(title)\",\"isModal\":\(isModal),\"buttons\":\(btnsJson)}")
        }
        print("{\"hasDialog\":true,\"dialogs\":[\(jsonParts.joined(separator: ","))]}")
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

    let xRaw = parsed.options["-x"]
    let yRaw = parsed.options["-y"]
    let xValue = xRaw.flatMap(Double.init)
    let yValue = yRaw.flatMap(Double.init)

    switch target {
    case .simulator:
        let scrollPoint = try simulatorScrollAnchorPoint(x: xValue, y: yValue)
        let scrollDistance = simulatorScrollDistance(deltaX: deltaX, deltaY: deltaY)
        let start = CGPoint(x: scrollPoint.x - scrollDistance.width / 2, y: scrollPoint.y - scrollDistance.height / 2)
        let end = CGPoint(x: scrollPoint.x + scrollDistance.width / 2, y: scrollPoint.y + scrollDistance.height / 2)

        let backend = resolveInputBackend(for: target)
        switch backend {
        case .indigoHID(let client):
            _ = client.swipe(fromX: Double(start.x), fromY: Double(start.y), toX: Double(end.x), toY: Double(end.y), duration: 0.45, steps: 18)
        case .cgevent:
            let targetUdid = simulatorUdid(from: target)
            let startPoint = try pointInSimulatorContent(x: Double(start.x), y: Double(start.y), udid: targetUdid)
            let endPoint = try pointInSimulatorContent(x: Double(end.x), y: Double(end.y), udid: targetUdid)
            sendSwipe(from: startPoint, to: endPoint, duration: 0.45)
        }
    case .macApp:
        var scrollPoint: CGPoint? = nil
        if let xValue, let yValue {
            scrollPoint = try pointForInput(x: xValue, y: yValue, for: target)
        }
        sendScrollWheel(at: scrollPoint, deltaX: Int32(deltaX), deltaY: Int32(deltaY))
    }
    return 0
}

// MARK: - handleSetUIValue (F010)

func handleSetUIValue(_ parsed: ParsedOptions) throws -> Int32 {
    let target = try resolveTarget(from: parsed)
    try ensureAccessibilityTrusted()
    try activateTarget(target)
    let appRoot = try accessibilityRootElement(for: target)

    let attributeStr = parsed.options["--attribute"] ?? "value"
    let valueStr = try requiredOption("--value", from: parsed)

    // Find element
    let element: AXUIElement
    if let accessibilityId = parsed.options["--id"] {
        guard let found = findAccessibilityElement(in: appRoot, identifier: accessibilityId, label: nil) else {
            throw NativeError.commandFailed("No element with id: \(accessibilityId)")
        }
        element = found
    } else if let label = parsed.options["--label"] {
        guard let found = findAccessibilityElement(in: appRoot, identifier: nil, label: label) else {
            throw NativeError.commandFailed("No element with label: \(label)")
        }
        element = found
    } else {
        var focusedRef: CFTypeRef?
        let status = AXUIElementCopyAttributeValue(appRoot, "AXFocusedUIElement" as CFString, &focusedRef)
        guard status == .success, let ref = focusedRef else {
            throw NativeError.commandFailed("No focused element and no --id or --label provided.")
        }
        element = ref as! AXUIElement
    }

    // 속성 이름 결정 (settable 체크와 set 호출 양쪽에 공통 사용)
    let axAttributeName: String
    switch attributeStr {
    case "value":           axAttributeName = kAXValueAttribute as String
    case "selectedTextRange": axAttributeName = "AXSelectedTextRange"
    case "focused":         axAttributeName = kAXFocusedAttribute as String
    default:
        throw NativeError.invalidArguments("Unsupported attribute: \(attributeStr). Use: value, selectedTextRange, focused.")
    }

    // 쓰기 가능 여부 사전 확인
    var settable: DarwinBoolean = false
    AXUIElementIsAttributeSettable(element, axAttributeName as CFString, &settable)
    if !settable.boolValue {
        throw NativeError.commandFailed(
            "Attribute '\(attributeStr)' is not writable on this element. "
            + "Use enumerate_ui to discover which attributes are settable."
        )
    }

    switch attributeStr {
    case "value":
        let result = AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, valueStr as CFTypeRef)
        guard result == .success else {
            throw NativeError.commandFailed("Failed to set value (AXError \(result.rawValue)). Element may not support writable value.")
        }
        print("Set value: \(valueStr)")

    case "selectedTextRange":
        // Parse "location,length" format
        let parts = valueStr.split(separator: ",").compactMap { Int($0.trimmingCharacters(in: .whitespaces)) }
        guard parts.count == 2 else {
            throw NativeError.invalidArguments("selectedTextRange requires 'location,length' format (e.g. '10,5').")
        }
        var range = CFRange(location: parts[0], length: parts[1])
        guard let axValue = AXValueCreate(.cfRange, &range) else {
            throw NativeError.commandFailed("Failed to create AXValue for range.")
        }
        let result = AXUIElementSetAttributeValue(element, "AXSelectedTextRange" as CFString, axValue)
        guard result == .success else {
            throw NativeError.commandFailed("Failed to set selectedTextRange (AXError \(result.rawValue)).")
        }
        print("Set selectedTextRange: location=\(parts[0]), length=\(parts[1])")

    case "focused":
        let boolValue = (valueStr == "true" || valueStr == "1")
        let result = AXUIElementSetAttributeValue(element, kAXFocusedAttribute as CFString, boolValue as CFTypeRef)
        guard result == .success else {
            throw NativeError.commandFailed("Failed to set focused (AXError \(result.rawValue)).")
        }
        print("Set focused: \(boolValue)")

    default:
        throw NativeError.invalidArguments("Unsupported attribute: \(attributeStr). Use: value, selectedTextRange, focused.")
    }
    return 0
}

// MARK: - handleHitTest (F003)

func handleHitTest(_ parsed: ParsedOptions) throws -> Int32 {
    try ensureAccessibilityTrusted()
    guard let xStr = parsed.options["-x"], let yStr = parsed.options["-y"],
          let x = Float(xStr), let y = Float(yStr) else {
        throw NativeError.invalidArguments("hit-test requires -x and -y coordinates.")
    }

    let systemWide = AXUIElementCreateSystemWide()
    var element: AXUIElement?
    let status = AXUIElementCopyElementAtPosition(systemWide, x, y, &element)
    guard status == .success, let found = element else {
        throw NativeError.commandFailed("No accessibility element found at (\(x), \(y)). AXError: \(status.rawValue)")
    }

    let role = StringAttribute(found, kAXRoleAttribute as CFString) ?? ""
    let subrole = StringAttribute(found, kAXSubroleAttribute as CFString) ?? ""
    let title = StringAttribute(found, kAXTitleAttribute as CFString) ?? ""
    let identifier = StringAttribute(found, "AXIdentifier" as CFString) ?? ""
    let value = StringAttribute(found, kAXValueAttribute as CFString) ?? ""
    let description = StringAttribute(found, kAXDescriptionAttribute as CFString) ?? ""

    var frameStr = ""
    if let frame = FrameAttribute(found) {
        frameStr = "\(formatFloat(frame.origin.x)),\(formatFloat(frame.origin.y)),\(formatFloat(frame.width)),\(formatFloat(frame.height))"
    }

    var pid: pid_t = 0
    AXUIElementGetPid(found, &pid)
    let appName = NSWorkspace.shared.runningApplications.first(where: { $0.processIdentifier == pid })?.localizedName ?? ""

    print("role=\(role) subrole=\(subrole) title=\(title) id=\(identifier) value=\(value) desc=\(description) frame=\(frameStr) pid=\(pid) app=\(appName)")
    return 0
}

// MARK: - handleEnumerateUI (F005)

func handleEnumerateUI(_ parsed: ParsedOptions) throws -> Int32 {
    let target = try resolveTarget(from: parsed)
    try ensureAccessibilityTrusted()
    try activateTarget(target)
    let appRoot = try accessibilityRootElement(for: target)

    let element: AXUIElement
    if let accessibilityId = parsed.options["--id"] {
        guard let found = findAccessibilityElement(in: appRoot, identifier: accessibilityId, label: nil) else {
            throw NativeError.commandFailed("No element with id: \(accessibilityId)")
        }
        element = found
    } else if let label = parsed.options["--label"] {
        guard let found = findAccessibilityElement(in: appRoot, identifier: nil, label: label) else {
            throw NativeError.commandFailed("No element with label: \(label)")
        }
        element = found
    } else {
        var focusedRef: CFTypeRef?
        let status = AXUIElementCopyAttributeValue(appRoot, "AXFocusedUIElement" as CFString, &focusedRef)
        guard status == .success, let ref = focusedRef else {
            throw NativeError.commandFailed("No focused element and no --id or --label provided.")
        }
        element = ref as! AXUIElement
    }

    // 속성 목록
    var attrNames: CFArray?
    AXUIElementCopyAttributeNames(element, &attrNames)
    var attributes: [(name: String, settable: Bool)] = []
    if let names = attrNames as? [String] {
        for name in names {
            var settable: DarwinBoolean = false
            AXUIElementIsAttributeSettable(element, name as CFString, &settable)
            attributes.append((name: name, settable: settable.boolValue))
        }
    }

    // 액션 목록
    var actionNames: CFArray?
    AXUIElementCopyActionNames(element, &actionNames)
    var actions: [(name: String, description: String)] = []
    if let names = actionNames as? [String] {
        for name in names {
            var desc: CFString?
            AXUIElementCopyActionDescription(element, name as CFString, &desc)
            actions.append((name: name, description: (desc as String?) ?? ""))
        }
    }

    // 파라미터화된 속성 목록
    var paramNames: CFArray?
    AXUIElementCopyParameterizedAttributeNames(element, &paramNames)
    let parameterized = (paramNames as? [String]) ?? []

    let attrJson = attributes.map { a in
        let escapedName = a.name.replacingOccurrences(of: "\"", with: "\\\"")
        return "{\"name\":\"\(escapedName)\",\"settable\":\(a.settable)}"
    }.joined(separator: ",")

    let actJson = actions.map { a in
        let escapedName = a.name.replacingOccurrences(of: "\"", with: "\\\"")
        let escapedDesc = a.description.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
        return "{\"name\":\"\(escapedName)\",\"description\":\"\(escapedDesc)\"}"
    }.joined(separator: ",")

    let paramJson = parameterized.map { "\"" + $0.replacingOccurrences(of: "\"", with: "\\\"") + "\"" }.joined(separator: ",")

    print("{\"attributes\":[\(attrJson)],\"actions\":[\(actJson)],\"parameterizedAttributes\":[\(paramJson)]}")
    return 0
}

// MARK: - handleReadUIParam (F012)

func handleReadUIParam(_ parsed: ParsedOptions) throws -> Int32 {
    let target = try resolveTarget(from: parsed)
    try ensureAccessibilityTrusted()
    try activateTarget(target)
    let appRoot = try accessibilityRootElement(for: target)

    let attributeStr = try requiredOption("--attribute", from: parsed)
    let paramStr = try requiredOption("--param", from: parsed)

    // Find element
    let element: AXUIElement
    if let accessibilityId = parsed.options["--id"] {
        guard let found = findAccessibilityElement(in: appRoot, identifier: accessibilityId, label: nil) else {
            throw NativeError.commandFailed("No element with id: \(accessibilityId)")
        }
        element = found
    } else if let label = parsed.options["--label"] {
        guard let found = findAccessibilityElement(in: appRoot, identifier: nil, label: label) else {
            throw NativeError.commandFailed("No element with label: \(label)")
        }
        element = found
    } else {
        var focusedRef: CFTypeRef?
        let status = AXUIElementCopyAttributeValue(appRoot, "AXFocusedUIElement" as CFString, &focusedRef)
        guard status == .success, let ref = focusedRef else {
            throw NativeError.commandFailed("No focused element and no --id or --label provided.")
        }
        element = ref as! AXUIElement
    }

    let axAttribute: String
    let parameter: CFTypeRef

    switch attributeStr {
    case "stringForRange", "boundsForRange":
        let parts = paramStr.split(separator: ",").compactMap { Int($0.trimmingCharacters(in: .whitespaces)) }
        guard parts.count == 2 else {
            throw NativeError.invalidArguments("\(attributeStr) requires 'location,length' format.")
        }
        var range = CFRange(location: parts[0], length: parts[1])
        guard let axValue = AXValueCreate(.cfRange, &range) else {
            throw NativeError.commandFailed("Failed to create AXValue for range.")
        }
        parameter = axValue
        axAttribute = attributeStr == "stringForRange"
            ? "AXStringForRange"
            : "AXBoundsForRange"

    case "lineForIndex":
        guard let index = Int(paramStr) else {
            throw NativeError.invalidArguments("lineForIndex requires a numeric index.")
        }
        parameter = index as CFTypeRef
        axAttribute = "AXLineForIndex"

    case "rangeForLine":
        guard let line = Int(paramStr) else {
            throw NativeError.invalidArguments("rangeForLine requires a numeric line number.")
        }
        parameter = line as CFTypeRef
        axAttribute = "AXRangeForLine"

    default:
        throw NativeError.invalidArguments("Unsupported parameterized attribute: \(attributeStr). Use: stringForRange, boundsForRange, lineForIndex, rangeForLine.")
    }

    var resultRef: CFTypeRef?
    let status = AXUIElementCopyParameterizedAttributeValue(element, axAttribute as CFString, parameter, &resultRef)
    guard status == .success, let result = resultRef else {
        throw NativeError.commandFailed("Failed to read \(attributeStr) (AXError \(status.rawValue)).")
    }

    if let str = result as? String {
        print(str)
    } else if let num = result as? NSNumber {
        print(num.stringValue)
    } else if CFGetTypeID(result) == AXValueGetTypeID() {
        let axVal = result as! AXValue
        let valType = AXValueGetType(axVal)
        if valType == .cfRange {
            var range = CFRange(location: 0, length: 0)
            AXValueGetValue(axVal, .cfRange, &range)
            print("\(range.location),\(range.length)")
        } else if valType == .cgRect {
            var rect = CGRect.zero
            AXValueGetValue(axVal, .cgRect, &rect)
            print("\(rect.origin.x),\(rect.origin.y),\(rect.width),\(rect.height)")
        } else if valType == .cgPoint {
            var point = CGPoint.zero
            AXValueGetValue(axVal, .cgPoint, &point)
            print("\(point.x),\(point.y)")
        } else {
            print(String(describing: result))
        }
    } else {
        print(String(describing: result))
    }
    return 0
}
