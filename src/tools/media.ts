import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { copyFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";

import type { ToolTextResult } from "../types.js";
import { pushOption, ensureOutputPath, makeToolError } from "../utils.js";
import { runBackend } from "../backend.js";

function extractText(result: ToolTextResult): string {
  return result.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

function rewriteTextContent(result: ToolTextResult, search: string, replace: string): ToolTextResult {
  return {
    ...result,
    content: result.content.map((item) =>
      item.type === "text"
        ? { ...item, text: item.text.split(search).join(replace) }
        : item
    ),
  };
}

function createStagingPath(finalPath: string, extension: "png" | "mov"): string {
  const finalBaseName = basename(finalPath);
  const suffix = `-${randomUUID()}`;
  const preferredBaseName = finalBaseName.endsWith(`.${extension}`)
    ? finalBaseName.replace(new RegExp(`\\.${extension}$`), `${suffix}.${extension}`)
    : `mcp-baepsae-media-${Date.now()}${suffix}.${extension}`;
  return join(tmpdir(), preferredBaseName);
}

async function finalizeStagedCapture(
  result: ToolTextResult,
  stagingPath: string,
  finalPath: string,
): Promise<ToolTextResult> {
  if (result.isError) {
    await rm(stagingPath, { force: true }).catch(() => {});
    return result;
  }

  try {
    const info = await stat(stagingPath);
    if (!info.isFile() || info.size <= 0) {
      throw new Error("Capture file was not created or is empty.");
    }
  } catch (error) {
    await rm(stagingPath, { force: true }).catch(() => {});
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `${extractText(result)}\n\nPost-processing failed.\nExpected staging file: ${stagingPath}\nReason: ${message}`.trim() }],
      isError: true,
      error: makeToolError({
        code: "execution.capture_output_missing",
        category: "execution",
        message,
        retryable: true,
        source: "runtime",
      }),
      metadata: {
        ...(result.metadata ?? {}),
        stagingOutputPath: stagingPath,
        outputPath: finalPath,
      },
    };
  }

  try {
    await copyFile(stagingPath, finalPath);
    await rm(stagingPath, { force: true }).catch(() => {});
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{
        type: "text",
        text: `${extractText(result)}\n\nPost-processing failed.\nStaging file: ${stagingPath}\nRequested output: ${finalPath}\nReason: ${message}`.trim(),
      }],
      isError: true,
      error: makeToolError({
        code: "execution.capture_output_finalize_failed",
        category: "execution",
        message,
        retryable: true,
        source: "runtime",
      }),
      metadata: {
        ...(result.metadata ?? {}),
        stagingOutputPath: stagingPath,
        outputPath: finalPath,
      },
    };
  }

  const rewritten = rewriteTextContent(result, stagingPath, finalPath);
  return {
    ...rewritten,
    metadata: {
      ...(rewritten.metadata ?? {}),
      stagingOutputPath: stagingPath,
      outputPath: finalPath,
    },
  };
}

export function registerMediaTools(server: McpServer): void {
  server.tool(
    "stream_video",
    "Capture a time-bounded simulator clip through the native stream-video shim.",
    {
      udid: z.string().min(1).describe("Simulator UDID"),
      output: z.string().optional().describe("Destination MOV file path for the captured clip"),
      durationSeconds: z
        .number()
        .positive()
        .optional()
        .describe("Requested clip duration in seconds (currently used as a timeout budget)"),
    },
    async (params) => {
      const args = ["stream-video", "--udid", params.udid];

      const durationSeconds = params.durationSeconds ?? 10;
      const outputPath = params.output ?? `simulator-stream-${Date.now()}.mov`;
      const resolvedOutput = await ensureOutputPath(outputPath);
      const stagingOutput = createStagingPath(resolvedOutput, "mov");
      pushOption(args, "--duration", durationSeconds);
      args.push("--output", stagingOutput);

      const result = await runBackend(
        "utility",
        args,
        {
          timeoutMs: Math.max(15_000, Math.round((durationSeconds + 15) * 1000)),
        },
        {
          extraLines: [
            "Capture mode: stream-video shim.",
            "Backend: simctl recordVideo (current implementation).",
            `Requested duration: ${durationSeconds}s`,
            `Output file: ${resolvedOutput}`,
          ],
          metadata: {
            captureMode: "stream_video_shim",
            backend: "simctl.recordVideo",
            requestedDurationSeconds: durationSeconds,
            outputPath: resolvedOutput,
          },
        }
      );
      return await finalizeStagedCapture(result, stagingOutput, resolvedOutput);
    }
  );

  server.tool(
    "record_video",
    "Record simulator display directly with simctl recordVideo.",
    {
      udid: z.string().min(1).describe("Simulator UDID"),
      output: z.string().optional().describe("Output MOV file path"),
      durationSeconds: z
        .number()
        .positive()
        .optional()
        .describe("Requested recording duration in seconds (default: 10)"),
    },
    async (params) => {
      const durationSeconds = params.durationSeconds ?? 10;
      const outputPath = params.output ?? `simulator-recording-${Date.now()}.mov`;
      const resolvedOutput = await ensureOutputPath(outputPath);
      const stagingOutput = createStagingPath(resolvedOutput, "mov");

      const extraLines = [
        "Capture mode: direct simctl recordVideo.",
        `Requested duration: ${durationSeconds}s`,
        `Output file: ${resolvedOutput}`,
      ];

      const result = await runBackend(
        "simulator",
        ["io", params.udid, "recordVideo", "--force", stagingOutput],
        {
          timeoutMs: Math.max(15_000, Math.round((durationSeconds + 5) * 1000)),
        },
        {
          timeoutIsExpected: true,
          extraLines,
          metadata: {
            captureMode: "record_video_direct",
            backend: "simctl.recordVideo",
            requestedDurationSeconds: durationSeconds,
            outputPath: resolvedOutput,
          },
        }
      );
      return await finalizeStagedCapture(result, stagingOutput, resolvedOutput);
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
      const stagingOutput = createStagingPath(resolvedOutput, "png");

      const result = await runBackend("simulator", ["io", params.udid, "screenshot", stagingOutput], undefined, {
        extraLines: [`Output file: ${resolvedOutput}`],
      });
      return await finalizeStagedCapture(result, stagingOutput, resolvedOutput);
    }
  );
}
