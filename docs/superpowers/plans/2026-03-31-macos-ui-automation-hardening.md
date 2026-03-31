# macOS UI Automation Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all macOS UI automation reliability issues — key combos, input source switching, CJK text input, UI traversal, and timing.

**Architecture:** Two-layer structure (TypeScript MCP + Swift native bridge) is unchanged. All Swift changes go in `native/Sources/`, all TS changes in `src/tools/`. Tests use Node built-in test runner with `withClient()` pattern.

**Tech Stack:** Swift 6 (CGEvent, AXUIElement, Carbon/TISInputSource), TypeScript (Zod, MCP SDK), Node test runner

**Spec:** `docs/superpowers/specs/2026-03-31-macos-ui-automation-hardening-design.md`

**API Reference:** `.claude/references/macos-accessibility-automation.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `native/Sources/Utils.swift` | Modify | sendKeyCombo rewrite, sendText rewrite, sendClick delay, activateTarget verification, keycodeToFlag dict |
| `native/Sources/Commands/InputSourceCommands.swift` | Create | handleListInputSources, handleInputSource (TIS API) |
| `native/Sources/Commands/UICommands.swift` | Modify | handleType AX method, handleDescribeUI window param |
| `native/Sources/Commands/SystemCommands.swift` | Modify | handleMenuAction submenu, handleFocusWindow, handleReadUIValue, remove hardcoded sleep |
| `native/Sources/Commands/InputCommands.swift` | Modify | key_sequence default delay |
| `native/Sources/main.swift` | Modify | Add dispatch for new commands, update help text |
| `src/tools/input.ts` | Modify | input_source, list_input_sources tools |
| `src/tools/ui.ts` | Modify | type_text "ax" method, wait_for_ui, read_ui_value, window param, auto default |
| `src/tools/system.ts` | Modify | focus_window tool, menu_action window param |
| `tests/unit.test.mjs` | Modify | Unit tests for all new/modified tools |
| `tests/mcp.contract.test.mjs` | Modify | Contract tests for new tools |

---

### Task 1: Phase 1 — sendKeyCombo CGEventFlags fix

**Files:**
- Modify: `native/Sources/Utils.swift:1610-1637` (keyboard events section)
- Test: `tests/unit.test.mjs` (add key_combo flag verification)

- [ ] **Step 1: Write unit test for key_combo with known modifier keycodes**

Add to `tests/unit.test.mjs` at the end of the key_combo section (~line 1243):

```javascript
test("key_combo with Command+Shift sends correct native args", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "key_combo",
      arguments: {
        bundleId: "com.example.app",
        modifiers: [55, 56],
        key: 9,
      },
    });
    const text = extractText(result);
    assert.match(text, /key-combo/);
    assert.match(text, /--modifiers/);
    assert.match(text, /55,56/);
    assert.match(text, /--key/);
    assert.match(text, /9/);
  });
});
```

- [ ] **Step 2: Run test to verify it passes (arg forwarding already works)**

Run: `npm run build:ts && node --test tests/unit.test.mjs --test-name-pattern "key_combo with Command"`
Expected: PASS (this tests TS layer which is unchanged)

- [ ] **Step 3: Add keycodeToFlag dictionary to Utils.swift**

In `native/Sources/Utils.swift`, add after the `// MARK: - Keyboard Events` comment (line 1610), before `sendKeyPress`:

```swift
// MARK: - Keycode to CGEventFlags Mapping

let keycodeToFlag: [Int: CGEventFlags] = [
    0x37: .maskCommand,      // Left Command (55)
    0x36: .maskCommand,      // Right Command (54)
    0x38: .maskShift,        // Left Shift (56)
    0x3C: .maskShift,        // Right Shift (60)
    0x3A: .maskAlternate,    // Left Option (58)
    0x3D: .maskAlternate,    // Right Option (61)
    0x3B: .maskControl,      // Left Control (59)
    0x3E: .maskControl,      // Right Control (62)
    0x39: .maskAlphaShift,   // Caps Lock (57)
    0x3F: .maskSecondaryFn,  // Fn (63)
]
```

- [ ] **Step 4: Rewrite sendKeyCombo in Utils.swift**

Replace `sendKeyCombo` (lines 1623-1637) with:

