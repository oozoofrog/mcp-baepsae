import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { ToolTextResult } from "../types.js";
import {
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

type DescribeParams = {
  output?: string;
  focusId?: string;
  all?: boolean;
  offset?: number;
  limit?: number;
  rootElementId?: string;
  role?: string;
  visibleOnly?: boolean;
  maxDepth?: number;
  summary?: boolean;
};

type SearchParams = {
  query: string;
  role?: string;
  visibleOnly?: boolean;
  maxDepth?: number;
};

type TapParams = {
  x?: number;
  y?: number;
  id?: string;
  label?: string;
  all?: boolean;
  double?: boolean;
  preDelay?: number;
  postDelay?: number;
};

type TypeParams = {
  text?: string;
  stdinText?: string;
  file?: string;
};

type SwipeParams = {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  duration?: number;
  preDelay?: number;
  postDelay?: number;
};

type ScrollParams = {
  deltaX?: number;
  deltaY?: number;
  x?: number;
  y?: number;
};

type DragDropParams = {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  duration?: number;
};

const simTargetSchema = {
  udid: z.string().min(1).describe("Simulator UDID"),
};

const macTargetSchema = {
  bundleId: z.string().optional().describe("macOS app bundle ID"),
  appName: z.string().optional().describe("macOS app name"),
};

const describeSchema = {
  output: z.string().optional().describe("Optional output file path for hierarchy text"),
  focusId: z.string().optional().describe("Focus on element with specific ID"),
  all: z.boolean().optional().describe("Include all elements (system UI, bezels)"),
  offset: z.number().int().min(0).optional().describe("Pagination start position (0-based node index)"),
  limit: z.number().int().min(1).optional().describe("Maximum number of nodes to return"),
  rootElementId: z.string().optional().describe("Only traverse subtree under this element ID"),
  role: z.string().optional().describe("Filter by AX role (e.g. AXButton, AXStaticText)"),
  visibleOnly: z.boolean().optional().describe("Only include visible elements"),
  maxDepth: z.number().int().min(0).optional().describe("Maximum tree traversal depth"),
  summary: z.boolean().optional().describe("Summary mode — collapse children as [N children]"),
};

const searchSchema = {
  query: z.string().min(1).describe("Text to search for"),
  role: z.string().optional().describe("Filter by AX role (e.g. AXButton, AXStaticText)"),
  visibleOnly: z.boolean().optional().describe("Only include visible elements"),
  maxDepth: z.number().int().min(0).optional().describe("Maximum tree traversal depth"),
};

const tapSchema = {
  x: z.number().optional().describe("X coordinate"),
  y: z.number().optional().describe("Y coordinate"),
  id: z.string().optional().describe("Accessibility identifier"),
  label: z.string().optional().describe("Accessibility label"),
  all: z.boolean().optional().describe("Include Simulator app chrome/system UI for selector lookup"),
  double: z.boolean().optional().describe("Send double-click instead of single click"),
  preDelay: z.number().optional().describe("Delay before tap in seconds"),
  postDelay: z.number().optional().describe("Delay after tap in seconds"),
};

const tapSchemaWithoutAll = {
  x: z.number().optional().describe("X coordinate"),
  y: z.number().optional().describe("Y coordinate"),
  id: z.string().optional().describe("Accessibility identifier"),
  label: z.string().optional().describe("Accessibility label"),
  double: z.boolean().optional().describe("Send double-click instead of single click"),
  preDelay: z.number().optional().describe("Delay before tap in seconds"),
  postDelay: z.number().optional().describe("Delay after tap in seconds"),
};

const typeSchema = {
  text: z.string().optional().describe("Text argument"),
  stdinText: z.string().optional().describe("Text piped to stdin mode"),
  file: z.string().optional().describe("Path for file input"),
};

const swipeSchema = {
  startX: z.number().describe("Start X"),
  startY: z.number().describe("Start Y"),
  endX: z.number().describe("End X"),
  endY: z.number().describe("End Y"),
  duration: z.number().optional().describe("Duration in seconds"),
  preDelay: z.number().optional().describe("Delay before swipe in seconds"),
  postDelay: z.number().optional().describe("Delay after swipe in seconds"),
};

const scrollSchema = {
  deltaX: z.number().optional().describe("Horizontal scroll amount"),
  deltaY: z.number().optional().describe("Vertical scroll amount"),
  x: z.number().optional().describe("X coordinate for scroll position"),
  y: z.number().optional().describe("Y coordinate for scroll position"),
};

const dragDropSchema = {
  startX: z.number().describe("Start X"),
  startY: z.number().describe("Start Y"),
  endX: z.number().describe("End X"),
  endY: z.number().describe("End Y"),
  duration: z.number().optional().describe("Duration in seconds"),
};

function validateTapParams(params: TapParams): ToolTextResult | null {
  const hasX = params.x !== undefined;
  const hasY = params.y !== undefined;
  const hasSelector = params.id !== undefined || params.label !== undefined;

  if (hasX !== hasY) {
    return {
      content: [{ type: "text", text: "Both x and y must be provided together." }],
      isError: true,
    };
  }

  if (hasX && hasSelector) {
    return {
      content: [{ type: "text", text: "Provide either x/y coordinates or id/label, not both." }],
      isError: true,
    };
  }

  if (!hasX && !params.id && !params.label) {
    return {
      content: [{ type: "text", text: "Provide either x/y coordinates, id, or label." }],
      isError: true,
    };
  }

  return null;
}

function validateTypeParams(params: TypeParams): ToolTextResult | null {
  const modes = [params.text !== undefined, params.stdinText !== undefined, params.file !== undefined].filter(Boolean).length;
  if (modes !== 1) {
    return {
      content: [{ type: "text", text: "Provide exactly one of text, stdinText, or file." }],
      isError: true,
    };
  }
  return null;
}

function buildDescribeArgs(target: string[], params: DescribeParams): string[] {
  const args = ["describe-ui", ...target];
  pushOption(args, "--output", params.output);
  pushOption(args, "--focus-id", params.focusId);
  if (params.all) {
    args.push("--all");
  }
  pushOption(args, "--offset", params.offset);
  pushOption(args, "--limit", params.limit);
  pushOption(args, "--root-element-id", params.rootElementId);
  pushOption(args, "--role", params.role);
  if (params.visibleOnly) {
    args.push("--visible-only");
  }
  pushOption(args, "--max-depth", params.maxDepth);
  if (params.summary) {
    args.push("--summary");
  }
  return args;
}

function buildSearchArgs(target: string[], params: SearchParams): string[] {
  const args = ["search-ui", ...target, "--query", params.query];
  pushOption(args, "--role", params.role);
  if (params.visibleOnly) {
    args.push("--visible-only");
  }
  pushOption(args, "--max-depth", params.maxDepth);
  return args;
}

function buildTapArgs(target: string[], params: TapParams): string[] {
  const args = ["tap"];
  pushOption(args, "-x", params.x);
  pushOption(args, "-y", params.y);
  pushOption(args, "--id", params.id);
  pushOption(args, "--label", params.label);
  if (params.all) {
    args.push("--all");
  }
  if (params.double) {
    args.push("--double");
  }
  pushOption(args, "--pre-delay", params.preDelay);
  pushOption(args, "--post-delay", params.postDelay);
  args.push(...target);
  return args;
}

function buildTypeArgs(target: string[], params: TypeParams): { args: string[]; stdinText?: string } {
  const args = ["type"];
  if (params.text !== undefined) {
    args.push(params.text);
  }
  if (params.stdinText !== undefined) {
    args.push("--stdin");
  }
  if (params.file !== undefined) {
    args.push("--file", params.file);
  }
  args.push(...target);
  return { args, stdinText: params.stdinText };
}

function buildSwipeArgs(target: string[], params: SwipeParams): string[] {
  const args = [
    "swipe",
    "--start-x",
    String(params.startX),
    "--start-y",
    String(params.startY),
    "--end-x",
    String(params.endX),
    "--end-y",
    String(params.endY),
  ];
  pushOption(args, "--duration", params.duration);
  pushOption(args, "--pre-delay", params.preDelay);
  pushOption(args, "--post-delay", params.postDelay);
  args.push(...target);
  return args;
}

function buildScrollArgs(target: string[], params: ScrollParams): string[] {
  const args = ["scroll", ...target];
  pushOption(args, "--delta-x", params.deltaX);
  pushOption(args, "--delta-y", params.deltaY);
  pushOption(args, "-x", params.x);
  pushOption(args, "-y", params.y);
  return args;
}

function buildDragDropArgs(target: string[], params: DragDropParams): string[] {
  const args = ["drag-drop", ...target];
  args.push("--start-x", String(params.startX), "--start-y", String(params.startY));
  args.push("--end-x", String(params.endX), "--end-y", String(params.endY));
  pushOption(args, "--duration", params.duration);
  return args;
}

export function registerUITools(server: McpServer): void {
  const registerDescribeTool = (
    name: string,
    description: string,
    targetSchema: Record<string, z.ZodTypeAny>,
    resolveTarget: (params: AnyTargetParams) => string[] | ToolTextResult
  ) => {
    server.tool(name, description, { ...targetSchema, ...describeSchema }, async (params) => {
      const target = resolveTarget(params as AnyTargetParams);
      if (!Array.isArray(target)) return target;
      return await runNative(buildDescribeArgs(target, params as DescribeParams));
    });
  };

  const registerSearchTool = (
    name: string,
    description: string,
    targetSchema: Record<string, z.ZodTypeAny>,
    resolveTarget: (params: AnyTargetParams) => string[] | ToolTextResult
  ) => {
    server.tool(name, description, { ...targetSchema, ...searchSchema }, async (params) => {
      const target = resolveTarget(params as AnyTargetParams);
      if (!Array.isArray(target)) return target;
      return await runNative(buildSearchArgs(target, params as SearchParams));
    });
  };

  const registerTapTool = (
    name: string,
    description: string,
    targetSchema: Record<string, z.ZodTypeAny>,
    tapSchemaVariant: Record<string, z.ZodTypeAny>,
    resolveTarget: (params: AnyTargetParams) => string[] | ToolTextResult
  ) => {
    server.tool(name, description, { ...targetSchema, ...tapSchemaVariant }, async (params) => {
      const validationError = validateTapParams(params as TapParams);
      if (validationError) return validationError;

      const target = resolveTarget(params as AnyTargetParams);
      if (!Array.isArray(target)) return target;
      return await runNative(buildTapArgs(target, params as TapParams));
    });
  };

  const registerTypeTool = (
    name: string,
    description: string,
    targetSchema: Record<string, z.ZodTypeAny>,
    resolveTarget: (params: AnyTargetParams) => string[] | ToolTextResult
  ) => {
    server.tool(name, description, { ...targetSchema, ...typeSchema }, async (params) => {
      const validationError = validateTypeParams(params as TypeParams);
      if (validationError) return validationError;

      const target = resolveTarget(params as AnyTargetParams);
      if (!Array.isArray(target)) return target;

      const built = buildTypeArgs(target, params as TypeParams);
      return await runNative(built.args, { stdinText: built.stdinText });
    });
  };

  const registerSwipeTool = (
    name: string,
    description: string,
    targetSchema: Record<string, z.ZodTypeAny>,
    resolveTarget: (params: AnyTargetParams) => string[] | ToolTextResult
  ) => {
    server.tool(name, description, { ...targetSchema, ...swipeSchema }, async (params) => {
      const target = resolveTarget(params as AnyTargetParams);
      if (!Array.isArray(target)) return target;
      return await runNative(buildSwipeArgs(target, params as SwipeParams));
    });
  };

  const registerScrollTool = (
    name: string,
    description: string,
    targetSchema: Record<string, z.ZodTypeAny>,
    resolveTarget: (params: AnyTargetParams) => string[] | ToolTextResult
  ) => {
    server.tool(name, description, { ...targetSchema, ...scrollSchema }, async (params) => {
      const target = resolveTarget(params as AnyTargetParams);
      if (!Array.isArray(target)) return target;
      return await runNative(buildScrollArgs(target, params as ScrollParams));
    });
  };

  const registerDragDropTool = (
    name: string,
    description: string,
    targetSchema: Record<string, z.ZodTypeAny>,
    resolveTarget: (params: AnyTargetParams) => string[] | ToolTextResult
  ) => {
    server.tool(name, description, { ...targetSchema, ...dragDropSchema }, async (params) => {
      const target = resolveTarget(params as AnyTargetParams);
      if (!Array.isArray(target)) return target;
      return await runNative(buildDragDropArgs(target, params as DragDropParams));
    });
  };

  // Explicit simulator/macOS split tools
  registerDescribeTool(
    "sim_describe_ui",
    "Describe Simulator app UI hierarchy (inside simulator app content by default).",
    simTargetSchema,
    resolveSimulatorTargetArgs
  );
  registerDescribeTool(
    "mac_describe_ui",
    "Describe macOS app UI hierarchy.",
    macTargetSchema,
    resolveMacTargetArgs
  );

  registerSearchTool(
    "sim_search_ui",
    "Search Simulator app UI elements by text, identifier, or label.",
    simTargetSchema,
    resolveSimulatorTargetArgs
  );
  registerSearchTool(
    "mac_search_ui",
    "Search macOS app UI elements by text, identifier, or label.",
    macTargetSchema,
    resolveMacTargetArgs
  );

  registerTapTool(
    "sim_tap",
    "Tap simulator coordinates or in-app accessibility element. Selector lookup defaults to in-app content; set all=true to include Simulator chrome UI.",
    simTargetSchema,
    tapSchema,
    resolveSimulatorTargetArgs
  );
  registerTapTool(
    "mac_tap",
    "Tap macOS app coordinates or accessibility element.",
    macTargetSchema,
    tapSchemaWithoutAll,
    resolveMacTargetArgs
  );

  registerTypeTool("sim_type_text", "Type text in Simulator target.", simTargetSchema, resolveSimulatorTargetArgs);
  registerTypeTool("mac_type_text", "Type text in macOS app target.", macTargetSchema, resolveMacTargetArgs);

  registerSwipeTool("sim_swipe", "Perform swipe gesture in Simulator target.", simTargetSchema, resolveSimulatorTargetArgs);
  registerSwipeTool("mac_swipe", "Perform swipe gesture in macOS app target.", macTargetSchema, resolveMacTargetArgs);

  registerScrollTool("sim_scroll", "Send scroll wheel events to Simulator target.", simTargetSchema, resolveSimulatorTargetArgs);
  registerScrollTool("mac_scroll", "Send scroll wheel events to macOS app target.", macTargetSchema, resolveMacTargetArgs);

  registerDragDropTool("sim_drag_drop", "Drag and drop in Simulator target.", simTargetSchema, resolveSimulatorTargetArgs);
  registerDragDropTool("mac_drag_drop", "Drag and drop in macOS app target.", macTargetSchema, resolveMacTargetArgs);
}
