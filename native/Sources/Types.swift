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

enum NativeErrorCode: String {
    case invalidArguments = "invalid_arguments"
    case unsupported = "unsupported"
    case commandFailed = "command_failed"
}

enum NativeErrorCategory: String {
    case validation
    case execution
    case environment
    case permission
    case unsupported
    case availability
    case timeout
    case unknown
}

struct StructuredNativeError {
    let code: String
    let category: NativeErrorCategory
    let retryable: Bool
    let source: String
    let message: String
    let nativeCode: NativeErrorCode
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
