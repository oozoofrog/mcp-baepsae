import Foundation

// MARK: - IndigoHID Client

/// High-level API for sending HID events to an iOS Simulator via IndigoHID.
final class IndigoHIDClient {
    let udid: String
    let port: mach_port_t
    let loader: IndigoHIDLoader
    let coords: IndigoHIDCoordinates

    /// Initialize with a simulator UDID.
    /// Returns nil if IndigoHID is not available or the Mach port cannot be resolved.
    init?(udid: String) {
        let loader = IndigoHIDLoader.shared
        guard loader.isAvailable else { return nil }
        guard let port = resolveIndigoHIDPort(udid: udid) else { return nil }

        self.udid = udid
        self.port = port
        self.loader = loader

        let screenSize = resolveSimulatorScreenSize(udid: udid)
        self.coords = IndigoHIDCoordinates(screenWidth: screenSize.width, screenHeight: screenSize.height)
    }

    // MARK: - Touch

    /// Send a single tap at the given pixel coordinates.
    func tap(x: Double, y: Double) -> Bool {
        let (nx, ny) = coords.normalize(x: x, y: y)

        // Touch began
        guard let beginMsg = loader.createTouchMessage(phase: .began, x: nx, y: ny) else { return false }
        guard sendIndigoHIDMessage(beginMsg, to: port) else { return false }

        Thread.sleep(forTimeInterval: 0.05)

        // Touch ended
        guard let endMsg = loader.createTouchMessage(phase: .ended, x: nx, y: ny) else { return false }
        return sendIndigoHIDMessage(endMsg, to: port)
    }

    /// Send a swipe gesture from start to end coordinates (in pixels).
    func swipe(fromX: Double, fromY: Double, toX: Double, toY: Double, duration: Double? = nil, steps: Int = 10) -> Bool {
        let (sx, sy) = coords.normalize(x: fromX, y: fromY)
        let (ex, ey) = coords.normalize(x: toX, y: toY)

        // Touch began
        guard let beginMsg = loader.createTouchMessage(phase: .began, x: sx, y: sy) else { return false }
        guard sendIndigoHIDMessage(beginMsg, to: port) else { return false }

        let stepDuration = (duration ?? 0.3) / Double(steps)

        // Touch moved sequence
        for step in 1...steps {
            let progress = Double(step) / Double(steps)
            let cx = sx + (ex - sx) * progress
            let cy = sy + (ey - sy) * progress
            guard let moveMsg = loader.createTouchMessage(phase: .moved, x: cx, y: cy) else { return false }
            guard sendIndigoHIDMessage(moveMsg, to: port) else { return false }
            Thread.sleep(forTimeInterval: stepDuration)
        }

        // Touch ended
        guard let endMsg = loader.createTouchMessage(phase: .ended, x: ex, y: ey) else { return false }
        return sendIndigoHIDMessage(endMsg, to: port)
    }

    /// Send a drag gesture (long press + move + release).
    func drag(fromX: Double, fromY: Double, toX: Double, toY: Double, holdDuration: Double = 0.5, moveDuration: Double? = nil) -> Bool {
        let (sx, sy) = coords.normalize(x: fromX, y: fromY)
        let (ex, ey) = coords.normalize(x: toX, y: toY)

        // Touch began (long press)
        guard let beginMsg = loader.createTouchMessage(phase: .began, x: sx, y: sy) else { return false }
        guard sendIndigoHIDMessage(beginMsg, to: port) else { return false }

        if holdDuration > 0 {
            Thread.sleep(forTimeInterval: holdDuration)
        }

        // Move sequence
        let steps = 10
        let stepDuration = (moveDuration ?? 0.3) / Double(steps)
        for step in 1...steps {
            let progress = Double(step) / Double(steps)
            let cx = sx + (ex - sx) * progress
            let cy = sy + (ey - sy) * progress
            guard let moveMsg = loader.createTouchMessage(phase: .moved, x: cx, y: cy) else { return false }
            guard sendIndigoHIDMessage(moveMsg, to: port) else { return false }
            Thread.sleep(forTimeInterval: stepDuration)
        }

        // Touch ended
        guard let endMsg = loader.createTouchMessage(phase: .ended, x: ex, y: ey) else { return false }
        return sendIndigoHIDMessage(endMsg, to: port)
    }

