import AppKit
import CoreGraphics
import Foundation

func handleKey(_ parsed: ParsedOptions) throws -> Int32 {
    let target = try resolveTarget(from: parsed)
    try ensureAccessibilityTrusted()
    try activateTarget(target)
    guard let keyString = parsed.positionals.first, let keyCode = Int(keyString) else {
        throw NativeError.invalidArguments("key requires a numeric keycode.")
    }
    let duration = try optionalDoubleOption("--duration", from: parsed)
    sendKeyPress(keyCode: keyCode, duration: duration)
    return 0
}

func handleKeySequence(_ parsed: ParsedOptions) throws -> Int32 {
    let target = try resolveTarget(from: parsed)
    try ensureAccessibilityTrusted()
    try activateTarget(target)
    guard let raw = parsed.options["--keycodes"] else {
        throw NativeError.invalidArguments("key-sequence requires --keycodes.")
    }
    let keycodes = try parseCommaSeparatedInts(raw, label: "keycodes")
    let delay = try optionalDoubleOption("--delay", from: parsed) ?? 0
    for keyCode in keycodes {
        sendKeyPress(keyCode: keyCode, duration: nil)
        if delay > 0 {
            Thread.sleep(forTimeInterval: delay)
        }
    }
    return 0
}

func handleKeyCombo(_ parsed: ParsedOptions) throws -> Int32 {
    let target = try resolveTarget(from: parsed)
    try ensureAccessibilityTrusted()
    try activateTarget(target)
    guard let rawModifiers = parsed.options["--modifiers"],
          let rawKey = parsed.options["--key"],
          let key = Int(rawKey) else {
        throw NativeError.invalidArguments("key-combo requires --modifiers and --key.")
    }
    let modifiers = try parseCommaSeparatedInts(rawModifiers, label: "modifiers")
    sendKeyCombo(modifiers: modifiers, key: key)
    return 0
}

func handleButton(_ parsed: ParsedOptions) throws -> Int32 {
    let target = try resolveTarget(from: parsed)
    let udid = try requireSimulatorUdid(target)
    try ensureAccessibilityTrusted()
    try activateSimulator(udid: udid)
    guard let buttonType = parsed.positionals.first else {
        throw NativeError.invalidArguments("button requires a button type.")
    }
    let holdDuration = try optionalDoubleOption("--duration", from: parsed)
    switch buttonType {
    case "home":
        sendKeyCombo(modifiers: [55, 56], key: 4)
    case "lock", "side-button":
        sendKeyCombo(modifiers: [55], key: 37)
    case "siri":
        sendKeyCombo(modifiers: [55, 56], key: 1)
    case "apple-pay":
        sendKeyCombo(modifiers: [55, 56], key: 35)
    default:
        throw NativeError.invalidArguments("Unsupported button type: \(buttonType)")
    }
    if let holdDuration, holdDuration > 0 {
        Thread.sleep(forTimeInterval: holdDuration)
    }
    return 0
}

func handleTouch(_ parsed: ParsedOptions) throws -> Int32 {
    let target = try resolveTarget(from: parsed)
    try ensureAccessibilityTrusted()
    let xRaw = parsed.options["-x"]
    let yRaw = parsed.options["-y"]
    guard let xRaw, let yRaw, let x = Double(xRaw), let y = Double(yRaw) else {
        throw NativeError.invalidArguments("touch requires -x and -y coordinates.")
    }
    let delay = try optionalDoubleOption("--delay", from: parsed) ?? 0
    try activateTarget(target)
    let point = try pointInWindow(x: x, y: y, for: target)
    let downRequested = parsed.flags.contains("--down")
    let upRequested = parsed.flags.contains("--up")
    if !downRequested && !upRequested {
        postMouseEvent(type: .leftMouseDown, point: point)
        if delay > 0 {
            Thread.sleep(forTimeInterval: delay)
        }
        postMouseEvent(type: .leftMouseUp, point: point)
    } else {
        if downRequested {
            postMouseEvent(type: .leftMouseDown, point: point)
        }
        if delay > 0 {
            Thread.sleep(forTimeInterval: delay)
        }
        if upRequested {
            postMouseEvent(type: .leftMouseUp, point: point)
        }
    }
    return 0
}

func handleGesture(_ parsed: ParsedOptions) throws -> Int32 {
    let target = try resolveTarget(from: parsed)
    try requireSimulatorOnly(target)
    guard let preset = parsed.positionals.first else {
        throw NativeError.invalidArguments("gesture requires a preset name.")
    }
    let preDelay = try optionalDoubleOption("--pre-delay", from: parsed) ?? 0
    let postDelay = try optionalDoubleOption("--post-delay", from: parsed) ?? 0
    let duration = try optionalDoubleOption("--duration", from: parsed)
    let screenWidth = try optionalDoubleOption("--screen-width", from: parsed)
    let screenHeight = try optionalDoubleOption("--screen-height", from: parsed)
    try ensureAccessibilityTrusted()
    try activateTarget(target)
    let bounds = simulatorWindowBounds()
    let width = screenWidth ?? Double(bounds?.width ?? 0)
    let height = screenHeight ?? Double(bounds?.height ?? 0)
    if width <= 0 || height <= 0 {
        throw NativeError.commandFailed("Unable to determine simulator window size; provide screenWidth/screenHeight.")
    }
    let start: CGPoint
    let end: CGPoint
    switch preset {
    case "scroll-up":
        start = try pointInSimulatorWindow(x: width * 0.5, y: height * 0.7)
        end = try pointInSimulatorWindow(x: width * 0.5, y: height * 0.3)
    case "scroll-down":
        start = try pointInSimulatorWindow(x: width * 0.5, y: height * 0.3)
        end = try pointInSimulatorWindow(x: width * 0.5, y: height * 0.7)
    case "scroll-left":
        start = try pointInSimulatorWindow(x: width * 0.7, y: height * 0.5)
        end = try pointInSimulatorWindow(x: width * 0.3, y: height * 0.5)
    case "scroll-right":
        start = try pointInSimulatorWindow(x: width * 0.3, y: height * 0.5)
        end = try pointInSimulatorWindow(x: width * 0.7, y: height * 0.5)
    case "swipe-from-left-edge":
        start = try pointInSimulatorWindow(x: width * 0.05, y: height * 0.5)
        end = try pointInSimulatorWindow(x: width * 0.6, y: height * 0.5)
    case "swipe-from-right-edge":
        start = try pointInSimulatorWindow(x: width * 0.95, y: height * 0.5)
        end = try pointInSimulatorWindow(x: width * 0.4, y: height * 0.5)
    case "swipe-from-top-edge":
        start = try pointInSimulatorWindow(x: width * 0.5, y: height * 0.05)
        end = try pointInSimulatorWindow(x: width * 0.5, y: height * 0.6)
    case "swipe-from-bottom-edge":
        start = try pointInSimulatorWindow(x: width * 0.5, y: height * 0.95)
        end = try pointInSimulatorWindow(x: width * 0.5, y: height * 0.4)
    default:
        throw NativeError.invalidArguments("Unsupported gesture preset: \(preset)")
    }
    if preDelay > 0 {
        Thread.sleep(forTimeInterval: preDelay)
    }
    sendSwipe(from: start, to: end, duration: duration)
    if postDelay > 0 {
        Thread.sleep(forTimeInterval: postDelay)
    }
    return 0
}
