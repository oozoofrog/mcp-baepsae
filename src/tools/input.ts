import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { ToolTextResult } from "../types.js";
import {
  keycodeSchema,
  BUTTON_TYPES,
  GESTURE_PRESETS,
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

type KeyParams = {
  keycode: number;
  duration?: number;
};

type KeySequenceParams = {
  keycodes: number[] | string;
  delay?: number;
};

type KeyComboParams = {
  modifiers: number[];
  key: number;
};

type TouchParams = {
  x: number;
  y: number;
  down?: boolean;
  up?: boolean;
  delay?: number;
};

const mixedTargetSchema = {
  udid: z.string().min(1).optional().describe("Simulator UDID"),
  bundleId: z.string().optional().describe("macOS app bundle ID"),
  appName: z.string().optional().describe("macOS app name"),
};

const simTargetSchema = {
  udid: z.string().min(1).describe("Simulator UDID"),
};

const macTargetSchema = {
  bundleId: z.string().optional().describe("macOS app bundle ID"),
  appName: z.string().optional().describe("macOS app name"),
};

const keySchema = {
  keycode: keycodeSchema.describe("HID keycode (0-255)"),
  duration: z.number().optional().describe("Hold duration in seconds"),
};

const keySequenceSchema = {
  keycodes: z
    .union([
      z.array(keycodeSchema).min(1).describe("Array of HID keycodes"),
      z.string().min(1).describe("Comma-separated HID keycodes"),
    ])
    .describe("Key sequence"),
  delay: z.number().optional().describe("Delay between key presses in seconds"),
};

const keyComboSchema = {
  modifiers: z.array(keycodeSchema).min(1).describe("Modifier keycodes"),
  key: keycodeSchema.describe("Keycode to press while modifiers are held"),
};

const touchSchema = {
  x: z.number().describe("X coordinate"),
  y: z.number().describe("Y coordinate"),
  down: z.boolean().optional().describe("Send touch down event"),
  up: z.boolean().optional().describe("Send touch up event"),
  delay: z.number().optional().describe("Delay between down/up in seconds"),
};

function buildKeyArgs(target: string[], params: KeyParams): string[] {
  const args = ["key", String(params.keycode)];
  pushOption(args, "--duration", params.duration);
  args.push(...target);
  return args;
}

function buildKeySequenceArgs(target: string[], params: KeySequenceParams): string[] {
  const keycodes = Array.isArray(params.keycodes) ? params.keycodes.join(",") : params.keycodes;
  const args = ["key-sequence", "--keycodes", keycodes];
  pushOption(args, "--delay", params.delay);
  args.push(...target);
  return args;
}

function buildKeyComboArgs(target: string[], params: KeyComboParams): string[] {
  return [
    "key-combo",
    "--modifiers",
    params.modifiers.join(","),
    "--key",
    String(params.key),
    ...target,
  ];
}

function buildTouchArgs(target: string[], params: TouchParams): string[] {
  const args = ["touch", "-x", String(params.x), "-y", String(params.y)];
  if (params.down === undefined && params.up === undefined) {
    args.push("--down", "--up");
  } else {
    if (params.down) {
      args.push("--down");
    }
    if (params.up) {
      args.push("--up");
    }
  }
  pushOption(args, "--delay", params.delay);
  args.push(...target);
  return args;
}

export function registerInputTools(server: McpServer): void {
  const registerKeyTool = (
    name: string,
    description: string,
    targetSchema: Record<string, z.ZodTypeAny>,
    resolveTarget: (params: AnyTargetParams) => string[] | ToolTextResult
  ) => {
    server.tool(name, description, { ...targetSchema, ...keySchema }, async (params) => {
      const target = resolveTarget(params as AnyTargetParams);
      if (!Array.isArray(target)) return target;
      return await runNative(buildKeyArgs(target, params as KeyParams));
    });
  };

  const registerKeySequenceTool = (
    name: string,
    description: string,
    targetSchema: Record<string, z.ZodTypeAny>,
    resolveTarget: (params: AnyTargetParams) => string[] | ToolTextResult
  ) => {
    server.tool(name, description, { ...targetSchema, ...keySequenceSchema }, async (params) => {
      const target = resolveTarget(params as AnyTargetParams);
      if (!Array.isArray(target)) return target;
      return await runNative(buildKeySequenceArgs(target, params as KeySequenceParams));
    });
  };

  const registerKeyComboTool = (
    name: string,
    description: string,
    targetSchema: Record<string, z.ZodTypeAny>,
    resolveTarget: (params: AnyTargetParams) => string[] | ToolTextResult
  ) => {
    server.tool(name, description, { ...targetSchema, ...keyComboSchema }, async (params) => {
      const target = resolveTarget(params as AnyTargetParams);
      if (!Array.isArray(target)) return target;
      return await runNative(buildKeyComboArgs(target, params as KeyComboParams));
    });
  };

  const registerTouchTool = (
    name: string,
    description: string,
    targetSchema: Record<string, z.ZodTypeAny>,
    resolveTarget: (params: AnyTargetParams) => string[] | ToolTextResult
  ) => {
    server.tool(name, description, { ...targetSchema, ...touchSchema }, async (params) => {
      const target = resolveTarget(params as AnyTargetParams);
      if (!Array.isArray(target)) return target;
      return await runNative(buildTouchArgs(target, params as TouchParams));
    });
  };

  server.tool(
    "button",
    "Press a simulator hardware button.",
    {
      udid: z.string().min(1).describe("Simulator UDID"),
      buttonType: z.enum(BUTTON_TYPES).describe("Button type"),
      duration: z.number().optional().describe("Hold duration in seconds"),
    },
    async (params) => {
      const args = ["button", params.buttonType];
      pushOption(args, "--duration", params.duration);
      args.push("--udid", params.udid);
      return await runNative(args);
    }
  );

  registerKeyTool(
    "key",
    "[DEPRECATED: use sim_key or mac_key] Press a single HID keycode.",
    mixedTargetSchema,
    resolveTargetArgs
  );
  registerKeySequenceTool(
    "key_sequence",
    "[DEPRECATED: use sim_key_sequence or mac_key_sequence] Press multiple HID keycodes in sequence.",
    mixedTargetSchema,
    resolveTargetArgs
  );
  registerKeyComboTool(
    "key_combo",
    "[DEPRECATED: use sim_key_combo or mac_key_combo] Press a key while holding modifiers.",
    mixedTargetSchema,
    resolveTargetArgs
  );
  registerTouchTool(
    "touch",
    "[DEPRECATED: use sim_touch or mac_touch] Perform touch down/up events at coordinates.",
    mixedTargetSchema,
    resolveTargetArgs
  );

  registerKeyTool("sim_key", "Press a single HID keycode in Simulator target.", simTargetSchema, resolveSimulatorTargetArgs);
  registerKeyTool("mac_key", "Press a single HID keycode in macOS app target.", macTargetSchema, resolveMacTargetArgs);

  registerKeySequenceTool(
    "sim_key_sequence",
    "Press multiple HID keycodes in sequence in Simulator target.",
    simTargetSchema,
    resolveSimulatorTargetArgs
  );
  registerKeySequenceTool(
    "mac_key_sequence",
    "Press multiple HID keycodes in sequence in macOS app target.",
    macTargetSchema,
    resolveMacTargetArgs
  );

  registerKeyComboTool(
    "sim_key_combo",
    "Press key combo in Simulator target.",
    simTargetSchema,
    resolveSimulatorTargetArgs
  );
  registerKeyComboTool(
    "mac_key_combo",
    "Press key combo in macOS app target.",
    macTargetSchema,
    resolveMacTargetArgs
  );

  registerTouchTool("sim_touch", "Perform touch events in Simulator target.", simTargetSchema, resolveSimulatorTargetArgs);
  registerTouchTool("mac_touch", "Perform touch events in macOS app target.", macTargetSchema, resolveMacTargetArgs);

  server.tool(
    "gesture",
    "Execute a preset gesture pattern.",
    {
      udid: z.string().min(1).describe("Simulator UDID"),
      preset: z.enum(GESTURE_PRESETS).describe("Gesture preset"),
      screenWidth: z.number().optional().describe("Screen width in points"),
      screenHeight: z.number().optional().describe("Screen height in points"),
      duration: z.number().optional().describe("Gesture duration in seconds"),
      preDelay: z.number().optional().describe("Delay before gesture in seconds"),
      postDelay: z.number().optional().describe("Delay after gesture in seconds"),
    },
    async (params) => {
      const args = ["gesture", params.preset];
      pushOption(args, "--screen-width", params.screenWidth);
      pushOption(args, "--screen-height", params.screenHeight);
      pushOption(args, "--duration", params.duration);
      pushOption(args, "--pre-delay", params.preDelay);
      pushOption(args, "--post-delay", params.postDelay);
      args.push("--udid", params.udid);
      return await runNative(args);
    }
  );
}