```swift
func sendKeyCombo(modifiers: [Int], key: Int) {
    let source = CGEventSource(stateID: .hidSystemState)

    // Convert keycodes to CGEventFlags
    var flags: CGEventFlags = []
    for modifier in modifiers {
        if let flag = keycodeToFlag[modifier] {
            flags.insert(flag)
        }
    }

    // Send modifier key-down events with flags (backward compat with apps that watch key events)
    for modifier in modifiers {
        let event = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(modifier), keyDown: true)
        event?.flags = flags
        event?.post(tap: .cghidEventTap)
    }
    usleep(30_000) // 30ms for modifiers to register

    // Ensure modifier key-up always happens (prevent stuck modifiers)
    defer {
        usleep(30_000)
        for modifier in modifiers.reversed() {
            let event = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(modifier), keyDown: false)
            event?.post(tap: .cghidEventTap)
        }
    }

    // Main key with flags set (critical: many apps only check flags, not key events)
    let keyDown = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(key), keyDown: true)
    keyDown?.flags = flags
    keyDown?.post(tap: .cghidEventTap)

    let keyUp = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(key), keyDown: false)
    keyUp?.flags = flags
    keyUp?.post(tap: .cghidEventTap)
}
```

- [ ] **Step 5: Build and run all tests**

Run: `npm run build && npm test`
Expected: All existing tests pass (key_combo behavior is backward compatible)

- [ ] **Step 6: Commit**

```bash
git add native/Sources/Utils.swift tests/unit.test.mjs
git commit -m "fix: set CGEventFlags on key_combo events for reliable modifier handling"
```

---

### Task 2: Phase 5a — Timing hardening (activateTarget, sendClick, key_sequence delay)

**Files:**
- Modify: `native/Sources/Utils.swift:1479-1489` (activateTarget)
- Modify: `native/Sources/Utils.swift:1521-1524` (sendClick)
- Modify: `native/Sources/Commands/InputCommands.swift:25` (key_sequence delay default)
- Modify: `native/Sources/Commands/SystemCommands.swift:165` (menu_action sleep)
- Test: `tests/unit.test.mjs`

Note: Phase 5 is done early because it improves reliability for all subsequent phases.

- [ ] **Step 1: Rewrite activateTarget in Utils.swift**

Replace `activateTarget` (lines 1479-1489) with:

```swift
func activateTarget(_ target: TargetApp) throws {
    switch target {
    case .simulator(let udid):
        try activateSimulator(udid: udid)
    case .macApp(let pid, _, _):
        let apps = NSWorkspace.shared.runningApplications.filter { $0.processIdentifier == pid }
        guard let app = apps.first else {
            throw NativeError.commandFailed("App with pid \(pid) not found.")
        }
        app.activate(options: [.activateAllWindows])
        // Poll for activation (max 1 second)
        let deadline = Date().addingTimeInterval(1.0)
        while Date() < deadline {
            if app.isActive { return }
            Thread.sleep(forTimeInterval: 0.05)
        }
        fputs("Warning: app activation may not have completed within timeout\n", stderr)
    }
}
```

- [ ] **Step 2: Add 20ms delay to sendClick**

Replace `sendClick` (lines 1521-1524) with:

```swift
func sendClick(at point: CGPoint) {
    postMouseEvent(type: .leftMouseDown, point: point)
    usleep(20_000) // 20ms prevents some apps from ignoring instant clicks
    postMouseEvent(type: .leftMouseUp, point: point)
}
```

- [ ] **Step 3: Change key_sequence default delay to 50ms**

In `native/Sources/Commands/InputCommands.swift` line 25, change:

```swift
// Before:
let delay = try optionalDoubleOption("--delay", from: parsed) ?? 0
// After:
let delay = try optionalDoubleOption("--delay", from: parsed) ?? 0.05
```

- [ ] **Step 4: Remove hardcoded sleep in menu_action**

In `native/Sources/Commands/SystemCommands.swift` line 165, remove:

```swift
// Remove this line — activateTarget now handles its own verification:
Thread.sleep(forTimeInterval: 0.3)
```

- [ ] **Step 5: Build and run all tests**

Run: `npm run build && npm test`
Expected: All pass. The key_sequence default delay change may affect timing-sensitive real tests — check `npm run test:real` if available.

- [ ] **Step 6: Commit**

```bash
git add native/Sources/Utils.swift native/Sources/Commands/InputCommands.swift native/Sources/Commands/SystemCommands.swift
git commit -m "fix: harden activation verification, click timing, and key_sequence defaults"
```

---

### Task 3: Phase 2 — Input source switching (Swift native)

**Files:**
- Create: `native/Sources/Commands/InputSourceCommands.swift`
- Modify: `native/Sources/main.swift`

- [ ] **Step 1: Create InputSourceCommands.swift**

Create `native/Sources/Commands/InputSourceCommands.swift`:

