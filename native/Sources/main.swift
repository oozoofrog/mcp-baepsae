import AppKit
import CoreGraphics
import Foundation

typealias UIElement = AXUIElement

enum TargetApp {
    case simulator(udid: String)
    case macApp(pid: pid_t, bundleId: String?, name: String?)
}

enum NativeError: Error, CustomStringConvertible {
    case invalidArguments(String)
    case unsupported(String)
    case commandFailed(String)

    var description: String {
        switch self {
        case .invalidArguments(let message):
            return message
        case .unsupported(let message):
            return message
        case .commandFailed(let message):
            return message
        }
    }
}

struct ParsedOptions {
    let command: String
    let options: [String: String]
    let flags: Set<String>
    let positionals: [String]
}

let supportedCommands: Set<String> = [
    "help",
    "--help",
    "-h",
    "--version",
    "list-simulators",
    "screenshot",
    "record-video",
    "describe-ui",
    "search-ui",
    "tap",
    "type",
    "swipe",
    "button",
    "key",
    "key-sequence",
    "key-combo",
    "touch",
    "gesture",
    "stream-video",
    "list-apps",
    "list-windows",
    "activate-app",
    "screenshot-app",
    "right-click",
    "scroll",
    "drag-drop",
    "menu-action",
    "get-focused-app",
    "clipboard",
]

func parse(arguments: [String]) throws -> ParsedOptions {
    if arguments.isEmpty {
        return ParsedOptions(command: "help", options: [:], flags: [], positionals: [])
    }

    let command = arguments[0]
    guard supportedCommands.contains(command) else {
        throw NativeError.invalidArguments("Unknown command: \(command)")
    }

    var options: [String: String] = [:]
    var flags: Set<String> = []
    var positionals: [String] = []

    var index = 1
    while index < arguments.count {
        let item = arguments[index]
        if item.hasPrefix("--") {
            if let separator = item.firstIndex(of: "=") {
                let key = String(item[..<separator])
                let value = String(item[item.index(after: separator)...])
                options[key] = value
            } else if index + 1 < arguments.count, !arguments[index + 1].hasPrefix("-") {
                options[item] = arguments[index + 1]
                index += 1
            } else {
                flags.insert(item)
            }
        } else if item.hasPrefix("-") {
            if index + 1 < arguments.count, !arguments[index + 1].hasPrefix("-") {
                options[item] = arguments[index + 1]
                index += 1
            } else {
                flags.insert(item)
            }
        } else {
            positionals.append(item)
        }
        index += 1
    }

    return ParsedOptions(command: command, options: options, flags: flags, positionals: positionals)
}

@discardableResult
func runProcess(_ command: String, _ arguments: [String]) throws -> Int32 {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: command)
    process.arguments = arguments
    process.standardInput = FileHandle.standardInput
    process.standardOutput = FileHandle.standardOutput
    process.standardError = FileHandle.standardError

    do {
        try process.run()
    } catch {
        throw NativeError.commandFailed("Failed to launch process: \(command) \(arguments.joined(separator: " "))")
    }

    process.waitUntilExit()
    return process.terminationStatus
}

func requiredOption(_ key: String, from parsed: ParsedOptions) throws -> String {
    if let value = parsed.options[key], !value.isEmpty {
        return value
    }
    throw NativeError.invalidArguments("Missing required option: \(key)")
}

func optionalDoubleOption(_ key: String, from parsed: ParsedOptions) throws -> Double? {
    guard let raw = parsed.options[key] else {
        return nil
    }
    if let value = Double(raw) {
        return value
    }
    throw NativeError.invalidArguments("Invalid numeric value for \(key): \(raw)")
}

func parseCommaSeparatedInts(_ raw: String, label: String) throws -> [Int] {
    let parts = raw.split(separator: ",")
    if parts.isEmpty {
        throw NativeError.invalidArguments("Missing \(label) values")
    }
    var result: [Int] = []
    for part in parts {
        if let value = Int(part.trimmingCharacters(in: .whitespacesAndNewlines)) {
            result.append(value)
        } else {
            throw NativeError.invalidArguments("Invalid \(label) value: \(part)")
        }
    }
    return result
}

func readStdinText() -> String {
    let data = FileHandle.standardInput.readDataToEndOfFile()
    return String(data: data, encoding: .utf8) ?? ""
}

func readFileText(_ path: String) throws -> String {
    let url = URL(fileURLWithPath: path)
    return try String(contentsOf: url, encoding: .utf8)
}

func resolveTarget(from parsed: ParsedOptions) throws -> TargetApp {
    let hasUdid = parsed.options["--udid"] != nil
    let hasBundleId = parsed.options["--bundle-id"] != nil
    let hasAppName = parsed.options["--app-name"] != nil

    let macTargetCount = (hasBundleId ? 1 : 0) + (hasAppName ? 1 : 0)
    if hasUdid && macTargetCount > 0 {
        throw NativeError.invalidArguments("Cannot use --udid with --bundle-id or --app-name. Choose simulator or macOS app target.")
    }
    if macTargetCount > 1 {
        throw NativeError.invalidArguments("Cannot use both --bundle-id and --app-name. Choose one.")
    }

    if hasUdid {
        return .simulator(udid: parsed.options["--udid"]!)
    }

    if let bundleId = parsed.options["--bundle-id"] {
        let apps = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId)
        guard let app = apps.first else {
            throw NativeError.commandFailed("No running application found with bundle ID: \(bundleId)")
        }
        return .macApp(pid: app.processIdentifier, bundleId: bundleId, name: app.localizedName)
    }

    if let appName = parsed.options["--app-name"] {
        let apps = NSWorkspace.shared.runningApplications.filter {
            $0.activationPolicy == .regular && $0.localizedName == appName
        }
        guard let app = apps.first else {
            throw NativeError.commandFailed("No running application found with name: \(appName)")
        }
        return .macApp(pid: app.processIdentifier, bundleId: app.bundleIdentifier, name: appName)
    }

    throw NativeError.invalidArguments("Target required: use --udid for simulator, or --bundle-id / --app-name for macOS app.")
}

func accessibilityRootElement(for target: TargetApp) throws -> UIElement {
    switch target {
    case .simulator:
        return try simulatorAccessibilityRootElement()
    case .macApp(let pid, _, _):
        return AXUIElementCreateApplication(pid)
    }
}

