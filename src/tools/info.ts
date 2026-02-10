import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  SERVER_NAME,
  SERVER_VERSION,
  NATIVE_BINARY_ENV,
  BAEPSAE_SUBCOMMANDS,
  resolveNativeBinary,
  executeCommand,
  runNative,
} from "../utils.js";

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
        "supported tools:",
        "- baepsae_help",
        "- baepsae_version",
        "- list_simulators",
        "- list_apps",
        "- screenshot",
        "- record_video",
        "- open_url",
        "- install_app",
        "- launch_app",
        "- terminate_app",
        "- uninstall_app",
        "",
        "Implemented tools:",
        "- describe_ui, search_ui, tap, type_text, swipe, button, key, key_sequence, key_combo, touch, gesture, stream_video",
        "- list_windows, activate_app, screenshot_app, right_click, scroll, drag_drop, menu_action, get_focused_app, clipboard",
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