```swift
import AppKit
import Carbon
import Foundation

private func getInputSourceProperty(_ source: TISInputSource, _ key: CFString) -> AnyObject? {
    guard let cfType = TISGetInputSourceProperty(source, key) else { return nil }
    return Unmanaged<AnyObject>.fromOpaque(cfType).takeUnretainedValue()
}

private func isCJKV(_ source: TISInputSource) -> Bool {
    guard let languages = getInputSourceProperty(source, kTISPropertyInputSourceLanguages) as? [String],
          let lang = languages.first else { return false }
    return ["ko", "ja", "zh", "vi"].contains(lang)
}

private func selectableKeyboardSources() -> [TISInputSource] {
    let sourceList = TISCreateInputSourceList(nil, false)
        .takeRetainedValue() as NSArray as! [TISInputSource]
    return sourceList.filter {
        let category = getInputSourceProperty($0, kTISPropertyInputSourceCategory) as? String
        let isSelectable = getInputSourceProperty($0, kTISPropertyInputSourceIsSelectCapable) as? Bool
        return category == (kTISCategoryKeyboardInputSource as String) && isSelectable == true
    }
}

func handleListInputSources(_ parsed: ParsedOptions) throws -> Int32 {
    let sources = selectableKeyboardSources()
    for source in sources {
        let id = getInputSourceProperty(source, kTISPropertyInputSourceID) as? String ?? ""
        let name = getInputSourceProperty(source, kTISPropertyLocalizedName) as? String ?? ""
        let isSelected = (getInputSourceProperty(source, kTISPropertyInputSourceIsSelected) as? Bool) == true
        print("\(id) | \(name) | \(isSelected ? "active" : "")")
    }
    return 0
}

func handleInputSource(_ parsed: ParsedOptions) throws -> Int32 {
    // No arguments: query current input source
    guard let targetId = parsed.positionals.first else {
        let current = TISCopyCurrentKeyboardInputSource().takeRetainedValue()
        let id = getInputSourceProperty(current, kTISPropertyInputSourceID) as? String ?? ""
        let name = getInputSourceProperty(current, kTISPropertyLocalizedName) as? String ?? ""
        print("\(id) | \(name)")
        return 0
    }

    // Find target source
    let sources = selectableKeyboardSources()
    guard let target = sources.first(where: {
        (getInputSourceProperty($0, kTISPropertyInputSourceID) as? String) == targetId
    }) else {
        let available = sources.compactMap { getInputSourceProperty($0, kTISPropertyInputSourceID) as? String }
        throw NativeError.commandFailed("Input source not found: \(targetId). Available: \(available.joined(separator: ", "))")
    }

    // CJKV workaround: double-switch via ABC/US first
    if isCJKV(target) {
        if let abc = sources.first(where: {
            let id = getInputSourceProperty($0, kTISPropertyInputSourceID) as? String ?? ""
            return id.contains("ABC") || id.contains(".US")
        }) {
            TISSelectInputSource(abc)
            usleep(100_000) // 100ms
        }
    }

    TISSelectInputSource(target)
    usleep(100_000)

    // Verify switch
    let current = TISCopyCurrentKeyboardInputSource().takeRetainedValue()
    let currentId = getInputSourceProperty(current, kTISPropertyInputSourceID) as? String ?? ""
    if currentId == targetId {
        print("Switched to: \(targetId)")
    } else {
        fputs("Warning: requested \(targetId) but current is \(currentId)\n", stderr)
        print("Switched to: \(currentId) (requested: \(targetId))")
    }
    return 0
}
```

- [ ] **Step 2: Add dispatch in main.swift**

In `native/Sources/main.swift`, add two cases before the `default` case (line 183):

```swift
    case "list-input-sources":
        return try handleListInputSources(parsed)

    case "input-source":
        return try handleInputSource(parsed)
```

Also update `printHelp()` — add these lines in the usage section:

```swift
      baepsae-native list-input-sources
      baepsae-native input-source [<SOURCE_ID>]
```

- [ ] **Step 3: Build Swift**

Run: `npm run build:native`
Expected: Compiles successfully

- [ ] **Step 4: Commit**

```bash
git add native/Sources/Commands/InputSourceCommands.swift native/Sources/main.swift
git commit -m "feat: add input-source and list-input-sources native commands"
```

---

### Task 4: Phase 2 — Input source switching (TypeScript MCP layer + tests)

**Files:**
- Modify: `src/tools/input.ts`
- Modify: `tests/unit.test.mjs`
- Modify: `tests/mcp.contract.test.mjs`

- [ ] **Step 1: Write unit tests for new tools**

Add to `tests/unit.test.mjs` after the key_combo section:

