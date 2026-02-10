import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { pushOption, ensureOutputPath, runNative, runSimctl } from "../utils.js";

export function registerMediaTools(server: McpServer): void {
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
}
