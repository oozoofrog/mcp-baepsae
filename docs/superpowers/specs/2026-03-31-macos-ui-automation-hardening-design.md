# macOS UI Automation Hardening — Design Spec

**Date:** 2026-03-31
**Status:** Approved
**Scope:** Full macOS UI automation reliability improvement for mcp-baepsae

## Problem Statement

mcp-baepsae's macOS UI automation tools have systemic reliability issues discovered through real-world usage with Xcode and other macOS apps:

1. **key_combo ignores CGEventFlags** — modifier keys sent as separate events, not as flags on the main key event. Many apps (including Xcode) ignore shortcuts.
2. **No input source switching** — Cannot switch between Korean/English or any other input method. TISInputSource API completely absent.
3. **type_text breaks on CJK/emoji** — Unicode scalar decomposition, no inter-character delay, UInt16 overflow for emoji.
4. **Shallow UI traversal** — No submenu support, single-window only, no wait/retry, no value reading.
5. **Timing fragility** — Hardcoded sleeps, no activation verification, modifier keys can get stuck.

## Goals

- Make ALL macOS UI operations reliable across any app (Xcode, Safari, TextEdit, Finder, etc.)
- Support Korean/English input source switching with CJKV workaround
- Provide AX-based direct text input as the most reliable CJK method
- Enable deep UI navigation (submenus, multi-window, element waiting)
- Eliminate timing-related failures through verification loops

## Non-Goals

- Xcode-specific integrations (build system API, project model)
- Custom IME implementation
- Screen recording for macOS apps (simulator-only remains)

## Architecture

