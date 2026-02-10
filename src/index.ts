#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { spawn, execFileSync } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { z } from "zod";

const SERVER_NAME = "mcp-baepsae";
const SERVER_VERSION = "3.1.10";

// --- Issue #17: CLI --version flag ---
if (process.argv.includes("--version") || process.argv.includes("-v")) {
  try {
    const packageJsonPath = resolve(__dirname, "..", "package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    console.log(`${packageJson.name} ${packageJson.version}`);
  } catch {
    console.log(`${SERVER_NAME} ${SERVER_VERSION}`);
  }
  process.exit(0);
}

const DEFAULT_TIMEOUT_MS = 30_000;
const NATIVE_BINARY_ENV = "BAEPSAE_NATIVE_PATH";
const NATIVE_BINARY_NAME = process.platform === "win32" ? "baepsae-native.exe" : "baepsae-native";
const PACKAGE_ROOT = resolve(__dirname, "..");

type ToolTextResult = {
  content: Array<{ type: "text"; text: string }>;
  isError: boolean;
};

interface CommandExecutionOptions {
  timeoutMs?: number;
  stdinText?: string;
  stdoutFilePath?: string;
  captureStdout?: boolean;
  env?: Record<string, string>;
}

interface CommandExecutionResult {
  executablePath: string;
  args: string[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  durationMs: number;
}

interface ResponseOptions {
  timeoutIsExpected?: boolean;
  extraLines?: string[];
}

const BUTTON_TYPES = ["apple-pay", "home", "lock", "side-button", "siri"] as const;
const GESTURE_PRESETS = [
  "scroll-up",
  "scroll-down",
  "scroll-left",
  "scroll-right",
  "swipe-from-left-edge",
  "swipe-from-right-edge",
  "swipe-from-top-edge",
  "swipe-from-bottom-edge",
] as const;
const BAEPSAE_SUBCOMMANDS = [
  "describe-ui",
  "search-ui",
  "list-simulators",
  "list-apps",
  "tap",
  "type",
  "swipe",
  "button",
  "key",
  "key-sequence",
  "key-combo",
  "touch",
  "gesture",
  "stream-video",
  "record-video",
  "screenshot",
  "list-windows",
  "activate-app",
  "screenshot-app",
  "right-click",
  "scroll",
  "drag-drop",
  "menu-action",
  "get-focused-app",
  "clipboard",
] as const;

const keycodeSchema = z.number().int().min(0).max(255);

function isExecutable(filePath: string): boolean {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveNativeBinary(): string {
  const override = process.env[NATIVE_BINARY_ENV];
  if (override) {
    const resolved = resolve(override);
    if (!isExecutable(resolved)) {
      throw new Error(`Configured ${NATIVE_BINARY_ENV} is not executable: ${resolved}`);
    }
    return resolved;
  }

  const candidates = [
    resolve(PACKAGE_ROOT, "native", ".build", "release", NATIVE_BINARY_NAME),
    resolve(PACKAGE_ROOT, "native", ".build", "debug", NATIVE_BINARY_NAME),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate) && isExecutable(candidate)) {
      return candidate;
    }
  }

  // Issue #18: Provide a clearer error message depending on the environment
  const messages: string[] = ["Native binary not found."];

  if (process.platform !== "darwin") {
    messages.push(
      `Native features require macOS. Current platform: ${process.platform}.`
    );
  } else {
    // Check if Swift toolchain is available
    let swiftAvailable = false;
    try {
      execFileSync("swift", ["--version"], { stdio: "ignore" });
      swiftAvailable = true;
    } catch {
      // swift not found or failed
    }

    if (!swiftAvailable) {
      messages.push(
        "Swift toolchain not found. Install Xcode or Xcode Command Line Tools (xcode-select --install) to enable native features."
      );
    } else {
      messages.push(
        `Build it with "npm run build:native" or set ${NATIVE_BINARY_ENV}.`
      );
    }
  }

  throw new Error(messages.join(" "));
}

function resolveTargetArgs(params: { udid?: string; bundleId?: string; appName?: string }): string[] | ToolTextResult {
  const modes = [params.udid, params.bundleId, params.appName].filter(Boolean).length;
  if (modes !== 1) {
    return {
      content: [{ type: "text", text: "Provide exactly one of udid, bundleId, or appName." }],
      isError: true,
    };
  }
  if (params.udid) return ["--udid", params.udid];
  if (params.bundleId) return ["--bundle-id", params.bundleId];
  return ["--app-name", params.appName!];
}

function pushOption(args: string[], name: string, value: string | number | undefined): void {
  if (value !== undefined) {
    args.push(name, String(value));
  }
}

function quoteArg(arg: string): string {
  if (!/[\s"'\\$`]/.test(arg)) {
    return arg;
  }

  return `"${arg.replace(/(["\\$`])/g, "\\$1")}"`;
}

