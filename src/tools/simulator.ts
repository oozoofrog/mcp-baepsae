import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolve } from "node:path";
import { z } from "zod";

import { runSimctl } from "../utils.js";

export function registerSimulatorTools(server: McpServer): void {
  server.tool("list_simulators", "List available simulators using simctl.", {}, async () => {
    return await runSimctl(["list", "devices", "available"]);
  });

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
}