```javascript
// ===========================================================================
// Section: input_source parameter forwarding
// ===========================================================================

test("input_source without sourceId queries current input source", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "input_source",
      arguments: {},
    });
    const text = extractText(result);
    assert.match(text, /input-source/);
  });
});

test("input_source with sourceId sends source ID as positional arg", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "input_source",
      arguments: { sourceId: "com.apple.keylayout.ABC" },
    });
    const text = extractText(result);
    assert.match(text, /input-source/);
    assert.match(text, /com\.apple\.keylayout\.ABC/);
  });
});

test("list_input_sources sends correct native command", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "list_input_sources",
      arguments: {},
    });
    const text = extractText(result);
    assert.match(text, /list-input-sources/);
  });
});
```

- [ ] **Step 2: Add contract test for tool registration**

Add to `tests/mcp.contract.test.mjs`:

```javascript
test("input_source tool is registered and callable", async () => {
  await withClient(async (client) => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "input_source");
    assert.ok(tool, "input_source tool should be registered");
  });
});

test("list_input_sources tool is registered and callable", async () => {
  await withClient(async (client) => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "list_input_sources");
    assert.ok(tool, "list_input_sources tool should be registered");
  });
});
```

- [ ] **Step 3: Add MCP tools to input.ts**

In `src/tools/input.ts`, add inside `registerInputTools` function, after the `gesture` tool registration:

```typescript
  server.tool(
    "input_source",
    "Get current keyboard input source or switch to a specific one. Call without sourceId to query current; with sourceId to switch. Uses CJKV workaround for Korean/Japanese/Chinese/Vietnamese.",
    {
      sourceId: z.string().optional().describe(
        "Input source ID to switch to (e.g. 'com.apple.inputmethod.Korean.2SetKorean'). Omit to query current."
      ),
    },
    async (params) => {
      const args = ["input-source"];
      if (params.sourceId) {
        args.push(params.sourceId);
      }
      return await runBackend("utility", args);
    }
  );

  server.tool(
    "list_input_sources",
    "List all available keyboard input sources with their IDs, names, and active status.",
    {},
    async () => {
      return await runBackend("utility", ["list-input-sources"]);
    }
  );
```

- [ ] **Step 4: Build and run tests**

Run: `npm run build && npm test`
Expected: All tests pass including new ones

- [ ] **Step 5: Commit**

```bash
git add src/tools/input.ts tests/unit.test.mjs tests/mcp.contract.test.mjs
git commit -m "feat: add input_source and list_input_sources MCP tools"
```

---

### Task 5: Phase 3 — sendText rewrite + paste race condition fix

**Files:**
- Modify: `native/Sources/Utils.swift:1639-1654` (sendText)
- Modify: `native/Sources/Commands/UICommands.swift:413` (paste wait time)

- [ ] **Step 1: Rewrite sendText for UTF-16 surrogate pair support**

Replace `sendText` in `native/Sources/Utils.swift` (lines 1639-1654) with:

```swift
func sendText(_ text: String, charDelay: Double = 0.01) {
    let source = CGEventSource(stateID: .hidSystemState)
    for char in text {
        var utf16Chars = Array(char.utf16)
        let keyDown = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true)
        keyDown?.keyboardSetUnicodeString(stringLength: utf16Chars.count, unicodeString: &utf16Chars)
        keyDown?.post(tap: .cghidEventTap)
        let keyUp = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false)
        keyUp?.post(tap: .cghidEventTap)
        if charDelay > 0 {
            Thread.sleep(forTimeInterval: charDelay)
        }
    }
}
```

- [ ] **Step 2: Fix paste race condition — increase wait time**

In `native/Sources/Commands/UICommands.swift`, change line 413:

```swift
// Before:
Thread.sleep(forTimeInterval: 0.15)
// After:
Thread.sleep(forTimeInterval: 0.3)
```

- [ ] **Step 3: Change macOS auto default to paste**

In `native/Sources/Commands/UICommands.swift`, in `handleType` function (around line 376), change the auto case:

```swift
// Before:
    default: // auto
        if case .simulator = target {
            usePaste = true
        } else {
            usePaste = false
        }
// After:
    default: // auto
        usePaste = true  // paste is more reliable for all targets including CJK
```

- [ ] **Step 4: Build and run tests**

Run: `npm run build && npm test`
Expected: All pass. The auto default change may affect type_text unit tests that check policy metadata — update if needed.

- [ ] **Step 5: Update unit test for auto default change**

In `tests/unit.test.mjs`, find the test `"type_text without method does not include --method flag"` (~line 778). The policy metadata may now show `usedMethod: "paste"` for macOS targets. Update assertions if they check for `"keyboard"`:

```javascript
// If any test checks: policy.usedMethod === "keyboard" for macOS auto
// Change to: policy.usedMethod === "paste"
```

- [ ] **Step 6: Run tests again**

