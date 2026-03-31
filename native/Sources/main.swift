import AppKit
import CoreGraphics
import Foundation

func printHelp() {
    let help = """
    baepsae-native

    Target: use --udid for simulator, --bundle-id or --app-name for macOS app

    Usage:
      baepsae-native help
      baepsae-native --version
      baepsae-native list-simulators
      baepsae-native list-apps
      baepsae-native doctor
      baepsae-native describe-ui <TARGET> [--all] [--focus-id <ID>] [--root-element-id <ID>]
                     [--offset <N>] [--limit <M>] [--max-depth <N>]
                     [--role <ROLE>] [--visible-only] [--summary] [--output <path>]
      baepsae-native search-ui <TARGET> --query <text> [--max-depth <N>] [--role <ROLE>] [--visible-only]
      baepsae-native screenshot --udid <UDID> [--output <path>]
      baepsae-native record-video --udid <UDID> [--output <path>]
      baepsae-native tap <TARGET> [--id <ID> | --label <LABEL> | -x <X> -y <Y>] [--all] [--double] [--pre-delay <S>] [--post-delay <S>]
      baepsae-native tap-tab <TARGET> --index <N> [--tab-count <N>] [--pre-delay <S>] [--post-delay <S>]
      baepsae-native type <TARGET> [<TEXT> | --stdin | --file <PATH>]
      baepsae-native swipe <TARGET> --start-x <X> --start-y <Y> --end-x <X> --end-y <Y> [--duration <S>] [--pre-delay <S>] [--post-delay <S>]
      baepsae-native button --udid <UDID> <TYPE> [--duration <S>]
      baepsae-native key <TARGET> <KEYCODE> [--duration <S>]
      baepsae-native key-sequence <TARGET> --keycodes <CODE,...> [--delay <S>]
      baepsae-native key-combo <TARGET> --modifiers <CODE,...> --key <CODE>
      baepsae-native touch <TARGET> -x <X> -y <Y> [--down] [--up] [--delay <S>]
      baepsae-native gesture --udid <UDID> <PRESET> [--screen-width <W>] [--screen-height <H>] [--duration <S>]
      baepsae-native stream-video --udid <UDID> [--output <PATH>] [--duration <S>]
      baepsae-native list-windows <TARGET>
      baepsae-native activate-app <TARGET>
      baepsae-native screenshot-app <TARGET> [--output <path>]
      baepsae-native right-click <TARGET> [--id <ID> | --label <LABEL> | -x <X> -y <Y>] [--all] [--pre-delay <S>] [--post-delay <S>]
      baepsae-native scroll <TARGET> [--delta-x <N>] [--delta-y <N>] [-x <X> -y <Y>]
      baepsae-native drag-drop <TARGET> --start-x <X> --start-y <Y> --end-x <X> --end-y <Y> [--duration <S>] [--hold-duration <S>] [--pre-delay <S>] [--post-delay <S>]
      baepsae-native menu-action --bundle-id <ID> | --app-name <NAME> --menu <MENU> --item <ITEM>
      baepsae-native get-focused-app
      baepsae-native clipboard --read | --write <TEXT>
      baepsae-native list-input-sources
      baepsae-native input-source [<SOURCE_ID>]
      baepsae-native focus-window <TARGET> [--index <N> | --title <TEXT>]
      baepsae-native read-ui-value <TARGET> [--id <ID> | --label <LABEL>] [--attribute <value|selectedText|insertionPoint|numberOfCharacters>]

    Where <TARGET> is one of:
      --udid <UDID>           iOS Simulator device UDID
      --bundle-id <ID>        macOS app bundle identifier
      --app-name <NAME>       macOS app name
    """
    print(help)
}

