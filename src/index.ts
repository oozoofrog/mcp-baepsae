#!/usr/bin/env node

import type { McpServer as McpServerType } from "@modelcontextprotocol/sdk/server/mcp.js";

import { PACKAGE_NAME, PACKAGE_VERSION } from "./version.js";

const VERSION_FLAG_ARGS = new Set(["--version", "-v"]);

function hasVersionFlag(argv: string[]): boolean {
  return argv.some((arg) => VERSION_FLAG_ARGS.has(arg));
}

// Fast path: avoid loading MCP SDK/tool modules when only version output is needed.
if (hasVersionFlag(process.argv)) {
  console.log(`${PACKAGE_NAME} ${PACKAGE_VERSION}`);
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