func windowBounds(for target: TargetApp) -> CGRect? {
    switch target {
    case .simulator:
        return simulatorWindowBounds()
    case .macApp(let pid, _, _):
        guard let windowInfo = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
            as? [[String: Any]] else {
            return nil
        }
        let windows = windowInfo.filter { info in
            let ownerPid = info[kCGWindowOwnerPID as String] as? pid_t
            let layer = info[kCGWindowLayer as String] as? Int
            return ownerPid == pid && (layer ?? 0) == 0
        }
        var best: CGRect?
        var bestArea: CGFloat = 0
        for info in windows {
            guard let boundsDict = info[kCGWindowBounds as String] as? [String: Any],
                  let x = boundsDict["X"] as? CGFloat,
                  let y = boundsDict["Y"] as? CGFloat,
                  let width = boundsDict["Width"] as? CGFloat,
                  let height = boundsDict["Height"] as? CGFloat else {
                continue
            }
            let rect = CGRect(x: x, y: y, width: width, height: height)
            let area = width * height
            if area > bestArea {
                bestArea = area
                best = rect
            }
        }
        return best
    }
}

func pointInWindow(x: Double, y: Double, for target: TargetApp) throws -> CGPoint {
    switch target {
    case .simulator:
        return try pointInSimulatorWindow(x: x, y: y)
    case .macApp:
        guard let bounds = windowBounds(for: target) else {
            throw NativeError.commandFailed("Application window not found. Ensure the app is running and visible.")
        }
        let targetX = bounds.origin.x + CGFloat(x)
        let targetY = bounds.origin.y + CGFloat(y)
        return CGPoint(x: targetX, y: targetY)
    }
}

func activateTarget(_ target: TargetApp) throws {
    switch target {
    case .simulator(let udid):
        try activateSimulator(udid: udid)
    case .macApp(let pid, _, _):
        let apps = NSWorkspace.shared.runningApplications.filter { $0.processIdentifier == pid }
        if let app = apps.first {
            app.activate(options: [.activateAllWindows])
        }
    }
}

func activateSimulator(udid: String?) throws {
    let bundleIdentifier = "com.apple.iphonesimulator"
    let running = NSRunningApplication.runningApplications(withBundleIdentifier: bundleIdentifier)
    if running.isEmpty {
        var args = ["-a", "Simulator"]
        if let udid, !udid.isEmpty {
            args += ["--args", "-CurrentDeviceUDID", udid]
        }
        _ = try runProcess("/usr/bin/open", args)
        Thread.sleep(forTimeInterval: 0.4)
    } else {
        for app in running {
            app.activate(options: [.activateAllWindows])
        }
    }
}

func simulatorWindowBounds() -> CGRect? {
    guard let windowInfo = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
        as? [[String: Any]] else {
        return nil
    }

    let windows = windowInfo.filter { info in
        let owner = info[kCGWindowOwnerName as String] as? String
        let layer = info[kCGWindowLayer as String] as? Int
        return owner == "Simulator" && (layer ?? 0) == 0
    }

    var best: CGRect?
    var bestArea: CGFloat = 0
    for info in windows {
        guard let boundsDict = info[kCGWindowBounds as String] as? [String: Any],
              let x = boundsDict["X"] as? CGFloat,
              let y = boundsDict["Y"] as? CGFloat,
              let width = boundsDict["Width"] as? CGFloat,
              let height = boundsDict["Height"] as? CGFloat else {
            continue
        }
        let rect = CGRect(x: x, y: y, width: width, height: height)
        let area = width * height
        if area > bestArea {
            bestArea = area
            best = rect
        }
    }
    return best
}

func pointInSimulatorWindow(x: Double, y: Double) throws -> CGPoint {
    guard let bounds = simulatorWindowBounds() else {
        throw NativeError.commandFailed("Simulator window not found. Ensure Simulator is running and visible.")
    }
    let targetX = bounds.origin.x + CGFloat(x)
    let targetY = bounds.origin.y + bounds.size.height - CGFloat(y)
    return CGPoint(x: targetX, y: targetY)
}

func postMouseEvent(type: CGEventType, point: CGPoint, button: CGMouseButton = .left) {
    let source = CGEventSource(stateID: .hidSystemState)
    let event = CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: point, mouseButton: button)
    event?.post(tap: .cghidEventTap)
}

func sendClick(at point: CGPoint) {
    postMouseEvent(type: .leftMouseDown, point: point)
    postMouseEvent(type: .leftMouseUp, point: point)
}

func sendRightClick(at point: CGPoint) {
    postMouseEvent(type: .rightMouseDown, point: point, button: .right)
    postMouseEvent(type: .rightMouseUp, point: point, button: .right)
}

func sendScrollWheel(at point: CGPoint?, deltaX: Int32, deltaY: Int32) {
    let source = CGEventSource(stateID: .hidSystemState)
    let event = CGEvent(scrollWheelEvent2Source: source, units: .line, wheelCount: 2, wheel1: deltaY, wheel2: deltaX, wheel3: 0)
    if let point = point {
        event?.location = point
    }
    event?.post(tap: CGEventTapLocation.cghidEventTap)
}

func sendDoubleClick(at point: CGPoint) {
    let source = CGEventSource(stateID: .hidSystemState)
    // First click
    let down1 = CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)
    down1?.setIntegerValueField(.mouseEventClickState, value: 1)
    down1?.post(tap: .cghidEventTap)
    let up1 = CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)
    up1?.setIntegerValueField(.mouseEventClickState, value: 1)
    up1?.post(tap: .cghidEventTap)
    // Second click
    let down2 = CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)
    down2?.setIntegerValueField(.mouseEventClickState, value: 2)
    down2?.post(tap: .cghidEventTap)
    let up2 = CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)
    up2?.setIntegerValueField(.mouseEventClickState, value: 2)
    up2?.post(tap: .cghidEventTap)
}

func sendSwipe(from start: CGPoint, to end: CGPoint, duration: Double?) {
    postMouseEvent(type: .leftMouseDown, point: start)
    let steps = 10
    for step in 1...steps {
        let progress = CGFloat(step) / CGFloat(steps)
        let x = start.x + (end.x - start.x) * progress
        let y = start.y + (end.y - start.y) * progress
        postMouseEvent(type: .leftMouseDragged, point: CGPoint(x: x, y: y))
        if let duration {
            Thread.sleep(forTimeInterval: duration / Double(steps))
        }
    }
    postMouseEvent(type: .leftMouseUp, point: end)
}

