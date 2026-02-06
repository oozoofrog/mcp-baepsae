#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

SERVER_NAME="baepsae"
TOOLS=()
CLAUDE_SCOPES=()
ACTION="install"
PACKAGE_MANAGER="npm"
SERVER_RUNTIME="node"
SERVER_PACKAGE="mcp-baepsae"
USE_NATIVE_ENV="true"
NATIVE_PATH=""
SKIP_INSTALL="false"
SKIP_BUILD="false"
DRY_RUN="false"
INTERACTIVE="false"

SERVER_CMD=""
SERVER_CMD_ARGS=()
DIST_PATH=""

print_help() {
  cat <<'EOF'
Usage:
  bash scripts/install.sh [options]

Options:
  --tool <name>         Tool target (repeatable).
                        Supported: claude-code, claude-desktop, codex-cli,
                        codex-desktop, opencode, gemini, antigravity, copilot, all
  --doctor              Validate environment and print readiness report
  --uninstall           Remove MCP server registration from supported clients
  --claude-scope <s>    Claude Code scope (repeatable): local, user, project, all
  --pm <name>           Package manager for install/build: npm, pnpm, bun
  --runtime <name>      Server launch runtime: node, bun, npx, bunx, global
  --server-package <n>  Package/binary name for npx, bunx, global (default: mcp-baepsae)
  --native-path <path>  Override BAEPSAE_NATIVE_PATH value
  --no-native-env       Do not pass BAEPSAE_NATIVE_PATH into MCP tool configs
  --server-name <name>  MCP server key name (default: baepsae)
  --project-root <path> Project root override
  --skip-install        Skip npm install
  --skip-build          Skip npm run build
  --interactive         Launch interactive installers where required
  --dry-run             Print commands only
  --help                Show this help

Examples:
  bash scripts/install.sh --tool claude-code
  bash scripts/install.sh --tool claude-code --claude-scope local --claude-scope project
  bash scripts/install.sh --tool codex-cli --pm pnpm
  bash scripts/install.sh --tool gemini --runtime bun
  bash scripts/install.sh --tool claude-code --runtime bunx --server-package mcp-baepsae
  bash scripts/install.sh --tool all --doctor
  bash scripts/install.sh --tool all --uninstall
  bash scripts/install.sh --tool claude-desktop --tool codex-cli
  bash scripts/install.sh --tool all
  bash scripts/install.sh --tool opencode
EOF
}

log() {
  printf '%s\n' "$*"
}

run_cmd() {
  log "+ $*"
  if [[ "$DRY_RUN" != "true" ]]; then
    "$@"
  fi
}

have_cmd() {
  command -v "$1" >/dev/null 2>&1
}

opencode_global_config_path() {
  printf '%s/.config/opencode/opencode.json' "$HOME"
}

upsert_opencode_global_config() {
  local config_path
  config_path="$(opencode_global_config_path)"
  local config_dir
  config_dir="$(dirname "$config_path")"

  if [[ "$DRY_RUN" == "true" ]]; then
    log "+ mkdir -p $config_dir"
    log "+ update OpenCode config at $config_path (add/update '$SERVER_NAME')"
    return
  fi

  if ! have_cmd python3; then
    log "[skip] python3 not found; cannot update OpenCode config file automatically"
    return
  fi

  mkdir -p "$config_dir"
  python3 - "$config_path" "$SERVER_NAME" "$USE_NATIVE_ENV" "$NATIVE_PATH" "$SERVER_CMD" "${SERVER_CMD_ARGS[@]}" <<'PY'
import json
import os
import sys

config_path, server_name, use_native_env, native_path, *command = sys.argv[1:]
if not command:
    raise SystemExit("Missing command for OpenCode MCP config")

config = {}
if os.path.exists(config_path):
    with open(config_path, "r", encoding="utf-8") as f:
        raw = f.read().strip()
    if raw:
        try:
            config = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise SystemExit(f"Failed to parse {config_path}: {exc}")

if not isinstance(config, dict):
    raise SystemExit(f"OpenCode config must be a JSON object: {config_path}")

config.setdefault("$schema", "https://opencode.ai/config.json")

mcp = config.get("mcp")
if not isinstance(mcp, dict):
    mcp = {}

entry = {
    "type": "local",
    "command": command,
}
if use_native_env == "true":
    entry["environment"] = {
        "BAEPSAE_NATIVE_PATH": native_path,
    }

mcp[server_name] = entry
config["mcp"] = mcp

with open(config_path, "w", encoding="utf-8") as f:
    json.dump(config, f, indent=2, ensure_ascii=False)
    f.write("\n")
PY

  log "[ok] opencode configured (global): $config_path"
}

