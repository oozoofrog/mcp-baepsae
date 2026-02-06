# mcp-baepsae

<p align="center">
  <img src="assets/baepsae.png" width="300" alt="baepsae">
</p>

> **Baepsae** (Vinous-throated Parrotbill) — A tiny Korean bird. Round, chubby, and constantly hopping around chirping. Known for its grit — even when a little bird tries to keep up with a stork, it never gives up. This project is small too, but it pecks away at your simulators tirelessly.

Local MCP server for iOS Simulator automation with a TypeScript MCP layer and a Swift native bridge.

한국어 문서는 `README-KR.md`를 참고하세요.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Install](#install)
- [MCP Setup (Recommended)](#mcp-setup-recommended)
- [Client Matrix](#client-matrix)
- [For LLM](#for-llm)
- [Manual Setup (Fallback)](#manual-setup-fallback)
- [Project Structure](#project-structure)
- [Commands](#commands)
- [MCP Tool Status](#mcp-tool-status)
- [Troubleshooting](#troubleshooting)

## Prerequisites

- macOS 14+
- Xcode + iOS Simulator
- Node.js 18+
- Swift 6+

## Permissions

**Accessibility permission is required** for UI automation features (`describe_ui`, `tap` by ID).

1. Open **System Settings** > **Privacy & Security** > **Accessibility**.
2. Enable your terminal (Terminal, iTerm2, VSCode) or command runner (`node`, `openclaw`).
3. If the app is missing, click `+` and add it manually.

## Install

### Option A) Local repository build (recommended)

```bash
git clone <your-repo-url>
cd mcp-baepsae
npm install
npm run build
```

### Option B) Global CLI install

```bash
npm install -g .
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

If an LLM agent is provisioning this repository end-to-end:

```bash
bash scripts/install.sh --tool all
```

Useful automation flags:

```bash
# Dry run (print only)
bash scripts/install.sh --tool all --dry-run

# Health check only
bash scripts/install.sh --tool all --doctor

# Remove MCP registrations
bash scripts/install.sh --tool all --uninstall
```

## Manual Setup (Fallback)

Use this when you do not want to run `scripts/install.sh`.

```bash
# Claude Code (project)
claude mcp add --scope project --env="BAEPSAE_NATIVE_PATH=/ABS/PATH/native/.build/release/baepsae-native" baepsae -- node /ABS/PATH/dist/index.js

# Codex CLI
codex mcp add baepsae --env BAEPSAE_NATIVE_PATH=/ABS/PATH/native/.build/release/baepsae-native -- node /ABS/PATH/dist/index.js

# Gemini CLI
gemini mcp add --scope user --transport stdio -e BAEPSAE_NATIVE_PATH=/ABS/PATH/native/.build/release/baepsae-native baepsae node /ABS/PATH/dist/index.js
```

## Project Structure

- MCP server: `src/index.ts`
- Native binary project: `native/`
- Native binary output: `native/.build/release/baepsae-native`
- Tests: `tests/mcp.contract.test.mjs`, `tests/mcp.real.test.mjs`

## Commands

```bash
npm run build       # Build TypeScript + native Swift binary
npm test            # Contract/integration tests
npm run test:real   # Real simulator smoke test (requires booted simulator)
npm run verify      # test + test:real
npm run setup:mcp   # Alias for scripts/install.sh
```

## MCP Tool Status

Implemented end-to-end:

- `list_simulators`: List available iOS simulators
- `open_url`: Open a URL (Safari/Deep Link)
- `install_app`: Install .app or .ipa file
- `launch_app`: Launch an app by Bundle ID
- `terminate_app`: Terminate a running app
- `uninstall_app`: Uninstall an app
- `screenshot`: Capture screen
- `record_video`: Record screen
- `describe_ui`: Read accessibility tree (requires Accessibility permission)
- `tap`: Tap at (x, y) or by element ID/label
- `type_text`: Type text
- `swipe`: Swipe gesture
- `button`: Press hardware buttons (home, lock, etc.)
- `key`, `key_sequence`, `key_combo`: Keyboard input
- `touch`, `gesture`: Advanced touch/gestures
- `stream_video`: Stream video frames

## Usage Examples (New Tools)

**Open a URL:**
```javascript
// Open Naver Mobile
open_url({ udid: "...", url: "https://m.naver.com" })
```

**Manage Apps:**
```javascript
// Install an app
install_app({ udid: "...", path: "/path/to/App.app" })

// Launch Safari
launch_app({ udid: "...", bundleId: "com.apple.mobilesafari" })

// Terminate Safari
terminate_app({ udid: "...", bundleId: "com.apple.mobilesafari" })
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
