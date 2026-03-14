import Foundation

// MARK: - Symbol Types

// Function pointer types matching SimulatorKit's IndigoHID API
typealias IndigoHIDMessageForButtonFn = @convention(c) (
    UInt32,  // button type
    UInt32,  // state (1=down, 2=up)
    UInt64   // timestamp
) -> Unmanaged<CFData>?

typealias IndigoHIDMessageForKeyboardArbitraryFn = @convention(c) (
    UInt32,  // usage page
    UInt32,  // usage (key code)
    UInt32,  // key operation (1=down, 2=up)
    UInt64   // timestamp
) -> Unmanaged<CFData>?

typealias IndigoHIDMessageForMouseNSEventFn = @convention(c) (
    UInt32,  // touch phase
    Double,  // x (0-1 normalized)
    Double,  // y (0-1 normalized)
    UInt32,  // finger index
    Double,  // pressure
    Double,  // twist
    Double,  // major radius
    Double,  // minor radius
    UInt64   // timestamp
) -> Unmanaged<CFData>?

// MARK: - IndigoHID Loader

/// Loads IndigoHID symbols from SimulatorKit.framework via dlopen/dlsym.
/// This is a singleton — symbol loading happens once.
final class IndigoHIDLoader: @unchecked Sendable {
    static let shared = IndigoHIDLoader()

    let buttonFn: IndigoHIDMessageForButtonFn?
    let keyboardFn: IndigoHIDMessageForKeyboardArbitraryFn?
    let mouseFn: IndigoHIDMessageForMouseNSEventFn?

    /// Whether all required symbols were loaded successfully.
    var isAvailable: Bool {
        return buttonFn != nil && keyboardFn != nil && mouseFn != nil
    }

    private init() {
        let frameworkPath = "/Library/Developer/PrivateFrameworks/CoreSimulator.framework/Versions/A/Frameworks/SimulatorKit.framework/SimulatorKit"
        let alternativePath = "/Applications/Xcode.app/Contents/Developer/Platforms/iPhoneOS.platform/Library/Developer/CoreSimulator/Profiles/Runtimes/iOS.simruntime/Contents/Resources/RuntimeRoot/System/Library/PrivateFrameworks/SimulatorKit.framework/SimulatorKit"

        var handle = dlopen(frameworkPath, RTLD_LAZY)
        if handle == nil {
            handle = dlopen(alternativePath, RTLD_LAZY)
        }

        guard let handle else {
            self.buttonFn = nil
            self.keyboardFn = nil
            self.mouseFn = nil
            return
        }

        if let sym = dlsym(handle, "IndigoHIDMessageForButton") {
            self.buttonFn = unsafeBitCast(sym, to: IndigoHIDMessageForButtonFn.self)
        } else {
            self.buttonFn = nil
        }

        if let sym = dlsym(handle, "IndigoHIDMessageForKeyboardArbitrary") {
            self.keyboardFn = unsafeBitCast(sym, to: IndigoHIDMessageForKeyboardArbitraryFn.self)
        } else {
            self.keyboardFn = nil
        }

        if let sym = dlsym(handle, "IndigoHIDMessageForMouseNSEvent") {
            self.mouseFn = unsafeBitCast(sym, to: IndigoHIDMessageForMouseNSEventFn.self)
        } else {
            self.mouseFn = nil
        }
    }

    /// Create a touch event message.
    func createTouchMessage(phase: IndigoHIDTouchPhase, x: Double, y: Double, finger: UInt32 = 1) -> CFData? {
        guard let fn = mouseFn else { return nil }
        let timestamp = mach_absolute_time()
        return fn(phase.rawValue, x, y, finger, 1.0, 0.0, 5.0, 5.0, timestamp)?.takeRetainedValue()
    }

    /// Create a button event message.
    func createButtonMessage(button: IndigoHIDButtonEventType, state: UInt32) -> CFData? {
        guard let fn = buttonFn else { return nil }
        let timestamp = mach_absolute_time()
        return fn(button.rawValue, state, timestamp)?.takeRetainedValue()
    }

    /// Create a keyboard event message.
    func createKeyboardMessage(usagePage: UInt32, usage: UInt32, operation: IndigoHIDKeyOperation) -> CFData? {
        guard let fn = keyboardFn else { return nil }
        let timestamp = mach_absolute_time()
        return fn(usagePage, usage, operation.rawValue, timestamp)?.takeRetainedValue()
    }
}