Run: `npm run build && npm test`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add native/Sources/Utils.swift native/Sources/Commands/UICommands.swift tests/unit.test.mjs
git commit -m "fix: sendText UTF-16 surrogate pairs, paste timing, macOS auto→paste default"
```

---

### Task 6: Phase 3 — type_text "ax" method (AX direct value setting)

**Files:**
- Modify: `native/Sources/Commands/UICommands.swift` (handleType)
- Modify: `src/tools/ui.ts` (method enum)
- Modify: `tests/unit.test.mjs`

- [ ] **Step 1: Write unit test**

Add to `tests/unit.test.mjs`:

```javascript
test("type_text with method=ax includes --method ax flag", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "type_text",
      arguments: {
        bundleId: "com.example.app",
        text: "hello",
        method: "ax",
      },
    });
    const text = extractText(result);
    assert.match(text, /--method/);
    assert.match(text, /ax/);
  });
});
```

- [ ] **Step 2: Extend method enum in ui.ts**

In `src/tools/ui.ts`, change the method schema (line 121):

```typescript
// Before:
method: z.enum(["auto", "paste", "keyboard"]).optional().describe(
// After:
method: z.enum(["auto", "paste", "keyboard", "ax"]).optional().describe(
  "Input method: 'auto' = paste for all targets; 'paste' = clipboard; 'keyboard' = char-by-char CGEvent; 'ax' = set value via Accessibility API (most reliable for CJK, bypasses IME)"
),
```

Also update the `TypeParams` type and `resolveTypeTextPolicy` to handle `"ax"`.

- [ ] **Step 3: Add AX method to native handleType**

In `native/Sources/Commands/UICommands.swift`, in `handleType`, add an `"ax"` case before the paste/keyboard branch (around line 368):

```swift
    let methodStr = parsed.options["--method"] ?? "auto"

    if methodStr == "ax" {
        let appRoot = try accessibilityRootElement(for: target)
        var focusedRef: CFTypeRef?
        let status = AXUIElementCopyAttributeValue(
            appRoot,
            "AXFocusedUIElement" as CFString,
            &focusedRef
        )
        if status == .success, let focused = focusedRef {
            let setResult = AXUIElementSetAttributeValue(
                focused as! AXUIElement,
                kAXValueAttribute as CFString,
                text as CFTypeRef
            )
            if setResult == .success {
                print("Set value via AX API.")
                return 0
            }
            fputs("AX setValue failed (status \(setResult.rawValue)), falling back to paste\n", stderr)
        } else {
            fputs("No focused element found, falling back to paste\n", stderr)
        }
        // Fallback to paste
        try pasteText(text, target: target)
        return 0
    }

    let usePaste: Bool
    // ... existing auto/paste/keyboard logic ...
```

- [ ] **Step 4: Build and run tests**

Run: `npm run build && npm test`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add native/Sources/Commands/UICommands.swift src/tools/ui.ts tests/unit.test.mjs
git commit -m "feat: add 'ax' method to type_text for direct AX value setting"
```

---

### Task 7: Phase 4a — menu_action submenu support

**Files:**
- Modify: `native/Sources/Commands/SystemCommands.swift` (handleMenuAction)
- Modify: `tests/unit.test.mjs`

- [ ] **Step 1: Write unit test for submenu path**

```javascript
test("menu_action with submenu path passes item with > separator", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "menu_action",
      arguments: {
        bundleId: "com.example.app",
        menu: "File",
        item: "New > Document",
      },
    });
    const text = extractText(result);
    assert.match(text, /menu-action/);
    assert.match(text, /--item/);
    assert.match(text, /New > Document/);
  });
});
```

- [ ] **Step 2: Rewrite handleMenuAction with submenu traversal**

In `native/Sources/Commands/SystemCommands.swift`, replace the item-finding section (lines 192-213) with:

```swift
    // Parse item path for submenu navigation
    let itemPath = itemName.split(separator: ">").map {
        $0.trimmingCharacters(in: .whitespaces)
    }

    // Open the top-level menu
    AXUIElementPerformAction(menuItem, kAXPressAction as CFString)
    Thread.sleep(forTimeInterval: 0.2)

    var currentMenu = menuItem
    for (depth, pathComponent) in itemPath.enumerated() {
        let isLast = depth == itemPath.count - 1
        let menuChildren = Children(currentMenu)
        var foundItem: UIElement? = nil

        for child in menuChildren {
            let items = Children(child)
            for item in items {
                if let title = StringAttribute(item, kAXTitleAttribute as CFString),
                   normalizeText(title) == normalizeText(pathComponent) {
                    foundItem = item
                    break
                }
            }
            if foundItem != nil { break }
        }

        guard let targetItem = foundItem else {
            AXUIElementPerformAction(menuItem, "AXCancel" as CFString)
            throw NativeError.commandFailed("Menu item '\(pathComponent)' not found at depth \(depth + 1) in '\(menuName)'.")
        }

        if isLast {
            let pressStatus = AXUIElementPerformAction(targetItem, kAXPressAction as CFString)
            if pressStatus != .success {
                throw NativeError.commandFailed("Failed to activate menu item '\(pathComponent)' (status: \(pressStatus.rawValue)).")
            }
        } else {
            // Open submenu
            AXUIElementPerformAction(targetItem, kAXPressAction as CFString)
            Thread.sleep(forTimeInterval: 0.2)
            currentMenu = targetItem
        }
    }

    let fullPath = itemPath.joined(separator: " > ")
    print("Performed: \(menuName) > \(fullPath)")
    return 0
```

- [ ] **Step 3: Build and run tests**

Run: `npm run build && npm test`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add native/Sources/Commands/SystemCommands.swift tests/unit.test.mjs
git commit -m "feat: menu_action submenu navigation via > separator"
```

---

### Task 8: Phase 4b — Multi-window support + focus_window

**Files:**
- Modify: `native/Sources/Commands/UICommands.swift` (handleDescribeUI window param)
- Modify: `native/Sources/Commands/SystemCommands.swift` (handleFocusWindow)
- Modify: `native/Sources/main.swift`
- Modify: `src/tools/ui.ts` (window param)
- Modify: `src/tools/system.ts` (focus_window tool)
- Modify: `tests/unit.test.mjs`
- Modify: `tests/mcp.contract.test.mjs`

- [ ] **Step 1: Write tests**

Unit test in `tests/unit.test.mjs`:

```javascript
test("analyze_ui with window parameter passes --window flag", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "analyze_ui",
      arguments: {
        bundleId: "com.example.app",
        window: "Debug",
      },
    });
    const text = extractText(result);
    assert.match(text, /--window/);
    assert.match(text, /Debug/);
  });
});

