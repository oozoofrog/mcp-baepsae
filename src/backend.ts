import { runNative, runSimctl } from "./utils.js";
import type { CommandExecutionOptions, ResponseOptions, ToolTextResult } from "./types.js";

export const BACKEND_KINDS = {
  SIMCTL: "simctl",
  NATIVE_ACCESSIBILITY: "native_accessibility",
  SIMULATOR_INPUT: "simulator_input",
  UTILITY_RUNTIME: "utility/runtime",
} as const;

export type BackendKind = typeof BACKEND_KINDS[keyof typeof BACKEND_KINDS];
export type BackendDomain = "simulator" | "accessibility" | "input" | "utility";
export type BackendExecutorKind = "native" | "simctl";

export interface BackendDescriptor {
  kind: BackendKind;
  domain: BackendDomain;
  executorKind: BackendExecutorKind;
  label: string;
  summary: string;
}

type BackendExecutor = (
  args: string[],
  options?: CommandExecutionOptions,
  responseOptions?: ResponseOptions
) => Promise<ToolTextResult>;

export const BACKEND_DOMAIN_TO_KIND: Record<BackendDomain, BackendKind> = {
  simulator: BACKEND_KINDS.SIMCTL,
  accessibility: BACKEND_KINDS.NATIVE_ACCESSIBILITY,
  input: BACKEND_KINDS.SIMULATOR_INPUT,
  utility: BACKEND_KINDS.UTILITY_RUNTIME,
};

export const BACKENDS: Record<BackendKind, BackendDescriptor> = {
  [BACKEND_KINDS.SIMCTL]: {
    kind: BACKEND_KINDS.SIMCTL,
    domain: "simulator",
    executorKind: "simctl",
    label: "simctl",
    summary: "Direct simulator control via xcrun simctl.",
  },
  [BACKEND_KINDS.NATIVE_ACCESSIBILITY]: {
    kind: BACKEND_KINDS.NATIVE_ACCESSIBILITY,
    domain: "accessibility",
    executorKind: "native",
    label: "native accessibility",
    summary: "Native accessibility and UI inspection commands.",
  },
  [BACKEND_KINDS.SIMULATOR_INPUT]: {
    kind: BACKEND_KINDS.SIMULATOR_INPUT,
    domain: "input",
    executorKind: "native",
    label: "simulator input",
    summary: "Native simulator input and HID-style interaction commands.",
  },
  [BACKEND_KINDS.UTILITY_RUNTIME]: {
    kind: BACKEND_KINDS.UTILITY_RUNTIME,
    domain: "utility",
    executorKind: "native",
    label: "utility/runtime",
    summary: "Native utility and runtime shim commands.",
  },
};

export const BACKEND_EXECUTORS: Record<BackendExecutorKind, BackendExecutor> = {
  native: runNative,
  simctl: runSimctl,
};

export function resolveBackendKind(domain: BackendDomain): BackendKind {
  return BACKEND_DOMAIN_TO_KIND[domain];
}

export function getBackendDescriptor(domain: BackendDomain): BackendDescriptor {
  return BACKENDS[resolveBackendKind(domain)];
}

function backendMetadata(descriptor: BackendDescriptor): Record<string, string> {
  return {
    backendDomain: descriptor.domain,
    backendKind: descriptor.kind,
    backendExecutor: descriptor.executorKind,
    backendLabel: descriptor.label,
  };
}

export async function runBackend(
  domain: BackendDomain,
  args: string[],
  options?: CommandExecutionOptions,
  responseOptions?: ResponseOptions
): Promise<ToolTextResult> {
  const descriptor = getBackendDescriptor(domain);
  const executor = BACKEND_EXECUTORS[descriptor.executorKind];
  return await executor(args, options, {
    ...responseOptions,
    metadata: {
      ...(responseOptions?.metadata ?? {}),
      ...backendMetadata(descriptor),
    },
  });
}
