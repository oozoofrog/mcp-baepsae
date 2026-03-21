import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { ToolTextResult, UnifiedTargetParams } from "../types.js";
import {
  unifiedTargetSchema,
  resolveUnifiedTargetArgs,
  pushOption,
  runNative,
  makeToolError,
} from "../utils.js";

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
  method?: "auto" | "paste" | "keyboard";
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
  holdDuration?: number;
};

type TapTabParams = {
  index: number;
  tabCount?: number;
  preDelay?: number;
  postDelay?: number;
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

const typeSchema = {
  text: z.string().optional().describe("Text argument"),
  stdinText: z.string().optional().describe("Text piped to stdin mode"),
  file: z.string().optional().describe("Path for file input"),
  method: z.enum(["auto", "paste", "keyboard"]).optional().describe(
    "Input method policy: 'auto' chooses paste for simulator targets and keyboard for macOS targets; 'paste' always uses the clipboard-backed paste path; 'keyboard' always types character-by-character. Paste temporarily overwrites the clipboard and restores it after submission."
  ),
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
  holdDuration: z.number().optional().describe("Hold duration before drag in seconds"),
};

const tapTabSchema = {
  index: z.number().int().min(0).describe("0-based tab index to tap"),
  tabCount: z.number().int().min(1).optional().describe("Total number of tabs (auto-detected from tab bar children if omitted)"),
  preDelay: z.number().optional().describe("Delay before tap in seconds"),
  postDelay: z.number().optional().describe("Delay after tap in seconds"),
};

function validateTapParams(params: TapParams): ToolTextResult | null {
  const hasX = params.x !== undefined;
  const hasY = params.y !== undefined;
  const hasSelector = params.id !== undefined || params.label !== undefined;

  if (hasX !== hasY) {
    return {
      content: [{ type: "text", text: "Both x and y must be provided together." }],
      isError: true,
      error: makeToolError({
        code: "validation.tap.coordinate_pair",
        category: "validation",
        message: "Both x and y must be provided together.",
      }),
    };
  }

  if (hasX && hasSelector) {
    return {
      content: [{ type: "text", text: "Provide either x/y coordinates or id/label, not both." }],
      isError: true,
      error: makeToolError({
        code: "validation.tap.selector_conflict",
        category: "validation",
        message: "Provide either x/y coordinates or id/label, not both.",
      }),
    };
  }

  if (!hasX && !params.id && !params.label) {
    return {
      content: [{ type: "text", text: "Provide either x/y coordinates, id, or label." }],
      isError: true,
      error: makeToolError({
        code: "validation.tap.selector_required",
        category: "validation",
        message: "Provide either x/y coordinates, id, or label.",
      }),
    };
  }

  return null;
}

function validateTapTabParams(params: TapTabParams): ToolTextResult | null {
  if (params.tabCount !== undefined && params.index >= params.tabCount) {
    return {
      content: [{ type: "text", text: `Tab index ${params.index} is out of range. Valid range: 0..${params.tabCount - 1}` }],
      isError: true,
      error: makeToolError({
        code: "validation.tap_tab.out_of_range",
        category: "validation",
        message: `Tab index ${params.index} is out of range. Valid range: 0..${params.tabCount - 1}`,
      }),
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
      error: makeToolError({
        code: "validation.type.source_required",
        category: "validation",
        message: "Provide exactly one of text, stdinText, or file.",
      }),
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
  if (params.method !== undefined) {
    args.push("--method", params.method);
  }
  args.push(...target);
  return { args, stdinText: params.stdinText };
}

function resolveTypeTextPolicy(
  params: TypeParams,
  target: UnifiedTargetParams
): { requestedMethod: "auto" | "paste" | "keyboard"; usedMethod: "paste" | "keyboard"; targetKind: "simulator" | "macOS"; inputSource: "text" | "stdinText" | "file" } {
  const requestedMethod = params.method ?? "auto";
  const targetKind: "simulator" | "macOS" = target.udid ? "simulator" : "macOS";
  const usedMethod =
    requestedMethod === "auto"
      ? targetKind === "simulator"
        ? "paste"
        : "keyboard"
      : requestedMethod;
  const inputSource = params.stdinText !== undefined ? "stdinText" : params.file !== undefined ? "file" : "text";
  return { requestedMethod, usedMethod, targetKind, inputSource };
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
  pushOption(args, "--hold-duration", params.holdDuration);
  return args;
}

function buildTapTabArgs(target: string[], params: TapTabParams): string[] {
  const args = ["tap-tab", ...target, "--index", String(params.index)];
  pushOption(args, "--tab-count", params.tabCount);
  pushOption(args, "--pre-delay", params.preDelay);
  pushOption(args, "--post-delay", params.postDelay);
  return args;
}

export function registerUITools(server: McpServer): void {
  server.tool(
    "analyze_ui",
    "Describe app UI hierarchy. Works with both simulator (udid) and macOS (bundleId/appName) targets.",
    { ...unifiedTargetSchema, ...describeSchema },
    async (params) => {
      const target = resolveUnifiedTargetArgs(params as UnifiedTargetParams);
      if (!Array.isArray(target)) return target;
      return await runNative(buildDescribeArgs(target, params as DescribeParams));
    }
  );

  server.tool(
    "query_ui",
    "Search app UI elements by text, identifier, or label. Works with both simulator and macOS targets.",
    { ...unifiedTargetSchema, ...searchSchema },
    async (params) => {
      const target = resolveUnifiedTargetArgs(params as UnifiedTargetParams);
      if (!Array.isArray(target)) return target;
      return await runNative(buildSearchArgs(target, params as SearchParams));
    }
  );

  server.tool(
    "tap",
    "Tap coordinates or accessibility element. Selector lookup defaults to in-app content; set all=true to include Simulator chrome UI.",
    { ...unifiedTargetSchema, ...tapSchema },
    async (params) => {
      const validationError = validateTapParams(params as TapParams);
      if (validationError) return validationError;

      const target = resolveUnifiedTargetArgs(params as UnifiedTargetParams);
      if (!Array.isArray(target)) return target;
      return await runNative(buildTapArgs(target, params as TapParams));
    }
  );

  server.tool(
    "type_text",
    "Type text into the target app. auto resolves to paste on simulators and keyboard on macOS; paste temporarily uses the clipboard; keyboard types character-by-character.",
    { ...unifiedTargetSchema, ...typeSchema },
    async (params) => {
      const validationError = validateTypeParams(params as TypeParams);
      if (validationError) return validationError;

      const target = resolveUnifiedTargetArgs(params as UnifiedTargetParams);
      if (!Array.isArray(target)) return target;

      const built = buildTypeArgs(target, params as TypeParams);
      const policy = resolveTypeTextPolicy(params as TypeParams, params as UnifiedTargetParams);
      const extraLines = [
        `Input source: ${policy.inputSource}`,
        `Target kind: ${policy.targetKind}`,
        `Requested method: ${policy.requestedMethod}`,
        `Used method: ${policy.usedMethod}`,
      ];
      if (policy.usedMethod === "paste") {
        extraLines.push("Clipboard side effect: clipboard is temporarily replaced with the input text and restored after paste.");
      } else {
        extraLines.push("Clipboard side effect: none.");
      }
      if (policy.requestedMethod === "auto") {
        extraLines.push(`Auto fallback: ${policy.targetKind === "simulator" ? "paste" : "keyboard"}.`);
      }
      return await runNative(built.args, { stdinText: built.stdinText }, { extraLines });
    }
  );

  server.tool(
    "swipe",
    "Perform swipe gesture in the target app.",
    { ...unifiedTargetSchema, ...swipeSchema },
    async (params) => {
      const target = resolveUnifiedTargetArgs(params as UnifiedTargetParams);
      if (!Array.isArray(target)) return target;
      return await runNative(buildSwipeArgs(target, params as SwipeParams));
    }
  );

  server.tool(
    "scroll",
    "Send scroll wheel events to the target app.",
    { ...unifiedTargetSchema, ...scrollSchema },
    async (params) => {
      const target = resolveUnifiedTargetArgs(params as UnifiedTargetParams);
      if (!Array.isArray(target)) return target;
      return await runNative(buildScrollArgs(target, params as ScrollParams));
    }
  );

  server.tool(
    "drag_drop",
    "Drag and drop in the target app.",
    { ...unifiedTargetSchema, ...dragDropSchema },
    async (params) => {
      const target = resolveUnifiedTargetArgs(params as UnifiedTargetParams);
      if (!Array.isArray(target)) return target;
      return await runNative(buildDragDropArgs(target, params as DragDropParams));
    }
  );

  server.tool(
    "tap_tab",
    "Tap a tab in a tab bar by index. Workaround for SwiftUI TabView where individual tab buttons are not exposed in the accessibility tree. Finds the tab bar element and calculates tap coordinates by dividing it equally.",
    { ...unifiedTargetSchema, ...tapTabSchema },
    async (params) => {
      const validationError = validateTapTabParams(params as TapTabParams);
      if (validationError) return validationError;

      const target = resolveUnifiedTargetArgs(params as UnifiedTargetParams);
      if (!Array.isArray(target)) return target;
      return await runNative(buildTapTabArgs(target, params as TapTabParams));
    }
  );
}
