#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { SERVER_NAME, SERVER_VERSION } from "./utils.js";
import { registerInfoTools } from "./tools/info.js";
import { registerSimulatorTools } from "./tools/simulator.js";
import { registerUITools } from "./tools/ui.js";
import { registerInputTools } from "./tools/input.js";
import { registerMediaTools } from "./tools/media.js";
import { registerSystemTools } from "./tools/system.js";

// --- Issue #17: CLI --version flag ---
if (process.argv.includes("--version") || process.argv.includes("-v")) {
  try {
    const packageJsonPath = resolve(__dirname, "..", "package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    console.log(`${packageJson.name} ${packageJson.version}`);
  } catch {
    console.log(`${SERVER_NAME} ${SERVER_VERSION}`);
  }
  process.exit(0);
}

const server = new McpServer({
  name: SERVER_NAME,
  version: SERVER_VERSION,
});

// Register all tool groups
registerInfoTools(server);
registerSimulatorTools(server);
registerUITools(server);
registerInputTools(server);
registerMediaTools(server);
registerSystemTools(server);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(`Failed to start ${SERVER_NAME} server:`, error);
  process.exit(1);
});
