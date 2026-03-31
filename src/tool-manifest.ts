export type ToolCategory =
  | "UI"
  | "Input"
  | "Workflow"
  | "System"
  | "Simulator-only"
  | "macOS/system"
  | "Utility";

export type ToolManifestEntry = {
  name: string;
  category: ToolCategory;
  summary: string;
};

export const TOOL_MANIFEST: ToolManifestEntry[] = [
  { name: "analyze_ui", category: "UI", summary: "Describe app UI hierarchy." },
  { name: "query_ui", category: "UI", summary: "Search app UI elements by text, identifier, or label." },
  { name: "tap", category: "UI", summary: "Tap coordinates or accessibility element." },
  { name: "tap_tab", category: "UI", summary: "Tap a tab in a tab bar by index." },
  { name: "type_text", category: "UI", summary: "Type text into the target app." },
  { name: "swipe", category: "UI", summary: "Perform swipe gesture in the target app." },
  { name: "scroll", category: "UI", summary: "Send scroll wheel events to the target app." },
  { name: "drag_drop", category: "UI", summary: "Drag and drop in the target app." },
  { name: "wait_for_ui", category: "UI", summary: "Wait for a UI element to appear or disappear." },
  { name: "detect_dialog", category: "UI", summary: "Detect if a modal dialog, sheet, or alert is currently presented." },
  { name: "read_ui_value", category: "UI", summary: "Read value, selected text, or insertion point of a UI element." },
  { name: "set_ui_value", category: "UI", summary: "Set value, text selection range, or focus on a UI element via Accessibility API." },
  { name: "read_ui_param", category: "UI", summary: "Read parameterized accessibility attributes like text ranges, line numbers, and bounds." },

  { name: "key", category: "Input", summary: "Press a single HID keycode in the target app." },
  { name: "key_sequence", category: "Input", summary: "Press multiple HID keycodes in sequence in the target app." },
  { name: "key_combo", category: "Input", summary: "Press key combo in the target app." },
  { name: "touch", category: "Input", summary: "Perform touch events in the target app." },
  { name: "input_source", category: "Input", summary: "Get or switch keyboard input source." },
  { name: "list_input_sources", category: "Input", summary: "List all available keyboard input sources." },

  { name: "run_steps", category: "Workflow", summary: "Execute ordered workflow steps using existing interaction tools." },

  { name: "list_windows", category: "System", summary: "List windows in the target app." },
  { name: "activate_app", category: "System", summary: "Bring the target app to foreground." },
  { name: "screenshot_app", category: "System", summary: "Take a screenshot of the target app window." },
  { name: "right_click", category: "System", summary: "Right-click in the target app." },
  { name: "focus_window", category: "System", summary: "Raise and focus a specific window by index or title." },
  { name: "context_menu_action", category: "System", summary: "Select an item from an open context menu (call after right_click). Supports submenu paths with > separator." },

  { name: "list_simulators", category: "Simulator-only", summary: "List available simulators using simctl." },
  { name: "screenshot", category: "Simulator-only", summary: "Capture a screenshot from simulator display using simctl screenshot." },
  { name: "record_video", category: "Simulator-only", summary: "Record simulator display." },
  { name: "stream_video", category: "Simulator-only", summary: "Stream simulator frames." },
  { name: "open_url", category: "Simulator-only", summary: "Open a URL in the simulator." },
  { name: "install_app", category: "Simulator-only", summary: "Install an app on the simulator." },
  { name: "launch_app", category: "Simulator-only", summary: "Launch an installed app on the simulator." },
  { name: "terminate_app", category: "Simulator-only", summary: "Terminate a running app on the simulator." },
  { name: "uninstall_app", category: "Simulator-only", summary: "Uninstall an app from the simulator." },
  { name: "button", category: "Simulator-only", summary: "Press a simulator hardware button." },
  { name: "gesture", category: "Simulator-only", summary: "Execute a preset gesture pattern." },

  { name: "list_apps", category: "macOS/system", summary: "List running macOS applications with their bundle IDs." },
  { name: "menu_action", category: "macOS/system", summary: "Execute a menu bar action in a macOS app." },
  { name: "get_focused_app", category: "macOS/system", summary: "Get information about the currently focused macOS app." },
  { name: "clipboard", category: "macOS/system", summary: "Read or write the system clipboard." },

  { name: "baepsae_help", category: "Utility", summary: "Show help." },
  { name: "baepsae_version", category: "Utility", summary: "Show server and native binary versions." },
  { name: "doctor", category: "Utility", summary: "Run readiness self-checks for host process, native binary, simulator, and accessibility." },
];

export const TOOL_CATEGORY_ORDER: ToolCategory[] = [
  "UI",
  "Input",
  "Workflow",
  "System",
  "Simulator-only",
  "macOS/system",
  "Utility",
];

export const TOOL_CATEGORY_LABELS_KR: Record<ToolCategory, string> = {
  UI: "UI",
  Input: "Input",
  Workflow: "Workflow",
  System: "System",
  "Simulator-only": "iOS 시뮬레이터 전용",
  "macOS/system": "macOS / 시스템",
  Utility: "유틸리티",
};

export function formatToolManifestMarkdown(): string {
  const lines = ["### Official public MCP surface: unified generic tools", "", "The public API surface is intentionally single-scheme: use unified generic tools with a target argument, rather than `sim_*` / `mac_*` names.", "", "| Category | Tools |", "|---|---|"];
  for (const category of TOOL_CATEGORY_ORDER) {
    const tools = TOOL_MANIFEST.filter((entry) => entry.category === category).map((entry) => `\`${entry.name}\``).join(", ");
    lines.push(`| ${category} | ${tools} |`);
  }
  lines.push("", "Target routing is explicit in the arguments: `udid` for simulator, `bundleId` / `appName` for macOS.");
  return lines.join("\n");
}

export function formatToolManifestMarkdownKr(): string {
  const lines = ["### 공식 공개 MCP 표면: unified generic tools", "", "공개 API 표면은 단일 스킴으로 정리되어 있으며, `sim_*` / `mac_*` 이름 대신 target 인자를 받는 unified generic tools 를 사용합니다.", "", "| 분류 | 도구 |", "|---|---|"];
  for (const category of TOOL_CATEGORY_ORDER) {
    const tools = TOOL_MANIFEST.filter((entry) => entry.category === category).map((entry) => `\`${entry.name}\``).join(", ");
    lines.push(`| ${TOOL_CATEGORY_LABELS_KR[category]} | ${tools} |`);
  }
  lines.push("", "대상 라우팅은 인자로 명시합니다: simulator 는 `udid`, macOS 는 `bundleId` / `appName`.");
  return lines.join("\n");
}