test("focus_window tool is registered and accepts title", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "focus_window",
      arguments: {
        bundleId: "com.example.app",
        title: "Main",
      },
    });
    const text = extractText(result);
    assert.match(text, /focus-window/);
    assert.match(text, /--title/);
    assert.match(text, /Main/);
  });
});
```

Contract test in `tests/mcp.contract.test.mjs`:

```javascript
test("focus_window tool is registered", async () => {
  await withClient(async (client) => {
    const { tools } = await client.listTools();
    assert.ok(tools.find((t) => t.name === "focus_window"), "focus_window should be registered");
  });
});
```

- [ ] **Step 2: Add window param to analyze_ui in UICommands.swift**

In `handleDescribeUI`, replace the macOS window selection block (lines 23-31):

```swift
    case .macApp:
        if !parsed.flags.contains("--all") {
            let windows = Children(appRoot)
            if let windowSelector = parsed.options["--window"] {
                if let idx = Int(windowSelector), idx < windows.count {
                    targetRoot = windows[idx]
                } else {
                    targetRoot = windows.first(where: {
                        let title = StringAttribute($0, kAXTitleAttribute as CFString) ?? ""
                        return title.localizedCaseInsensitiveContains(windowSelector)
                    }) ?? windows.first ?? appRoot
                }
            } else if let firstWindow = windows.first {
                targetRoot = firstWindow
            }
        }
```

- [ ] **Step 3: Add handleFocusWindow to SystemCommands.swift**

Add at the end of the file:

```swift
func handleFocusWindow(_ parsed: ParsedOptions) throws -> Int32 {
    let target = try resolveTarget(from: parsed)
    if case .simulator = target {
        throw NativeError.commandFailed("focus-window is only supported for macOS apps.")
    }
    try ensureAccessibilityTrusted()
    try activateTarget(target)
    let appRoot = try accessibilityRootElement(for: target)
    let windows = Children(appRoot)

    let selected: UIElement
    if let indexStr = parsed.options["--index"], let idx = Int(indexStr) {
        guard idx < windows.count else {
            throw NativeError.invalidArguments("Window index \(idx) out of range (0..\(windows.count - 1)).")
        }
        selected = windows[idx]
    } else if let title = parsed.options["--title"] {
        guard let found = windows.first(where: {
            (StringAttribute($0, kAXTitleAttribute as CFString) ?? "")
                .localizedCaseInsensitiveContains(title)
        }) else {
            let available = windows.compactMap { StringAttribute($0, kAXTitleAttribute as CFString) }
            throw NativeError.commandFailed("No window matching '\(title)'. Available: \(available.joined(separator: ", "))")
        }
        selected = found
    } else {
        throw NativeError.invalidArguments("focus-window requires --index or --title.")
    }

    AXUIElementPerformAction(selected, kAXRaiseAction as CFString)
    let windowTitle = StringAttribute(selected, kAXTitleAttribute as CFString) ?? "(untitled)"
    print("Focused window: \(windowTitle)")
    return 0
}
```

- [ ] **Step 4: Add dispatch in main.swift**

```swift
    case "focus-window":
        return try handleFocusWindow(parsed)
