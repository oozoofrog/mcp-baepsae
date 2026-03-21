import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { pushOption, ensureOutputPath } from "../utils.js";
import { runBackend } from "../backend.js";

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
      pushOption(args, "--duration", durationSeconds);
      args.push("--output", resolvedOutput);

      return await runBackend(
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

      const extraLines = [
        "Capture mode: direct simctl recordVideo.",
        `Requested duration: ${durationSeconds}s`,
        `Output file: ${resolvedOutput}`,
      ];

      return await runBackend(
        "simulator",
        ["io", params.udid, "recordVideo", "--force", resolvedOutput],
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

      return await runBackend("simulator", ["io", params.udid, "screenshot", resolvedOutput], undefined, {
        extraLines: [`Output file: ${resolvedOutput}`],
      });
    }
  );
}
