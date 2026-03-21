import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { ToolTextResult, UnifiedTargetParams } from "../types.js";
import {
  makeToolError,
  pushOption,
  resolveUnifiedTargetArgs,
  runNative,
  unifiedTargetSchema,
} from "../utils.js";

type WorkflowTargetKind = "simulator" | "macOS";
type WorkflowTargetResolution = { targetArgs: string[]; targetKind: WorkflowTargetKind; targetLabel: string };
type WorkflowStepTool = "tap" | "type_text" | "key" | "swipe" | "sleep";

type WorkflowStep = {
  tool: WorkflowStepTool;
  x?: number;
  y?: number;
  id?: string;
  label?: string;
  all?: boolean;
  double?: boolean;
  preDelay?: number;
  postDelay?: number;
  waitTimeout?: number;
  pollInterval?: number;
  text?: string;
  stdinText?: string;
  file?: string;
  method?: "auto" | "paste" | "keyboard";
  keycode?: number;
  duration?: number;
  startX?: number;
  startY?: number;
  endX?: number;
  endY?: number;
};

type WorkflowParams = UnifiedTargetParams & {
  continueOnError?: boolean;
  continue_on_error?: boolean;
  steps: WorkflowStep[];
};

type WorkflowStepResult = {
  index: number;
  total: number;
  tool: WorkflowStepTool;
  status: "success" | "failed" | "skipped";
  durationMs: number;
  message: string;
  nativeText?: string;
  attempts?: number;
  retryableFailure?: boolean;
};

const workflowStepSchema = z.object({
  tool: z.enum(["tap", "type_text", "key", "swipe", "sleep"]),
  x: z.number().optional().describe("X coordinate"),
  y: z.number().optional().describe("Y coordinate"),
  id: z.string().optional().describe("Accessibility identifier"),
  label: z.string().optional().describe("Accessibility label"),
  all: z.boolean().optional().describe("Include Simulator chrome/system UI for selector lookup"),
  double: z.boolean().optional().describe("Send double-click instead of single click"),
  preDelay: z.number().optional().describe("Delay before tap or swipe in seconds"),
  postDelay: z.number().optional().describe("Delay after tap or swipe in seconds"),
  waitTimeout: z.number().min(0).optional().describe("Selector wait/retry window for tap steps, in milliseconds"),
  pollInterval: z.number().min(1).optional().describe("Polling interval for selector wait/retry, in milliseconds"),
  text: z.string().optional().describe("Text argument"),
  stdinText: z.string().optional().describe("Text piped to stdin mode"),
  file: z.string().optional().describe("Path for file input"),
  method: z.enum(["auto", "paste", "keyboard"]).optional().describe("Input method policy"),
  keycode: z.number().int().min(0).max(255).optional().describe("HID keycode (0-255)"),
  duration: z.number().min(0).optional().describe("Hold or wait duration in seconds"),
  startX: z.number().optional().describe("Start X"),
  startY: z.number().optional().describe("Start Y"),
  endX: z.number().optional().describe("End X"),
  endY: z.number().optional().describe("End Y"),
});

const workflowSchema = {
  ...unifiedTargetSchema,
  continueOnError: z.boolean().optional().describe("Continue executing later steps after a step fails"),
  continue_on_error: z.boolean().optional().describe("Alias of continueOnError"),
  steps: z.array(workflowStepSchema).min(1).describe("Ordered steps to execute"),
};

function makeValidationError(message: string, code: string): ToolTextResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
    error: makeToolError({
      code,
      category: "validation",
      message,
    }),
  };
}

function resolveOptionalWorkflowTargetArgs(
  params: UnifiedTargetParams,
): WorkflowTargetResolution | null | ToolTextResult {
  const targetCount = [params.udid, params.bundleId, params.appName].filter(Boolean).length;
  if (targetCount === 0) {
    return null;
  }

  const target = resolveUnifiedTargetArgs(params);
  if (!Array.isArray(target)) return target;

  if (params.udid) {
    return { targetArgs: target, targetKind: "simulator", targetLabel: `udid=${params.udid}` };
  }
  if (params.bundleId) {
    return { targetArgs: target, targetKind: "macOS", targetLabel: `bundleId=${params.bundleId}` };
  }
  return { targetArgs: target, targetKind: "macOS", targetLabel: `appName=${params.appName}` };
}

function isToolTextResult(value: unknown): value is ToolTextResult {
  return typeof value === "object" && value !== null && "content" in value && "isError" in value;
}