func sendKeyPress(keyCode: Int, duration: Double?) {
    let source = CGEventSource(stateID: .hidSystemState)
    let keyDown = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(keyCode), keyDown: true)
    let keyUp = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(keyCode), keyDown: false)
    keyDown?.post(tap: .cghidEventTap)
    if let duration {
        Thread.sleep(forTimeInterval: duration)
    }
    keyUp?.post(tap: .cghidEventTap)
}

func sendKeyCombo(modifiers: [Int], key: Int) {
    let source = CGEventSource(stateID: .hidSystemState)
    for modifier in modifiers {
        let event = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(modifier), keyDown: true)
        event?.post(tap: .cghidEventTap)
    }
    let keyDown = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(key), keyDown: true)
    let keyUp = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(key), keyDown: false)
    keyDown?.post(tap: .cghidEventTap)
    keyUp?.post(tap: .cghidEventTap)
    for modifier in modifiers.reversed() {
        let event = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(modifier), keyDown: false)
        event?.post(tap: .cghidEventTap)
    }
}

func sendText(_ text: String) {
    let source = CGEventSource(stateID: .hidSystemState)
    for scalar in text.unicodeScalars {
        let value = scalar.value
        guard value <= UInt16.max else {
            continue
        }
        var char = UniChar(value)
        let keyDown = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true)
        keyDown?.keyboardSetUnicodeString(stringLength: 1, unicodeString: &char)
        keyDown?.post(tap: .cghidEventTap)
        let keyUp = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false)
        keyUp?.keyboardSetUnicodeString(stringLength: 1, unicodeString: &char)
        keyUp?.post(tap: .cghidEventTap)
    }
}

func ensureAccessibilityTrusted() throws {
    if AXIsProcessTrusted() {
        return
    }
    throw NativeError.commandFailed(
        """
        [Permission Denied] Accessibility access is required to read/control the Simulator UI.
        
        Please enable it in macOS System Settings:
        1. Open 'System Settings' -> 'Privacy & Security' -> 'Accessibility'.
        2. Find your terminal app (e.g. iTerm, Terminal, VSCode) or 'node'/'openclaw' in the list.
        3. Turn the switch ON.
        4. If it's already ON, try turning it OFF and ON again, or restart your terminal.
        """
    )
}

func CopyAttributeValue(_ element: UIElement, _ attribute: CFString) -> CFTypeRef? {
    var value: CFTypeRef?
    let status = AXUIElementCopyAttributeValue(element, attribute, &value)
    guard status == .success else {
        return nil
    }
    return value
}

func copyMultipleAttributes(_ element: UIElement, _ attributes: [String]) -> [String: CFTypeRef] {
    var result = [String: CFTypeRef]()
    var values: CFArray?
    let cfAttributes = attributes as CFArray
    let status = AXUIElementCopyMultipleAttributeValues(element, cfAttributes, AXCopyMultipleAttributeOptions(rawValue: 0), &values)
    guard status == .success, let array = values as? [Any?] else {
        return result
    }
    for (index, attribute) in attributes.enumerated() {
        guard index < array.count, let value = array[index] else { continue }
        let typeRef = value as CFTypeRef
        if CFGetTypeID(typeRef) != 0 {
            result[attribute] = typeRef
        }
    }
    return result
}

func stringFromCFTypeRef(_ value: CFTypeRef) -> String? {
    if let stringValue = value as? String {
        return stringValue
    }
    if let attributed = value as? NSAttributedString {
        return attributed.string
    }
    if let numberValue = value as? NSNumber {
        return numberValue.stringValue
    }
    return nil
}

func frameFromCFTypeRef(_ value: CFTypeRef) -> CGRect? {
    guard let axValue = ValueFromCFType(value), AXValueGetType(axValue) == .cgRect else {
        return nil
    }
    var rect = CGRect.zero
    guard AXValueGetValue(axValue, .cgRect, &rect) else {
        return nil
    }
    return rect
}

func UIElementFromCFType(_ value: CFTypeRef) -> UIElement? {
    guard CFGetTypeID(value) == AXUIElementGetTypeID() else {
        return nil
    }
    return unsafeDowncast(value, to: UIElement.self)
}

func ValueFromCFType(_ value: CFTypeRef) -> AXValue? {
    guard CFGetTypeID(value) == AXValueGetTypeID() else {
        return nil
    }
    return unsafeDowncast(value, to: AXValue.self)
}

func ElementAttribute(_ element: UIElement, _ attribute: CFString) -> UIElement? {
    guard let value = CopyAttributeValue(element, attribute) else {
        return nil
    }
    return UIElementFromCFType(value)
}

func StringAttribute(_ element: UIElement, _ attribute: CFString) -> String? {
    guard let value = CopyAttributeValue(element, attribute) else {
        return nil
    }

    if let stringValue = value as? String {
        return stringValue
    }

    if let attributed = value as? NSAttributedString {
        return attributed.string
    }

    if let numberValue = value as? NSNumber {
        return numberValue.stringValue
    }

    return nil
}

func Children(_ element: UIElement) -> [UIElement] {
    guard let rawChildren = CopyAttributeValue(element, kAXChildrenAttribute as CFString) else {
        return []
    }

    guard let children = rawChildren as? [CFTypeRef] else {
        return []
    }

    return children.compactMap(UIElementFromCFType)
}

func FrameAttribute(_ element: UIElement) -> CGRect? {
    guard let rawValue = CopyAttributeValue(element, "AXFrame" as CFString),
          let value = ValueFromCFType(rawValue) else {
        return nil
    }

    if AXValueGetType(value) != .cgRect {
        return nil
    }

    var rect = CGRect.zero
    guard AXValueGetValue(value, .cgRect, &rect) else {
        return nil
    }
    return rect
}

func ActionNames(_ element: UIElement) -> [String] {
    var actionsRef: CFArray?
    let status = AXUIElementCopyActionNames(element, &actionsRef)
    guard status == .success, let actions = actionsRef as? [Any] else {
        return []
    }
    return actions.compactMap { $0 as? String }
}

func normalizeText(_ value: String) -> String {
    return value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
}

func truncateText(_ value: String, maxLength: Int = 80) -> String {
    let singleLine = value.replacingOccurrences(of: "\n", with: " ").trimmingCharacters(in: .whitespacesAndNewlines)
    if singleLine.count <= maxLength {
        return singleLine
    }
    return String(singleLine.prefix(maxLength - 3)) + "..."
}

func formatFloat(_ value: CGFloat) -> String {
    return String(format: "%.1f", Double(value))
}

