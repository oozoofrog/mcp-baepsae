#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { McpServer as McpServerType } from "@modelcontextprotocol/sdk/server/mcp.js";

const VERSION_FLAG_ARGS = new Set(["--version", "-v"]);
const VERSION_FALLBACK = "mcp-baepsae 4.0.0";

function hasVersionFlag(argv: string[]): boolean {
  return argv.some((arg) => VERSION_FLAG_ARGS.has(arg));
}

// Fast path: avoid loading MCP SDK/tool modules when only version output is needed.
if (hasVersionFlag(process.argv)) {
  try {
    const packageJsonPath = resolve(__dirname, "..", "package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      name?: unknown;
      version?: unknown;
    };

    if (typeof packageJson.name === "string" && typeof packageJson.version === "string") {
      console.log(`${packageJson.name} ${packageJson.version}`);
      process.exit(0);
    }
  } catch {
    // fall through to fallback
  }

  console.log(VERSION_FALLBACK);
  process.exit(0);
}

async function main(): Promise<void> {
  const [{ McpServer }, { StdioServerTransport }, { SERVER_NAME, SERVER_VERSION }, { registerInfoTools }, { registerSimulatorTools }, { registerUITools }, { registerInputTools }, { registerMediaTools }, { registerSystemTools }] =
    await Promise.all([
      import("@modelcontextprotocol/sdk/server/mcp.js"),
      import("@modelcontextprotocol/sdk/server/stdio.js"),
      import("./utils.js"),
      import("./tools/info.js"),
      import("./tools/simulator.js"),
      import("./tools/ui.js"),
      import("./tools/input.js"),
      import("./tools/media.js"),
      import("./tools/system.js"),
    ]);

  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  }) as unknown as McpServerType;

  registerInfoTools(server);
  registerSimulatorTools(server);
  registerUITools(server);
  registerInputTools(server);
  registerMediaTools(server);
  registerSystemTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Failed to start mcp-baepsae server:", error);
  process.exit(1);
});
