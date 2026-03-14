import CoreGraphics
import Foundation

// MARK: - Coordinate Normalization

/// Normalizes pixel coordinates to 0-1 ratio for IndigoHID.
/// IndigoHID expects coordinates as fractions of the screen dimensions.
struct IndigoHIDCoordinates {
    let screenWidth: Double
    let screenHeight: Double

    init(screenWidth: Double, screenHeight: Double) {
        self.screenWidth = max(1, screenWidth)
        self.screenHeight = max(1, screenHeight)
    }

    /// Convert point coordinates (pixels) to normalized 0-1 ratio.
    /// Origin is top-left.
    func normalize(x: Double, y: Double) -> (x: Double, y: Double) {
        return (x / screenWidth, y / screenHeight)
    }

    /// Create a touch point from pixel coordinates.
    func touchPoint(x: Double, y: Double, phase: IndigoHIDTouchPhase, finger: UInt32 = 1) -> IndigoHIDTouchPoint {
        let (nx, ny) = normalize(x: x, y: y)
        return IndigoHIDTouchPoint(x: nx, y: ny, phase: phase, finger: finger)
    }
}

/// Resolve screen dimensions for the given simulator UDID.
/// Falls back to common iPhone dimensions if detection fails.
func resolveSimulatorScreenSize(udid: String) -> (width: Double, height: Double) {
    // Try to get screen size from simctl
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/xcrun")
    process.arguments = ["simctl", "list", "devices", "-j"]

    let pipe = Pipe()
    process.standardOutput = pipe
    process.standardError = FileHandle.nullDevice

    do {
        try process.run()
        process.waitUntilExit()

        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let devices = json["devices"] as? [String: [[String: Any]]] {
            for (_, deviceList) in devices {
                for device in deviceList {
                    if let deviceUdid = device["udid"] as? String, deviceUdid == udid {
                        // Try to infer from device type
                        if let deviceType = device["deviceTypeIdentifier"] as? String {
                            if deviceType.contains("iPhone-16") || deviceType.contains("iPhone-15") {
                                return (393, 852)
                            }
                            if deviceType.contains("iPhone-SE") {
                                return (375, 667)
                            }
                            if deviceType.contains("iPad") {
                                return (1024, 1366)
                            }
                        }
                    }
                }
            }
        }
    } catch {
        // Fall through to default
    }

    // Default: iPhone 15/16 logical resolution
    return (393, 852)
}