func IdentifierAttribute(_ element: UIElement) -> String? {
    return StringAttribute(element, "AXIdentifier" as CFString)
}

let describeAttributes: [String] = [
    kAXRoleAttribute as String,
    kAXSubroleAttribute as String,
    "AXIdentifier",
    "AXLabel",
    kAXTitleAttribute as String,
    kAXDescriptionAttribute as String,
    kAXValueAttribute as String,
    kAXHelpAttribute as String,
    "AXPlaceholderValue",
    kAXEnabledAttribute as String,
    "AXSelected",
    "AXFrame",
]

func describeAccessibilityElement(_ element: UIElement, includeEmpty: Bool = true) -> String? {
    let attrs = copyMultipleAttributes(element, describeAttributes)
    var parts: [String] = []

    let role: String
    if let roleRef = attrs[kAXRoleAttribute as String], let s = stringFromCFTypeRef(roleRef), !s.isEmpty {
        role = s
    } else {
        role = "unknown"
    }
    parts.append("role=\(role)")

    if let ref = attrs[kAXSubroleAttribute as String], let s = stringFromCFTypeRef(ref), !s.isEmpty {
        parts.append("subrole=\(s)")
    }

    if let ref = attrs["AXIdentifier"], let s = stringFromCFTypeRef(ref), !s.isEmpty {
        parts.append("id=\(truncateText(s))")
    }

    var textSources: [String] = []
    let textKeys: [(String, String?)] = [
        ("AXLabel", nil),
        (kAXTitleAttribute as String, nil),
        (kAXDescriptionAttribute as String, nil),
        (kAXValueAttribute as String, nil),
        (kAXHelpAttribute as String, nil),
        ("AXPlaceholderValue", "placeholder:"),
    ]
    for (key, prefix) in textKeys {
        if let ref = attrs[key], let s = stringFromCFTypeRef(ref), !s.isEmpty {
            textSources.append(prefix != nil ? "\(prefix!)\(s)" : s)
        }
    }

    let uniqueTexts = Array(Set(textSources)).filter { !$0.isEmpty }

    if !uniqueTexts.isEmpty {
        let combinedText = uniqueTexts.joined(separator: " | ")
        parts.append("text=\(truncateText(combinedText))")
    }

    if let ref = attrs[kAXEnabledAttribute as String], let s = stringFromCFTypeRef(ref) {
        if s.lowercased() == "false" || s == "0" {
            parts.append("enabled=false")
        }
    }

    if let ref = attrs["AXSelected"], let s = stringFromCFTypeRef(ref) {
        if s.lowercased() == "true" || s == "1" {
            parts.append("selected=true")
        }
    }

    if let ref = attrs["AXFrame"], let frame = frameFromCFTypeRef(ref) {
        let frameText = "frame=(x:\(formatFloat(frame.origin.x)),y:\(formatFloat(frame.origin.y)),w:\(formatFloat(frame.size.width)),h:\(formatFloat(frame.size.height)))"
        parts.append(frameText)
    }

    if !includeEmpty && uniqueTexts.isEmpty {
        if attrs["AXIdentifier"] == nil || (stringFromCFTypeRef(attrs["AXIdentifier"]!) ?? "").isEmpty {
            let children = Children(element)
            if children.isEmpty {
                return nil
            }
        }
    }

    return parts.joined(separator: " ")
}

func describeAccessibilityTree(from root: UIElement, maxDepth: Int = 12, maxNodes: Int = 1500) -> [String] {
    var lines: [String] = []
    var stack: [(element: UIElement, depth: Int)] = [(root, 0)]
    var visited = 0

    while let current = stack.popLast() {
        if visited >= maxNodes {
            lines.append("... truncated after \(maxNodes) nodes")
            break
        }

        visited += 1
        let prefix = String(repeating: "  ", count: current.depth)

        if let description = describeAccessibilityElement(current.element) {
            lines.append("\(prefix)- \(description)")
        } else {
            lines.append("\(prefix)- [hidden: no accessible content]")
        }

        if current.depth >= maxDepth {
            continue
        }

        let children = Children(current.element)
        for child in children.reversed() {
            stack.append((child, current.depth + 1))
        }
    }

    return lines
}

let textAttributes: [String] = [
    "AXLabel",
    kAXTitleAttribute as String,
    kAXDescriptionAttribute as String,
    kAXValueAttribute as String,
    kAXHelpAttribute as String,
]

func getElementTextValues(_ element: UIElement) -> [String] {
    let attrs = copyMultipleAttributes(element, textAttributes)
    var texts: [String] = []
    for key in textAttributes {
        if let ref = attrs[key], let s = stringFromCFTypeRef(ref), !s.isEmpty {
            texts.append(s)
        }
    }
    return texts
}

let matchAttributes: [String] = [
    "AXIdentifier",
    "AXLabel",
    kAXTitleAttribute as String,
    kAXDescriptionAttribute as String,
    kAXValueAttribute as String,
    kAXHelpAttribute as String,
]

func matchesAccessibilityElement(_ element: UIElement, identifier: String?, label: String?) -> Bool {
    guard identifier != nil || label != nil else { return false }

    let attrs = copyMultipleAttributes(element, matchAttributes)

    if let identifier {
        guard let ref = attrs["AXIdentifier"], let s = stringFromCFTypeRef(ref),
              normalizeText(s) == normalizeText(identifier) else {
            return false
        }
    }

    if let label {
        let textKeys = ["AXLabel", kAXTitleAttribute as String, kAXDescriptionAttribute as String, kAXValueAttribute as String, kAXHelpAttribute as String]
        let matches = textKeys.contains { key in
            guard let ref = attrs[key], let s = stringFromCFTypeRef(ref), !s.isEmpty else { return false }
            return normalizeText(s) == normalizeText(label)
        }
        if !matches {
            return false
        }
    }

    return true
}

func findAccessibilityElement(
    in root: UIElement,
    identifier: String?,
    label: String?,
    maxDepth: Int = 14,
    maxNodes: Int = 2000
) -> UIElement? {
    var stack: [(element: UIElement, depth: Int)] = [(root, 0)]
    var visited = 0

    while let current = stack.popLast() {
        if visited >= maxNodes {
            break
        }

        visited += 1
        if matchesAccessibilityElement(current.element, identifier: identifier, label: label) {
            return current.element
        }

        if current.depth >= maxDepth {
            continue
        }

        let children = Children(current.element)
        for child in children.reversed() {
            stack.append((child, current.depth + 1))
        }
    }

    return nil
}

