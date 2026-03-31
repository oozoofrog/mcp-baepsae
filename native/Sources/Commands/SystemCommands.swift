import AppKit
import CoreGraphics
import Foundation

private struct DoctorReport: Codable {
    struct Check: Codable {
        let ok: Bool
        let detail: String
    }

    let host: Check
    let parent: Check
    let nativeBinary: Check
    let simulator: Check
    let accessibility: Check
}

private func shellCapture(_ command: String, _ arguments: [String]) -> String? {
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

func handleListApps(_ parsed: ParsedOptions) throws -> Int32 {
    let apps = NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular }
    for app in apps {
        let bundleId = app.bundleIdentifier ?? "unknown"
        let name = app.localizedName ?? "unknown"
        let pid = app.processIdentifier
        print("\(bundleId) | \(name) | \(pid)")
    }
    return 0
}

func handleDoctor(_ parsed: ParsedOptions) throws -> Int32 {
    var systemInfo = utsname()
    uname(&systemInfo)
    let machine = withUnsafePointer(to: &systemInfo.machine) {
        $0.withMemoryRebound(to: CChar.self, capacity: 1) { String(cString: $0) }
    }
    let hostDetail = "\(ProcessInfo.processInfo.operatingSystemVersionString); arch=\(machine)"
    let parentPid = getppid()
    let parentDetail = shellCapture("/bin/ps", ["-p", String(parentPid), "-o", "pid=,ppid=,comm="]) ?? "unknown"

    let nativeBinaryDetail = CommandLine.arguments.first ?? "baepsae-native"
    let nativeBinaryOk = !nativeBinaryDetail.isEmpty

    let simulatorAppRunning = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.iphonesimulator").first != nil
    let bootedDevicesOutput = shellCapture("/usr/bin/xcrun", ["simctl", "list", "devices", "booted"])
    let bootedSimulatorAvailable = bootedDevicesOutput?.contains("(Booted)") ?? false
    let simulatorDetail: String
    if bootedSimulatorAvailable {
        simulatorDetail = simulatorAppRunning
            ? "Booted simulator available and Simulator app is running"
            : "Booted simulator available"
    } else if simulatorAppRunning {
        simulatorDetail = "Simulator app is running, but no booted simulator was detected"
    } else if bootedDevicesOutput == nil {
        simulatorDetail = "Could not query booted simulators via simctl"
    } else {
        simulatorDetail = "Simulator app is not running and no booted simulator was detected"
    }

    let accessibilityTrusted = AXIsProcessTrusted()
    let accessibilityDetail = accessibilityTrusted
        ? "Accessibility permission granted"
        : "Accessibility permission missing"

    let report = DoctorReport(
        host: .init(ok: true, detail: hostDetail),
        parent: .init(ok: !parentDetail.isEmpty, detail: parentDetail),
        nativeBinary: .init(ok: nativeBinaryOk, detail: nativeBinaryDetail),
        simulator: .init(ok: bootedSimulatorAvailable, detail: simulatorDetail),
        accessibility: .init(ok: accessibilityTrusted, detail: accessibilityDetail)
    )

    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    guard let data = try? encoder.encode(report), let json = String(data: data, encoding: .utf8) else {
        throw NativeError.commandFailed("Failed to encode doctor report.")
    }

    print("Doctor check completed.")
    print("host=\(report.host.ok ? "ok" : "warn") parent=\(report.parent.ok ? "ok" : "warn") native=\(report.nativeBinary.ok ? "ok" : "warn") simulator=\(report.simulator.ok ? "ok" : "warn") accessibility=\(report.accessibility.ok ? "ok" : "warn")")
    print("")
    print(json)
    return 0
}

func handleListWindows(_ parsed: ParsedOptions) throws -> Int32 {
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
}

func handleActivateApp(_ parsed: ParsedOptions) throws -> Int32 {
    let target = try resolveTarget(from: parsed)
    try activateTarget(target)
    switch target {
    case .macApp(_, let bundleId, let name):
        print("Activated: \(name ?? bundleId ?? "app")")
    case .simulator:
        print("Activated: Simulator")
    }
    return 0
}