remove_opencode_global_config() {
  local config_path
  config_path="$(opencode_global_config_path)"

  if [[ "$DRY_RUN" == "true" ]]; then
    log "+ update OpenCode config at $config_path (remove '$SERVER_NAME')"
    return
  fi

  if [[ ! -f "$config_path" ]]; then
    log "[info] OpenCode config not found: $config_path"
    return
  fi

  if ! have_cmd python3; then
    log "[skip] python3 not found; remove '$SERVER_NAME' manually from $config_path"
    return
  fi

  python3 - "$config_path" "$SERVER_NAME" <<'PY'
import json
import sys

config_path, server_name = sys.argv[1:]
with open(config_path, "r", encoding="utf-8") as f:
    raw = f.read().strip()

if not raw:
    raise SystemExit(0)

try:
    config = json.loads(raw)
except json.JSONDecodeError as exc:
    raise SystemExit(f"Failed to parse {config_path}: {exc}")

if not isinstance(config, dict):
    raise SystemExit(f"OpenCode config must be a JSON object: {config_path}")

mcp = config.get("mcp")
if isinstance(mcp, dict) and server_name in mcp:
    del mcp[server_name]
    if mcp:
        config["mcp"] = mcp
    else:
        config.pop("mcp", None)

with open(config_path, "w", encoding="utf-8") as f:
    json.dump(config, f, indent=2, ensure_ascii=False)
    f.write("\n")
PY

  log "[ok] opencode uninstall attempted (global): $config_path"
}

add_tool() {
  local tool="$1"
  for existing in "${TOOLS[@]-}"; do
    if [[ "$existing" == "$tool" ]]; then
      return
    fi
  done
  TOOLS+=("$tool")
}

add_claude_scope() {
  local scope="$1"
  for existing in "${CLAUDE_SCOPES[@]-}"; do
    if [[ "$existing" == "$scope" ]]; then
      return
    fi
  done
  CLAUDE_SCOPES+=("$scope")
}

normalize_claude_scopes() {
  if [[ ${#CLAUDE_SCOPES[@]} -eq 0 ]]; then
    CLAUDE_SCOPES=(project)
    return
  fi

  if [[ " ${CLAUDE_SCOPES[*]-} " == *" all "* ]]; then
    CLAUDE_SCOPES=(local user project)
    return
  fi

  for scope in "${CLAUDE_SCOPES[@]}"; do
    case "$scope" in
      local|user|project)
        ;;
      *)
        log "Unsupported --claude-scope value: $scope"
        exit 1
        ;;
    esac
  done
}

normalize_package_manager() {
  case "$PACKAGE_MANAGER" in
    npm|pnpm|bun)
      ;;
    *)
      log "Unsupported --pm value: $PACKAGE_MANAGER"
      exit 1
      ;;
  esac
}

normalize_runtime() {
  case "$SERVER_RUNTIME" in
    node|bun|npx|bunx|global)
      ;;
    *)
      log "Unsupported --runtime value: $SERVER_RUNTIME"
      exit 1
      ;;
  esac
}

server_command_display() {
  local parts=("$SERVER_CMD" "${SERVER_CMD_ARGS[@]}")
  local rendered=""
  for p in "${parts[@]}"; do
    rendered+="$(printf '%q' "$p") "
  done
  printf '%s' "${rendered% }"
}

resolve_server_runtime_command() {
  local strict="true"
  if [[ "$ACTION" != "install" ]]; then
    strict="false"
  fi

  DIST_PATH="$PROJECT_ROOT/dist/index.js"

  case "$SERVER_RUNTIME" in
    node)
      SERVER_CMD="node"
      SERVER_CMD_ARGS=("$DIST_PATH")
      ;;
    bun)
      SERVER_CMD="bun"
      SERVER_CMD_ARGS=("$DIST_PATH")
      ;;
    npx)
      SERVER_CMD="npx"
      SERVER_CMD_ARGS=(-y "$SERVER_PACKAGE")
      ;;
    bunx)
      SERVER_CMD="bunx"
      SERVER_CMD_ARGS=("$SERVER_PACKAGE")
      ;;
    global)
      SERVER_CMD="$SERVER_PACKAGE"
      SERVER_CMD_ARGS=()
      ;;
  esac

  if [[ "$SERVER_RUNTIME" == "node" || "$SERVER_RUNTIME" == "bun" ]]; then
    if [[ ! -f "$DIST_PATH" ]]; then
      if [[ "$strict" == "true" ]]; then
        log "Missing build output: $DIST_PATH"
        exit 1
      fi
    fi
  fi

  if [[ "$USE_NATIVE_ENV" == "true" ]]; then
    if [[ -z "$NATIVE_PATH" ]]; then
      NATIVE_PATH="$PROJECT_ROOT/native/.build/release/baepsae-native"
    fi

    if [[ ! -f "$NATIVE_PATH" ]]; then
      if [[ "$strict" == "true" ]]; then
        log "Missing native binary for BAEPSAE_NATIVE_PATH: $NATIVE_PATH"
        exit 1
      fi
    fi
  fi

  if ! have_cmd "$SERVER_CMD"; then
    if [[ "$strict" == "true" ]]; then
      log "Required runtime command not found: $SERVER_CMD"
      exit 1
    fi
  fi
}

