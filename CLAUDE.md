# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

`mcp-baepsae` is a local MCP (Model Context Protocol) server for iOS Simulator and macOS app automation. It has two layers:

- **TypeScript MCP layer** (`src/index.ts`) — exposes 32 MCP tools, validates inputs via Zod, spawns child processes
- **Swift native bridge** (`native/`) — a CLI binary (`baepsae-native`) that uses AppKit/CoreGraphics/Accessibility APIs for UI automation

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

All MCP tool registrations and dispatch logic live in the single file `src/index.ts`. There is no router/module split — each tool is a `server.tool(...)` call with inline Zod schema + handler.

Key functions in `src/index.ts`:
- `resolveNativeBinary()` — finds the native binary (env override `BAEPSAE_NATIVE_PATH` → release → debug fallback)
- `executeCommand()` — process spawn with timeout, SIGINT→SIGTERM escalation, stdout/stderr capture
- `runNative()` / `runSimctl()` — bridge MCP tools to native CLI or `xcrun simctl`
- `toToolResult()` — normalizes output into `{ content: text[], isError: boolean }` shape

The native binary (`native/Sources/main.swift`) is a single-file Swift 6 CLI. It parses commands via `parse(arguments:)` → dispatches via `runParsed(_:)`.

## Naming Convention (Critical)

MCP tool names are **snake_case** (e.g., `describe_ui`, `key_sequence`).
Native CLI subcommands are **kebab-case** (e.g., `describe-ui`, `key-sequence`).

When adding a tool, both sides must be updated consistently.

## Adding a New Tool

1. Add `server.tool(...)` in `src/index.ts` with Zod schema + handler
2. Map arguments to native/simctl command
3. Add contract test in `tests/mcp.contract.test.mjs`
4. If simulator-dependent, extend `tests/mcp.real.test.mjs`
5. Add native command handler in `native/Sources/main.swift` if needed

## Testing

- Uses **Node built-in test runner** (`node --test`), not Jest/Vitest
- Test files are ESM `.mjs`
- Contract tests use `@modelcontextprotocol/sdk` stdio client against `dist/index.js`
- Both test files share a `withClient(...)` helper for connect/close lifecycle
- Real smoke tests skip gracefully when no simulator is booted
- Temp artifacts go under `.tmp-test-artifacts/` and must be cleaned up

## Error Handling

Tool failures must return `{ content: [{ type: "text", text: "..." }], isError: true }`. Do not throw uncaught errors from tool handlers.

## Things to Avoid

- Editing `dist/` directly — always regenerate via build
- Adding a tool in only one layer (TS or Swift) without the other and tests
- Bypassing `runNative()`/`runSimctl()` to spawn ad-hoc commands in handlers
- Hardcoding machine-specific paths in tests
