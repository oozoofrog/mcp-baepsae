import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { UnifiedTargetParams } from "../types.js";
import {
  unifiedTargetSchema,
  resolveUnifiedTargetArgs,
  pushOption,
  runNative,
} from "../utils.js";

type ScreenshotParams = {
  output?: string;
};

type RightClickParams = {
  x?: number;
  y?: number;
  id?: string;
  label?: string;
  all?: boolean;
};

const screenshotSchema = {
  output: z.string().optional().describe("Output file path"),
};

const rightClickSchema = {
  x: z.number().optional(),
  y: z.number().optional(),
  id: z.string().optional(),
  label: z.string().optional(),
  all: z.boolean().optional(),
};

function buildScreenshotArgs(target: string[], params: ScreenshotParams): string[] {
  const args = ["screenshot-app", ...target];
  pushOption(args, "--output", params.output);
  return args;
}

function buildRightClickArgs(target: string[], params: RightClickParams): string[] {
  const args = ["right-click", ...target];
  pushOption(args, "-x", params.x);
  pushOption(args, "-y", params.y);
  pushOption(args, "--id", params.id);
  pushOption(args, "--label", params.label);
  if (params.all) args.push("--all");
  return args;
}

export function registerSystemTools(server: McpServer): void {
  server.tool(
    "list_windows",
    "List windows in the target app.",
    unifiedTargetSchema,
    async (params) => {
      const target = resolveUnifiedTargetArgs(params as UnifiedTargetParams);
      if (!Array.isArray(target)) return target;
      return await runNative(["list-windows", ...target]);
    }
  );

  server.tool(
    "activate_app",
    "Bring the target app to foreground.",
    unifiedTargetSchema,
    async (params) => {
      const target = resolveUnifiedTargetArgs(params as UnifiedTargetParams);
      if (!Array.isArray(target)) return target;
      return await runNative(["activate-app", ...target]);
    }
  );

  server.tool(
    "screenshot_app",
    "Take a screenshot of the target app window.",
    { ...unifiedTargetSchema, ...screenshotSchema },
    async (params) => {
      const target = resolveUnifiedTargetArgs(params as UnifiedTargetParams);
      if (!Array.isArray(target)) return target;
      return await runNative(buildScreenshotArgs(target, params as ScreenshotParams));
    }
  );

  server.tool(
    "right_click",
    "Right-click in the target app. Selector lookup defaults to in-app content; set all=true for Simulator chrome UI.",
    { ...unifiedTargetSchema, ...rightClickSchema },
    async (params) => {
      const target = resolveUnifiedTargetArgs(params as UnifiedTargetParams);
      if (!Array.isArray(target)) return target;
      return await runNative(buildRightClickArgs(target, params as RightClickParams));
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