func handleMenuAction(_ parsed: ParsedOptions) throws -> Int32 {
    let target = try resolveTarget(from: parsed)
    if case .simulator = target {
        throw NativeError.commandFailed("menu-action is only supported for macOS apps (use --bundle-id or --app-name).")
    }
    try ensureAccessibilityTrusted()
    try activateTarget(target)
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
    // Parse item path for submenu navigation (e.g. "New > File..." uses > separator)
    let itemPath = itemName.split(separator: ">").map {
        $0.trimmingCharacters(in: .whitespaces)
    }

    // Open the top-level menu
    AXUIElementPerformAction(menuItem, kAXPressAction as CFString)
    Thread.sleep(forTimeInterval: 0.2)

    var currentMenu = menuItem
    for (depth, pathComponent) in itemPath.enumerated() {
        let isLast = depth == itemPath.count - 1
        let menuChildren = Children(currentMenu)
        var foundItem: UIElement? = nil

        for child in menuChildren {
            let items = Children(child)
            for item in items {
                if let title = StringAttribute(item, kAXTitleAttribute as CFString),
                   normalizeText(title) == normalizeText(pathComponent) {
                    foundItem = item
                    break
                }
            }
            if foundItem != nil { break }
        }

        guard let targetItem = foundItem else {
            AXUIElementPerformAction(menuItem, "AXCancel" as CFString)
            throw NativeError.commandFailed("Menu item '\(pathComponent)' not found at depth \(depth + 1) in '\(menuName)'.")
        }

        if isLast {
            let pressStatus = AXUIElementPerformAction(targetItem, kAXPressAction as CFString)
            if pressStatus != .success {
                throw NativeError.commandFailed("Failed to activate menu item '\(pathComponent)' (status: \(pressStatus.rawValue)).")
            }
        } else {
            // Open submenu
            AXUIElementPerformAction(targetItem, kAXPressAction as CFString)
            Thread.sleep(forTimeInterval: 0.2)
            currentMenu = targetItem
        }
    }

    let fullPath = itemPath.joined(separator: " > ")
    print("Performed: \(menuName) > \(fullPath)")
    return 0
}

func handleGetFocusedApp(_ parsed: ParsedOptions) throws -> Int32 {
    guard let app = NSWorkspace.shared.frontmostApplication else {
        throw NativeError.commandFailed("No frontmost application found.")
    }
    let bundleId = app.bundleIdentifier ?? "unknown"
    let name = app.localizedName ?? "unknown"
    let pid = app.processIdentifier
    print("\(bundleId) | \(name) | \(pid)")
    return 0
}

func handleClipboard(_ parsed: ParsedOptions) throws -> Int32 {
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
}

func handleFocusWindow(_ parsed: ParsedOptions) throws -> Int32 {
    let target = try resolveTarget(from: parsed)
    if case .simulator = target {
        throw NativeError.commandFailed("focus-window is only supported for macOS apps.")
    }
    try ensureAccessibilityTrusted()
    try activateTarget(target)
    let appRoot = try accessibilityRootElement(for: target)
    let windows = Children(appRoot)

    let selected: UIElement
    if let indexStr = parsed.options["--index"], let idx = Int(indexStr) {
        guard idx < windows.count else {
            throw NativeError.invalidArguments("Window index \(idx) out of range (0..\(windows.count - 1)).")
        }
        selected = windows[idx]
    } else if let title = parsed.options["--title"] {
        guard let found = windows.first(where: {
            (StringAttribute($0, kAXTitleAttribute as CFString) ?? "")
                .localizedCaseInsensitiveContains(title)
        }) else {
            let available = windows.compactMap { StringAttribute($0, kAXTitleAttribute as CFString) }
            throw NativeError.commandFailed("No window matching '\(title)'. Available: \(available.joined(separator: ", "))")
        }
        selected = found
    } else {
        throw NativeError.invalidArguments("focus-window requires --index or --title.")
    }

    AXUIElementPerformAction(selected, kAXRaiseAction as CFString)
    let windowTitle = StringAttribute(selected, kAXTitleAttribute as CFString) ?? "(untitled)"
    print("Focused window: \(windowTitle)")
    return 0
}

func handleReadUIValue(_ parsed: ParsedOptions) throws -> Int32 {
    let target = try resolveTarget(from: parsed)
    try ensureAccessibilityTrusted()
    try activateTarget(target)
    let appRoot = try accessibilityRootElement(for: target)

    let attributeStr = parsed.options["--attribute"] ?? "value"
    let axAttribute: String
    switch attributeStr {
    case "value": axAttribute = kAXValueAttribute as String
    case "selectedText": axAttribute = "AXSelectedText"
    case "insertionPoint": axAttribute = "AXInsertionPointLineNumber"
    case "numberOfCharacters": axAttribute = "AXNumberOfCharacters"
    default:
        throw NativeError.invalidArguments("Unsupported attribute: \(attributeStr). Use: value, selectedText, insertionPoint, numberOfCharacters.")
    }

    // Find element by selector or use focused element
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

    var valueRef: CFTypeRef?
    let status = AXUIElementCopyAttributeValue(element, axAttribute as CFString, &valueRef)
    guard status == .success, let value = valueRef else {
        print("(no value)")
        return 0
    }

    if let str = value as? String {
        print(str)
    } else if let num = value as? NSNumber {
        print(num.stringValue)
    } else {
        print(String(describing: value))
    }
    return 0
}
