import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { UnifiedTargetParams } from "../types.js";
import {
  keycodeSchema,
  resolveKeycode,
  BUTTON_TYPES,
  GESTURE_PRESETS,
  unifiedTargetSchema,
  resolveUnifiedTargetArgs,
  pushOption,
} from "../utils.js";
import { runBackend } from "../backend.js";

type KeyParams = {
  keycode: number | string;
  duration?: number;
};

type KeySequenceParams = {
  keycodes: (number | string)[] | string;
  delay?: number;
};

type KeyComboParams = {
  modifiers: (number | string)[];
  key: number | string;
};

type TouchParams = {
  x: number;
  y: number;
  down?: boolean;
  up?: boolean;
  delay?: number;
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
  const args = ["key", String(resolveKeycode(params.keycode))];
  pushOption(args, "--duration", params.duration);
  args.push(...target);
  return args;
}

function buildKeySequenceArgs(target: string[], params: KeySequenceParams): string[] {
  const keycodes = Array.isArray(params.keycodes)
    ? params.keycodes.map(k => resolveKeycode(k)).join(",")
    : params.keycodes; // 쉼표 구분 숫자 문자열은 그대로 전달
  const args = ["key-sequence", "--keycodes", keycodes];
  pushOption(args, "--delay", params.delay);
  args.push(...target);
  return args;
}

function buildKeyComboArgs(target: string[], params: KeyComboParams): string[] {
  return [
    "key-combo",
    "--modifiers",
    params.modifiers.map(m => resolveKeycode(m)).join(","),
    "--key",
    String(resolveKeycode(params.key)),
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
      return await runBackend("input", args);
    }
  );

  server.tool(
    "key",
    "Press a single HID keycode in the target app.",
    { ...unifiedTargetSchema, ...keySchema },
    async (params) => {
      const target = resolveUnifiedTargetArgs(params as UnifiedTargetParams);
      if (!Array.isArray(target)) return target;
      return await runBackend("input", buildKeyArgs(target, params as KeyParams));
    }
  );

  server.tool(
    "key_sequence",
    "Press multiple HID keycodes in sequence in the target app.",
    { ...unifiedTargetSchema, ...keySequenceSchema },
    async (params) => {
      const target = resolveUnifiedTargetArgs(params as UnifiedTargetParams);
      if (!Array.isArray(target)) return target;
      return await runBackend("input", buildKeySequenceArgs(target, params as KeySequenceParams));
    }
  );

  server.tool(
    "key_combo",
    "Press key combo in the target app.",
    { ...unifiedTargetSchema, ...keyComboSchema },
    async (params) => {
      const target = resolveUnifiedTargetArgs(params as UnifiedTargetParams);
      if (!Array.isArray(target)) return target;
      return await runBackend("input", buildKeyComboArgs(target, params as KeyComboParams));
    }
  );

  server.tool(
    "touch",
    "Perform touch events in the target app.",
    { ...unifiedTargetSchema, ...touchSchema },
    async (params) => {
      const target = resolveUnifiedTargetArgs(params as UnifiedTargetParams);
      if (!Array.isArray(target)) return target;
      return await runBackend("input", buildTouchArgs(target, params as TouchParams));
    }
  );

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
      return await runBackend("input", args);
    }
  );

  server.tool(
    "input_source",
    "Get current keyboard input source or switch to a specific one. Call without sourceId to query current; with sourceId to switch. Uses CJKV workaround for Korean/Japanese/Chinese/Vietnamese.",
    {
      sourceId: z.string().optional().describe(
        "Input source ID to switch to (e.g. 'com.apple.inputmethod.Korean.2SetKorean'). Omit to query current."
      ),
    },
    async (params) => {
      const args = ["input-source"];
      if (params.sourceId) {
        args.push(params.sourceId);
      }
      return await runBackend("utility", args);
    }
  );

  server.tool(
    "list_input_sources",
    "List all available keyboard input sources with their IDs, names, and active status.",
    {},
    async () => {
      return await runBackend("utility", ["list-input-sources"]);
    }
  );
}