// DFS search for an element containing text in ID, Label, or Value
func searchAccessibilityElements(in root: UIElement, query: String, maxNodes: Int = 3000) -> [String] {
    var results: [String] = []
    var stack: [(element: UIElement, depth: Int)] = [(root, 0)]
    var visited = 0
    let normalizedQuery = normalizeText(query)

    let searchAttributes: [String] = [
        "AXIdentifier",
        "AXLabel",
        kAXTitleAttribute as String,
        kAXDescriptionAttribute as String,
        kAXValueAttribute as String,
        kAXHelpAttribute as String,
    ]

    while let current = stack.popLast() {
        if visited >= maxNodes {
            results.append("... truncated search after \(maxNodes) nodes")
            break
        }
        visited += 1

        let element = current.element
        let attrs = copyMultipleAttributes(element, searchAttributes)
        var matchFound = false

        for key in searchAttributes {
            if let ref = attrs[key], let s = stringFromCFTypeRef(ref), !s.isEmpty,
               normalizeText(s).contains(normalizedQuery) {
                matchFound = true
                break
            }
        }

        if matchFound {
            if let desc = describeAccessibilityElement(element) {
                results.append(desc)
            }
        }

        let children = Children(element)
        for child in children.reversed() {
            stack.append((child, current.depth + 1))
        }
    }
    return results
}

func findElementBySubrole(from root: UIElement, subrole: String) -> UIElement? {
    var stack: [UIElement] = [root]
    var visited = 0
    while let current = stack.popLast() {
        if visited > 500 { break }
        visited += 1

        let attrs = copyMultipleAttributes(current, [kAXSubroleAttribute as String])
        if let ref = attrs[kAXSubroleAttribute as String], let sr = stringFromCFTypeRef(ref), sr == subrole {
            return current
        }

        for child in Children(current).reversed() {
            stack.append(child)
        }
    }
    return nil
}

func simulatorAccessibilityRootElement() throws -> UIElement {
    let bundleIdentifier = "com.apple.iphonesimulator"
    guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundleIdentifier).first else {
        throw NativeError.commandFailed("Simulator app is not running.")
    }

    let appElement = AXUIElementCreateApplication(app.processIdentifier)
    return appElement
}

@discardableResult
func runProcessWithTimeout(_ command: String, _ arguments: [String], timeoutSeconds: Double) throws -> Int32 {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: command)
    process.arguments = arguments
    process.standardInput = FileHandle.standardInput
    process.standardOutput = FileHandle.standardOutput
    process.standardError = FileHandle.standardError

    do {
        try process.run()
    } catch {
        throw NativeError.commandFailed("Failed to launch process: \(command) \(arguments.joined(separator: " "))")
    }

    let group = DispatchGroup()
    group.enter()
    process.terminationHandler = { _ in
        group.leave()
    }

    if group.wait(timeout: .now() + timeoutSeconds) == .timedOut {
        process.interrupt()
        if group.wait(timeout: .now() + 1.0) == .timedOut {
            process.terminate()
            group.wait()
        }
    }

    return process.terminationStatus
}

func defaultOutputPath(prefix: String, ext: String) -> String {
    let timestamp = ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "-")
    return "\(prefix)-\(timestamp).\(ext)"
}

func printHelp() {
    let help = """
    baepsae-native

    Target: use --udid for simulator, --bundle-id or --app-name for macOS app

    Usage:
      baepsae-native help
      baepsae-native --version
      baepsae-native list-simulators
      baepsae-native list-apps
      baepsae-native describe-ui <TARGET> [--all] [--focus-id <ID>] [--output <path>]
      baepsae-native search-ui <TARGET> --query <text>
      baepsae-native screenshot --udid <UDID> [--output <path>]
      baepsae-native record-video --udid <UDID> [--output <path>]
      baepsae-native tap <TARGET> [--id <ID> | --label <LABEL> | -x <X> -y <Y>] [--double] [--pre-delay <S>] [--post-delay <S>]
      baepsae-native type <TARGET> [<TEXT> | --stdin | --file <PATH>]
      baepsae-native swipe <TARGET> --start-x <X> --start-y <Y> --end-x <X> --end-y <Y> [--duration <S>] [--pre-delay <S>] [--post-delay <S>]
      baepsae-native button --udid <UDID> <TYPE> [--duration <S>]
      baepsae-native key <TARGET> <KEYCODE> [--duration <S>]
      baepsae-native key-sequence <TARGET> --keycodes <CODE,...> [--delay <S>]
      baepsae-native key-combo <TARGET> --modifiers <CODE,...> --key <CODE>
      baepsae-native touch <TARGET> -x <X> -y <Y> [--down] [--up] [--delay <S>]
      baepsae-native gesture --udid <UDID> <PRESET> [--screen-width <W>] [--screen-height <H>] [--duration <S>]
      baepsae-native stream-video --udid <UDID> [--output <PATH>] [--duration <S>]
      baepsae-native list-windows <TARGET>
      baepsae-native activate-app <TARGET>
      baepsae-native screenshot-app <TARGET> [--output <path>]
      baepsae-native right-click <TARGET> [--id <ID> | --label <LABEL> | -x <X> -y <Y>] [--pre-delay <S>] [--post-delay <S>]
      baepsae-native scroll <TARGET> [--delta-x <N>] [--delta-y <N>] [-x <X> -y <Y>]
      baepsae-native drag-drop <TARGET> --start-x <X> --start-y <Y> --end-x <X> --end-y <Y> [--duration <S>] [--pre-delay <S>] [--post-delay <S>]
      baepsae-native menu-action --bundle-id <ID> | --app-name <NAME> --menu <MENU> --item <ITEM>
      baepsae-native get-focused-app
      baepsae-native clipboard --read | --write <TEXT>

    Where <TARGET> is one of:
      --udid <UDID>           iOS Simulator device UDID
      --bundle-id <ID>        macOS app bundle identifier
      --app-name <NAME>       macOS app name
    """
    print(help)
}

func requireSimulatorOnly(_ target: TargetApp) throws {
    if case .macApp = target {
        throw NativeError.commandFailed("This command is only available for iOS Simulator.")
    }
}

func requireSimulatorUdid(_ target: TargetApp) throws -> String {
    guard case .simulator(let udid) = target else {
        throw NativeError.commandFailed("This command is only available for iOS Simulator.")
    }
    return udid
}