run_install_steps() {
  if [[ "$SKIP_INSTALL" != "true" ]]; then
    case "$PACKAGE_MANAGER" in
      npm)
        run_cmd npm install --prefix "$PROJECT_ROOT"
        ;;
      pnpm)
        run_cmd pnpm --dir "$PROJECT_ROOT" install
        ;;
      bun)
        run_cmd bun install --cwd "$PROJECT_ROOT"
        ;;
    esac
  fi

  if [[ "$SKIP_BUILD" != "true" ]]; then
    case "$PACKAGE_MANAGER" in
      npm)
        run_cmd npm run --prefix "$PROJECT_ROOT" build
        ;;
      pnpm)
        run_cmd pnpm --dir "$PROJECT_ROOT" run build
        ;;
      bun)
        run_cmd bun run --cwd "$PROJECT_ROOT" build
        ;;
    esac
  fi
}

run_uninstall_steps() {
  log "Running uninstall for: ${TOOLS[*]}"
}

get_package_version() {
  if [[ -f "$PROJECT_ROOT/package.json" ]]; then
    if have_cmd node; then
      node -p "require('$PROJECT_ROOT/package.json').version" 2>/dev/null || echo "unknown"
    else
      grep '"version"' "$PROJECT_ROOT/package.json" | head -1 | sed 's/.*"version".*"\([^"]*\)".*/\1/' || echo "unknown"
    fi
  else
    echo "unknown"
  fi
}

get_native_version() {
  if [[ -f "$NATIVE_PATH" ]]; then
    "$NATIVE_PATH" --version 2>/dev/null || echo "unknown"
  else
    echo "not built"
  fi
}

