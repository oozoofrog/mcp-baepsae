import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { ToolTextResult } from "../types.js";
import {
  resolveTargetArgs,
  resolveSimulatorTargetArgs,
  resolveMacTargetArgs,
  pushOption,
  runNative,
} from "../utils.js";

type AnyTargetParams = {
  udid?: string;
  bundleId?: string;
  appName?: string;
};

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

const mixedTargetSchema = {
  udid: z.string().min(1).optional(),
  bundleId: z.string().optional(),
  appName: z.string().optional(),
};

const simTargetSchema = {
  udid: z.string().min(1),
};

const macTargetSchema = {
  bundleId: z.string().optional(),
  appName: z.string().optional(),
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

const rightClickSchemaWithoutAll = {
  x: z.number().optional(),
  y: z.number().optional(),
  id: z.string().optional(),
  label: z.string().optional(),
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
  const registerListWindowsTool = (
    name: string,
    description: string,
    targetSchema: Record<string, z.ZodTypeAny>,
    resolveTarget: (params: AnyTargetParams) => string[] | ToolTextResult
  ) => {
    server.tool(name, description, targetSchema, async (params) => {
      const target = resolveTarget(params as AnyTargetParams);
      if (!Array.isArray(target)) return target;
      return await runNative(["list-windows", ...target]);
    });
  };

  const registerActivateAppTool = (
    name: string,
    description: string,
    targetSchema: Record<string, z.ZodTypeAny>,
    resolveTarget: (params: AnyTargetParams) => string[] | ToolTextResult
  ) => {
    server.tool(name, description, targetSchema, async (params) => {
      const target = resolveTarget(params as AnyTargetParams);
      if (!Array.isArray(target)) return target;
      return await runNative(["activate-app", ...target]);
    });
  };

  const registerScreenshotAppTool = (
    name: string,
    description: string,
    targetSchema: Record<string, z.ZodTypeAny>,
    resolveTarget: (params: AnyTargetParams) => string[] | ToolTextResult
  ) => {
    server.tool(name, description, { ...targetSchema, ...screenshotSchema }, async (params) => {
      const target = resolveTarget(params as AnyTargetParams);
      if (!Array.isArray(target)) return target;
      return await runNative(buildScreenshotArgs(target, params as ScreenshotParams));
    });
  };

  const registerRightClickTool = (
    name: string,
    description: string,
    targetSchema: Record<string, z.ZodTypeAny>,
    schema: Record<string, z.ZodTypeAny>,
    resolveTarget: (params: AnyTargetParams) => string[] | ToolTextResult
  ) => {
    server.tool(name, description, { ...targetSchema, ...schema }, async (params) => {
      const target = resolveTarget(params as AnyTargetParams);
      if (!Array.isArray(target)) return target;
      return await runNative(buildRightClickArgs(target, params as RightClickParams));
    });
  };

  registerListWindowsTool(
    "list_windows",
    "[DEPRECATED: use sim_list_windows or mac_list_windows] List windows of a macOS app or simulator.",
    mixedTargetSchema,
    resolveTargetArgs
  );
  registerActivateAppTool(
    "activate_app",
    "[DEPRECATED: use sim_activate_app or mac_activate_app] Bring a macOS app or simulator to foreground.",
    mixedTargetSchema,
    resolveTargetArgs
  );
  registerScreenshotAppTool(
    "screenshot_app",
    "[DEPRECATED: use sim_screenshot_app or mac_screenshot_app] Take a screenshot of a target app window.",
    mixedTargetSchema,
    resolveTargetArgs
  );
  registerRightClickTool(
    "right_click",
    "[DEPRECATED: use sim_right_click or mac_right_click] Right-click on an app element or coordinate.",
    mixedTargetSchema,
    rightClickSchema,
    resolveTargetArgs
  );

  registerListWindowsTool("sim_list_windows", "List windows in Simulator target.", simTargetSchema, resolveSimulatorTargetArgs);
  registerListWindowsTool("mac_list_windows", "List windows in macOS app target.", macTargetSchema, resolveMacTargetArgs);

  registerActivateAppTool("sim_activate_app", "Bring Simulator target to foreground.", simTargetSchema, resolveSimulatorTargetArgs);
  registerActivateAppTool("mac_activate_app", "Bring macOS app target to foreground.", macTargetSchema, resolveMacTargetArgs);

  registerScreenshotAppTool(
    "sim_screenshot_app",
    "Take a screenshot of Simulator target window.",
    simTargetSchema,
    resolveSimulatorTargetArgs
  );
  registerScreenshotAppTool(
    "mac_screenshot_app",
    "Take a screenshot of macOS app target window.",
    macTargetSchema,
    resolveMacTargetArgs
  );

  registerRightClickTool(
    "sim_right_click",
    "Right-click in Simulator target (selector lookup defaults to in-app content; set all=true for Simulator chrome UI).",
    simTargetSchema,
    rightClickSchema,
    resolveSimulatorTargetArgs
  );
  registerRightClickTool(
    "mac_right_click",
    "Right-click in macOS app target.",
    macTargetSchema,
    rightClickSchemaWithoutAll,
    resolveMacTargetArgs
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