func structuredNativeError(for error: Error) -> StructuredNativeError {
    if let nativeError = error as? NativeError {
        switch nativeError {
        case .invalidArguments(let message):
            return StructuredNativeError(code: "validation.native.invalid_arguments", category: .validation, retryable: false, source: "native", message: message, nativeCode: .invalidArguments)
        case .unsupported(let message):
            return StructuredNativeError(code: "unsupported.native.command", category: .unsupported, retryable: false, source: "native", message: message, nativeCode: .unsupported)
        case .commandFailed(let message):
            let category: NativeErrorCategory
            let retryable: Bool
            let code: String
            if message.contains("Permission Denied") || message.contains("Accessibility access is required") {
                category = .permission
                retryable = false
                code = "permission.accessibility_required"
            } else if message.contains("not running") || message.contains("not found") {
                category = .availability
                retryable = true
                code = "availability.target_unavailable"
            } else {
                category = .execution
                retryable = true
                code = "execution.native_command_failed"
            }
            return StructuredNativeError(code: code, category: category, retryable: retryable, source: "native", message: message, nativeCode: .commandFailed)
        }
    }

    return StructuredNativeError(code: "runtime.unexpected", category: .unknown, retryable: false, source: "runtime", message: error.localizedDescription, nativeCode: .commandFailed)
}

struct StructuredErrorPayload: Codable {
    let code: String
    let category: String
    let retryable: Bool
    let source: String
    let message: String
    let nativeCode: String
}

func runParsed(_ parsed: ParsedOptions) throws -> Int32 {
    switch parsed.command {
    case "help", "--help", "-h":
        printHelp()
        return 0

    case "--version":
        print("baepsae-native \(BAEPSAE_VERSION)")
        return 0

    case "list-simulators":
        return try runProcess("/usr/bin/xcrun", ["simctl", "list", "devices", "available"])

    case "list-apps":
        return try handleListApps(parsed)

    case "doctor":
        return try handleDoctor(parsed)

    case "screenshot":
        return try handleScreenshot(parsed)

    case "record-video":
        return try handleRecordVideo(parsed)

    case "describe-ui":
        return try handleDescribeUI(parsed)

    case "search-ui":
        return try handleSearchUI(parsed)

    case "tap":
        return try handleTap(parsed)

    case "tap-tab":
        return try handleTapTab(parsed)

    case "type":
        return try handleType(parsed)

    case "swipe":
        return try handleSwipe(parsed)

    case "button":
        return try handleButton(parsed)

    case "key":
        return try handleKey(parsed)

    case "key-sequence":
        return try handleKeySequence(parsed)

    case "key-combo":
        return try handleKeyCombo(parsed)

    case "touch":
        return try handleTouch(parsed)

    case "gesture":
        return try handleGesture(parsed)

    case "stream-video":
        return try handleStreamVideo(parsed)

    case "list-windows":
        return try handleListWindows(parsed)

    case "activate-app":
        return try handleActivateApp(parsed)

    case "screenshot-app":
        return try handleScreenshotApp(parsed)

    case "right-click":
        return try handleRightClick(parsed)

    case "scroll":
        return try handleScroll(parsed)

    case "drag-drop":
        return try handleDragDrop(parsed)

    case "menu-action":
        return try handleMenuAction(parsed)

    case "get-focused-app":
        return try handleGetFocusedApp(parsed)

    case "clipboard":
        return try handleClipboard(parsed)

    case "list-input-sources":
        return try handleListInputSources(parsed)

    case "input-source":
        return try handleInputSource(parsed)

    case "focus-window":
        return try handleFocusWindow(parsed)

    case "read-ui-value":
        return try handleReadUIValue(parsed)

    default:
        throw NativeError.invalidArguments("Unhandled command: \(parsed.command)")
    }
}

do {
    let parsed = try parse(arguments: Array(CommandLine.arguments.dropFirst()))
    let status = try runParsed(parsed)
    exit(status)
} catch {
    let structured = structuredNativeError(for: error)
    if let data = try? JSONEncoder().encode(StructuredErrorPayload(code: structured.code, category: structured.category.rawValue, retryable: structured.retryable, source: structured.source, message: structured.message, nativeCode: structured.nativeCode.rawValue)) {
        FileHandle.standardError.write(Data("BAEPSAE_ERROR ".utf8))
        FileHandle.standardError.write(data)
        FileHandle.standardError.write(Data("\n".utf8))
    }
    FileHandle.standardError.write(Data((structured.message + "\n").utf8))
    if case NativeError.unsupported = error {
        exit(2)
    }
    exit(1)
}
