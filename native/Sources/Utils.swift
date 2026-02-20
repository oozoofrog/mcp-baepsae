import AppKit
import CoreGraphics
import Foundation

// MARK: - Supported Commands

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

// MARK: - Argument Parsing

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

// MARK: - Option Helpers

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

// MARK: - I/O Helpers

func readStdinText() -> String {
    let data = FileHandle.standardInput.readDataToEndOfFile()
    return String(data: data, encoding: .utf8) ?? ""
}

func readFileText(_ path: String) throws -> String {
    let url = URL(fileURLWithPath: path)
    return try String(contentsOf: url, encoding: .utf8)
}

// MARK: - Process Execution

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

// MARK: - Target Resolution

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

// MARK: - Accessibility Helpers

func ensureAccessibilityTrusted() throws {
    if AXIsProcessTrusted() {
        return
    }
    throw NativeError.commandFailed(
        """
        [Permission Denied] Accessibility access is required to read/control Simulator UI (including apps running inside it) and send input events.

        Please enable it in macOS System Settings:
        1. Open 'System Settings' -> 'Privacy & Security' -> 'Accessibility'.
        2. Find your terminal app (e.g. iTerm, Terminal, VSCode) or 'node'/'openclaw' in the list.
        3. Turn the switch ON.
        4. If it's already ON, try turning it OFF and ON again, or restart your terminal.
        """
    )
}

func accessibilityRootElement(for target: TargetApp) throws -> UIElement {
    switch target {
    case .simulator:
        return try simulatorAccessibilityRootElement()
    case .macApp(let pid, _, _):
        return AXUIElementCreateApplication(pid)
    }
}

func simulatorAccessibilityRootElement() throws -> UIElement {
    let bundleIdentifier = "com.apple.iphonesimulator"
    guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundleIdentifier).first else {
        throw NativeError.commandFailed("Simulator app is not running.")
    }

    let appElement = AXUIElementCreateApplication(app.processIdentifier)
    return appElement
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

func IdentifierAttribute(_ element: UIElement) -> String? {
    return StringAttribute(element, "AXIdentifier" as CFString)
}

// MARK: - Text Helpers

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

// MARK: - Describe / Search Accessibility

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

