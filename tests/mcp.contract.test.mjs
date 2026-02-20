import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const require = createRequire(import.meta.url);
const { version } = require("../package.json");

// CI runners can be very slow; use a generous request timeout
const REQUEST_TIMEOUT_MS = 120_000;

async function withClient(run) {
  const client = new Client(
    { name: "baepsae-contract-test", version: "1.0.0" },
    { capabilities: {}, requestTimeoutMs: REQUEST_TIMEOUT_MS },
  );
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

async function withClientFromDir(cwd, run) {
  const client = new Client(
    { name: "baepsae-contract-test", version: "1.0.0" },
    { capabilities: {}, requestTimeoutMs: REQUEST_TIMEOUT_MS },
  );
  const transport = new StdioClientTransport({
    command: "node",
    args: [path.join(projectRoot, "dist/index.js")],
    cwd,
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
      "list_apps",
      "open_url",
      "install_app",
      "launch_app",
      "terminate_app",
      "uninstall_app",
      "button",
      "gesture",
      "stream_video",
      "record_video",
      "screenshot",
      "sim_describe_ui",
      "mac_describe_ui",
      "sim_search_ui",
      "mac_search_ui",
      "sim_tap",
      "mac_tap",
      "sim_type_text",
      "mac_type_text",
      "sim_swipe",
      "mac_swipe",
      "sim_key",
      "mac_key",
      "sim_key_sequence",
      "mac_key_sequence",
      "sim_key_combo",
      "mac_key_combo",
      "sim_touch",
      "mac_touch",
      "sim_right_click",
      "mac_right_click",
      "sim_scroll",
      "mac_scroll",
      "sim_drag_drop",
      "mac_drag_drop",
      "sim_list_windows",
      "mac_list_windows",
      "sim_activate_app",
      "mac_activate_app",
      "sim_screenshot_app",
      "mac_screenshot_app",
      "menu_action",
      "get_focused_app",
      "clipboard",
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

    const escapedVersion = version.replace(/\./g, "\\.");
    assert.match(text, new RegExp(`mcp-baepsae ${escapedVersion}`));
  });
});

test("sim_tap validates coordinate pair before native invocation", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "sim_tap",
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

test("sim_describe_ui call is routed to native layer", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "sim_describe_ui",
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

test("sim_describe_ui routes with simulator target", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "sim_describe_ui",
      arguments: {
        udid: "00000000-0000-0000-0000-000000000000",
      },
    });

    const text = result.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");

    assert.match(text, /describe-ui/);
    assert.match(text, /--udid/);
  });
});

test("mac_describe_ui routes with macOS target", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "mac_describe_ui",
      arguments: {
        bundleId: "com.example.app",
      },
    });

    const text = result.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");

    assert.match(text, /describe-ui/);
    assert.match(text, /--bundle-id/);
  });
});

test("sim_tap id/label call is routed to native layer", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "sim_tap",
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

test("sim_tap forwards all=true to native --all", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "sim_tap",
      arguments: {
        udid: "00000000-0000-0000-0000-000000000000",
        id: "com.example.button",
        all: true,
      },
    });

    const text = result.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");

    assert.match(text, /tap/);
    assert.match(text, /--all/);
  });
});

test("sim_tap forwards simulator-scoped args", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "sim_tap",
      arguments: {
        udid: "00000000-0000-0000-0000-000000000000",
        id: "com.example.button",
        all: true,
      },
    });

    const text = result.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");

    assert.match(text, /tap/);
    assert.match(text, /--udid/);
    assert.match(text, /--all/);
  });
});

test("sim_tap rejects mixing coordinate and selector inputs", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "sim_tap",
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

test("sim_describe_ui forwards output option to native layer", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "sim_describe_ui",
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

// --- npx scenario tests (cwd ≠ package root) ---

test("baepsae_version resolves native binary from different cwd (npx scenario)", async () => {
  await withClientFromDir(os.tmpdir(), async (client) => {
    const result = await client.callTool({ name: "baepsae_version", arguments: {} });
    assert.equal(result.isError ?? false, false);

    const text = result.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");

    const escapedVersion = version.replace(/\./g, "\\.");
    assert.match(text, new RegExp(`mcp-baepsae ${escapedVersion}`));
  });
});

test("sim_describe_ui resolves native binary from different cwd (npx scenario)", async () => {
  await withClientFromDir(os.tmpdir(), async (client) => {
    const result = await client.callTool({
      name: "sim_describe_ui",
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

// --- CLI --version flag tests (Issue #17) ---

test("--version flag prints version and exits", () => {
  const output = execFileSync("node", ["dist/index.js", "--version"], {
    cwd: projectRoot,
    encoding: "utf8",
    timeout: 30000,
  }).trim();

  assert.match(output, /^mcp-baepsae \d+\.\d+\.\d+$/);
});

test("-v flag prints version and exits", () => {
  const output = execFileSync("node", ["dist/index.js", "-v"], {
    cwd: projectRoot,
    encoding: "utf8",
    timeout: 30000,
  }).trim();

  assert.match(output, /^mcp-baepsae \d+\.\d+\.\d+$/);
});
