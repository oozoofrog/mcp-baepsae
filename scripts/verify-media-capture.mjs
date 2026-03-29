import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, stat } from "node:fs/promises";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const artifactDir = path.join(projectRoot, ".tmp-test-artifacts");
const realNativePath = path.join(projectRoot, "native", ".build", "release", "baepsae-native");

function extractText(result) {
  return result.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

function extractBootedUdid(text) {
  const match = text.match(/\(([0-9A-F-]{36})\)\s+\(Booted\)/i);
  return match ? match[1] : null;
}

async function withClient(run) {
  const client = new Client({ name: "baepsae-media-verify", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    cwd: projectRoot,
    stderr: "pipe",
    env: {
      ...process.env,
      BAEPSAE_NATIVE_PATH: process.env.BAEPSAE_NATIVE_PATH ?? realNativePath,
    },
  });

  await client.connect(transport);
  try {
    return await run(client);
  } finally {
    await client.close();
  }
}

async function main() {
  await mkdir(artifactDir, { recursive: true });

  const summary = await withClient(async (client) => {
    const listResult = await client.callTool({ name: "list_simulators", arguments: {} });
    const udid = extractBootedUdid(extractText(listResult));
    if (!udid) {
      throw new Error("No booted simulator detected.");
    }

    const probes = [
      ["screenshot", { udid, output: path.join(artifactDir, `verify-media-${Date.now()}.png`) }],
      ["record_video", { udid, output: path.join(artifactDir, `verify-media-${Date.now()}.mov`), durationSeconds: 2 }],
      ["stream_video", { udid, output: path.join(artifactDir, `verify-media-${Date.now()}.mov`), durationSeconds: 2 }],
    ];

    const results = [];
    for (const [name, args] of probes) {
      const result = await client.callTool({ name, arguments: args });
      const text = extractText(result);
      const outputPath = args.output;
      let fileSize = null;
      try {
        const info = await stat(outputPath);
        fileSize = info.size;
      } catch {
        // ignore
      }

      results.push({
        tool: name,
        isError: !!result.isError,
        outputPath,
        fileSize,
        text,
        error: result.error ?? null,
      });
    }
    return { udid, results };
  });

  console.log(JSON.stringify(summary, null, 2));

  const failed = summary.results.filter((entry) => entry.isError || !entry.fileSize || entry.fileSize <= 0);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
