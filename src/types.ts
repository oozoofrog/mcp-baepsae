export type UnifiedTargetParams = {
  udid?: string;
  bundleId?: string;
  appName?: string;
};

export type ToolTextResult = {
  content: Array<{ type: "text"; text: string }>;
  isError: boolean;
};

export interface CommandExecutionOptions {
  timeoutMs?: number;
  stdinText?: string;
  stdoutFilePath?: string;
  captureStdout?: boolean;
  env?: Record<string, string>;
}

export interface CommandExecutionResult {
  executablePath: string;
  args: string[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  durationMs: number;
}

export interface ResponseOptions {
  timeoutIsExpected?: boolean;
  extraLines?: string[];
}