function validateTapStep(step: WorkflowStep, stepIndex: number): ToolTextResult | null {
  const hasX = step.x !== undefined;
  const hasY = step.y !== undefined;
  const hasSelector = step.id !== undefined || step.label !== undefined;

  if (hasX !== hasY) {
    return makeValidationError(`Step ${stepIndex}: both x and y must be provided together.`, "validation.workflow.tap.coordinate_pair");
  }
  if (hasX && hasSelector) {
    return makeValidationError(`Step ${stepIndex}: provide either x/y coordinates or id/label, not both.`, "validation.workflow.tap.selector_conflict");
  }
  if (!hasX && !step.id && !step.label) {
    return makeValidationError(`Step ${stepIndex}: provide either x/y coordinates, id, or label.`, "validation.workflow.tap.selector_required");
  }
  return null;
}

function validateTypeStep(step: WorkflowStep, stepIndex: number): ToolTextResult | null {
  const modes = [step.text !== undefined, step.stdinText !== undefined, step.file !== undefined].filter(Boolean).length;
  if (modes !== 1) {
    return makeValidationError(`Step ${stepIndex}: provide exactly one of text, stdinText, or file.`, "validation.workflow.type.source_required");
  }
  return null;
}

function validateKeyStep(step: WorkflowStep, stepIndex: number): ToolTextResult | null {
  if (step.keycode === undefined) {
    return makeValidationError(`Step ${stepIndex}: keycode is required.`, "validation.workflow.key.keycode_required");
  }
  return null;
}

function validateSwipeStep(step: WorkflowStep, stepIndex: number): ToolTextResult | null {
  const requiredFields = [step.startX, step.startY, step.endX, step.endY];
  if (requiredFields.some((value) => value === undefined)) {
    return makeValidationError(`Step ${stepIndex}: startX, startY, endX, and endY are required.`, "validation.workflow.swipe.coordinates_required");
  }
  return null;
}

function buildTapArgs(targetArgs: string[], step: WorkflowStep): string[] {
  const args = ["tap"];
  pushOption(args, "-x", step.x);
  pushOption(args, "-y", step.y);
  pushOption(args, "--id", step.id);
  pushOption(args, "--label", step.label);
  if (step.all) args.push("--all");
  if (step.double) args.push("--double");
  pushOption(args, "--pre-delay", step.preDelay);
  pushOption(args, "--post-delay", step.postDelay);
  args.push(...targetArgs);
  return args;
}

function buildTypeArgs(targetArgs: string[], step: WorkflowStep): { args: string[]; stdinText?: string } {
  const args = ["type"];
  if (step.text !== undefined) args.push(step.text);
  if (step.stdinText !== undefined) args.push("--stdin");
  if (step.file !== undefined) args.push("--file", step.file);
  if (step.method !== undefined) args.push("--method", step.method);
  args.push(...targetArgs);
  return { args, stdinText: step.stdinText };
}

function buildKeyArgs(targetArgs: string[], step: WorkflowStep): string[] {
  const args = ["key", String(step.keycode)];
  pushOption(args, "--duration", step.duration);
  args.push(...targetArgs);
  return args;
}

function buildSwipeArgs(targetArgs: string[], step: WorkflowStep): string[] {
  const args = [
    "swipe",
    "--start-x",
    String(step.startX),
    "--start-y",
    String(step.startY),
    "--end-x",
    String(step.endX),
    "--end-y",
    String(step.endY),
  ];
  pushOption(args, "--duration", step.duration);
  pushOption(args, "--pre-delay", step.preDelay);
  pushOption(args, "--post-delay", step.postDelay);
  args.push(...targetArgs);
  return args;
}

