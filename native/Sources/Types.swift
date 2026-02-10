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

struct DescribeOptions {
    var maxDepth: Int = Int.max
    var offset: Int = 0
    var limit: Int = Int.max
    var roleFilter: String? = nil
    var visibleOnly: Bool = false
    var screenBounds: CGRect? = nil
    var summary: Bool = false
}

struct SearchOptions {
    var maxDepth: Int = Int.max
    var roleFilter: String? = nil
    var visibleOnly: Bool = false
    var screenBounds: CGRect? = nil
}
