import { spawn, execFileSync } from "node:child_process";
import { accessSync, constants, existsSync, createWriteStream, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { z } from "zod";

import type { ToolTextResult, CommandExecutionOptions, CommandExecutionResult, ResponseOptions } from "./types.js";

export const PACKAGE_ROOT = resolve(__dirname, "..");
export const SERVER_NAME = "mcp-baepsae";
export const SERVER_VERSION = (() => {
  try {
    const packageJsonPath = resolve(PACKAGE_ROOT, "package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: unknown };
    if (typeof packageJson.version === "string" && packageJson.version.length > 0) {
      return packageJson.version;
    }
  } catch {
    // fall through to static fallback
  }
  return "3.2.1";
})();

export const DEFAULT_TIMEOUT_MS = 30_000;
export const NATIVE_BINARY_ENV = "BAEPSAE_NATIVE_PATH";
export const NATIVE_BINARY_NAME = process.platform === "win32" ? "baepsae-native.exe" : "baepsae-native";

export const BUTTON_TYPES = ["apple-pay", "home", "lock", "side-button", "siri"] as const;
export const GESTURE_PRESETS = [
  "scroll-up",
  "scroll-down",
  "scroll-left",
  "scroll-right",
  "swipe-from-left-edge",
  "swipe-from-right-edge",
  "swipe-from-top-edge",
  "swipe-from-bottom-edge",
] as const;
export const BAEPSAE_SUBCOMMANDS = [
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

export const keycodeSchema = z.number().int().min(0).max(255);

export function isExecutable(filePath: string): boolean {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveNativeBinary(): string {
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

export function resolveTargetArgs(params: { udid?: string; bundleId?: string; appName?: string }): string[] | ToolTextResult {
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

export function resolveSimulatorTargetArgs(params: { udid?: string }): string[] | ToolTextResult {
  if (!params.udid) {
    return {
      content: [{ type: "text", text: "Provide udid." }],
      isError: true,
    };
  }
  return ["--udid", params.udid];
}

export function resolveMacTargetArgs(params: { bundleId?: string; appName?: string }): string[] | ToolTextResult {
  const modes = [params.bundleId, params.appName].filter(Boolean).length;
  if (modes !== 1) {
    return {
      content: [{ type: "text", text: "Provide exactly one of bundleId or appName." }],
      isError: true,
    };
  }
  if (params.bundleId) {
    return ["--bundle-id", params.bundleId];
  }
  return ["--app-name", params.appName!];
}

export function pushOption(args: string[], name: string, value: string | number | undefined): void {
  if (value !== undefined) {
    args.push(name, String(value));
  }
}

export function quoteArg(arg: string): string {
  if (!/[\s"'\\$`]/.test(arg)) {
    return arg;
  }

  return `"${arg.replace(/(["\\$`])/g, "\\$1")}"`;
}

export async function ensureOutputPath(filePath: string): Promise<string> {
  const absolute = resolve(filePath);
  await mkdir(dirname(absolute), { recursive: true });
  return absolute;
}

export async function executeCommand(
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

export function toToolResult(result: CommandExecutionResult, options: ResponseOptions = {}): ToolTextResult {
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

export async function runSimctl(args: string[], options?: CommandExecutionOptions, responseOptions?: ResponseOptions): Promise<ToolTextResult> {
  return await runCommand("xcrun", ["simctl", ...args], options, responseOptions);
}

export async function runNative(
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