func describeAccessibilityTree(from root: UIElement, options: DescribeOptions = DescribeOptions()) -> [String] {
    var lines: [String] = []
    var stack: [(element: UIElement, depth: Int)] = [(root, 0)]
    var totalNodes = 0
    var emitted = 0

    while let current = stack.popLast() {
        let element = current.element
        let depth = current.depth

        // Apply filters
        if options.roleFilter != nil || options.visibleOnly {
            let attrs = copyMultipleAttributes(element, [kAXRoleAttribute as String, "AXFrame"])
            if let roleFilter = options.roleFilter {
                if let roleRef = attrs[kAXRoleAttribute as String], let role = stringFromCFTypeRef(roleRef) {
                    if role != roleFilter {
                        // Still traverse children even if this node doesn't match
                        if depth < options.maxDepth {
                            let children = Children(element)
                            for child in children.reversed() {
                                stack.append((child, depth + 1))
                            }
                        }
                        continue
                    }
                } else {
                    if depth < options.maxDepth {
                        let children = Children(element)
                        for child in children.reversed() {
                            stack.append((child, depth + 1))
                        }
                    }
                    continue
                }
            }
            if options.visibleOnly, let screenBounds = options.screenBounds {
                if let frameRef = attrs["AXFrame"], let frame = frameFromCFTypeRef(frameRef) {
                    if !screenBounds.intersects(frame) {
                        if depth < options.maxDepth {
                            let children = Children(element)
                            for child in children.reversed() {
                                stack.append((child, depth + 1))
                            }
                        }
                        continue
                    }
                }
            }
        }

        totalNodes += 1
        let prefix = String(repeating: "  ", count: depth)

        // Pagination: only emit nodes within [offset, offset+limit)
        if totalNodes > options.offset && emitted < options.limit {
            if options.summary {
                let children = Children(element)
                if let description = describeAccessibilityElement(element) {
                    if !children.isEmpty {
                        lines.append("\(prefix)- \(description) [\(children.count) children]")
                    } else {
                        lines.append("\(prefix)- \(description)")
                    }
                }
                emitted += 1
                // In summary mode, don't recurse into children
                continue
            } else {
                if let description = describeAccessibilityElement(element) {
                    lines.append("\(prefix)- \(description)")
                } else {
                    lines.append("\(prefix)- [hidden: no accessible content]")
                }
                emitted += 1
            }
        }

        if depth >= options.maxDepth {
            continue
        }

        let children = Children(element)
        for child in children.reversed() {
            stack.append((child, depth + 1))
        }
    }

    // Add pagination header/footer
    if options.offset > 0 || options.limit < Int.max {
        let start = options.offset + 1
        let end = options.offset + emitted
        lines.insert("[Total: \(totalNodes) nodes]", at: 0)
        lines.append("[Showing \(start)-\(end) of \(totalNodes)]")
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
    maxDepth: Int = Int.max,
    maxNodes: Int = Int.max
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

func searchAccessibilityElements(in root: UIElement, query: String, options: SearchOptions = SearchOptions()) -> [String] {
    var results: [String] = []
    var stack: [(element: UIElement, depth: Int)] = [(root, 0)]
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
        let element = current.element
        let depth = current.depth

        // Fetch search attributes + filter attributes in one call
        var allAttrs = searchAttributes
        if options.roleFilter != nil { allAttrs.append(kAXRoleAttribute as String) }
        if options.visibleOnly { allAttrs.append("AXFrame") }
        let attrs = copyMultipleAttributes(element, allAttrs)

        // Apply role filter
        if let roleFilter = options.roleFilter {
            if let roleRef = attrs[kAXRoleAttribute as String], let role = stringFromCFTypeRef(roleRef) {
                if role != roleFilter {
                    if depth < options.maxDepth {
                        let children = Children(element)
                        for child in children.reversed() {
                            stack.append((child, depth + 1))
                        }
                    }
                    continue
                }
            } else {
                if depth < options.maxDepth {
                    let children = Children(element)
                    for child in children.reversed() {
                        stack.append((child, depth + 1))
                    }
                }
                continue
            }
        }

        // Apply visible-only filter
        if options.visibleOnly, let screenBounds = options.screenBounds {
            if let frameRef = attrs["AXFrame"], let frame = frameFromCFTypeRef(frameRef) {
                if !screenBounds.intersects(frame) {
                    if depth < options.maxDepth {
                        let children = Children(element)
                        for child in children.reversed() {
                            stack.append((child, depth + 1))
                        }
                    }
                    continue
                }
            }
        }

        // Check text match
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

        if depth < options.maxDepth {
            let children = Children(element)
            for child in children.reversed() {
                stack.append((child, depth + 1))
            }
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

func simulatorContentRootElement(from appRoot: UIElement) -> UIElement? {
    return findElementBySubrole(from: appRoot, subrole: "iOSContentGroup")
}

// MARK: - Window / Coordinate Helpers

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

func pointInSimulatorWindow(x: Double, y: Double) throws -> CGPoint {
    guard let bounds = simulatorWindowBounds() else {
        throw NativeError.commandFailed("Simulator window not found. Ensure Simulator is running and visible.")
    }
    let targetX = bounds.origin.x + CGFloat(x)
    let targetY = bounds.origin.y + bounds.size.height - CGFloat(y)
    return CGPoint(x: targetX, y: targetY)
}

// MARK: - App Activation

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

    // When UDID is provided, always pass it to Simulator so the intended device
    // becomes current even if Simulator is already running.
    if let udid, !udid.isEmpty {
        _ = try runProcess("/usr/bin/open", ["-a", "Simulator", "--args", "-CurrentDeviceUDID", udid])
        Thread.sleep(forTimeInterval: 0.4)
    } else {
        let running = NSRunningApplication.runningApplications(withBundleIdentifier: bundleIdentifier)
        if running.isEmpty {
            _ = try runProcess("/usr/bin/open", ["-a", "Simulator"])
            Thread.sleep(forTimeInterval: 0.4)
        }
    }

    let runningNow = NSRunningApplication.runningApplications(withBundleIdentifier: bundleIdentifier)
    for app in runningNow {
        app.activate(options: [.activateAllWindows])
    }
}

// MARK: - Mouse Events

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

// MARK: - Keyboard Events

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

// MARK: - Misc Helpers

func defaultOutputPath(prefix: String, ext: String) -> String {
    let timestamp = ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "-")
    return "\(prefix)-\(timestamp).\(ext)"
}