    /// Type text using HID keyboard events.
    /// This bypasses iOS autocomplete by sending raw HID keycodes.
    func typeText(_ text: String) -> Bool {
        let usagePage: UInt32 = 0x07  // Keyboard/Keypad page

        for char in text {
            guard let usage = hidUsageForCharacter(char) else { continue }

            let needsShift = characterNeedsShift(char)

            if needsShift {
                // Shift down (usage 0xE1 = Left Shift)
                if let shiftDown = loader.createKeyboardMessage(usagePage: usagePage, usage: 0xE1, operation: .keyDown) {
                    _ = sendIndigoHIDMessage(shiftDown, to: port)
                }
            }

            // Key down
            if let keyDown = loader.createKeyboardMessage(usagePage: usagePage, usage: usage, operation: .keyDown) {
                _ = sendIndigoHIDMessage(keyDown, to: port)
            }
            Thread.sleep(forTimeInterval: 0.02)

            // Key up
            if let keyUp = loader.createKeyboardMessage(usagePage: usagePage, usage: usage, operation: .keyUp) {
                _ = sendIndigoHIDMessage(keyUp, to: port)
            }

            if needsShift {
                // Shift up
                if let shiftUp = loader.createKeyboardMessage(usagePage: usagePage, usage: 0xE1, operation: .keyUp) {
                    _ = sendIndigoHIDMessage(shiftUp, to: port)
                }
            }

            Thread.sleep(forTimeInterval: 0.02)
        }

        return true
    }
}

// MARK: - HID Usage Mapping

/// Map a character to its USB HID Usage ID (usage page 0x07).
private func hidUsageForCharacter(_ char: Character) -> UInt32? {
    let lower = char.lowercased().first ?? char
    switch lower {
    case "a": return 0x04
    case "b": return 0x05
    case "c": return 0x06
    case "d": return 0x07
    case "e": return 0x08
    case "f": return 0x09
    case "g": return 0x0A
    case "h": return 0x0B
    case "i": return 0x0C
    case "j": return 0x0D
    case "k": return 0x0E
    case "l": return 0x0F
    case "m": return 0x10
    case "n": return 0x11
    case "o": return 0x12
    case "p": return 0x13
    case "q": return 0x14
    case "r": return 0x15
    case "s": return 0x16
    case "t": return 0x17
    case "u": return 0x18
    case "v": return 0x19
    case "w": return 0x1A
    case "x": return 0x1B
    case "y": return 0x1C
    case "z": return 0x1D
    case "1", "!": return 0x1E
    case "2", "@": return 0x1F
    case "3", "#": return 0x20
    case "4", "$": return 0x21
    case "5", "%": return 0x22
    case "6", "^": return 0x23
    case "7", "&": return 0x24
    case "8", "*": return 0x25
    case "9", "(": return 0x26
    case "0", ")": return 0x27
    case "\n": return 0x28  // Return
    case "\t": return 0x2B  // Tab
    case " ": return 0x2C   // Space
    case "-", "_": return 0x2D
    case "=", "+": return 0x2E
    case "[", "{": return 0x2F
    case "]", "}": return 0x30
    case "\\", "|": return 0x31
    case ";", ":": return 0x33
    case "'", "\"": return 0x34
    case "`", "~": return 0x35
    case ",", "<": return 0x36
    case ".", ">": return 0x37
    case "/", "?": return 0x38
    default: return nil
    }
}

/// Check if a character requires the Shift modifier.
private func characterNeedsShift(_ char: Character) -> Bool {
    let shiftChars: Set<Character> = [
        "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
        "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
        "!", "@", "#", "$", "%", "^", "&", "*", "(", ")",
        "_", "+", "{", "}", "|", ":", "\"", "~", "<", ">", "?"
    ]
    return shiftChars.contains(char)
}
