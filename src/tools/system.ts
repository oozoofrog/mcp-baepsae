import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveTargetArgs, pushOption, runNative } from "../utils.js";

export function registerSystemTools(server: McpServer): void {
  server.tool(
    "list_windows",
    "List windows of a macOS app or simulator.",
    {
      udid: z.string().min(1).optional(),
      bundleId: z.string().optional(),
      appName: z.string().optional(),
    },
    async (params) => {
      const target = resolveTargetArgs(params);
      if (!Array.isArray(target)) return target;
      return await runNative(["list-windows", ...target]);
    }
  );

  server.tool(
    "activate_app",
    "Bring a macOS app or simulator to foreground.",
    {
      udid: z.string().min(1).optional(),
      bundleId: z.string().optional(),
      appName: z.string().optional(),
    },
    async (params) => {
      const target = resolveTargetArgs(params);
      if (!Array.isArray(target)) return target;
      return await runNative(["activate-app", ...target]);
    }
  );

  server.tool(
    "screenshot_app",
    "Take a screenshot of a macOS app window.",
    {
      udid: z.string().min(1).optional(),
      bundleId: z.string().optional(),
      appName: z.string().optional(),
      output: z.string().optional().describe("Output file path"),
    },
    async (params) => {
      const target = resolveTargetArgs(params);
      if (!Array.isArray(target)) return target;
      const args = ["screenshot-app", ...target];
      pushOption(args, "--output", params.output);
      return await runNative(args);
    }
  );

  server.tool(
    "right_click",
    "Right-click on a macOS app element or coordinate.",
    {
      udid: z.string().min(1).optional(),
      bundleId: z.string().optional(),
      appName: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      id: z.string().optional(),
      label: z.string().optional(),
    },
    async (params) => {
      const target = resolveTargetArgs(params);
      if (!Array.isArray(target)) return target;
      const args = ["right-click", ...target];
      pushOption(args, "-x", params.x);
      pushOption(args, "-y", params.y);
      pushOption(args, "--id", params.id);
      pushOption(args, "--label", params.label);
      return await runNative(args);
    }
  );

  server.tool(
    "menu_action",
    "Execute a menu bar action in a macOS app.",
    {
      bundleId: z.string().optional(),
      appName: z.string().optional(),
      menu: z.string().describe("Menu name (e.g. 'File')"),
      item: z.string().describe("Menu item name (e.g. 'Save')"),
    },
    async (params) => {
      const args = ["menu-action"];
      if (params.bundleId) args.push("--bundle-id", params.bundleId);
      else if (params.appName) args.push("--app-name", params.appName);
      else return { content: [{ type: "text", text: "Provide bundleId or appName." }], isError: true };
      args.push("--menu", params.menu, "--item", params.item);
      return await runNative(args);
    }
  );

  server.tool(
    "clipboard",
    "Read or write the system clipboard.",
    {
      action: z.enum(["read", "write"]).describe("Read or write clipboard"),
      text: z.string().optional().describe("Text to write (required for write action)"),
    },
    async (params) => {
      const args = ["clipboard"];
      if (params.action === "read") {
        args.push("--read");
      } else {
        if (!params.text) return { content: [{ type: "text", text: "text is required for write action." }], isError: true };
        args.push("--write", params.text);
      }
      return await runNative(args);
    }
  );
}