No architectural changes. All modifications stay within existing two-layer structure:
- **TypeScript MCP layer** (src/tools/*.ts) — tool registration, validation, argument building
- **Swift native bridge** (native/Sources/) — CGEvent, AXUIElement, TISInputSource implementation

## Phase 1: CGEvent Key Combo Fix

### Files Modified
- `native/Sources/Utils.swift`

### Changes

**1.1 Add keycode-to-flag mapping dictionary**

```swift
let keycodeToFlag: [CGKeyCode: CGEventFlags] = [
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

**1.2 Rewrite sendKeyCombo**

- Convert modifier keycodes to CGEventFlags union
- Send modifier key-down events WITH flags set (backward compat)
- 30ms delay between modifier-down and main key
- Set `keyDown.flags` and `keyUp.flags` on the main key event
- Use `defer` block for modifier key-up (stuck prevention, also referenced in Phase 5)
- 30ms delay before modifier release

### Verification
- key_combo(modifiers: [55,56], key: 9) → Cmd+Shift+O in Xcode
- key_combo(modifiers: [55], key: 11) → Cmd+B in Xcode
- key_combo(modifiers: [55], key: 15) → Cmd+R in Xcode
- Verify via screenshot_app that expected UI appeared

## Phase 2: Input Source Switching

### Files Created
- `native/Sources/Commands/InputSourceCommands.swift` (follows existing Commands/ convention)

### Files Modified
- `native/Sources/main.swift` — add `input-source` and `list-input-sources` dispatch
- `src/tools/input.ts` — add two new MCP tools
- `src/index.ts` — register if needed (input tools already registered)

### New MCP Tools

| Tool | Native Command | Parameters | Description |
|------|---------------|------------|-------------|
| `input_source` | `input-source` | `sourceId?: string` | Get current or switch to specified input source |
| `list_input_sources` | `list-input-sources` | none | List all selectable keyboard input sources |

### Implementation Details

**list-input-sources output format:**
```
com.apple.keylayout.ABC | ABC | active
com.apple.inputmethod.Korean.2SetKorean | 2-Set Korean |
```

**input-source switching with CJKV workaround:**
1. Check if target is CJKV (Korean/Japanese/Chinese/Vietnamese)
2. If CJKV: first switch to ABC/US, wait 100ms, then switch to target
3. Wait 100ms after switch
4. Verify by reading current input source
5. Print result with warning if verification fails

### Verification
- list_input_sources → see all sources
- input_source() → see current
- input_source("com.apple.inputmethod.Korean.2SetKorean") → switch to Korean
- type_text with Korean text → verify input
- input_source("com.apple.keylayout.ABC") → switch back

## Phase 3: type_text CJK/Unicode Improvement

### Files Modified
- `native/Sources/Utils.swift` — rewrite `sendText`
- `native/Sources/Commands/UICommands.swift` — add AX method path in `handleType`
- `src/tools/ui.ts` — extend method enum to include "ax"

### Changes

**3.1 sendText rewrite**
- Iterate by `Character` instead of `unicodeScalars`
- Use UTF-16 encoding (`char.utf16`) to handle surrogate pairs (emoji)
- Pass full UTF-16 array to `keyboardSetUnicodeString`
- Add 10ms default inter-character delay
- Accept optional `charDelay` parameter

**3.2 New "ax" input method**
- Read focused UI element via `kAXFocusedUIElementAttribute`
- Set value directly via `AXUIElementSetAttributeValue(kAXValueAttribute)`
- Falls back to paste if AX set fails
- Most reliable method for CJK text — bypasses IME entirely

**3.3 macOS auto default change**
- Current: macOS auto → keyboard
- New: macOS auto → paste
- Rationale: paste is more reliable for all character sets, clipboard is restored after

**3.4 Paste race condition fix**
- macOS paste wait: 0.15s → 0.3s before clipboard restore
- Prevents premature clipboard restoration before app processes Cmd+V

### Verification
- type_text(text: "한글 테스트", method: "ax") in Xcode/TextEdit
- type_text(text: "emoji 🎉🚀", method: "keyboard") → emoji input
- type_text(text: "Hello") on macOS → confirm uses paste by default
- Long text (500+ chars) → no character drops

## Phase 4: UI Traversal Enhancement

### Files Modified
- `native/Sources/Commands/SystemCommands.swift` — submenu support in handleMenuAction
- `native/Sources/Commands/UICommands.swift` — window parameter in handleDescribeUI
- `native/Sources/main.swift` — dispatch new commands
- `src/tools/ui.ts` — new tools + schema extensions
- `src/tools/system.ts` — schema extensions

### Files Created
- None (new commands added to existing modules)

### 4.1 Submenu Navigation

**menu_action --item syntax extension:** `"Parent > Child > Grandchild"` using `>` separator.

Implementation:
1. Open top-level menu
2. For each path component: find matching item in current menu children
3. If not last: press to open submenu, wait 200ms
4. If last: press to execute
5. Cancel menu on any failure

### 4.2 Multi-Window Support

**analyze_ui/query_ui --window parameter:** accepts integer index or title substring.

- Index: `--window 0`, `--window 2`
- Title: `--window "ViewController"`, `--window "Debug"`
- No parameter: first window (backward compatible)

### 4.3 New Tool: wait_for_ui

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| query | string | required | Text/ID/label to search for |
| condition | "exists" \| "not_exists" | "exists" | Wait condition |
| timeout | number | 10 | Max seconds |
| interval | number | 0.5 | Poll interval seconds |

Implemented in TS layer as polling loop around query_ui.

### 4.4 New Tool: read_ui_value

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| id/label | string | optional | Element selector |
| attribute | enum | "value" | value, selectedText, insertionPoint, numberOfCharacters |

Native reads `kAXValueAttribute`, `kAXSelectedTextAttribute`, `kAXInsertionPointLineNumberAttribute`, `kAXNumberOfCharactersAttribute`.

### 4.5 New Tool: focus_window

| Parameter | Type | Description |
|-----------|------|-------------|
| index | number | Window index |
| title | string | Window title substring |

Native: `AXUIElementPerformAction(kAXRaiseAction)` + `AXUIElementSetAttributeValue(kAXMainAttribute)`.

### Verification
- menu_action(item: "File > New > File...") in Xcode
- analyze_ui(window: "ViewController.swift") in Xcode
- wait_for_ui(query: "Build Succeeded", timeout: 30)
- read_ui_value(attribute: "selectedText") in Xcode editor
- focus_window(title: "Debug") in Xcode

## Phase 5: Timing & Activation Hardening

### Files Modified
- `native/Sources/Utils.swift` — activateTarget verification loop, sendClick delay
- `native/Sources/Commands/InputCommands.swift` — key_sequence default delay
- `native/Sources/Commands/SystemCommands.swift` — remove hardcoded sleep

### Changes

**5.1 activateTarget verification loop**
- After `app.activate()`, poll `app.isActive` every 50ms
- Max wait: 1 second
- Timeout = warning to stderr, continue execution
- Replaces blind 300ms sleep in menu_action

**5.2 sendKeyCombo defer cleanup**
- Modifier key-up wrapped in `defer` block
- Guarantees cleanup even if main key posting fails

**5.3 sendClick 20ms delay**
- Insert `usleep(20_000)` between mouseDown and mouseUp
- Prevents some apps from ignoring zero-duration clicks

**5.4 key_sequence default delay**
- Change default from 0 to 0.05 (50ms)
- Prevents key event overlap in rapid sequences

**5.5 menu_action sleep removal**
- Remove hardcoded `Thread.sleep(0.3)` after activateTarget
- activateTarget now handles its own verification

### Verification
- Under CPU load: key_combo still works
- Force error during key_combo: modifiers don't get stuck
- key_sequence with 10+ keys: no drops
- activate_app → immediate key_combo: works first time

## Summary

| Phase | New Tools | Modified Tools | New Files | Modified Files |
|-------|-----------|---------------|-----------|----------------|
| 1 | 0 | 0 | 0 | 1 |
| 2 | 2 | 0 | 1 | 3 |
| 3 | 0 | 1 (type_text) | 0 | 3 |
| 4 | 3 | 2 (menu_action, analyze_ui) | 0 | 5 |
| 5 | 0 | 0 | 0 | 3 |
| **Total** | **5** | **3** | **1** | **~10 unique** |

## Testing Strategy

Each phase adds:
1. **Contract tests** in `tests/mcp.contract.test.mjs` — tool registration, parameter validation
2. **Unit tests** in `tests/unit.test.mjs` — argument building, edge cases
3. **Real tests** in `tests/mcp.real.test.mjs` — actual macOS app interaction (where possible)

New tools follow existing pattern: contract test for schema, unit test for arg forwarding, real test for behavior.

## API Reference

Detailed API documentation for AXUIElement, CGEvent, and TISInputSource is in `.claude/references/macos-accessibility-automation.md`.