function sleepMs(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function indent(text: string, prefix = "  "): string {
  return text
    .split(/\r?\n/)
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function extractText(result: ToolTextResult): string {
  return result.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n")
    .trim();
}

function hasSelectorTap(step: WorkflowStep): boolean {
  return step.tool === "tap" && (step.id !== undefined || step.label !== undefined);
}

function isRetryableSelectorTapFailure(step: WorkflowStep, result: ToolTextResult): boolean {
  if (!hasSelectorTap(step) || !result.isError || !result.error) return false;

  const error = result.error;
  if (error.source !== "native") return false;
  if (error.category === "validation" || error.category === "permission" || error.category === "unsupported" || error.category === "environment") {
    return false;
  }

  const code = error.code.toLowerCase();
  const text = `${error.message}\n${extractText(result)}`.toLowerCase();
  return (
    code.includes("selector_not_found") ||
    (error.category === "availability" && code === "availability.target_unavailable" && text.includes("no accessibility element matched"))
  );
}

function formatAttemptMessage(baseMessage: string, attempts: number): string {
  if (attempts <= 1) return baseMessage;
  return `${baseMessage} after ${attempts} attempt(s)`;
}

function formatStepLabel(step: WorkflowStep): string {
  switch (step.tool) {
    case "tap":
      if (step.x !== undefined && step.y !== undefined) return `tap (${step.x}, ${step.y})`;
      if (step.id) return `tap id=${step.id}`;
      if (step.label) return `tap label=${step.label}`;
      return "tap";
    case "type_text":
      if (step.text !== undefined) return `type_text text=${JSON.stringify(step.text)}`;
      if (step.stdinText !== undefined) return "type_text stdinText";
      if (step.file !== undefined) return `type_text file=${step.file}`;
      return "type_text";
    case "key":
      return `key ${step.keycode}`;
    case "swipe":
      return `swipe (${step.startX}, ${step.startY}) → (${step.endX}, ${step.endY})`;
    case "sleep":
      return `sleep ${step.duration ?? 0}s`;
  }
}

async function executeWorkflowStep(
  step: WorkflowStep,
  targetArgs: string[] | null,
  stepIndex: number,
  total: number,
): Promise<WorkflowStepResult | ToolTextResult> {
  const startedAt = Date.now();
  const stepLabel = formatStepLabel(step);

  if (step.tool !== "sleep" && !targetArgs) {
    return makeValidationError(`Step ${stepIndex}: a target is required for ${step.tool} steps.`, "validation.workflow.target_required");
  }

  switch (step.tool) {
    case "tap": {
      const validationError = validateTapStep(step, stepIndex);
      if (validationError) return validationError;
      const waitTimeoutMs = step.waitTimeout ?? 0;
      const pollIntervalMs = step.pollInterval ?? 250;
      const shouldWaitForSelector = hasSelectorTap(step) && waitTimeoutMs > 0;
      const deadlineMs = startedAt + waitTimeoutMs;

      let attempts = 0;

      while (true) {
        attempts += 1;
        const result = await runNative(buildTapArgs(targetArgs!, step));
        if (!result.isError) {
          return {
            index: stepIndex,
            total,
            tool: step.tool,
            status: "success",
            durationMs: Date.now() - startedAt,
            message: formatAttemptMessage(`${stepLabel} completed`, attempts),
            attempts,
          };
        }

        const retryableFailure = isRetryableSelectorTapFailure(step, result);
        if (!shouldWaitForSelector || !retryableFailure || Date.now() >= deadlineMs) {
          const text = extractText(result);
          return {
            index: stepIndex,
            total,
            tool: step.tool,
            status: "failed",
            durationMs: Date.now() - startedAt,
            message: formatAttemptMessage(text || `${stepLabel} failed`, attempts),
            nativeText: text || undefined,
            attempts,
            retryableFailure: result.error?.retryable ?? false,
          };
        }

        const remainingMs = deadlineMs - Date.now();
        if (remainingMs > 0) {
          await sleepMs(Math.min(Math.max(1, pollIntervalMs), remainingMs));
        }
      }
    }
    case "type_text": {
      const validationError = validateTypeStep(step, stepIndex);
      if (validationError) return validationError;
      const built = buildTypeArgs(targetArgs!, step);
      const result = await runNative(built.args, { stdinText: built.stdinText });
      return {
        index: stepIndex,
        total,
        tool: step.tool,
        status: result.isError ? "failed" : "success",
        durationMs: Date.now() - startedAt,
        message: result.isError ? extractText(result) || `${stepLabel} failed` : `${stepLabel} completed`,
        nativeText: result.isError ? extractText(result) : undefined,
        attempts: 1,
        retryableFailure: result.error?.retryable ?? false,
      };
    }
    case "key": {
      const validationError = validateKeyStep(step, stepIndex);
      if (validationError) return validationError;
      const result = await runNative(buildKeyArgs(targetArgs!, step));
      return {
        index: stepIndex,
        total,
        tool: step.tool,
        status: result.isError ? "failed" : "success",
        durationMs: Date.now() - startedAt,
        message: result.isError ? extractText(result) || `${stepLabel} failed` : `${stepLabel} completed`,
        nativeText: result.isError ? extractText(result) : undefined,
        attempts: 1,
        retryableFailure: result.error?.retryable ?? false,
      };
    }
    case "swipe": {
      const validationError = validateSwipeStep(step, stepIndex);
      if (validationError) return validationError;
      const result = await runNative(buildSwipeArgs(targetArgs!, step));
      return {
        index: stepIndex,
        total,
        tool: step.tool,
        status: result.isError ? "failed" : "success",
        durationMs: Date.now() - startedAt,
        message: result.isError ? extractText(result) || `${stepLabel} failed` : `${stepLabel} completed`,
        nativeText: result.isError ? extractText(result) : undefined,
        attempts: 1,
        retryableFailure: result.error?.retryable ?? false,
      };
    }
    case "sleep": {
      const durationSeconds = step.duration ?? 0;
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, durationSeconds) * 1000));
      return {
        index: stepIndex,
        total,
        tool: step.tool,
        status: "success",
        durationMs: Date.now() - startedAt,
        message: `slept for ${durationSeconds}s`,
        attempts: 1,
        retryableFailure: false,
      };
    }
  }
}

