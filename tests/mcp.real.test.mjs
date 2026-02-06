import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, rm, stat } from "node:fs/promises";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const artifactDir = path.join(projectRoot, ".tmp-test-artifacts");

async function withClient(run) {
  const client = new Client({ name: "baepsae-real-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    cwd: projectRoot,
    stderr: "pipe",
  });

  await client.connect(transport);
  try {
    return await run(client);
  } finally {
    await client.close();
  }
}

function extractBootedUdid(text) {
  const match = text.match(/\(([0-9A-F-]{36})\)\s+\(Booted\)/i);
  return match ? match[1] : null;
}

test("real-world simulator smoke (list/screenshot/record)", { timeout: 120000 }, async (t) => {
  await mkdir(artifactDir, { recursive: true });

  await withClient(async (client) => {
    const listResult = await client.callTool({ name: "list_simulators", arguments: {} });
    assert.equal(listResult.isError ?? false, false);

    const listText = listResult.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");

    const udid = extractBootedUdid(listText);
    if (!udid) {
      t.skip("No booted simulator detected");
      return;
    }

    const screenshotPath = path.join(artifactDir, `smoke-${Date.now()}.png`);
    const recordPath = path.join(artifactDir, `smoke-${Date.now()}.mov`);

    const screenshotResult = await client.callTool({
      name: "screenshot",
      arguments: { udid, output: screenshotPath },
    });
    assert.equal(screenshotResult.isError ?? false, false);

    const screenshotStat = await stat(screenshotPath);
    assert.equal(screenshotStat.isFile(), true);
    assert.equal(screenshotStat.size > 0, true);

    const recordResult = await client.callTool({
      name: "record_video",
      arguments: { udid, output: recordPath, durationSeconds: 2 },
    });
    assert.equal(recordResult.isError ?? false, false);

    const recordStat = await stat(recordPath);
    assert.equal(recordStat.isFile(), true);
    assert.equal(recordStat.size > 0, true);
  });

  await rm(artifactDir, { recursive: true, force: true });
});