async function ensureOutputPath(filePath: string): Promise<string> {
  const absolute = resolve(filePath);
  await mkdir(dirname(absolute), { recursive: true });
  return absolute;
}

async function executeCommand(
  executable: string,
  args: string[],
  options: CommandExecutionOptions = {}
): Promise<CommandExecutionResult> {
  const startedAt = Date.now();
  const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const captureStdout = options.captureStdout ?? !options.stdoutFilePath;

  const outputPath = options.stdoutFilePath ? await ensureOutputPath(options.stdoutFilePath) : undefined;

  return await new Promise<CommandExecutionResult>((resolvePromise, rejectPromise) => {
    const child = spawn(executable, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: options.env ? { ...process.env, ...options.env } : process.env,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;
    let closed = false;
    let escalationTimer: NodeJS.Timeout | undefined;
    let outputFinished: Promise<void> | undefined;

    if (outputPath) {
      const outputStream = createWriteStream(outputPath);
      outputFinished = new Promise<void>((resolveOutput, rejectOutput) => {
        outputStream.on("finish", () => resolveOutput());
        outputStream.on("error", (error) => rejectOutput(error));
      });
      child.stdout.pipe(outputStream);
    } else if (captureStdout) {
      child.stdout.on("data", (chunk: Buffer | string) => {
        stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
    }

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    child.on("error", (error) => {
      rejectPromise(new Error(`Failed to execute command: ${error.message}`));
    });

    if (options.stdinText !== undefined) {
      child.stdin.write(options.stdinText);
    }
    child.stdin.end();

    const timer = setTimeout(() => {
      if (closed) {
        return;
      }

      timedOut = true;
      child.kill("SIGINT");

      escalationTimer = setTimeout(() => {
        if (!closed) {
          child.kill("SIGTERM");
        }
      }, 800);
    }, timeoutMs);

    child.on("close", async (exitCode, signal) => {
      closed = true;
      clearTimeout(timer);
      if (escalationTimer) {
        clearTimeout(escalationTimer);
      }

      try {
        if (outputFinished) {
          await outputFinished;
        }

        resolvePromise({
          executablePath: executable,
          args,
          stdout: captureStdout ? Buffer.concat(stdoutChunks).toString("utf8").trimEnd() : "",
          stderr: Buffer.concat(stderrChunks).toString("utf8").trimEnd(),
          exitCode,
          signal,
          timedOut,
          durationMs: Date.now() - startedAt,
        });
      } catch (error) {
        rejectPromise(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}

function commandToString(executableName: string, args: string[]): string {
  return `${quoteArg(executableName)} ${args.map((arg) => quoteArg(arg)).join(" ")}`;
}

function toToolResult(result: CommandExecutionResult, options: ResponseOptions = {}): ToolTextResult {
  const timeoutIsExpected = options.timeoutIsExpected ?? false;
  const expectedTimeoutSignal =
    timeoutIsExpected && result.timedOut && (result.signal === "SIGINT" || result.signal === "SIGTERM");
  const isError =
    (result.exitCode !== 0 && result.exitCode !== null) ||
    (result.timedOut && !timeoutIsExpected) ||
    (result.signal !== null && !expectedTimeoutSignal);

  const lines: string[] = [
    `Executable: ${result.executablePath}`,
    `Command: ${commandToString(basename(result.executablePath), result.args)}`,
    `Exit code: ${result.exitCode === null ? "null" : String(result.exitCode)}`,
    `Duration: ${result.durationMs}ms`,
  ];

  if (result.signal) {
    lines.push(`Signal: ${result.signal}`);
  }

  if (result.timedOut) {
    lines.push(`Timed out: ${timeoutIsExpected ? "expected stop" : "yes"}`);
  }

  if (options.extraLines && options.extraLines.length > 0) {
    lines.push(...options.extraLines);
  }

  if (result.stdout.length > 0) {
    lines.push("", "STDOUT:", result.stdout);
  }

  if (result.stderr.length > 0) {
    lines.push("", "STDERR:", result.stderr);
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
    isError,
  };
}

async function runCommand(
  executable: string,
  args: string[],
  options?: CommandExecutionOptions,
  responseOptions?: ResponseOptions
): Promise<ToolTextResult> {
  try {
    const result = await executeCommand(executable, args, options);
    return toToolResult(result, responseOptions);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Error executing ${commandToString(executable, args)}\n${message}` }],
      isError: true,
    };
  }
}

async function runSimctl(args: string[], options?: CommandExecutionOptions, responseOptions?: ResponseOptions): Promise<ToolTextResult> {
  return await runCommand("xcrun", ["simctl", ...args], options, responseOptions);
}

async function runNative(
  args: string[],
  options?: CommandExecutionOptions,
  responseOptions?: ResponseOptions
): Promise<ToolTextResult> {
  let binary: string;
  try {
    binary = resolveNativeBinary();
  } catch (error) {
    return {
      content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
      isError: true,
    };
  }
  return await runCommand(binary, args, options, responseOptions);
}

const server = new McpServer({
  name: SERVER_NAME,
  version: SERVER_VERSION,
});

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

server.tool("list_simulators", "List available simulators using simctl.", {}, async () => {
  return await runSimctl(["list", "devices", "available"]);
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
  "open_url",
  "Open a URL in the simulator (e.g. Safari or deep link).",
  {
    udid: z.string().min(1).describe("Simulator UDID"),
    url: z.string().min(1).describe("URL to open"),
  },
  async (params) => {
    return await runSimctl(["openurl", params.udid, params.url]);
  }
);

server.tool(
  "install_app",
  "Install an app (.app, .ipa) on the simulator.",
  {
    udid: z.string().min(1).describe("Simulator UDID"),
    path: z.string().min(1).describe("Path to .app or .ipa file"),
  },
  async (params) => {
    const resolvedPath = resolve(params.path);
    return await runSimctl(["install", params.udid, resolvedPath]);
  }
);

server.tool(
  "uninstall_app",
  "Uninstall an app from the simulator.",
  {
    udid: z.string().min(1).describe("Simulator UDID"),
    bundleId: z.string().min(1).describe("App Bundle Identifier (e.g. com.example.app)"),
  },
  async (params) => {
    return await runSimctl(["uninstall", params.udid, params.bundleId]);
  }
);

server.tool(
  "launch_app",
  "Launch an installed app on the simulator.",
  {
    udid: z.string().min(1).describe("Simulator UDID"),
    bundleId: z.string().min(1).describe("App Bundle Identifier"),
    args: z.array(z.string()).optional().describe("Arguments to pass to the app"),
    env: z.record(z.string()).optional().describe("Environment variables"),
  },
  async (params) => {
    const args = ["launch", params.udid, params.bundleId];
    if (params.args) {
      args.push(...params.args);
    }
    const env: Record<string, string> | undefined = params.env
      ? Object.fromEntries(Object.entries(params.env).map(([k, v]) => [`SIMCTL_CHILD_${k}`, v]))
      : undefined;
    return await runSimctl(args, { env });
  }
);

server.tool(
  "terminate_app",
  "Terminate a running app on the simulator.",
  {
    udid: z.string().min(1).describe("Simulator UDID"),
    bundleId: z.string().min(1).describe("App Bundle Identifier"),
  },
  async (params) => {
    return await runSimctl(["terminate", params.udid, params.bundleId]);
  }
);

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

server.tool(
  "key",
  "Press a single HID keycode. Works with iOS Simulator (udid) or macOS app (bundleId/appName).",
  {
    udid: z.string().min(1).optional().describe("Simulator UDID"),
    bundleId: z.string().optional().describe("macOS app bundle ID"),
    appName: z.string().optional().describe("macOS app name"),
    keycode: keycodeSchema.describe("HID keycode (0-255)"),
    duration: z.number().optional().describe("Hold duration in seconds"),
  },
  async (params) => {
    const target = resolveTargetArgs(params);
    if (!Array.isArray(target)) return target;

    const args = ["key", String(params.keycode)];
    pushOption(args, "--duration", params.duration);
    args.push(...target);
    return await runNative(args);
  }
);

server.tool(
  "key_sequence",
  "Press multiple HID keycodes in sequence. Works with iOS Simulator (udid) or macOS app (bundleId/appName).",
  {
    udid: z.string().min(1).optional().describe("Simulator UDID"),
    bundleId: z.string().optional().describe("macOS app bundle ID"),
    appName: z.string().optional().describe("macOS app name"),
    keycodes: z
      .union([
        z.array(keycodeSchema).min(1).describe("Array of HID keycodes"),
        z.string().min(1).describe("Comma-separated HID keycodes"),
      ])
      .describe("Key sequence"),
    delay: z.number().optional().describe("Delay between key presses in seconds"),
  },
  async (params) => {
    const target = resolveTargetArgs(params);
    if (!Array.isArray(target)) return target;

    const keycodes = Array.isArray(params.keycodes) ? params.keycodes.join(",") : params.keycodes;
    const args = ["key-sequence", "--keycodes", keycodes];
    pushOption(args, "--delay", params.delay);
    args.push(...target);
    return await runNative(args);
  }
);

server.tool(
  "key_combo",
  "Press a key while holding modifier keycodes. Works with iOS Simulator (udid) or macOS app (bundleId/appName).",
  {
    udid: z.string().min(1).optional().describe("Simulator UDID"),
    bundleId: z.string().optional().describe("macOS app bundle ID"),
    appName: z.string().optional().describe("macOS app name"),
    modifiers: z.array(keycodeSchema).min(1).describe("Modifier keycodes"),
    key: keycodeSchema.describe("Keycode to press while modifiers are held"),
  },
  async (params) => {
    const target = resolveTargetArgs(params);
    if (!Array.isArray(target)) return target;

    const args = [
      "key-combo",
      "--modifiers",
      params.modifiers.join(","),
      "--key",
      String(params.key),
      ...target,
    ];
    return await runNative(args);
  }
);

server.tool(
  "touch",
  "Perform touch down/up events at specific coordinates. Works with iOS Simulator (udid) or macOS app (bundleId/appName).",
  {
    udid: z.string().min(1).optional().describe("Simulator UDID"),
    bundleId: z.string().optional().describe("macOS app bundle ID"),
    appName: z.string().optional().describe("macOS app name"),
    x: z.number().describe("X coordinate"),
    y: z.number().describe("Y coordinate"),
    down: z.boolean().optional().describe("Send touch down event"),
    up: z.boolean().optional().describe("Send touch up event"),
    delay: z.number().optional().describe("Delay between down/up in seconds"),
  },
  async (params) => {
    const target = resolveTargetArgs(params);
    if (!Array.isArray(target)) return target;

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
    return await runNative(args);
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
    return await runNative(args);
  }
);

server.tool(
  "stream_video",
  "Stream simulator frames.",
  {
    udid: z.string().min(1).describe("Simulator UDID"),
    output: z.string().optional().describe("Destination output path"),
    durationSeconds: z.number().positive().optional().describe("Capture duration in seconds"),
  },
  async (params) => {
    const args = ["stream-video", "--udid", params.udid];

    const durationSeconds = params.durationSeconds ?? 10;
    const outputPath = params.output ?? `simulator-stream-${Date.now()}.mov`;
    const resolvedOutput = await ensureOutputPath(outputPath);
    pushOption(args, "--duration", durationSeconds);
    args.push("--output", resolvedOutput);

    return await runNative(
      args,
      {
        timeoutMs: Math.max(15_000, Math.round((durationSeconds + 15) * 1000)),
      },
      {
        extraLines: [`Capture duration: ${durationSeconds}s`, `Output file: ${resolvedOutput}`],
      }
    );
  }
);

server.tool(
  "record_video",
  "Record simulator display.",
  {
    udid: z.string().min(1).describe("Simulator UDID"),
    output: z.string().optional().describe("Output MOV file path"),
    durationSeconds: z.number().positive().optional().describe("Recording duration in seconds (default: 10)"),
  },
  async (params) => {
    const durationSeconds = params.durationSeconds ?? 10;
    const outputPath = params.output ?? `simulator-recording-${Date.now()}.mov`;
    const resolvedOutput = await ensureOutputPath(outputPath);

    const extraLines = [
      `Recording duration: ${durationSeconds}s`,
      `Output file: ${resolvedOutput}`,
    ];

    return await runSimctl(
      ["io", params.udid, "recordVideo", "--force", resolvedOutput],
      {
        timeoutMs: Math.max(15_000, Math.round((durationSeconds + 5) * 1000)),
      },
      {
        timeoutIsExpected: true,
        extraLines,
      }
    );
  }
);

server.tool(
  "screenshot",
  "Capture a screenshot from simulator display using simctl screenshot.",
  {
    udid: z.string().min(1).describe("Simulator UDID"),
    output: z.string().optional().describe("Output PNG file path"),
  },
  async (params) => {
    const outputPath = params.output ?? `simulator-screenshot-${Date.now()}.png`;
    const resolvedOutput = await ensureOutputPath(outputPath);

    return await runSimctl(["io", params.udid, "screenshot", resolvedOutput], undefined, {
      extraLines: [`Output file: ${resolvedOutput}`],
    });
  }
);

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
  "get_focused_app",
  "Get information about the currently focused macOS app.",
  {},
  async () => {
    return await runNative(["get-focused-app"]);
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

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(`Failed to start ${SERVER_NAME} server:`, error);
  process.exit(1);
});
