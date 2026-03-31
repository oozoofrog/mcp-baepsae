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
    "tap-tab",
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
    "doctor",
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

    func looksLikeNegativeNumber(_ value: String) -> Bool {
        let pattern = #"^-\d+(\.\d+)?$"#
        return value.range(of: pattern, options: .regularExpression) != nil
    }

    var index = 1
    while index < arguments.count {
        let item = arguments[index]
        if item.hasPrefix("--") {
            if let separator = item.firstIndex(of: "=") {
                let key = String(item[..<separator])
                let value = String(item[item.index(after: separator)...])
                options[key] = value
            } else if index + 1 < arguments.count, (!arguments[index + 1].hasPrefix("-") || looksLikeNegativeNumber(arguments[index + 1])) {
                options[item] = arguments[index + 1]
                index += 1
            } else {
                flags.insert(item)
            }
        } else if item.hasPrefix("-") {
            if index + 1 < arguments.count, (!arguments[index + 1].hasPrefix("-") || looksLikeNegativeNumber(arguments[index + 1])) {
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
func runProcess(_ command: String, _ arguments: [String], stdinText: String? = nil) throws -> Int32 {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: command)
    process.arguments = arguments
    if let stdinText {
        let pipe = Pipe()
        process.standardInput = pipe
        process.standardOutput = FileHandle.standardOutput
        process.standardError = FileHandle.standardError
        do {
            try process.run()
        } catch {
            throw NativeError.commandFailed("Failed to launch process: \(command) \(arguments.joined(separator: " "))")
        }
        if let data = stdinText.data(using: .utf8) {
            pipe.fileHandleForWriting.write(data)
        }
        pipe.fileHandleForWriting.closeFile()
        process.waitUntilExit()
        return process.terminationStatus
    }
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

func simulatorUdid(from target: TargetApp) -> String? {
    guard case .simulator(let udid) = target else { return nil }
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

        Most commonly this happens because either the MCP client app or the terminal app running mcp-baepsae does not have Accessibility permission.

        Please enable it in macOS System Settings:
        1. Open 'System Settings' -> 'Privacy & Security' -> 'Accessibility'.
        2. Find both the MCP client app and terminal app you used, and also the Node.js runtime ('node') in the list.
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

func shellCaptureCommand(_ command: String, _ arguments: [String]) -> String? {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: command)
    process.arguments = arguments
    let pipe = Pipe()
    process.standardOutput = pipe
    process.standardError = FileHandle.nullDevice
    do {
        try process.run()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else { return nil }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        return String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
    } catch {
        return nil
    }
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

func performPrimaryAction(on element: UIElement) throws {
    let actions = ActionNames(element)
    if actions.contains(kAXPressAction as String) {
        let status = AXUIElementPerformAction(element, kAXPressAction as CFString)
        if status != .success {
            throw NativeError.commandFailed("Matched accessibility element but AXPress failed with status \(status.rawValue).")
        }
        return
    }

    if let frame = FrameAttribute(element) {
        sendClick(at: CGPoint(x: frame.midX, y: frame.midY))
        return
    }

    throw NativeError.commandFailed("Matched accessibility element has no AXPress action or frame for fallback click.")
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

func actionableTabBarItems(in tabBar: UIElement, maxDepth: Int = 2) -> [UIElement] {
    var stack: [(element: UIElement, depth: Int)] = Children(tabBar).map { ($0, 1) }.reversed()
    var matches: [UIElement] = []

    while let current = stack.popLast() {
        let role = StringAttribute(current.element, kAXRoleAttribute as CFString) ?? ""
        let actions = ActionNames(current.element)
        let hasFrame = FrameAttribute(current.element) != nil
        let isLikelyTabItem =
            role == "AXButton" ||
            role == "AXRadioButton" ||
            role == "AXCheckBox" ||
            actions.contains(kAXPressAction as String)

        if isLikelyTabItem && hasFrame {
            if !matches.contains(where: { elementsAreEqual($0, current.element) }) {
                matches.append(current.element)
            }
        }

        if current.depth < maxDepth {
            for child in Children(current.element).reversed() {
                stack.append((child, current.depth + 1))
            }
        }
    }

    return matches.sorted {
        (FrameAttribute($0)?.midX ?? 0) < (FrameAttribute($1)?.midX ?? 0)
    }
}

func semanticProxyTabButtons(in contentRoot: UIElement, excluding excludedElement: UIElement? = nil, expectedCount: Int) -> [UIElement] {
    guard expectedCount > 0 else { return [] }
    guard let contentFrame = FrameAttribute(contentRoot) else { return [] }
    let excludedFrame = excludedElement.flatMap(FrameAttribute)

    let directChildren = Children(contentRoot)
    let candidates = directChildren.filter { child in
        let role = StringAttribute(child, kAXRoleAttribute as CFString) ?? ""
        let actions = ActionNames(child)
        guard let frame = FrameAttribute(child) else { return false }
        if let excludedFrame, excludedFrame.contains(frame) {
            return false
        }
        guard frame.midY < contentFrame.origin.y + contentFrame.height * 0.55 else {
            return false
        }
        guard frame.width < contentFrame.width * 0.8 else {
            return false
        }
        return role == "AXButton" || actions.contains(kAXPressAction as String)
    }

    guard !candidates.isEmpty else { return [] }

    struct RowGroup {
        var meanY: CGFloat
        var elements: [UIElement]
    }

    var rows: [RowGroup] = []
    let tolerance: CGFloat = 24
    for element in candidates.sorted(by: { (FrameAttribute($0)?.midY ?? 0) < (FrameAttribute($1)?.midY ?? 0) }) {
        let midY = FrameAttribute(element)?.midY ?? 0
        if let rowIndex = rows.firstIndex(where: { abs($0.meanY - midY) <= tolerance }) {
            rows[rowIndex].elements.append(element)
            let count = CGFloat(rows[rowIndex].elements.count)
            rows[rowIndex].meanY = ((rows[rowIndex].meanY * (count - 1)) + midY) / count
        } else {
            rows.append(RowGroup(meanY: midY, elements: [element]))
        }
    }

    guard let bestRow = rows.sorted(by: {
        if $0.elements.count == $1.elements.count {
            return $0.meanY < $1.meanY
        }
        return $0.elements.count > $1.elements.count
    }).first else {
        return []
    }

    guard bestRow.elements.count == expectedCount else {
        return []
    }

    return bestRow.elements.sorted {
        (FrameAttribute($0)?.midX ?? 0) < (FrameAttribute($1)?.midX ?? 0)
    }
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
                // Add hint for tab bar elements with unlabeled children
                let attrs2 = copyMultipleAttributes(element, [kAXRoleAttribute as String])
                if let roleRef = attrs2[kAXRoleAttribute as String], let role = stringFromCFTypeRef(roleRef),
                   role == "AXTabGroup" || role == "AXRadioGroup" {
                    let tabChildren = Children(element)
                    let unlabeledCount = tabChildren.filter { child in
                        let childTexts = getElementTextValues(child)
                        return childTexts.isEmpty
                    }.count
                    if unlabeledCount > 0 && unlabeledCount == tabChildren.count {
                        let hint = "\(prefix)  [Tab bar with \(tabChildren.count) unlabeled items - use tap_tab with index 0..\(tabChildren.count - 1)]"
                        lines.append(hint)
                    }
                }
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

func findAccessibilityElement(
    in roots: [UIElement],
    identifier: String?,
    label: String?,
    maxDepth: Int = Int.max,
    maxNodes: Int = Int.max
) -> UIElement? {
    for root in roots {
        if let match = findAccessibilityElement(in: root, identifier: identifier, label: label, maxDepth: maxDepth, maxNodes: maxNodes) {
            return match
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

func searchAccessibilityElements(in roots: [UIElement], query: String, options: SearchOptions = SearchOptions()) -> [String] {
    var results: [String] = []
    for root in roots {
        results.append(contentsOf: searchAccessibilityElements(in: root, query: query, options: options))
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

func simulatorDeviceName(for udid: String?) -> String? {
    guard let udid, !udid.isEmpty else { return nil }
    return shellCaptureCommand("/usr/bin/xcrun", ["simctl", "getenv", udid, "SIMULATOR_DEVICE_NAME"])
}

func simulatorWindowTitle(_ element: UIElement) -> String? {
    return StringAttribute(element, kAXTitleAttribute as CFString)
        ?? StringAttribute(element, kAXDescriptionAttribute as CFString)
        ?? StringAttribute(element, kAXValueAttribute as CFString)
}

func simulatorWindowElement(from appRoot: UIElement, udid: String? = nil) -> UIElement? {
    let windows = Children(appRoot).filter { element in
        let attrs = copyMultipleAttributes(element, [kAXRoleAttribute as String])
        if let ref = attrs[kAXRoleAttribute as String], let role = stringFromCFTypeRef(ref) {
            return role == "AXWindow"
        }
        return false
    }

    guard !windows.isEmpty else { return nil }

    let normalizedDeviceName = simulatorDeviceName(for: udid).map(normalizeText)
    let preferredWindows: [UIElement]
    if let normalizedDeviceName {
        let matched = windows.filter { window in
            guard let title = simulatorWindowTitle(window) else { return false }
            return normalizeText(title).contains(normalizedDeviceName)
        }
        preferredWindows = matched.isEmpty ? windows : matched
    } else {
        preferredWindows = windows
    }

    var bestWindow: UIElement?
    var bestArea: CGFloat = 0
    for window in preferredWindows {
        let area = FrameAttribute(window).map { $0.width * $0.height } ?? 0
        if bestWindow == nil || area > bestArea {
            bestWindow = window
            bestArea = area
        }
    }
    return bestWindow
}

func simulatorContentRootElement(from appRoot: UIElement, udid: String? = nil) -> UIElement? {
    if let scopedWindow = simulatorWindowElement(from: appRoot, udid: udid),
       let scopedContentRoot = findElementBySubrole(from: scopedWindow, subrole: "iOSContentGroup") {
        return scopedContentRoot
    }
    return findElementBySubrole(from: appRoot, subrole: "iOSContentGroup")
}

struct SimulatorAuxiliaryContainerCandidate {
    let element: UIElement
    let label: String
}

func elementsAreEqual(_ lhs: UIElement, _ rhs: UIElement) -> Bool {
    CFEqual(lhs, rhs)
}

func collectElements(
    in root: UIElement,
    matching predicate: (UIElement, Int) -> Bool,
    maxVisited: Int = 500,
    maxMatches: Int = 8
) -> [UIElement] {
    var stack: [(element: UIElement, depth: Int)] = [(root, 0)]
    var visited = 0
    var matches: [UIElement] = []

    while let current = stack.popLast() {
        if visited >= maxVisited || matches.count >= maxMatches {
            break
        }
        visited += 1

        if predicate(current.element, current.depth) {
            matches.append(current.element)
        }

        for child in Children(current.element).reversed() {
            stack.append((child, current.depth + 1))
        }
    }

    return matches
}

func collectElementsByRole(in root: UIElement, role: String, maxMatches: Int = 4) -> [UIElement] {
    collectElements(
        in: root,
        matching: { element, _ in
            let attrs = copyMultipleAttributes(element, [kAXRoleAttribute as String])
            if let ref = attrs[kAXRoleAttribute as String], let value = stringFromCFTypeRef(ref) {
                return value == role
            }
            return false
        },
        maxMatches: maxMatches
    )
}

func collectWideAuxiliaryGroups(in root: UIElement, contentRootFrame: CGRect? = nil, maxMatches: Int = 4) -> [UIElement] {
    guard let mainScreen = NSScreen.main else { return [] }
    let screenWidth = mainScreen.frame.width
    let screenHeight = mainScreen.frame.height
    let topThreshold = screenHeight * 0.20
    let bottomThreshold = screenHeight * 0.20

    return collectElements(
        in: root,
        matching: { element, _ in
            let attrs = copyMultipleAttributes(element, [kAXRoleAttribute as String, "AXFrame"])
            guard let ref = attrs[kAXRoleAttribute as String], let role = stringFromCFTypeRef(ref), role == "AXGroup" else {
                return false
            }
            guard let frameRef = attrs["AXFrame"], let frame = frameFromCFTypeRef(frameRef) else {
                return false
            }
            guard frame.width > screenWidth * 0.6 else {
                return false
            }
            guard frame.origin.y < topThreshold || frame.origin.y > screenHeight - bottomThreshold else {
                return false
            }
            if let contentRootFrame, contentRootFrame.contains(frame) {
                return false
            }
            return Children(element).count >= 2
        },
        maxMatches: maxMatches
    )
}

func simulatorAuxiliaryContainerCandidates(from appRoot: UIElement, excluding contentRoot: UIElement? = nil, udid: String? = nil) -> [SimulatorAuxiliaryContainerCandidate] {
    let scopeRoot = simulatorWindowElement(from: appRoot, udid: udid) ?? appRoot
    let contentRootFrame = contentRoot.flatMap(FrameAttribute)
    let roleCandidates: [(role: String, label: String)] = [
        ("AXTabGroup", "tab bar"),
        ("AXRadioGroup", "radio group"),
        ("AXSegmentedControl", "segmented control"),
        ("AXToolbar", "toolbar"),
    ]

    var candidates: [SimulatorAuxiliaryContainerCandidate] = []

    func appendCandidate(_ element: UIElement, label: String) {
        if let contentRoot, elementsAreEqual(element, contentRoot) {
            return
        }
        if let candidateFrame = FrameAttribute(element), let contentRootFrame, contentRootFrame.contains(candidateFrame) {
            return
        }
        if candidates.contains(where: { elementsAreEqual($0.element, element) }) {
            return
        }
        candidates.append(SimulatorAuxiliaryContainerCandidate(element: element, label: label))
    }

    for roleCandidate in roleCandidates {
        for element in collectElementsByRole(in: scopeRoot, role: roleCandidate.role) {
            appendCandidate(element, label: roleCandidate.label)
        }
    }

    for element in collectWideAuxiliaryGroups(in: scopeRoot, contentRootFrame: contentRootFrame) {
        appendCandidate(element, label: "auxiliary group")
    }

    return candidates
}

func simulatorAuxiliaryContainerLabels(from appRoot: UIElement, excluding contentRoot: UIElement? = nil, udid: String? = nil) -> [String] {
    simulatorAuxiliaryContainerCandidates(from: appRoot, excluding: contentRoot, udid: udid).map(\.label)
}

func formatSimulatorAuxiliaryContainerHint(_ labels: [String]) -> String? {
    var seen: Set<String> = []
    let uniqueLabels = labels.filter { label in
        let normalized = label.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty else { return false }
        return seen.insert(normalized).inserted
    }
    guard !uniqueLabels.isEmpty else {
        return nil
    }
    let containerList = uniqueLabels.joined(separator: ", ")
    return "[Hint] Simulator auxiliary containers outside iOSContentGroup: \(containerList). Use --all to inspect Simulator chrome UI."
}

func simulatorSelectorNotFoundMessage(selectorText: String, auxiliaryLabels: [String]) -> String {
    if let hint = formatSimulatorAuxiliaryContainerHint(auxiliaryLabels) {
        return "No accessibility element matched \(selectorText) in simulator app content or auxiliary containers. \(hint)"
    }
    return "No accessibility element matched \(selectorText) in simulator app content. Try --all to include Simulator chrome UI."
}

func findTabBarElement(in root: UIElement, simulatorUdid: String? = nil) -> UIElement? {
    // 1st pass: Look for AXTabGroup
    var stack: [UIElement] = [root]
    var visited = 0
    while let current = stack.popLast() {
        if visited > 500 { break }
        visited += 1

        let attrs = copyMultipleAttributes(current, [kAXRoleAttribute as String])
        if let ref = attrs[kAXRoleAttribute as String], let role = stringFromCFTypeRef(ref), role == "AXTabGroup" {
            return current
        }
        for child in Children(current).reversed() {
            stack.append(child)
        }
    }

    // 2nd pass: Look for AXRadioGroup
    stack = [root]
    visited = 0
    while let current = stack.popLast() {
        if visited > 500 { break }
        visited += 1

        let attrs = copyMultipleAttributes(current, [kAXRoleAttribute as String])
        if let ref = attrs[kAXRoleAttribute as String], let role = stringFromCFTypeRef(ref), role == "AXRadioGroup" {
            return current
        }
        for child in Children(current).reversed() {
            stack.append(child)
        }
    }

    // 3rd pass: Simulator-specific heuristic — look for a wide bottom group
    // inside iOSContentGroup. SwiftUI TabView on Simulator frequently exposes
    // the tab bar as AXGroup text="Tab Bar" rather than AXTabGroup.
    if let contentRoot = simulatorContentRootElement(from: root, udid: simulatorUdid),
       let contentFrame = FrameAttribute(contentRoot) {
        let bottomThresholdY = contentFrame.origin.y + contentFrame.height * 0.65
        stack = [contentRoot]
        visited = 0
        while let current = stack.popLast() {
            if visited > 800 { break }
            visited += 1

            let attrs = copyMultipleAttributes(current, [
                kAXRoleAttribute as String,
                "AXFrame",
                "AXLabel",
                kAXTitleAttribute as String,
                kAXDescriptionAttribute as String,
                kAXValueAttribute as String,
            ])

            if let ref = attrs[kAXRoleAttribute as String],
               let role = stringFromCFTypeRef(ref),
               role == "AXGroup",
               let frameRef = attrs["AXFrame"],
               let frame = frameFromCFTypeRef(frameRef) {
                let textCandidates = [
                    attrs["AXLabel"],
                    attrs[kAXTitleAttribute as String],
                    attrs[kAXDescriptionAttribute as String],
                    attrs[kAXValueAttribute as String],
                ].compactMap { $0 }.compactMap(stringFromCFTypeRef)

                let hasExplicitTabBarText = textCandidates.contains { candidate in
                    normalizeText(candidate).contains("tab bar")
                }

                let isWide = frame.width >= contentFrame.width * 0.60
                let isNearBottom = frame.origin.y >= bottomThresholdY && frame.maxY <= contentFrame.maxY + 8
                let plausibleBarHeight = frame.height >= 32 && frame.height <= 140

                if hasExplicitTabBarText || (isWide && isNearBottom && plausibleBarHeight) {
                    return current
                }
            }

            for child in Children(current).reversed() {
                stack.append(child)
            }
        }
    }

    // 4th pass: Generic heuristic — wide AXGroup in bottom 15% of screen
    guard let mainScreen = NSScreen.main else { return nil }
    let screenHeight = mainScreen.frame.height
    let bottomThreshold = screenHeight * 0.15

    stack = [root]
    visited = 0
    while let current = stack.popLast() {
        if visited > 500 { break }
        visited += 1

        let attrs = copyMultipleAttributes(current, [kAXRoleAttribute as String, "AXFrame"])
        if let ref = attrs[kAXRoleAttribute as String], let role = stringFromCFTypeRef(ref), role == "AXGroup" {
            if let frameRef = attrs["AXFrame"], let frame = frameFromCFTypeRef(frameRef) {
                // AXFrame uses screen coordinates with origin at top-left.
                // A tab bar near the bottom of the screen has a high y value.
                // We check if the element is wide (>60% of screen width) and in the bottom 15%.
                let screenWidth = mainScreen.frame.width
                if frame.width > screenWidth * 0.6 && frame.origin.y > screenHeight - bottomThreshold {
                    return current
                }
            }
        }
        for child in Children(current).reversed() {
            stack.append(child)
        }
    }

    return nil
}

// MARK: - Window / Coordinate Helpers

func windowBounds(for target: TargetApp) -> CGRect? {
    switch target {
    case .simulator(let udid):
        return simulatorWindowBounds(udid: udid)
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

func simulatorWindowBounds(udid: String? = nil) -> CGRect? {
    guard let windowInfo = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
        as? [[String: Any]] else {
        return nil
    }

    let windows = windowInfo.filter { info in
        let owner = info[kCGWindowOwnerName as String] as? String
        let layer = info[kCGWindowLayer as String] as? Int
        return owner == "Simulator" && (layer ?? 0) == 0
    }

    let normalizedDeviceName = simulatorDeviceName(for: udid).map(normalizeText)
    let preferredWindows: [[String: Any]]
    if let normalizedDeviceName {
        let matched = windows.filter { info in
            let title = (info[kCGWindowName as String] as? String) ?? ""
            return normalizeText(title).contains(normalizedDeviceName)
        }
        preferredWindows = matched.isEmpty ? windows : matched
    } else {
        preferredWindows = windows
    }

    var best: CGRect?
    var bestArea: CGFloat = 0
    for info in preferredWindows {
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
    case .simulator(let udid):
        return try pointInSimulatorWindow(x: x, y: y, udid: udid)
    case .macApp:
        guard let bounds = windowBounds(for: target) else {
            throw NativeError.commandFailed("Application window not found. Ensure the app is running and visible.")
        }
        let targetX = bounds.origin.x + CGFloat(x)
        let targetY = bounds.origin.y + CGFloat(y)
        return CGPoint(x: targetX, y: targetY)
    }
}

func pointInSimulatorWindow(x: Double, y: Double, udid: String? = nil) throws -> CGPoint {
    guard let bounds = simulatorWindowBounds(udid: udid) else {
        throw NativeError.commandFailed("Simulator window not found. Ensure Simulator is running and visible.")
    }
    let targetX = bounds.origin.x + CGFloat(x)
    let targetY = bounds.origin.y + CGFloat(y)
    return CGPoint(x: targetX, y: targetY)
}

// MARK: - Simulator Content Bounds

func simulatorContentBounds(udid: String? = nil) -> CGRect? {
    guard let appRoot = try? simulatorAccessibilityRootElement() else {
        return simulatorWindowBounds(udid: udid)
    }
    if let contentGroup = simulatorContentRootElement(from: appRoot, udid: udid),
       let frame = FrameAttribute(contentGroup) {
        return frame
    }
    return simulatorWindowBounds(udid: udid)
}

func pointInSimulatorContent(x: Double, y: Double, udid: String? = nil) throws -> CGPoint {
    guard let bounds = simulatorContentBounds(udid: udid) else {
        throw NativeError.commandFailed("Simulator content area not found. Ensure Simulator is running and visible.")
    }
    let targetX = bounds.origin.x + CGFloat(x)
    let targetY = bounds.origin.y + CGFloat(y)
    return CGPoint(x: targetX, y: targetY)
}

func pointForInput(x: Double, y: Double, for target: TargetApp) throws -> CGPoint {
    switch target {
    case .simulator(let udid):
        return try pointInSimulatorContent(x: x, y: y, udid: udid)
    case .macApp:
        return try pointInWindow(x: x, y: y, for: target)
    }
}

func simulatorScrollAnchorPoint(x: Double?, y: Double?, udid: String? = nil) throws -> CGPoint {
    if let x, let y {
        return CGPoint(x: x, y: y)
    }
    guard let bounds = simulatorContentBounds(udid: udid) else {
        throw NativeError.commandFailed("Simulator content area not found. Ensure Simulator is running and visible.")
    }
    return CGPoint(x: bounds.width * 0.5, y: bounds.height * 0.5)
}

func simulatorScrollDistance(deltaX: Double, deltaY: Double) -> CGSize {
    func component(for delta: Double) -> CGFloat {
        guard delta != 0 else { return 0 }
        let magnitude = min(max(abs(delta) * 18.0, 90.0), 320.0)
        let sign: CGFloat = delta < 0 ? -1 : 1
        return CGFloat(magnitude) * sign
    }

    return CGSize(width: component(for: deltaX), height: component(for: deltaY))
}

// MARK: - App Activation

func activateTarget(_ target: TargetApp) throws {
    switch target {
    case .simulator(let udid):
        try activateSimulator(udid: udid)
    case .macApp(let pid, _, _):
        let apps = NSWorkspace.shared.runningApplications.filter { $0.processIdentifier == pid }
        guard let app = apps.first else {
            throw NativeError.commandFailed("App with pid \(pid) not found.")
        }
        app.activate(options: [.activateAllWindows])
        // Poll for activation (max 1 second)
        let deadline = Date().addingTimeInterval(1.0)
        while Date() < deadline {
            if app.isActive { return }
            Thread.sleep(forTimeInterval: 0.05)
        }
        fputs("Warning: app activation may not have completed within timeout\n", stderr)
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
    usleep(20_000) // 20ms prevents some apps from ignoring instant clicks
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

func sendDrag(from start: CGPoint, to end: CGPoint, holdDuration: Double, moveDuration: Double?) {
    postMouseEvent(type: .leftMouseDown, point: start)
    if holdDuration > 0 {
        Thread.sleep(forTimeInterval: holdDuration)
    }

    // iOS drag & drop is often sensitive to the exact event sequence.
    // Use a slightly larger warmup move so SwiftUI DragGesture reliably
    // leaves the initial long-press state and enters an active drag.
    let warmupOffset: CGFloat = 4.0
    let warmupPoint = CGPoint(
        x: start.x + (end.x >= start.x ? warmupOffset : -warmupOffset),
        y: start.y + (end.y >= start.y ? warmupOffset : -warmupOffset)
    )
    postMouseEvent(type: .leftMouseDragged, point: warmupPoint)
    if let moveDuration {
        Thread.sleep(forTimeInterval: min(max(moveDuration / 24.0, 0.02), 0.06))
    } else {
        Thread.sleep(forTimeInterval: 0.05)
    }

    let steps = 18
    for step in 1...steps {
        let progress = CGFloat(step) / CGFloat(steps)
        let x = start.x + (end.x - start.x) * progress
        let y = start.y + (end.y - start.y) * progress
        postMouseEvent(type: .leftMouseDragged, point: CGPoint(x: x, y: y))
        if let moveDuration {
            Thread.sleep(forTimeInterval: moveDuration / Double(steps))
        } else {
            Thread.sleep(forTimeInterval: 0.02)
        }
    }
    Thread.sleep(forTimeInterval: 0.08)
    postMouseEvent(type: .leftMouseUp, point: end)
}

// MARK: - Keycode to CGEventFlags Mapping

let keycodeToFlag: [Int: CGEventFlags] = [
    0x37: .maskCommand,      // Left Command (55)
    0x36: .maskCommand,      // Right Command (54)
    0x38: .maskShift,        // Left Shift (56)
    0x3C: .maskShift,        // Right Shift (60)
    0x3A: .maskAlternate,    // Left Option (58)
    0x3D: .maskAlternate,    // Right Option (61)
    0x3B: .maskControl,      // Left Control (59)
    0x3E: .maskControl,      // Right Control (62)
    0x39: .maskAlphaShift,   // Caps Lock (57)
    0x3F: .maskSecondaryFn,  // Fn (63)
]

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

    // Convert keycodes to CGEventFlags
    var flags: CGEventFlags = []
    for modifier in modifiers {
        if let flag = keycodeToFlag[modifier] {
            flags.insert(flag)
        }
    }

    // Send modifier key-down events with flags (backward compat with apps that watch key events)
    for modifier in modifiers {
        let event = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(modifier), keyDown: true)
        event?.flags = flags
        event?.post(tap: .cghidEventTap)
    }
    usleep(30_000) // 30ms for modifiers to register

    // Ensure modifier key-up always happens (prevent stuck modifiers)
    defer {
        usleep(30_000)
        for modifier in modifiers.reversed() {
            let event = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(modifier), keyDown: false)
            event?.post(tap: .cghidEventTap)
        }
    }

    // Main key with flags set (critical: many apps only check flags, not key events)
    let keyDown = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(key), keyDown: true)
    keyDown?.flags = flags
    keyDown?.post(tap: .cghidEventTap)

    let keyUp = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(key), keyDown: false)
    keyUp?.flags = flags
    keyUp?.post(tap: .cghidEventTap)
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

// MARK: - Input Backend

enum InputBackend {
    case cgevent
    case indigoHID(IndigoHIDClient)
}

/// Resolve the input backend for the given target.
/// For simulators: try IndigoHID first, fall back to CGEvent.
/// For macOS apps: always use CGEvent.
/// Override with BAEPSAE_INPUT_BACKEND=indigo|cgevent|auto
func resolveInputBackend(for target: TargetApp) -> InputBackend {
    let envOverride = ProcessInfo.processInfo.environment["BAEPSAE_INPUT_BACKEND"]?.lowercased()

    switch target {
    case .macApp:
        return .cgevent
    case .simulator(let udid):
        if envOverride == "cgevent" {
            return .cgevent
        }

        if let client = IndigoHIDClient(udid: udid) {
            return .indigoHID(client)
        }

        if envOverride == "indigo" {
            fputs("Warning: IndigoHID requested but not available, falling back to CGEvent\n", stderr)
        }
        return .cgevent
    }
}

// MARK: - Misc Helpers

func defaultOutputPath(prefix: String, ext: String) -> String {
    let timestamp = ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "-")
    return "\(prefix)-\(timestamp).\(ext)"
}
