import AppKit
import CoreGraphics
import Foundation

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
