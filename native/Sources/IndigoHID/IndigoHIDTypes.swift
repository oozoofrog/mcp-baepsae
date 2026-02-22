import Foundation

// MARK: - Touch Phase

enum IndigoHIDTouchPhase: UInt32 {
    case began = 1
    case moved = 2
    case ended = 4
}

// MARK: - Button Event Type

enum IndigoHIDButtonEventType: UInt32 {
    case home = 1
    case lock = 2
    case siri = 3
    case applePay = 4
}

// MARK: - Key Operation

enum IndigoHIDKeyOperation: UInt32 {
    case keyDown = 1
    case keyUp = 2
}

// MARK: - Touch Point

struct IndigoHIDTouchPoint {
    let x: Double  // 0.0 - 1.0 normalized
    let y: Double  // 0.0 - 1.0 normalized
    let phase: IndigoHIDTouchPhase
    let finger: UInt32

    init(x: Double, y: Double, phase: IndigoHIDTouchPhase, finger: UInt32 = 1) {
        self.x = max(0, min(1, x))
        self.y = max(0, min(1, y))
        self.phase = phase
        self.finger = finger
    }
}