func runParsed(_ parsed: ParsedOptions) throws -> Int32 {
    switch parsed.command {
    case "help", "--help", "-h":
        printHelp()
        return 0

    case "--version":
        print("baepsae-native 3.1.0")
        return 0

    case "list-simulators":
        return try runProcess("/usr/bin/xcrun", ["simctl", "list", "devices", "available"])

    case "list-apps":
        let apps = NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular }
        for app in apps {
            let bundleId = app.bundleIdentifier ?? "unknown"
            let name = app.localizedName ?? "unknown"
            let pid = app.processIdentifier
            print("\(bundleId) | \(name) | \(pid)")
        }
        return 0

    case "screenshot":
        let udid = try requiredOption("--udid", from: parsed)
        let output = parsed.options["--output"] ?? defaultOutputPath(prefix: "simulator-screenshot", ext: "png")
        return try runProcess("/usr/bin/xcrun", ["simctl", "io", udid, "screenshot", output])

    case "record-video":
        let udid = try requiredOption("--udid", from: parsed)
        let output = parsed.options["--output"] ?? defaultOutputPath(prefix: "simulator-recording", ext: "mov")
        return try runProcess("/usr/bin/xcrun", ["simctl", "io", udid, "recordVideo", "--force", output])

    case "describe-ui":
        let target = try resolveTarget(from: parsed)
        try ensureAccessibilityTrusted()
        try activateTarget(target)

        let appRoot = try accessibilityRootElement(for: target)
        var targetRoot = appRoot

        switch target {
        case .simulator:
            // Default behavior: Focus on iOSContentGroup unless --all is specified
            if !parsed.flags.contains("--all") {
                if let contentGroup = findElementBySubrole(from: appRoot, subrole: "iOSContentGroup") {
                    targetRoot = contentGroup
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
            } else {
                throw NativeError.commandFailed("Could not find element with id: \(focusId)")
            }
        }

        let isMacApp: Bool
        if case .macApp = target { isMacApp = true } else { isMacApp = false }
        let lines = describeAccessibilityTree(
            from: targetRoot,
            maxDepth: isMacApp ? 8 : 12,
            maxNodes: isMacApp ? 500 : 1500
        )
        if lines.isEmpty {
            throw NativeError.commandFailed("No accessibility elements found.")
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

    case "search-ui":
        let target = try resolveTarget(from: parsed)
        let query = try requiredOption("--query", from: parsed)
        try ensureAccessibilityTrusted()
        try activateTarget(target)

        let appRoot = try accessibilityRootElement(for: target)
        var searchRoot = appRoot
        if case .simulator = target {
            if let contentGroup = findElementBySubrole(from: appRoot, subrole: "iOSContentGroup") {
                searchRoot = contentGroup
            }
        }

        let searchIsMacApp: Bool
        if case .macApp = target { searchIsMacApp = true } else { searchIsMacApp = false }
        let results = searchAccessibilityElements(in: searchRoot, query: query, maxNodes: searchIsMacApp ? 500 : 3000)
        if results.isEmpty {
            print("No elements found matching query: \(query)")
        } else {
            print(results.joined(separator: "\n"))
        }
        return 0

    case "tap":
        let target = try resolveTarget(from: parsed)
        let accessibilityId = parsed.options["--id"]
        let accessibilityLabel = parsed.options["--label"]
        let isDouble = parsed.flags.contains("--double")
        if accessibilityId != nil || accessibilityLabel != nil {
            let preDelay = try optionalDoubleOption("--pre-delay", from: parsed) ?? 0
            let postDelay = try optionalDoubleOption("--post-delay", from: parsed) ?? 0

            try ensureAccessibilityTrusted()
            try activateTarget(target)
            if preDelay > 0 {
                Thread.sleep(forTimeInterval: preDelay)
            }

            let root = try accessibilityRootElement(for: target)
            guard let matchedElement = findAccessibilityElement(
                in: root,
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
                throw NativeError.commandFailed("No accessibility element matched \(selectors.joined(separator: " and ")).")
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
        let point = try pointInWindow(x: x, y: y, for: target)
        if isDouble {
            sendDoubleClick(at: point)
        } else {
            sendClick(at: point)
        }
        if postDelay > 0 {
            Thread.sleep(forTimeInterval: postDelay)
        }
        return 0

    case "type":
        let target = try resolveTarget(from: parsed)
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
        sendText(text)
        return 0

    case "swipe":
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
        try activateTarget(target)
        if preDelay > 0 {
            Thread.sleep(forTimeInterval: preDelay)
        }
        let start = try pointInWindow(x: startXValue, y: startYValue, for: target)
        let end = try pointInWindow(x: endXValue, y: endYValue, for: target)
        sendSwipe(from: start, to: end, duration: duration)
        if postDelay > 0 {
            Thread.sleep(forTimeInterval: postDelay)
        }
        return 0

    case "button":
        let target = try resolveTarget(from: parsed)
        let udid = try requireSimulatorUdid(target)
        try activateSimulator(udid: udid)
        guard let buttonType = parsed.positionals.first else {
            throw NativeError.invalidArguments("button requires a button type.")
        }
        let holdDuration = try optionalDoubleOption("--duration", from: parsed)
        switch buttonType {
        case "home":
            sendKeyCombo(modifiers: [55, 56], key: 4)
        case "lock", "side-button":
            sendKeyCombo(modifiers: [55], key: 37)
        case "siri":
            sendKeyCombo(modifiers: [55, 56], key: 1)
        case "apple-pay":
            sendKeyCombo(modifiers: [55, 56], key: 35)
        default:
            throw NativeError.invalidArguments("Unsupported button type: \(buttonType)")
        }
        if let holdDuration, holdDuration > 0 {
            Thread.sleep(forTimeInterval: holdDuration)
        }
        return 0

    case "key":
        let target = try resolveTarget(from: parsed)
        try activateTarget(target)
        guard let keyString = parsed.positionals.first, let keyCode = Int(keyString) else {
            throw NativeError.invalidArguments("key requires a numeric keycode.")
        }
        let duration = try optionalDoubleOption("--duration", from: parsed)
        sendKeyPress(keyCode: keyCode, duration: duration)
        return 0

    case "key-sequence":
        let target = try resolveTarget(from: parsed)
        try activateTarget(target)
        guard let raw = parsed.options["--keycodes"] else {
            throw NativeError.invalidArguments("key-sequence requires --keycodes.")
        }
        let keycodes = try parseCommaSeparatedInts(raw, label: "keycodes")
        let delay = try optionalDoubleOption("--delay", from: parsed) ?? 0
        for keyCode in keycodes {
            sendKeyPress(keyCode: keyCode, duration: nil)
            if delay > 0 {
                Thread.sleep(forTimeInterval: delay)
            }
        }
        return 0

    case "key-combo":
        let target = try resolveTarget(from: parsed)
        try activateTarget(target)
        guard let rawModifiers = parsed.options["--modifiers"],
              let rawKey = parsed.options["--key"],
              let key = Int(rawKey) else {
            throw NativeError.invalidArguments("key-combo requires --modifiers and --key.")
        }
        let modifiers = try parseCommaSeparatedInts(rawModifiers, label: "modifiers")
        sendKeyCombo(modifiers: modifiers, key: key)
        return 0

    case "touch":
        let target = try resolveTarget(from: parsed)
        let xRaw = parsed.options["-x"]
        let yRaw = parsed.options["-y"]
        guard let xRaw, let yRaw, let x = Double(xRaw), let y = Double(yRaw) else {
            throw NativeError.invalidArguments("touch requires -x and -y coordinates.")
        }
        let delay = try optionalDoubleOption("--delay", from: parsed) ?? 0
        try activateTarget(target)
        let point = try pointInWindow(x: x, y: y, for: target)
        let downRequested = parsed.flags.contains("--down")
        let upRequested = parsed.flags.contains("--up")
        if !downRequested && !upRequested {
            postMouseEvent(type: .leftMouseDown, point: point)
            if delay > 0 {
                Thread.sleep(forTimeInterval: delay)
            }
            postMouseEvent(type: .leftMouseUp, point: point)
        } else {
            if downRequested {
                postMouseEvent(type: .leftMouseDown, point: point)
            }
            if delay > 0 {
                Thread.sleep(forTimeInterval: delay)
            }
            if upRequested {
                postMouseEvent(type: .leftMouseUp, point: point)
            }
        }
        return 0

    case "gesture":
        let target = try resolveTarget(from: parsed)
        try requireSimulatorOnly(target)
        guard let preset = parsed.positionals.first else {
            throw NativeError.invalidArguments("gesture requires a preset name.")
        }
        let preDelay = try optionalDoubleOption("--pre-delay", from: parsed) ?? 0
        let postDelay = try optionalDoubleOption("--post-delay", from: parsed) ?? 0
        let duration = try optionalDoubleOption("--duration", from: parsed)
        let screenWidth = try optionalDoubleOption("--screen-width", from: parsed)
        let screenHeight = try optionalDoubleOption("--screen-height", from: parsed)
        try activateTarget(target)
        let bounds = simulatorWindowBounds()
        let width = screenWidth ?? Double(bounds?.width ?? 0)
        let height = screenHeight ?? Double(bounds?.height ?? 0)
        if width <= 0 || height <= 0 {
            throw NativeError.commandFailed("Unable to determine simulator window size; provide screenWidth/screenHeight.")
        }
        let start: CGPoint
        let end: CGPoint
        switch preset {
        case "scroll-up":
            start = try pointInSimulatorWindow(x: width * 0.5, y: height * 0.7)
            end = try pointInSimulatorWindow(x: width * 0.5, y: height * 0.3)
        case "scroll-down":
            start = try pointInSimulatorWindow(x: width * 0.5, y: height * 0.3)
            end = try pointInSimulatorWindow(x: width * 0.5, y: height * 0.7)
        case "scroll-left":
            start = try pointInSimulatorWindow(x: width * 0.7, y: height * 0.5)
            end = try pointInSimulatorWindow(x: width * 0.3, y: height * 0.5)
        case "scroll-right":
            start = try pointInSimulatorWindow(x: width * 0.3, y: height * 0.5)
            end = try pointInSimulatorWindow(x: width * 0.7, y: height * 0.5)
        case "swipe-from-left-edge":
            start = try pointInSimulatorWindow(x: width * 0.05, y: height * 0.5)
            end = try pointInSimulatorWindow(x: width * 0.6, y: height * 0.5)
        case "swipe-from-right-edge":
            start = try pointInSimulatorWindow(x: width * 0.95, y: height * 0.5)
            end = try pointInSimulatorWindow(x: width * 0.4, y: height * 0.5)
        case "swipe-from-top-edge":
            start = try pointInSimulatorWindow(x: width * 0.5, y: height * 0.05)
            end = try pointInSimulatorWindow(x: width * 0.5, y: height * 0.6)
        case "swipe-from-bottom-edge":
            start = try pointInSimulatorWindow(x: width * 0.5, y: height * 0.95)
            end = try pointInSimulatorWindow(x: width * 0.5, y: height * 0.4)
        default:
            throw NativeError.invalidArguments("Unsupported gesture preset: \(preset)")
        }
        if preDelay > 0 {
            Thread.sleep(forTimeInterval: preDelay)
        }
        sendSwipe(from: start, to: end, duration: duration)
        if postDelay > 0 {
            Thread.sleep(forTimeInterval: postDelay)
        }
        return 0

    case "stream-video":
        let udid = try requiredOption("--udid", from: parsed)
        let output = parsed.options["--output"] ?? defaultOutputPath(prefix: "simulator-stream", ext: "mov")
        let duration = try optionalDoubleOption("--duration", from: parsed) ?? 10
        let args = ["simctl", "io", udid, "recordVideo", "--force", output]
        return try runProcessWithTimeout("/usr/bin/xcrun", args, timeoutSeconds: max(1, duration))

    case "list-windows":
        let target = try resolveTarget(from: parsed)
        guard let windowInfo = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
            as? [[String: Any]] else {
            throw NativeError.commandFailed("Failed to get window list.")
        }
        let filterPid: pid_t?
        let filterName: String?
        switch target {
        case .macApp(let pid, _, _):
            filterPid = pid
            filterName = nil
        case .simulator:
            filterPid = nil
            filterName = "Simulator"
        }
        let windows = windowInfo.filter { info in
            let ownerPid = info[kCGWindowOwnerPID as String] as? pid_t
            let ownerName = info[kCGWindowOwnerName as String] as? String
            let layer = info[kCGWindowLayer as String] as? Int
            if (layer ?? 0) != 0 { return false }
            if let filterPid { return ownerPid == filterPid }
            if let filterName { return ownerName == filterName }
            return false
        }
        if windows.isEmpty {
            print("No windows found.")
        }
        for info in windows {
            let title = info[kCGWindowName as String] as? String ?? ""
            let windowId = info[kCGWindowNumber as String] as? Int ?? 0
            var frameStr = ""
            if let boundsDict = info[kCGWindowBounds as String] as? [String: Any],
               let x = boundsDict["X"] as? CGFloat,
               let y = boundsDict["Y"] as? CGFloat,
               let w = boundsDict["Width"] as? CGFloat,
               let h = boundsDict["Height"] as? CGFloat {
                frameStr = "(\(formatFloat(x)),\(formatFloat(y)),\(formatFloat(w)),\(formatFloat(h)))"
            }
            print("\(title) | \(frameStr) | \(windowId)")
        }
        return 0

    case "activate-app":
        let target = try resolveTarget(from: parsed)
        try activateTarget(target)
        switch target {
        case .macApp(_, let bundleId, let name):
            print("Activated: \(name ?? bundleId ?? "app")")
        case .simulator:
            print("Activated: Simulator")
        }
        return 0

    case "screenshot-app":
        let target = try resolveTarget(from: parsed)
        let output = parsed.options["--output"] ?? defaultOutputPath(prefix: "app-screenshot", ext: "png")
        // Find the main window ID for the target
        guard let windowInfo = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
            as? [[String: Any]] else {
            throw NativeError.commandFailed("Failed to get window list.")
        }
        let targetPid: pid_t
        switch target {
        case .macApp(let pid, _, _):
            targetPid = pid
        case .simulator:
            let bundleIdentifier = "com.apple.iphonesimulator"
            guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundleIdentifier).first else {
                throw NativeError.commandFailed("Simulator is not running.")
            }
            targetPid = app.processIdentifier
        }
        let appWindows = windowInfo.filter { info in
            let ownerPid = info[kCGWindowOwnerPID as String] as? pid_t
            let layer = info[kCGWindowLayer as String] as? Int
            return ownerPid == targetPid && (layer ?? 0) == 0
        }
        guard let mainWindow = appWindows.first,
              let windowId = mainWindow[kCGWindowNumber as String] as? CGWindowID else {
            throw NativeError.commandFailed("No window found for the target app.")
        }
        // Use screencapture -l to capture specific window
        let status = try runProcess("/usr/sbin/screencapture", ["-l", String(windowId), "-x", output])
        if status == 0 {
            print("Screenshot saved to: \(output)")
        }
        return status

    case "right-click":
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

    case "scroll":
        let target = try resolveTarget(from: parsed)
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

    case "drag-drop":
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

    case "menu-action":
        let target = try resolveTarget(from: parsed)
        if case .simulator = target {
            throw NativeError.commandFailed("menu-action is only supported for macOS apps (use --bundle-id or --app-name).")
        }
        try ensureAccessibilityTrusted()
        try activateTarget(target)
        Thread.sleep(forTimeInterval: 0.3)
        let menuName = try requiredOption("--menu", from: parsed)
        let itemName = try requiredOption("--item", from: parsed)
        guard case .macApp(let pid, _, _) = target else {
            throw NativeError.commandFailed("menu-action requires a macOS app target.")
        }
        let appElement = AXUIElementCreateApplication(pid)
        guard let menuBar = ElementAttribute(appElement, kAXMenuBarAttribute as CFString) else {
            throw NativeError.commandFailed("Could not access menu bar for the application.")
        }
        let menuBarItems = Children(menuBar)
        var foundMenu: UIElement? = nil
        for menuBarItem in menuBarItems {
            if let title = StringAttribute(menuBarItem, kAXTitleAttribute as CFString),
               normalizeText(title) == normalizeText(menuName) {
                foundMenu = menuBarItem
                break
            }
        }
        guard let menuItem = foundMenu else {
            let availableMenus = menuBarItems.compactMap { StringAttribute($0, kAXTitleAttribute as CFString) }
            throw NativeError.commandFailed("Menu '\(menuName)' not found. Available menus: \(availableMenus.joined(separator: ", "))")
        }
        // Open the menu
        AXUIElementPerformAction(menuItem, kAXPressAction as CFString)
        Thread.sleep(forTimeInterval: 0.2)
        // Find the item within the opened menu
        let menuChildren = Children(menuItem)
        var foundItem: UIElement? = nil
        for child in menuChildren {
            let items = Children(child)
            for item in items {
                if let title = StringAttribute(item, kAXTitleAttribute as CFString),
                   normalizeText(title) == normalizeText(itemName) {
                    foundItem = item
                    break
                }
            }
            if foundItem != nil { break }
        }
        guard let targetItem = foundItem else {
            // Cancel the menu
            AXUIElementPerformAction(menuItem, "AXCancel" as CFString)
            throw NativeError.commandFailed("Menu item '\(itemName)' not found in '\(menuName)'.")
        }
        let pressStatus = AXUIElementPerformAction(targetItem, kAXPressAction as CFString)
        if pressStatus != .success {
            throw NativeError.commandFailed("Failed to activate menu item '\(itemName)' (status: \(pressStatus.rawValue)).")
        }
        print("Performed: \(menuName) > \(itemName)")
        return 0

    case "get-focused-app":
        guard let app = NSWorkspace.shared.frontmostApplication else {
            throw NativeError.commandFailed("No frontmost application found.")
        }
        let bundleId = app.bundleIdentifier ?? "unknown"
        let name = app.localizedName ?? "unknown"
        let pid = app.processIdentifier
        print("\(bundleId) | \(name) | \(pid)")
        return 0

    case "clipboard":
        if parsed.flags.contains("--read") {
            let pasteboard = NSPasteboard.general
            if let text = pasteboard.string(forType: .string) {
                print(text)
            } else {
                print("")
            }
        } else if let text = parsed.options["--write"] {
            let pasteboard = NSPasteboard.general
            pasteboard.clearContents()
            pasteboard.setString(text, forType: .string)
            print("Clipboard updated.")
        } else {
            throw NativeError.invalidArguments("clipboard requires --read or --write <text>.")
        }
        return 0

    default:
        throw NativeError.invalidArguments("Unhandled command: \(parsed.command)")
    }
}

do {
    let parsed = try parse(arguments: Array(CommandLine.arguments.dropFirst()))
    let status = try runParsed(parsed)
    exit(status)
} catch {
    let message: String
    if let nativeError = error as? NativeError {
        message = nativeError.description
    } else {
        message = error.localizedDescription
    }

    FileHandle.standardError.write(Data((message + "\n").utf8))
    if case NativeError.unsupported = error {
        exit(2)
    }
    exit(1)
}
