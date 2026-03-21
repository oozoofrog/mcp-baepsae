import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execFileSync } from "node:child_process";

import {
  SERVER_NAME,
  SERVER_VERSION,
  NATIVE_BINARY_ENV,
  BAEPSAE_SUBCOMMANDS,
  resolveNativeBinary,
  executeCommand,
  runNative,
  tryResolveNativeBinaryPath,
} from "../utils.js";

function captureParentProcessDetail(): string {
  try {
    return execFileSync("/bin/ps", ["-p", String(process.ppid), "-o", "pid=,ppid=,comm="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

function extractJsonObject(text: string): unknown | null {
  const match = text.match(/(\{[\s\S]*\})\s*$/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

export function registerInfoTools(server: McpServer): void {
  server.tool(
    "baepsae_help",
    "Show help. Optionally pass subcommand name for compatibility reference.",
    {
      subcommand: z
        .enum(BAEPSAE_SUBCOMMANDS)
        .optional()
        .describe("Optional legacy subcommand name for compatibility reference"),
    },
    async (params) => {
      const lines = [
        `Server: ${SERVER_NAME} v${SERVER_VERSION}`,
        "Mode: native-layer + simctl",
        "",
        "Official public MCP surface: unified generic tools",
        "",
        "The public API surface is intentionally single-scheme: use unified generic tools with a target argument, rather than sim_* / mac_* names.",
        "",
        "supported tools:",
        "",
        "UI:",
        "- analyze_ui, query_ui, tap, tap_tab, type_text, swipe, scroll, drag_drop",
        "",
        "Input:",
        "- key, key_sequence, key_combo, touch",
        "",
        "System:",
        "- list_windows, activate_app, screenshot_app, right_click",
        "",
        "Simulator-only:",
        "- list_simulators, screenshot, record_video, stream_video, open_url, install_app, launch_app, terminate_app, uninstall_app, button, gesture",
        "",
        "macOS/system:",
        "- list_apps, menu_action, get_focused_app, clipboard",
        "",
        "Utility:",
        "- baepsae_help, baepsae_version, doctor",
        "",
        "Accessibility tip:",
        "- launch_app -> analyze_ui/query_ui -> tap(id/label)",
        "- tap/right_click selector lookup defaults to in-app content (set all=true to include Simulator chrome UI)",
        "",
        `Native binary requirement: build native binary or set ${NATIVE_BINARY_ENV}`,
      ];

      if (params.subcommand) {
        lines.push("", `Requested legacy subcommand: ${params.subcommand}`);
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        isError: false,
      };
    }
  );

  server.tool("baepsae_version", "Show server and native binary versions.", {}, async () => {
    const lines = [
      `${SERVER_NAME} ${SERVER_VERSION}`,
      `Node.js: ${process.version}`,
      `Platform: ${process.platform} ${process.arch}`,
    ];

    try {
      const binary = resolveNativeBinary();
      const result = await executeCommand(binary, ["--version"]);
      lines.push(`Native: ${result.stdout}`);
    } catch {
      lines.push("Native: not built (run npm run build)");
    }

    return {
      content: [{ type: "text", text: lines.join("\n") }],
      isError: false,
    };
  });

  server.tool(
    "doctor",
    "Run readiness self-checks for host process, parent process, native binary, booted simulator availability, and accessibility permission.",
    {},
    async () => {
      const host = {
        ok: true,
        detail: `${process.platform} ${process.arch}; node=${process.version}; pid=${process.pid}; ppid=${process.ppid}`,
      };
      const parent = {
        ok: true,
        detail: captureParentProcessDetail(),
      };
      const nativeBinary = tryResolveNativeBinaryPath();

      let nativeCheck: { ok: boolean; detail: string } = nativeBinary.ok
        ? { ok: true, detail: nativeBinary.path }
        : { ok: false, detail: nativeBinary.error };
      let simulator = { ok: false, detail: "native doctor not executed" };
      let accessibility = { ok: false, detail: "native doctor not executed" };

      if (nativeBinary.ok) {
        const doctorResult = await runNative(["doctor"]);
        const parsed = doctorResult.content
          .filter((item) => item.type === "text")
          .map((item) => item.text)
          .join("\n");
        const json = extractJsonObject(parsed);
        if (json && typeof json === "object") {
          const report = json as Record<string, { ok?: boolean; detail?: string }>;
          simulator = {
            ok: Boolean(report.simulator?.ok),
            detail: report.simulator?.detail ?? "unknown",
          };
          accessibility = {
            ok: Boolean(report.accessibility?.ok),
            detail: report.accessibility?.detail ?? "unknown",
          };
          nativeCheck = {
            ok: true,
            detail: `${nativeBinary.path} (doctor ok)`,
          };
        } else {
          nativeCheck = {
            ok: false,
            detail: `${nativeBinary.path} (doctor output could not be parsed)`,
          };
        }
      }

      const report = {
        host,
        parent,
        nativeBinary: nativeCheck,
        simulator,
        accessibility,
      };
      const lines = [
        "Doctor check completed.",
        `host: ${host.ok ? "ok" : "warn"} — ${host.detail}`,
        `parent: ${parent.ok ? "ok" : "warn"} — ${parent.detail}`,
        `native binary: ${nativeCheck.ok ? "ok" : "warn"} — ${nativeCheck.detail}`,
        `simulator: ${simulator.ok ? "ok" : "warn"} — ${simulator.detail}`,
        `accessibility: ${accessibility.ok ? "ok" : "warn"} — ${accessibility.detail}`,
        "",
        JSON.stringify(report, null, 2),
      ];

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        isError: !(host.ok && parent.ok && nativeCheck.ok && simulator.ok && accessibility.ok),
      };
    }
  );

  server.tool(
    "list_apps",
    "List running macOS applications with their bundle IDs.",
    {},
    async () => {
      return await runNative(["list-apps"]);
    }
  );

  server.tool(
    "get_focused_app",
    "Get information about the currently focused macOS app.",
    {},
    async () => {
      return await runNative(["get-focused-app"]);
    }
  );
}
