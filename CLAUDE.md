# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

`mcp-baepsae` is a local MCP (Model Context Protocol) server for iOS Simulator and macOS app automation. It has two layers:

- **TypeScript MCP layer** (`src/`) — exposes 32 MCP tools, validates inputs via Zod, spawns child processes. Entry point is `src/index.ts`; tools are registered in `src/tools/*.ts` modules.
- **Swift native bridge** (`native/`) — a CLI binary (`baepsae-native`) that uses AppKit/CoreGraphics/Accessibility APIs for UI automation. Entry point is `native/Sources/main.swift`; command handlers are in `native/Sources/Commands/*.swift`.

The TS layer is the MCP surface; it delegates to either the native binary or `xcrun simctl` depending on the command.

## Build & Test Commands

```bash
npm run build          # TypeScript (tsc) + Swift (release) build
npm run build:ts       # TypeScript only
npm run build:native   # Swift only: swift build --package-path native -c release
npm test               # Build + contract tests (no simulator needed)
npm run test:real      # Build + real simulator smoke tests (requires booted simulator)
npm run test:e2e       # Build sample app + real tests
npm run verify         # test + test:real
```

Single test file: `node --test tests/mcp.contract.test.mjs`

## Architecture

### TypeScript MCP layer (`src/`)

- `src/index.ts` — Entry point: `--version` flag, MCP server setup, imports and calls `registerXxxTools()` from each tool module
- `src/types.ts` — Shared TypeScript interfaces (`ToolTextResult`, `CommandExecutionOptions`, etc.)
- `src/utils.ts` — Shared utilities and constants:
  - `resolveNativeBinary()` — finds the native binary (env override `BAEPSAE_NATIVE_PATH` → bundled → release → debug fallback)
  - `executeCommand()` — process spawn with timeout, SIGINT→SIGTERM escalation, stdout/stderr capture
  - `runNative()` / `runSimctl()` — bridge MCP tools to native CLI or `xcrun simctl`
  - `toToolResult()` — normalizes output into `{ content: text[], isError: boolean }` shape
- `src/tools/` — Tool registration modules, each exports a `registerXxxTools(server)` function:
  - `info.ts` — baepsae_help, baepsae_version, list_apps, get_focused_app
  - `simulator.ts` — list_simulators, open_url, install_app, launch_app, terminate_app, uninstall_app
  - `ui.ts` — analyze_ui, query_ui, tap, type_text, swipe, scroll, drag_drop
  - `input.ts` — key, key_sequence, key_combo, button, touch, gesture
  - `media.ts` — stream_video, record_video, screenshot
  - `system.ts` — list_windows, activate_app, screenshot_app, right_click, menu_action, clipboard

### Swift native bridge (`native/Sources/`)

- `main.swift` — Entry point: `printHelp()`, `runParsed()` dispatch switch, error handling
- `Types.swift` — Shared types: `TargetApp`, `NativeError`, `ParsedOptions`, etc.
- `Utils.swift` — Shared utilities: argument parsing, accessibility helpers, mouse/keyboard events, coordinate conversion
- `Commands/` — Command handler modules:
  - `UICommands.swift` — describe-ui, search-ui, tap, type, swipe, scroll
  - `InputCommands.swift` — key, key-sequence, key-combo, button, touch, gesture
  - `MediaCommands.swift` — screenshot, record-video, screenshot-app, stream-video
  - `SystemCommands.swift` — list-apps, list-windows, activate-app, menu-action, get-focused-app, clipboard
  - `WindowCommands.swift` — right-click, drag-drop

## Naming Convention (Critical)

MCP tool names are **snake_case** (e.g., `analyze_ui`, `key_sequence`).
Native CLI subcommands are **kebab-case** (e.g., `describe-ui`, `key-sequence`).

When adding a tool, both sides must be updated consistently.

## Adding a New Tool

1. Add `server.tool(...)` in the appropriate `src/tools/*.ts` module (or create a new one and register it in `src/index.ts`)
2. Map arguments to native/simctl command
3. Add contract test in `tests/mcp.contract.test.mjs`
4. Add unit test in `tests/unit.test.mjs` for edge cases and parameter forwarding
5. If simulator-dependent, extend `tests/mcp.real.test.mjs`
6. Add native command handler in the appropriate `native/Sources/Commands/*.swift` module if needed

## Testing

### TypeScript tests (Node built-in test runner)

- Uses **Node built-in test runner** (`node --test`), not Jest/Vitest
- Test files are ESM `.mjs`
- `tests/mcp.contract.test.mjs` — Contract tests via `@modelcontextprotocol/sdk` stdio client against `dist/index.js`
- `tests/unit.test.mjs` — Unit tests for edge cases, input validation, parameter forwarding (69 tests, no simulator needed)
- `tests/mcp.real.test.mjs` — Real simulator smoke tests (skip gracefully when no simulator is booted)
- Test files share a `withClient(...)` helper for connect/close lifecycle
- Temp artifacts go under `.tmp-test-artifacts/` and must be cleaned up

### Swift tests (XCTest)

- `native/Tests/BaepsaeNativeTests/` — XCTest target testing the compiled binary via subprocess invocation
- Tests cover argument parsing, error messages, help output, and commands that work without a simulator
- Run with `swift test --package-path native`

## Error Handling

Tool failures must return `{ content: [{ type: "text", text: "..." }], isError: true }`. Do not throw uncaught errors from tool handlers.

## Things to Avoid

- Editing `dist/` directly — always regenerate via build
- Adding a tool in only one layer (TS or Swift) without the other and tests
- Bypassing `runNative()`/`runSimctl()` to spawn ad-hoc commands in handlers
- Hardcoding machine-specific paths in tests

## API References (.claude/references/)

When working with macOS Accessibility, CGEvent, or TISInputSource APIs, consult the reference docs first.
Index: .claude/references/_index.md

- Unknown API → search reference docs before guessing
- Reference docs vs training data conflict → reference docs win
- Not in reference docs → context7 or web search fallback