function buildWorkflowSummary(
  stepResults: WorkflowStepResult[],
  continueOnError: boolean,
  targetLabel: string,
): { text: string; failedCount: number; successCount: number; skippedCount: number; retryableFailureCount: number } {
  const successCount = stepResults.filter((step) => step.status === "success").length;
  const failedCount = stepResults.filter((step) => step.status === "failed").length;
  const skippedCount = stepResults.filter((step) => step.status === "skipped").length;
  const retryableFailureCount = stepResults.filter((step) => step.status === "failed" && step.retryableFailure).length;

  const lines = [
    `Workflow target: ${targetLabel}`,
    `Execution policy: ${continueOnError ? "continue_on_error" : "fail-fast"}`,
    "",
  ];

  for (const step of stepResults) {
    const emoji = step.status === "success" ? "✅" : step.status === "failed" ? "❌" : "⏭️";
    lines.push(`Step ${step.index}/${step.total} ${emoji} ${step.tool} — ${step.status} (${step.durationMs}ms): ${step.message}`);
    if (step.nativeText) {
      lines.push(indent(step.nativeText, "    "));
    }
  }

  lines.push(
    "",
    `Final summary: ${successCount} succeeded, ${failedCount} failed, ${skippedCount} skipped. Status: ${failedCount > 0 ? "failure" : "success"}.`,
  );

  return { text: lines.join("\n"), failedCount, successCount, skippedCount, retryableFailureCount };
}

export function registerWorkflowTools(server: McpServer): void {
  server.tool(
    "run_steps",
    "Execute ordered workflow steps using existing tap, type_text, key, swipe, and sleep behavior. Defaults to fail-fast; set continueOnError or continue_on_error to keep going after a failure.",
    workflowSchema,
    async (params) => {
      const workflowParams = params as WorkflowParams;
      const steps = workflowParams.steps;
      const continueOnError = workflowParams.continueOnError ?? workflowParams.continue_on_error ?? false;
      const targetResolution = resolveOptionalWorkflowTargetArgs(workflowParams);
      if (targetResolution && isToolTextResult(targetResolution)) {
        return targetResolution;
      }

      const targetArgs = targetResolution ? targetResolution.targetArgs : null;
      const targetLabel = targetResolution ? targetResolution.targetLabel : "none (sleep-only workflow)";
      const targetKind = targetResolution ? targetResolution.targetKind : null;

      const stepResults: WorkflowStepResult[] = [];
      let encounteredFailure = false;

      for (let index = 0; index < steps.length; index += 1) {
        const stepNumber = index + 1;
        const step = steps[index];

        if (encounteredFailure && !continueOnError) {
          stepResults.push({
            index: stepNumber,
            total: steps.length,
            tool: step.tool,
            status: "skipped",
            durationMs: 0,
            message: "skipped because fail-fast stopped the workflow",
          });
          continue;
        }

        const outcome = await executeWorkflowStep(step, targetArgs, stepNumber, steps.length);
        if (isToolTextResult(outcome)) {
          return outcome;
        }

        stepResults.push(outcome);
        if (outcome.status === "failed") {
          encounteredFailure = true;
          if (!continueOnError) {
            for (let skippedIndex = index + 1; skippedIndex < steps.length; skippedIndex += 1) {
              const skippedStep = steps[skippedIndex];
              stepResults.push({
                index: skippedIndex + 1,
                total: steps.length,
                tool: skippedStep.tool,
                status: "skipped",
                durationMs: 0,
                message: "skipped because fail-fast stopped the workflow",
              });
            }
            break;
          }
        }
      }

      const summary = buildWorkflowSummary(stepResults, continueOnError, targetLabel);
      const isError = summary.failedCount > 0;
      return {
        content: [{ type: "text", text: summary.text }],
        isError,
        error: isError
          ? makeToolError({
              code: summary.failedCount > 1 ? "workflow.steps_failed" : "workflow.step_failed",
              category: "execution",
              message: `${summary.failedCount} workflow step(s) failed.`,
              retryable: summary.failedCount === summary.retryableFailureCount,
            })
          : undefined,
        metadata: {
          continueOnError,
          targetLabel,
          targetKind,
          stepResults,
          summary: {
            successCount: summary.successCount,
            failedCount: summary.failedCount,
            skippedCount: summary.skippedCount,
            total: steps.length,
          },
        },
      };
    },
  );
}
