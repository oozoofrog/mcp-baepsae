# mcp-baepsae

<p align="center">
  <img src="assets/baepsae.png" width="300" alt="baepsae">
</p>

> **Baepsae** (Vinous-throated Parrotbill) — A tiny Korean bird. Round, chubby, and constantly hopping around chirping. Known for its grit — even when a little bird tries to keep up with a stork, it never gives up. This project is small too, but it pecks away at your simulators tirelessly.

Local MCP server for iOS Simulator and macOS app automation with a TypeScript MCP layer and a Swift native bridge.

한국어 문서는 [README-KR.md](./README-KR.md)를 참고하세요.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Platform Support](#platform-support)
- [Install](#install)
- [Permissions](#permissions)
- [MCP Setup (Recommended)](#mcp-setup-recommended)
- [Client Matrix](#client-matrix)
- [For LLM](#for-llm)
- [Manual Setup (Fallback)](#manual-setup-fallback)
- [Project Structure](#project-structure)
- [Commands](#commands)
- [MCP Tool Status](#mcp-tool-status)
- [Usage Examples](#usage-examples)
- [Troubleshooting](#troubleshooting)

## Prerequisites

- macOS 14+
- Xcode + iOS Simulator
- Node.js 18+
- Swift 6+

## Platform Support

| Platform | Supported | Notes |
|---|---|---|
| macOS | Yes | Primary platform. Required for iOS Simulator and Accessibility APIs. |
| Linux | No | Native binary depends on AppKit, CoreGraphics, and Accessibility frameworks. |
| Windows | No | Native binary depends on AppKit, CoreGraphics, and Accessibility frameworks. |

**Why macOS only?**

The Swift native bridge (`baepsae-native`) uses macOS-specific frameworks (AppKit, CoreGraphics, Accessibility) to interact with iOS Simulator and macOS applications. These frameworks are not available on Linux or Windows. The TypeScript MCP layer also relies on `xcrun simctl`, which is part of Xcode Command Line Tools and only available on macOS.

**Requirements summary:**

- **macOS 14 or later** -- required for iOS Simulator automation and Accessibility API access.
- **Xcode or Xcode Command Line Tools** -- required for Swift 6+ compilation of the native binary and `xcrun simctl` commands.
- **Node.js >= 18.0.0** -- required to run the TypeScript MCP server.

## Permissions

**Accessibility permission is required** for UI inspection and input automation features (use `sim_*` / `mac_*` scoped tools such as `sim_describe_ui`, `mac_tap`, `sim_right_click`).

1. Open **System Settings** > **Privacy & Security** > **Accessibility**.
2. Enable the MCP client app and terminal you actually use, and also the runtime process (`node`) if listed.
3. If the app is missing, click `+` and add it manually.

For simulator targets, selector-based actions (`sim_tap` / `sim_right_click` with `id` or `label`) search **in-app content** by default. Set `all: true` to include Simulator chrome UI.

## Install

### Option A) npm (easiest)

```bash
# Run directly without installing
npx mcp-baepsae@latest

# Or install globally
npm install -g mcp-baepsae
```

> On macOS, the Swift native binary is built automatically during install. If Swift is not available, the server still works with simctl-based features.

### Option B) From source

```bash
git clone https://github.com/oozoofrog/mcp-baepsae.git
cd mcp-baepsae
npm install
npm run build
```

## MCP Setup (Recommended)

Use the installer script that calls each client's MCP install flow directly.

```bash
bash scripts/install.sh --tool all
```

## Client Matrix

| Client | Install Path | Script Target | Notes |
|---|---|---|---|
| Claude Code | `claude mcp add` | `--tool claude-code` | Supports multi-scope via `--claude-scope` |
| Claude Desktop | `claude mcp add --scope user` | `--tool claude-desktop` | User-level registration |
| Codex CLI | `codex mcp add` | `--tool codex-cli` | Also works for Codex Desktop settings |
| Codex Desktop | Codex CLI MCP config | `--tool codex-desktop` | Uses same MCP registry as CLI |
| OpenCode | Global config (`~/.config/opencode/opencode.json`) | `--tool opencode` | Auto-updated by installer |
| Gemini | `gemini mcp add` | `--tool gemini` | User scope setup |
| Google Antigravity | Gemini-compatible MCP flow | `--tool antigravity` | Uses Gemini MCP command path |
| GitHub Copilot | `copilot` or `gh copilot` session | `--tool copilot` | Interactive/session-based setup |

## For LLM

If you are an LLM agent setting up this MCP server, here is everything you need:

### Quick start (one command)

```bash
# Register baepsae as an MCP server for all supported clients
bash scripts/install.sh --tool all
```

If you installed via npm instead of cloning the repo, use npx:

```bash
# Claude Code
claude mcp add baepsae -- npx -y mcp-baepsae@latest

# Codex CLI
codex mcp add baepsae -- npx -y mcp-baepsae@latest
```

### Automation flags

```bash
# Preview commands without executing
bash scripts/install.sh --tool all --dry-run

# Verify environment and dependencies
bash scripts/install.sh --tool all --doctor

# Unregister from all clients
bash scripts/install.sh --tool all --uninstall
```

### Runtime options

The installer supports multiple runtimes via `--runtime`:

| Flag | Command | When to use |
|---|---|---|
| `--runtime node` (default) | `node dist/index.js` | Local source build |
| `--runtime npx` | `npx -y mcp-baepsae@latest` | npm registry, no global install |
| `--runtime bunx` | `bunx mcp-baepsae@latest` | Bun users |
| `--runtime global` | `mcp-baepsae` | After `npm install -g mcp-baepsae` |

## Manual Setup (Fallback)

Use this when you do not want to run `scripts/install.sh`.

### Using npx (recommended for npm users)

```bash
# Claude Code
claude mcp add baepsae -- npx -y mcp-baepsae@latest

# Codex CLI
codex mcp add baepsae -- npx -y mcp-baepsae@latest

# Gemini CLI
gemini mcp add --scope user --transport stdio baepsae npx -y mcp-baepsae@latest
```

### Using local build

```bash
# Claude Code (project)
claude mcp add --scope project --env="BAEPSAE_NATIVE_PATH=/ABS/PATH/native/.build/release/baepsae-native" baepsae -- node /ABS/PATH/dist/index.js

# Codex CLI
codex mcp add baepsae --env BAEPSAE_NATIVE_PATH=/ABS/PATH/native/.build/release/baepsae-native -- node /ABS/PATH/dist/index.js

# Gemini CLI
gemini mcp add --scope user --transport stdio -e BAEPSAE_NATIVE_PATH=/ABS/PATH/native/.build/release/baepsae-native baepsae node /ABS/PATH/dist/index.js
```

## Project Structure

- MCP server entry point: `src/index.ts`
- Tool modules: `src/tools/` (info, simulator, ui, input, media, system)
- Shared utilities: `src/utils.ts`, `src/types.ts`
- Native binary entry point: `native/Sources/main.swift`
- Native command handlers: `native/Sources/Commands/`
- Native binary output: `native/.build/release/baepsae-native`
- TS tests: `tests/mcp.contract.test.mjs`, `tests/unit.test.mjs`, `tests/mcp.real.test.mjs`
- Swift tests: `native/Tests/BaepsaeNativeTests/`

## Commands

```bash
npm run build       # Build TypeScript + native Swift binary
npm test            # Contract/integration tests
npm run test:real   # Real simulator smoke test (requires booted simulator)
npm run verify      # test + test:real
npm run setup:mcp   # Alias for scripts/install.sh
```

## MCP Tool Status

47 tools implemented end-to-end.

### Explicit target-scoped tools (30, recommended)

Use these first to avoid simulator/macOS target ambiguity.

| Simulator-scoped | macOS-scoped |
|---|---|
| `sim_describe_ui` | `mac_describe_ui` |
| `sim_search_ui` | `mac_search_ui` |
| `sim_tap` | `mac_tap` |
| `sim_type_text` | `mac_type_text` |
| `sim_swipe` | `mac_swipe` |
| `sim_key` | `mac_key` |
| `sim_key_sequence` | `mac_key_sequence` |
| `sim_key_combo` | `mac_key_combo` |
| `sim_touch` | `mac_touch` |
| `sim_right_click` | `mac_right_click` |
| `sim_scroll` | `mac_scroll` |
| `sim_drag_drop` | `mac_drag_drop` |
| `sim_list_windows` | `mac_list_windows` |
| `sim_activate_app` | `mac_activate_app` |
| `sim_screenshot_app` | `mac_screenshot_app` |

### iOS Simulator Only (11)

`list_simulators`, `screenshot`, `record_video`, `stream_video`, `open_url`, `install_app`, `launch_app`, `terminate_app`, `uninstall_app`, `button`, `gesture`

### macOS / System Only (4)

`list_apps`, `menu_action`, `get_focused_app`, `clipboard`

### Utility (2)

`baepsae_help`, `baepsae_version`

## Usage Examples

**Simulator app accessibility quickstart (inside app UI):**
```javascript
// 1) Launch your app in the target simulator
launch_app({ udid: "...", bundleId: "com.example.app" })

// 2) Inspect or search accessibility tree (in-app content scope by default)
sim_describe_ui({ udid: "..." })
sim_search_ui({ udid: "...", query: "Login" })

// 3) Interact by accessibility identifier/label
sim_tap({ udid: "...", id: "login-button" })

// Optional: include Simulator chrome/system UI in selector lookup
sim_tap({ udid: "...", label: "Home", all: true })
```

**Open a URL (iOS Simulator):**
```javascript
// Open Naver Mobile
open_url({ udid: "...", url: "https://m.naver.com" })
```

**Manage Apps (iOS Simulator):**
```javascript
// Install an app
install_app({ udid: "...", path: "/path/to/App.app" })

// Launch Safari
launch_app({ udid: "...", bundleId: "com.apple.mobilesafari" })

// Terminate Safari
terminate_app({ udid: "...", bundleId: "com.apple.mobilesafari" })
```

**macOS App Automation:**
```javascript
// List running macOS apps
list_apps({})

// Take screenshot of a macOS app
mac_screenshot_app({ bundleId: "com.apple.Safari" })
```

## Troubleshooting

- `Invalid environment variable format` on Claude setup:
  - Use current script (`scripts/install.sh`) or `claude mcp add --env="KEY=value" ...` format.
- `Missing native binary` error:
  - Run `npm run build` and confirm `native/.build/release/baepsae-native` exists.
- OpenCode does not show `baepsae`:
  - Re-run `bash scripts/install.sh --tool opencode --skip-install --skip-build` and check `~/.config/opencode/opencode.json`.
- Copilot not auto-registered:
  - Copilot MCP flow is interactive/session-based. Re-run installer with `--interactive`.
- Real smoke test skipped:
  - Boot an iOS simulator first, then run `npm run test:real`.
