import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

async function withClient(run) {
  const client = new Client({ name: "baepsae-contract-test", version: "1.0.0" });
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

test("tools/list exposes expected MCP tools", async () => {
  await withClient(async (client) => {
    const result = await client.listTools();
    const names = new Set(result.tools.map((tool) => tool.name));

    const expected = [
      "baepsae_help",
      "baepsae_version",
      "list_simulators",
      "open_url",
      "install_app",
      "launch_app",
      "terminate_app",
      "uninstall_app",
      "describe_ui",
      "search_ui",
      "tap",
      "type_text",
      "swipe",
      "button",
      "key",
      "key_sequence",
      "key_combo",
      "touch",
      "gesture",
      "stream_video",
      "record_video",
      "screenshot",
    ];

    for (const name of expected) {
      assert.equal(names.has(name), true, `Missing tool: ${name}`);
    }
  });
});

test("baepsae_version returns non-error response", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({ name: "baepsae_version", arguments: {} });
    assert.equal(result.isError ?? false, false);

    const text = result.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");

    assert.match(text, /mcp-baepsae 3\.1\.0/);
  });
});

test("tap validates coordinate pair before native invocation", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "tap",
      arguments: {
        udid: "00000000-0000-0000-0000-000000000000",
        x: 10,
      },
    });

    assert.equal(result.isError ?? false, true);
    const text = result.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");
    assert.match(text, /Both x and y must be provided together\./);
  });
});

test("describe_ui call is routed to native layer", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "describe_ui",
      arguments: {
        udid: "00000000-0000-0000-0000-000000000000",
      },
    });

    const text = result.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");

    assert.match(text, /Executable:/);
    assert.match(text, /baepsae-native/);
    assert.match(text, /describe-ui/);
  });
});

test("tap id/label call is routed to native layer", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "tap",
      arguments: {
        udid: "00000000-0000-0000-0000-000000000000",
        id: "com.example.button",
      },
    });

    const text = result.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");

    assert.match(text, /Executable:/);
    assert.match(text, /baepsae-native/);
    assert.match(text, /tap/);
    assert.match(text, /--id/);
  });
});

test("tap rejects mixing coordinate and selector inputs", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "tap",
      arguments: {
        udid: "00000000-0000-0000-0000-000000000000",
        x: 10,
        y: 20,
        id: "com.example.button",
      },
    });

    assert.equal(result.isError ?? false, true);
    const text = result.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");
    assert.match(text, /Provide either x\/y coordinates or id\/label, not both\./);
  });
});

test("describe_ui forwards output option to native layer", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "describe_ui",
      arguments: {
        udid: "00000000-0000-0000-0000-000000000000",
        output: ".tmp-test-artifacts/describe-ui.txt",
      },
    });

    const text = result.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");

    assert.match(text, /describe-ui/);
    assert.match(text, /--output/);
  });
});

test("stream_video allows omitted output and auto-generates output path", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "stream_video",
      arguments: {
        udid: "00000000-0000-0000-0000-000000000000",
      },
    });

    const text = result.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");

    assert.match(text, /Executable:/);
    assert.match(text, /stream-video/);
    assert.match(text, /--output/);
    assert.match(text, /Output file: .*simulator-stream-.*\.mov/);
  });
});