```

And add to help text:

```swift
      baepsae-native focus-window <TARGET> [--index <N> | --title <TEXT>]
```

- [ ] **Step 5: Add window param to ui.ts and focus_window to system.ts**

In `src/tools/ui.ts`, add `window` to `describeSchema`:

```typescript
window: z.union([z.number().int().min(0), z.string()])
    .optional().describe("Window index or title substring (macOS only)"),
```

Update `buildDescribeArgs` to include:

```typescript
if (params.window !== undefined) {
    args.push("--window", String(params.window));
}
```

In `src/tools/system.ts`, add focus_window tool in `registerSystemTools`:

```typescript
  server.tool(
    "focus_window",
    "Raise and focus a specific window by index or title. macOS apps only.",
    {
      ...unifiedTargetSchema,
      index: z.number().int().min(0).optional().describe("Window index (0-based)"),
      title: z.string().optional().describe("Window title substring"),
    },
    async (params) => {
      const target = resolveUnifiedTargetArgs(params as UnifiedTargetParams);
      if (!Array.isArray(target)) return target;
      const args = ["focus-window", ...target];
      pushOption(args, "--index", params.index);
      pushOption(args, "--title", params.title);
      return await runNative(args);
    }
  );
```

- [ ] **Step 6: Build and run tests**

Run: `npm run build && npm test`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add native/Sources/Commands/UICommands.swift native/Sources/Commands/SystemCommands.swift native/Sources/main.swift src/tools/ui.ts src/tools/system.ts tests/unit.test.mjs tests/mcp.contract.test.mjs
git commit -m "feat: multi-window support in analyze_ui + focus_window tool"
```

---

### Task 9: Phase 4c — wait_for_ui + read_ui_value

**Files:**
- Modify: `native/Sources/Commands/SystemCommands.swift` (handleReadUIValue)
- Modify: `native/Sources/main.swift`
- Modify: `src/tools/ui.ts` (wait_for_ui, read_ui_value)
- Modify: `tests/unit.test.mjs`
- Modify: `tests/mcp.contract.test.mjs`

- [ ] **Step 1: Write tests**

Unit tests:

```javascript
test("wait_for_ui tool is registered with correct params", async () => {
  await withClient(async (client) => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "wait_for_ui");
    assert.ok(tool, "wait_for_ui should be registered");
  });
});

test("read_ui_value passes attribute flag", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "read_ui_value",
      arguments: {
        bundleId: "com.example.app",
        attribute: "selectedText",
      },
    });
    const text = extractText(result);
    assert.match(text, /read-ui-value/);
    assert.match(text, /--attribute/);
    assert.match(text, /selectedText/);
  });
});
```

- [ ] **Step 2: Add handleReadUIValue to SystemCommands.swift**

```swift
func handleReadUIValue(_ parsed: ParsedOptions) throws -> Int32 {
    let target = try resolveTarget(from: parsed)
    try ensureAccessibilityTrusted()
    try activateTarget(target)
    let appRoot = try accessibilityRootElement(for: target)

    let attributeStr = parsed.options["--attribute"] ?? "value"
    let axAttribute: String
    switch attributeStr {
    case "value": axAttribute = kAXValueAttribute as String
    case "selectedText": axAttribute = kAXSelectedTextAttribute as String
    case "insertionPoint": axAttribute = kAXInsertionPointLineNumberAttribute as String
    case "numberOfCharacters": axAttribute = kAXNumberOfCharactersAttribute as String
    default:
        throw NativeError.invalidArguments("Unsupported attribute: \(attributeStr). Use: value, selectedText, insertionPoint, numberOfCharacters.")
    }

    // Find element by selector or use focused element
    let element: AXUIElement
    if let accessibilityId = parsed.options["--id"] {
        guard let found = findAccessibilityElement(in: appRoot, identifier: accessibilityId, label: nil) else {
            throw NativeError.commandFailed("No element with id: \(accessibilityId)")
        }
        element = found
    } else if let label = parsed.options["--label"] {
        guard let found = findAccessibilityElement(in: appRoot, identifier: nil, label: label) else {
            throw NativeError.commandFailed("No element with label: \(label)")
        }
        element = found
    } else {
        var focusedRef: CFTypeRef?
        let status = AXUIElementCopyAttributeValue(appRoot, "AXFocusedUIElement" as CFString, &focusedRef)
        guard status == .success, let ref = focusedRef else {
            throw NativeError.commandFailed("No focused element and no --id or --label provided.")
        }
        element = ref as! AXUIElement
    }

    var valueRef: CFTypeRef?
    let status = AXUIElementCopyAttributeValue(element, axAttribute as CFString, &valueRef)
    guard status == .success, let value = valueRef else {
        print("(no value)")
        return 0
    }

    if let str = value as? String {
        print(str)
    } else if let num = value as? NSNumber {
        print(num.stringValue)
    } else {
        print(String(describing: value))
    }
    return 0
}
```