run_doctor_checks() {
  log "===================================="
  log "Baepsae Environment Doctor"
  log "===================================="
  log ""
  log "Versions:"
  log "  Package:  $(get_package_version)"
  log "  Native:   $(get_native_version)"
  if have_cmd node; then
    log "  Node.js:  $(node --version)"
  fi
  if have_cmd swift; then
    log "  Swift:    $(swift --version | head -1)"
  fi
  log ""
  log "Configuration:"
  log "  Action:     $ACTION"
  log "  Project:    $PROJECT_ROOT"
  log "  Package:    $PACKAGE_MANAGER"
  log "  Runtime:    $SERVER_RUNTIME"
  log "  Server:     $SERVER_PACKAGE"
  log "  Tools:      ${TOOLS[*]}"
  log ""

  if have_cmd "$PACKAGE_MANAGER"; then
    log "[ok] package manager: $PACKAGE_MANAGER"
  else
    log "[warn] package manager not found: $PACKAGE_MANAGER"
  fi

  if have_cmd "$SERVER_CMD"; then
    log "[ok] runtime command: $SERVER_CMD"
  else
    log "[warn] runtime command not found: $SERVER_CMD"
  fi

  if [[ "$SERVER_RUNTIME" == "node" || "$SERVER_RUNTIME" == "bun" ]]; then
    if [[ -f "$DIST_PATH" ]]; then
      log "[ok] build output: $DIST_PATH"
    else
      log "[warn] build output missing: $DIST_PATH"
    fi
  fi

  if [[ "$USE_NATIVE_ENV" == "true" ]]; then
    if [[ -f "$NATIVE_PATH" ]]; then
      log "[ok] native binary: $NATIVE_PATH"
    else
      log "[warn] native binary missing: $NATIVE_PATH"
    fi
  else
    log "[info] native env: disabled"
  fi

  log ""
  log "MCP Clients:"
  if have_cmd claude; then
    log "  [ok] claude"
  else
    log "  [..] claude (not found)"
  fi

  if have_cmd codex; then
    log "  [ok] codex"
  else
    log "  [..] codex (not found)"
  fi

  if have_cmd gemini; then
    log "  [ok] gemini"
  else
    log "  [..] gemini (not found)"
  fi

  if have_cmd opencode; then
    log "  [ok] opencode"
  else
    log "  [..] opencode (not found)"
  fi

  if have_cmd copilot; then
    log "  [ok] copilot"
  elif have_cmd gh; then
    log "  [ok] gh (copilot via wrapper)"
  else
    log "  [..] copilot/gh (not found)"
  fi

  log ""
  log "===================================="
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tool)
      add_tool "${2:-}"
      shift 2
      ;;
    --doctor)
      ACTION="doctor"
      shift
      ;;
    --uninstall)
      ACTION="uninstall"
      shift
      ;;
    --claude-scope)
      add_claude_scope "${2:-}"
      shift 2
      ;;
    --pm)
      PACKAGE_MANAGER="${2:-}"
      shift 2
      ;;
    --runtime)
      SERVER_RUNTIME="${2:-}"
      shift 2
      ;;
    --server-package)
      SERVER_PACKAGE="${2:-}"
      shift 2
      ;;
    --native-path)
      NATIVE_PATH="${2:-}"
      shift 2
      ;;
    --no-native-env)
      USE_NATIVE_ENV="false"
      shift
      ;;
    --server-name)
      SERVER_NAME="${2:-}"
      shift 2
      ;;
    --project-root)
      PROJECT_ROOT="$(cd "${2:-}" && pwd)"
      shift 2
      ;;
    --skip-install)
      SKIP_INSTALL="true"
      shift
      ;;
    --skip-build)
      SKIP_BUILD="true"
      shift
      ;;
    --interactive)
      INTERACTIVE="true"
      shift
      ;;
    --dry-run)
      DRY_RUN="true"
      shift
      ;;
    --help)
      print_help
      exit 0
      ;;
    *)
      log "Unknown option: $1"
      print_help
      exit 1
      ;;
  esac
done

