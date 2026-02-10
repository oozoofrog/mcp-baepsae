import AppKit
import CoreGraphics
import Foundation

func handleScreenshot(_ parsed: ParsedOptions) throws -> Int32 {
    let udid = try requiredOption("--udid", from: parsed)
    let output = parsed.options["--output"] ?? defaultOutputPath(prefix: "simulator-screenshot", ext: "png")
    return try runProcess("/usr/bin/xcrun", ["simctl", "io", udid, "screenshot", output])
}

func handleRecordVideo(_ parsed: ParsedOptions) throws -> Int32 {
    let udid = try requiredOption("--udid", from: parsed)
    let output = parsed.options["--output"] ?? defaultOutputPath(prefix: "simulator-recording", ext: "mov")
    return try runProcess("/usr/bin/xcrun", ["simctl", "io", udid, "recordVideo", "--force", output])
}

func handleScreenshotApp(_ parsed: ParsedOptions) throws -> Int32 {
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
}

func handleStreamVideo(_ parsed: ParsedOptions) throws -> Int32 {
    let udid = try requiredOption("--udid", from: parsed)
    let output = parsed.options["--output"] ?? defaultOutputPath(prefix: "simulator-stream", ext: "mov")
    let duration = try optionalDoubleOption("--duration", from: parsed) ?? 10
    let args = ["simctl", "io", udid, "recordVideo", "--force", output]
    return try runProcessWithTimeout("/usr/bin/xcrun", args, timeoutSeconds: max(1, duration))
}