- [ ] **Step 3: Add dispatch in main.swift**

```swift
    case "read-ui-value":
        return try handleReadUIValue(parsed)
```

Help text:

```swift
      baepsae-native read-ui-value <TARGET> [--id <ID> | --label <LABEL>] [--attribute <value|selectedText|insertionPoint|numberOfCharacters>]
```

- [ ] **Step 4: Add wait_for_ui and read_ui_value to ui.ts**

In `src/tools/ui.ts`, add inside `registerUITools`:

```typescript
  server.tool(
    "wait_for_ui",
    "Wait for a UI element to appear or disappear. Polls query_ui at interval until condition met or timeout.",
    {
      ...unifiedTargetSchema,
      query: z.string().min(1).describe("Text/ID/label to search for"),
      condition: z.enum(["exists", "not_exists"]).optional().describe("Wait condition (default: exists)"),
      timeout: z.number().optional().describe("Max wait time in seconds (default: 10)"),
      interval: z.number().optional().describe("Poll interval in seconds (default: 0.5)"),
    },
    async (params) => {
      const target = resolveUnifiedTargetArgs(params as UnifiedTargetParams);
      if (!Array.isArray(target)) return target;
      const timeout = params.timeout ?? 10;
      const interval = params.interval ?? 0.5;
      const condition = params.condition ?? "exists";
      const start = Date.now();

      while ((Date.now() - start) / 1000 < timeout) {
        const result = await runBackend(
          "accessibility",
          buildSearchArgs(target, { query: params.query })
        );
        const text = result.content
          .filter((c: { type: string }) => c.type === "text")
          .map((c: { text: string }) => c.text)
          .join("\n");
        const found = !result.isError && !text.includes("No elements found");

        if ((condition === "exists" && found) || (condition === "not_exists" && !found)) {
          return {
            content: [{ type: "text" as const, text: `Condition '${condition}' met for '${params.query}'.\n${text}` }],
            isError: false,
          };
        }
        await new Promise((r) => setTimeout(r, interval * 1000));
      }
      return {
        content: [{ type: "text" as const, text: `Timeout (${timeout}s) waiting for '${params.query}' to ${condition === "exists" ? "appear" : "disappear"}.` }],
        isError: true,
      };
    }
  );

  server.tool(
    "read_ui_value",
    "Read value, selected text, or insertion point of a UI element via Accessibility API.",
    {
      ...unifiedTargetSchema,
      id: z.string().optional().describe("Accessibility identifier"),
      label: z.string().optional().describe("Accessibility label"),
      attribute: z.enum(["value", "selectedText", "insertionPoint", "numberOfCharacters"])
        .optional().describe("Attribute to read (default: value)"),
    },
    async (params) => {
      const target = resolveUnifiedTargetArgs(params as UnifiedTargetParams);
      if (!Array.isArray(target)) return target;
      const args = ["read-ui-value", ...target];
      pushOption(args, "--id", params.id);
      pushOption(args, "--label", params.label);
      pushOption(args, "--attribute", params.attribute);
      return await runNative(args);
    }
  );
```

- [ ] **Step 5: Build and run tests**

Run: `npm run build && npm test`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add native/Sources/Commands/SystemCommands.swift native/Sources/main.swift src/tools/ui.ts tests/unit.test.mjs tests/mcp.contract.test.mjs
git commit -m "feat: add wait_for_ui and read_ui_value tools"
```

---

### Task 10: Final verification and version bump

- [ ] **Step 1: Run full test suite**

Run: `npm run build && npm test`
Expected: All tests pass

- [ ] **Step 2: Run real tests if simulator available**

Run: `npm run test:real`
Expected: Existing real tests pass (new timing defaults may improve stability)

- [ ] **Step 3: Verify tool count**

Run: `node -e "const m = require('./dist/tool-manifest.js'); console.log(Object.keys(m.TOOL_MANIFEST).length)"`
Expected: 37 (was 32 + 5 new: input_source, list_input_sources, wait_for_ui, read_ui_value, focus_window)

- [ ] **Step 4: Commit any remaining changes**

```bash
git add -A
git commit -m "chore: final verification after macOS UI automation hardening"
```
