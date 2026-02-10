import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveTargetArgs, pushOption, runNative } from "../utils.js";

export function registerUITools(server: McpServer): void {
  server.tool(
    "describe_ui",
    "Describe UI hierarchy. Works with iOS Simulator (udid) or macOS app (bundleId/appName). Supports pagination (offset/limit), subtree filtering (rootElementId), role filtering, visible-only mode, depth limiting, and summary mode.",
    {
      udid: z.string().min(1).optional().describe("Simulator UDID"),
      bundleId: z.string().optional().describe("macOS app bundle ID"),
      appName: z.string().optional().describe("macOS app name"),
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
    },
    async (params) => {
      const target = resolveTargetArgs(params);
      if (!Array.isArray(target)) return target;

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
      return await runNative(args);
    }
  );

  server.tool(
    "search_ui",
    "Search for UI elements by text, identifier, or label. Works with iOS Simulator (udid) or macOS app (bundleId/appName). Supports role filtering, visible-only mode, and depth limiting.",
    {
      udid: z.string().min(1).optional().describe("Simulator UDID"),
      bundleId: z.string().optional().describe("macOS app bundle ID"),
      appName: z.string().optional().describe("macOS app name"),
      query: z.string().min(1).describe("Text to search for"),
      role: z.string().optional().describe("Filter by AX role (e.g. AXButton, AXStaticText)"),
      visibleOnly: z.boolean().optional().describe("Only include visible elements"),
      maxDepth: z.number().int().min(0).optional().describe("Maximum tree traversal depth"),
    },
    async (params) => {
      const target = resolveTargetArgs(params);
      if (!Array.isArray(target)) return target;

      const args = ["search-ui", ...target, "--query", params.query];
      pushOption(args, "--role", params.role);
      if (params.visibleOnly) {
        args.push("--visible-only");
      }
      pushOption(args, "--max-depth", params.maxDepth);
      return await runNative(args);
    }
  );

  server.tool(
    "tap",
    "Tap coordinates or element by accessibility identifier/label. Works with iOS Simulator (udid) or macOS app (bundleId/appName).",
    {
      udid: z.string().min(1).optional().describe("Simulator UDID"),
      bundleId: z.string().optional().describe("macOS app bundle ID"),
      appName: z.string().optional().describe("macOS app name"),
      x: z.number().optional().describe("X coordinate"),
      y: z.number().optional().describe("Y coordinate"),
      id: z.string().optional().describe("Accessibility identifier"),
      label: z.string().optional().describe("Accessibility label"),
      double: z.boolean().optional().describe("Send double-click instead of single click"),
      preDelay: z.number().optional().describe("Delay before tap in seconds"),
      postDelay: z.number().optional().describe("Delay after tap in seconds"),
    },
    async (params) => {
      const target = resolveTargetArgs(params);
      if (!Array.isArray(target)) return target;

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

      const args = ["tap"];
      pushOption(args, "-x", params.x);
      pushOption(args, "-y", params.y);
      pushOption(args, "--id", params.id);
      pushOption(args, "--label", params.label);
      if (params.double) {
        args.push("--double");
      }
      pushOption(args, "--pre-delay", params.preDelay);
      pushOption(args, "--post-delay", params.postDelay);
      args.push(...target);

      return await runNative(args);
    }
  );

  server.tool(
    "type_text",
    "Type text. Works with iOS Simulator (udid) or macOS app (bundleId/appName).",
    {
      udid: z.string().min(1).optional().describe("Simulator UDID"),
      bundleId: z.string().optional().describe("macOS app bundle ID"),
      appName: z.string().optional().describe("macOS app name"),
      text: z.string().optional().describe("Text argument"),
      stdinText: z.string().optional().describe("Text piped to stdin mode"),
      file: z.string().optional().describe("Path for file input"),
    },
    async (params) => {
      const target = resolveTargetArgs(params);
      if (!Array.isArray(target)) return target;

      const modes = [params.text !== undefined, params.stdinText !== undefined, params.file !== undefined].filter(Boolean)
        .length;

      if (modes !== 1) {
        return {
          content: [{ type: "text", text: "Provide exactly one of text, stdinText, or file." }],
          isError: true,
        };
      }

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

      return await runNative(args, { stdinText: params.stdinText });
    }
  );

  server.tool(
    "swipe",
    "Perform a swipe gesture. Works with iOS Simulator (udid) or macOS app (bundleId/appName).",
    {
      udid: z.string().min(1).optional().describe("Simulator UDID"),
      bundleId: z.string().optional().describe("macOS app bundle ID"),
      appName: z.string().optional().describe("macOS app name"),
      startX: z.number().describe("Start X"),
      startY: z.number().describe("Start Y"),
      endX: z.number().describe("End X"),
      endY: z.number().describe("End Y"),
      duration: z.number().optional().describe("Duration in seconds"),
      preDelay: z.number().optional().describe("Delay before swipe in seconds"),
      postDelay: z.number().optional().describe("Delay after swipe in seconds"),
    },
    async (params) => {
      const target = resolveTargetArgs(params);
      if (!Array.isArray(target)) return target;

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

      return await runNative(args);
    }
  );

  server.tool(
    "scroll",
    "Send scroll wheel events to a macOS app.",
    {
      udid: z.string().min(1).optional(),
      bundleId: z.string().optional(),
      appName: z.string().optional(),
      deltaX: z.number().optional().describe("Horizontal scroll amount"),
      deltaY: z.number().optional().describe("Vertical scroll amount"),
      x: z.number().optional().describe("X coordinate for scroll position"),
      y: z.number().optional().describe("Y coordinate for scroll position"),
    },
    async (params) => {
      const target = resolveTargetArgs(params);
      if (!Array.isArray(target)) return target;
      const args = ["scroll", ...target];
      pushOption(args, "--delta-x", params.deltaX);
      pushOption(args, "--delta-y", params.deltaY);
      pushOption(args, "-x", params.x);
      pushOption(args, "-y", params.y);
      return await runNative(args);
    }
  );

  server.tool(
    "drag_drop",
    "Drag and drop between two points.",
    {
      udid: z.string().min(1).optional(),
      bundleId: z.string().optional(),
      appName: z.string().optional(),
      startX: z.number().describe("Start X"),
      startY: z.number().describe("Start Y"),
      endX: z.number().describe("End X"),
      endY: z.number().describe("End Y"),
      duration: z.number().optional().describe("Duration in seconds"),
    },
    async (params) => {
      const target = resolveTargetArgs(params);
      if (!Array.isArray(target)) return target;
      const args = ["drag-drop", ...target];
      args.push("--start-x", String(params.startX), "--start-y", String(params.startY));
      args.push("--end-x", String(params.endX), "--end-y", String(params.endY));
      pushOption(args, "--duration", params.duration);
      return await runNative(args);
    }
  );
}
