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
      baepsae-native describe-ui <TARGET> [--all] [--focus-id <ID>] [--root-element-id <ID>]
                     [--offset <N>] [--limit <M>] [--max-depth <N>]
                     [--role <ROLE>] [--visible-only] [--summary] [--output <path>]
      baepsae-native search-ui <TARGET> --query <text> [--max-depth <N>] [--role <ROLE>] [--visible-only]
      baepsae-native screenshot --udid <UDID> [--output <path>]
      baepsae-native record-video --udid <UDID> [--output <path>]
      baepsae-native tap <TARGET> [--id <ID> | --label <LABEL> | -x <X> -y <Y>] [--all] [--double] [--pre-delay <S>] [--post-delay <S>]
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
      baepsae-native drag-drop <TARGET> --start-x <X> --start-y <Y> --end-x <X> --end-y <Y> [--duration <S>] [--pre-delay <S>] [--post-delay <S>]
      baepsae-native menu-action --bundle-id <ID> | --app-name <NAME> --menu <MENU> --item <ITEM>
      baepsae-native get-focused-app
      baepsae-native clipboard --read | --write <TEXT>

    Where <TARGET> is one of:
      --udid <UDID>           iOS Simulator device UDID
      --bundle-id <ID>        macOS app bundle identifier
      --app-name <NAME>       macOS app name
    """
    print(help)
}

func runParsed(_ parsed: ParsedOptions) throws -> Int32 {
    switch parsed.command {
    case "help", "--help", "-h":
        printHelp()
        return 0

    case "--version":
        print("baepsae-native 3.2.1")
        return 0

    case "list-simulators":
        return try runProcess("/usr/bin/xcrun", ["simctl", "list", "devices", "available"])

    case "list-apps":
        return try handleListApps(parsed)

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

    default:
        throw NativeError.invalidArguments("Unhandled command: \(parsed.command)")
    }
}

do {
    let parsed = try parse(arguments: Array(CommandLine.arguments.dropFirst()))
    let status = try runParsed(parsed)
    exit(status)
} catch {
    let message: String
    if let nativeError = error as? NativeError {
        message = nativeError.description
    } else {
        message = error.localizedDescription
    }

    FileHandle.standardError.write(Data((message + "\n").utf8))
    if case NativeError.unsupported = error {
        exit(2)
    }
    exit(1)
}