if [[ ${#TOOLS[@]} -eq 0 ]]; then
  add_tool "all"
fi

if [[ " ${TOOLS[*]-} " == *" all "* ]]; then
  TOOLS=(
    claude-code
    claude-desktop
    codex-cli
    codex-desktop
    opencode
    gemini
    antigravity
    copilot
  )
fi

normalize_package_manager
normalize_runtime

if [[ "$ACTION" == "install" ]]; then
  run_install_steps
fi

resolve_server_runtime_command

log "Runtime command: $(server_command_display)"
if [[ "$USE_NATIVE_ENV" == "true" ]]; then
  log "Native env: BAEPSAE_NATIVE_PATH=$NATIVE_PATH"
else
  log "Native env: disabled (--no-native-env)"
fi

install_claude() {
  local scope="$1"
  if ! have_cmd claude; then
    log "[skip] claude CLI not found"
    return
  fi

  run_cmd claude mcp remove --scope "$scope" "$SERVER_NAME" || true
  local cmd=(claude mcp add --scope "$scope")
  if [[ "$USE_NATIVE_ENV" == "true" ]]; then
    cmd+=("--env=BAEPSAE_NATIVE_PATH=$NATIVE_PATH")
  fi
  cmd+=("$SERVER_NAME" -- "$SERVER_CMD" "${SERVER_CMD_ARGS[@]}")
  run_cmd "${cmd[@]}"
  log "[ok] claude ($scope) configured"
}

install_claude_code() {
  normalize_claude_scopes
  for scope in "${CLAUDE_SCOPES[@]}"; do
    install_claude "$scope"
  done
}

uninstall_claude() {
  local scope="$1"
  if ! have_cmd claude; then
    log "[skip] claude CLI not found"
    return
  fi
  run_cmd claude mcp remove --scope "$scope" "$SERVER_NAME" || true
  log "[ok] claude ($scope) uninstall attempted"
}

uninstall_claude_code() {
  normalize_claude_scopes
  for scope in "${CLAUDE_SCOPES[@]}"; do
    uninstall_claude "$scope"
  done
}

install_codex() {
  if ! have_cmd codex; then
    log "[skip] codex CLI not found"
    return
  fi

  run_cmd codex mcp remove "$SERVER_NAME" || true
  local cmd=(codex mcp add "$SERVER_NAME")
  if [[ "$USE_NATIVE_ENV" == "true" ]]; then
    cmd+=(--env "BAEPSAE_NATIVE_PATH=$NATIVE_PATH")
  fi
  cmd+=(-- "$SERVER_CMD" "${SERVER_CMD_ARGS[@]}")
  run_cmd "${cmd[@]}"
  log "[ok] codex configured"
}

uninstall_codex() {
  if ! have_cmd codex; then
    log "[skip] codex CLI not found"
    return
  fi
  run_cmd codex mcp remove "$SERVER_NAME" || true
  log "[ok] codex uninstall attempted"
}

install_gemini() {
  if ! have_cmd gemini; then
    log "[skip] gemini CLI not found"
    return
  fi

  run_cmd gemini mcp remove "$SERVER_NAME" || true
  local cmd=(gemini mcp add --scope user --transport stdio)
  if [[ "$USE_NATIVE_ENV" == "true" ]]; then
    cmd+=(-e "BAEPSAE_NATIVE_PATH=$NATIVE_PATH")
  fi
  cmd+=("$SERVER_NAME" "$SERVER_CMD" "${SERVER_CMD_ARGS[@]}")
  run_cmd "${cmd[@]}"
  log "[ok] gemini configured"
}

install_opencode() {
  upsert_opencode_global_config

  if have_cmd opencode; then
    run_cmd opencode mcp list || true
  else
    log "[info] opencode CLI not found; config is prepared for future OpenCode runs."
  fi
}

install_copilot() {
  if have_cmd copilot; then
    log "[info] copilot CLI detected. If '/mcp add' is interactive-only, run manually in copilot session."
    if [[ "$INTERACTIVE" == "true" ]]; then
      run_cmd copilot
    else
      log "       Re-run with --interactive to launch copilot session."
    fi
    return
  fi

  if have_cmd gh; then
    log "[info] GitHub CLI found. Launch with: gh copilot"
    log "       Then run MCP setup in Copilot session/UI using:"
    log "       name=$SERVER_NAME, command=$(server_command_display)"
    if [[ "$USE_NATIVE_ENV" == "true" ]]; then
      log "       env BAEPSAE_NATIVE_PATH=$NATIVE_PATH"
    fi
    if [[ "$INTERACTIVE" == "true" ]]; then
      run_cmd gh copilot
    fi
    return
  fi

  log "[skip] neither copilot nor gh command is available"
}

uninstall_gemini() {
  if ! have_cmd gemini; then
    log "[skip] gemini CLI not found"
    return
  fi
  run_cmd gemini mcp remove "$SERVER_NAME" || true
  log "[ok] gemini uninstall attempted"
}

uninstall_opencode() {
  remove_opencode_global_config
}

uninstall_copilot() {
  if have_cmd copilot; then
    log "[info] run inside copilot session: /mcp delete $SERVER_NAME"
    return
  fi

  if have_cmd gh; then
    log "[info] launch gh copilot, then run: /mcp delete $SERVER_NAME"
    return
  fi

  log "[skip] neither copilot nor gh command is available"
}

do_action_for_tool() {
  local tool="$1"
  case "$ACTION" in
    install)
      case "$tool" in
        claude-code)
          install_claude_code
          ;;
        claude-desktop)
          install_claude "user"
          ;;
        codex-cli)
          install_codex
          ;;
        codex-desktop)
          install_codex
          log "[info] codex desktop uses codex CLI MCP settings."
          ;;
        gemini)
          install_gemini
          ;;
        antigravity)
          install_gemini
          ;;
        opencode)
          install_opencode
          ;;
        copilot)
          install_copilot
          ;;
        *)
          log "Unsupported tool: $tool"
          exit 1
          ;;
      esac
      ;;
    uninstall)
      case "$tool" in
        claude-code)
          uninstall_claude_code
          ;;
        claude-desktop)
          uninstall_claude "user"
          ;;
        codex-cli)
          uninstall_codex
          ;;
        codex-desktop)
          uninstall_codex
          ;;
        gemini)
          uninstall_gemini
          ;;
        antigravity)
          uninstall_gemini
          ;;
        opencode)
          uninstall_opencode
          ;;
        copilot)
          uninstall_copilot
          ;;
        *)
          log "Unsupported tool: $tool"
          exit 1
          ;;
      esac
      ;;
    doctor)
      run_doctor_checks
      ;;
    *)
      log "Unsupported action: $ACTION"
      exit 1
      ;;
  esac
}

if [[ "$ACTION" == "doctor" ]]; then
  run_doctor_checks
else
  for tool in "${TOOLS[@]}"; do
    do_action_for_tool "$tool"
  done
fi

log "Done."
