/**
 * Unit tests for mcp-baepsae internal functions.
 *
 * Since the functions are not exported (refactoring is tracked in issue #8),
 * these tests exercise them indirectly through the MCP client interface.
 * They focus on edge cases, error paths, and specific behaviors that the
 * existing contract tests do not cover.
 *
 * No booted simulator is required.
 */

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { writeFileSync, chmodSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const { version } = require("../package.json");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractText(result) {
  return result.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

async function withClient(run, envOverrides = {}) {
  const client = new Client({ name: "baepsae-unit-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    cwd: projectRoot,
    stderr: "pipe",
    env: { ...process.env, ...envOverrides },
  });

  await client.connect(transport);
  try {
    return await run(client);
  } finally {
    await client.close();
  }
}

// ===========================================================================
// Section 1: Tool registry completeness
// ===========================================================================

test("tool registry lists all 32 expected MCP tools", async () => {
  await withClient(async (client) => {
    const result = await client.listTools();
    const names = new Set(result.tools.map((t) => t.name));

    const allExpected = [
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
      "menu_action",
      "get_focused_app",
      "clipboard",
      "analyze_ui",
      "query_ui",
      "tap",
      "type_text",
      "swipe",
      "scroll",
      "drag_drop",
      "key",
      "key_sequence",
      "key_combo",
      "touch",
      "list_windows",
      "activate_app",
      "screenshot_app",
      "right_click",
    ];

    for (const name of allExpected) {
      assert.ok(names.has(name), `Missing tool: ${name}`);
    }

    assert.equal(names.size, allExpected.length, `Expected ${allExpected.length} tools, got ${names.size}`);
  });
});

// ===========================================================================
// Section 2: baepsae_help tool
// ===========================================================================

test("baepsae_help returns help text without subcommand", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({ name: "baepsae_help", arguments: {} });
    assert.equal(result.isError ?? false, false);

    const text = extractText(result);
    assert.match(text, /mcp-baepsae/);
    assert.match(text, /supported tools:/);
    assert.match(text, /Native binary requirement/);
    // Should NOT contain "Requested legacy subcommand" line
    assert.ok(!text.includes("Requested legacy subcommand"), "Should not include subcommand line when none given");
  });
});

test("baepsae_help includes subcommand reference when provided", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "baepsae_help",
      arguments: { subcommand: "describe-ui" },
    });
    assert.equal(result.isError ?? false, false);

    const text = extractText(result);
    assert.match(text, /Requested legacy subcommand: describe-ui/);
  });
});

test("baepsae_help includes version string", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({ name: "baepsae_help", arguments: {} });
    const text = extractText(result);
    const escaped = version.replace(/\./g, "\\.");
    assert.match(text, new RegExp(`v${escaped}`));
  });
});

// ===========================================================================
// Section 3: baepsae_version output structure
// ===========================================================================

test("baepsae_version includes platform and Node.js info", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({ name: "baepsae_version", arguments: {} });
    assert.equal(result.isError ?? false, false);

    const text = extractText(result);
    assert.match(text, /Node\.js:/);
    assert.match(text, /Platform:/);
    assert.match(text, /darwin/);
  });
});

test("baepsae_version includes native binary version when built", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({ name: "baepsae_version", arguments: {} });
    const text = extractText(result);
    // Should say "Native: <version>" (not "not built")
    assert.match(text, /Native:/);
    assert.ok(!text.includes("not built"), "Native binary should be built for this test");
  });
});

// ===========================================================================
// Section 4: Unified target validation
// ===========================================================================

test("analyze_ui errors when no target is provided", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "analyze_ui",
      arguments: {},
    });
    assert.equal(result.isError ?? false, true);
    const text = extractText(result);
    assert.match(text, /No target specified/);
  });
});

test("analyze_ui errors when multiple targets are provided", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "analyze_ui",
      arguments: {
        udid: "00000000-0000-0000-0000-000000000000",
        bundleId: "com.example.app",
      },
    });
    assert.equal(result.isError ?? false, true);
    const text = extractText(result);
    assert.match(text, /Multiple targets specified/);
  });
});

test("analyze_ui errors when all three targets are provided", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "analyze_ui",
      arguments: {
        udid: "00000000-0000-0000-0000-000000000000",
        bundleId: "com.example.app",
        appName: "Example",
      },
    });
    assert.equal(result.isError ?? false, true);
    const text = extractText(result);
    assert.match(text, /Multiple targets specified/);
  });
});

test("analyze_ui routes correctly with bundleId target", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "analyze_ui",
      arguments: { bundleId: "com.example.nonexistent" },
    });
    const text = extractText(result);
    assert.match(text, /baepsae-native/);
    assert.match(text, /--bundle-id/);
    assert.match(text, /com\.example\.nonexistent/);
  });
});

test("analyze_ui routes correctly with appName target", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "analyze_ui",
      arguments: { appName: "NonexistentApp" },
    });
    const text = extractText(result);
    assert.match(text, /baepsae-native/);
    assert.match(text, /--app-name/);
    assert.match(text, /NonexistentApp/);
  });
});

test("query_ui errors when no target is provided", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "query_ui",
      arguments: { query: "hello" },
    });
    assert.equal(result.isError ?? false, true);
    const text = extractText(result);
    assert.match(text, /No target specified/);
  });
});

test("list_windows errors when no target is provided", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({ name: "list_windows", arguments: {} });
    assert.equal(result.isError ?? false, true);
    const text = extractText(result);
    assert.match(text, /No target specified/);
  });
});

test("activate_app errors when no target is provided", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({ name: "activate_app", arguments: {} });
    assert.equal(result.isError ?? false, true);
    const text = extractText(result);
    assert.match(text, /No target specified/);
  });
});

// ===========================================================================
// Section 5: tap tool input validation edge cases
// ===========================================================================

test("tap errors when only y is provided (missing x)", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "tap",
      arguments: {
        udid: "00000000-0000-0000-0000-000000000000",
        y: 20,
      },
    });
    assert.equal(result.isError ?? false, true);
    const text = extractText(result);
    assert.match(text, /Both x and y must be provided together\./);
  });
});

test("tap errors when no coordinate or selector is provided", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "tap",
      arguments: {
        udid: "00000000-0000-0000-0000-000000000000",
      },
    });
    assert.equal(result.isError ?? false, true);
    const text = extractText(result);
    assert.match(text, /Provide either x\/y coordinates, id, or label\./);
  });
});

test("tap errors when coordinates and label are both given", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "tap",
      arguments: {
        udid: "00000000-0000-0000-0000-000000000000",
        x: 10,
        y: 20,
        label: "Click",
      },
    });
    assert.equal(result.isError ?? false, true);
    const text = extractText(result);
    assert.match(text, /Provide either x\/y coordinates or id\/label, not both\./);
  });
});

test("tap with label-only routes correctly to native binary", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "tap",
      arguments: {
        udid: "00000000-0000-0000-0000-000000000000",
        label: "My Button",
      },
    });
    const text = extractText(result);
    assert.match(text, /baepsae-native/);
    assert.match(text, /--label/);
  });
});

test("tap with coordinates passes x and y to native", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "tap",
      arguments: {
        udid: "00000000-0000-0000-0000-000000000000",
        x: 100,
        y: 200,
      },
    });
    const text = extractText(result);
    assert.match(text, /baepsae-native/);
    assert.match(text, /-x/);
    assert.match(text, /-y/);
  });
});

test("tap with --double flag is forwarded", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "tap",
      arguments: {
        udid: "00000000-0000-0000-0000-000000000000",
        x: 100,
        y: 200,
        double: true,
      },
    });
    const text = extractText(result);
    assert.match(text, /--double/);
  });
});

test("tap with all=true forwards --all", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "tap",
      arguments: {
        udid: "00000000-0000-0000-0000-000000000000",
        id: "test-button",
        all: true,
      },
    });
    const text = extractText(result);
    assert.match(text, /--all/);
  });
});

test("tap errors when no target is provided", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({ name: "tap", arguments: { id: "test-button" } });
    assert.equal(result.isError ?? false, true);
    const text = extractText(result);
    assert.match(text, /No target specified/);
  });
});

test("tap forwards mac target args with bundleId", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "tap",
      arguments: {
        bundleId: "com.example.app",
        id: "test-button",
      },
    });
    const text = extractText(result);
    assert.match(text, /tap/);
    assert.match(text, /--bundle-id/);
    assert.doesNotMatch(text, /--udid/);
  });
});

test("tap forwards mac target args with appName", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "tap",
      arguments: {
        appName: "Safari",
        id: "test-button",
      },
    });
    const text = extractText(result);
    assert.match(text, /tap/);
    assert.match(text, /--app-name/);
    assert.doesNotMatch(text, /--udid/);
    assert.doesNotMatch(text, /--bundle-id/);
  });
});

// ===========================================================================
// Section 6: type_text validation
// ===========================================================================

test("type_text errors when no text source is provided", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "type_text",
      arguments: {
        udid: "00000000-0000-0000-0000-000000000000",
      },
    });
    assert.equal(result.isError ?? false, true);
    const text = extractText(result);
    assert.match(text, /Provide exactly one of text, stdinText, or file\./);
  });
});

test("type_text errors when multiple text sources are provided", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "type_text",
      arguments: {
        udid: "00000000-0000-0000-0000-000000000000",
        text: "hello",
        stdinText: "world",
      },
    });
    assert.equal(result.isError ?? false, true);
    const text = extractText(result);
    assert.match(text, /Provide exactly one of text, stdinText, or file\./);
  });
});

test("type_text errors when all three text sources are provided", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "type_text",
      arguments: {
        udid: "00000000-0000-0000-0000-000000000000",
        text: "hello",
        stdinText: "world",
        file: "/tmp/test.txt",
      },
    });
    assert.equal(result.isError ?? false, true);
    const text = extractText(result);
    assert.match(text, /Provide exactly one of text, stdinText, or file\./);
  });
});

test("type_text with text argument routes to native with correct args", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "type_text",
      arguments: {
        udid: "00000000-0000-0000-0000-000000000000",
        text: "hello world",
      },
    });
    const text = extractText(result);
    assert.match(text, /baepsae-native/);
    assert.match(text, /type/);
  });
});

test("type_text with file argument includes --file flag", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "type_text",
      arguments: {
        udid: "00000000-0000-0000-0000-000000000000",
        file: "/tmp/nonexistent-type-test.txt",
      },
    });
    const text = extractText(result);
    assert.match(text, /--file/);
  });
});

test("type_text with stdinText argument includes --stdin flag", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "type_text",
      arguments: {
        udid: "00000000-0000-0000-0000-000000000000",
        stdinText: "piped text",
      },
    });
    const text = extractText(result);
    assert.match(text, /--stdin/);
  });
});

// ===========================================================================
// Section 7: clipboard validation
// ===========================================================================

test("clipboard write without text returns error", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "clipboard",
      arguments: { action: "write" },
    });
    assert.equal(result.isError ?? false, true);
    const text = extractText(result);
    assert.match(text, /text is required for write action\./);
  });
});

test("clipboard read routes correctly", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "clipboard",
      arguments: { action: "read" },
    });
    const text = extractText(result);
    assert.match(text, /baepsae-native/);
    assert.match(text, /clipboard/);
    assert.match(text, /--read/);
  });
});

test("clipboard write with text routes correctly", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "clipboard",
      arguments: { action: "write", text: "test clipboard content" },
    });
    const text = extractText(result);
    assert.match(text, /baepsae-native/);
    assert.match(text, /clipboard/);
    assert.match(text, /--write/);
  });
});

// ===========================================================================
// Section 8: menu_action validation
// ===========================================================================

test("menu_action errors when no app identifier is provided", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "menu_action",
      arguments: { menu: "File", item: "Save" },
    });
    assert.equal(result.isError ?? false, true);
    const text = extractText(result);
    assert.match(text, /Provide bundleId or appName\./);
  });
});

test("menu_action with bundleId routes correctly", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "menu_action",
      arguments: { bundleId: "com.apple.Safari", menu: "File", item: "Save" },
    });
    const text = extractText(result);
    assert.match(text, /baepsae-native/);
    assert.match(text, /menu-action/);
    assert.match(text, /--bundle-id/);
    assert.match(text, /--menu/);
    assert.match(text, /--item/);
  });
});

test("menu_action with appName routes correctly", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "menu_action",
      arguments: { appName: "Safari", menu: "File", item: "Save" },
    });
    const text = extractText(result);
    assert.match(text, /baepsae-native/);
    assert.match(text, /menu-action/);
    assert.match(text, /--app-name/);
  });
});

// ===========================================================================
// Section 9: toToolResult output structure (via command execution)
// ===========================================================================

test("successful native command output includes Executable, Command, Exit code, Duration lines", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "analyze_ui",
      arguments: { udid: "00000000-0000-0000-0000-000000000000" },
    });
    const text = extractText(result);

    assert.match(text, /^Executable: /m, "Output should include Executable line");
    assert.match(text, /^Command: /m, "Output should include Command line");
    assert.match(text, /^Exit code: /m, "Output should include Exit code line");
    assert.match(text, /^Duration: \d+ms/m, "Output should include Duration line in ms");
  });
});

test("native command output quotes arguments with special characters in Command line", async () => {
  await withClient(async (client) => {
    // Search UI with a query containing spaces to test quoteArg
    const result = await client.callTool({
      name: "query_ui",
      arguments: {
        udid: "00000000-0000-0000-0000-000000000000",
        query: "hello world",
      },
    });
    const text = extractText(result);
    // The "hello world" argument should be quoted in the Command line
    assert.match(text, /Command:.*"hello world"/, "Arguments with spaces should be quoted");
  });
});

// ===========================================================================
// Section 10: analyze_ui optional parameters forwarding
// ===========================================================================

test("analyze_ui forwards pagination parameters (offset/limit)", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "analyze_ui",
      arguments: {
        udid: "00000000-0000-0000-0000-000000000000",
        offset: 5,
        limit: 10,
      },
    });
    const text = extractText(result);
    assert.match(text, /--offset/, "Should forward --offset");
    assert.match(text, /--limit/, "Should forward --limit");
  });
});

test("analyze_ui forwards filter parameters (role, visibleOnly, maxDepth)", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "analyze_ui",
      arguments: {
        udid: "00000000-0000-0000-0000-000000000000",
        role: "AXButton",
        visibleOnly: true,
        maxDepth: 3,
      },
    });
    const text = extractText(result);
    assert.match(text, /--role/, "Should forward --role");
    assert.match(text, /--visible-only/, "Should forward --visible-only");
    assert.match(text, /--max-depth/, "Should forward --max-depth");
  });
});

test("analyze_ui forwards --all and --summary flags", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "analyze_ui",
      arguments: {
        udid: "00000000-0000-0000-0000-000000000000",
        all: true,
        summary: true,
      },
    });
    const text = extractText(result);
    assert.match(text, /--all/, "Should forward --all");
    assert.match(text, /--summary/, "Should forward --summary");
  });
});

test("analyze_ui forwards rootElementId parameter", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "analyze_ui",
      arguments: {
        udid: "00000000-0000-0000-0000-000000000000",
        rootElementId: "some-element-42",
      },
    });
    const text = extractText(result);
    assert.match(text, /--root-element-id/, "Should forward --root-element-id");
  });
});

// ===========================================================================
// Section 11: query_ui optional parameters
// ===========================================================================

test("query_ui forwards optional filter parameters", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "query_ui",
      arguments: {
        udid: "00000000-0000-0000-0000-000000000000",
        query: "test",
        role: "AXStaticText",
        visibleOnly: true,
        maxDepth: 5,
      },
    });
    const text = extractText(result);
    assert.match(text, /--role/, "Should forward --role");
    assert.match(text, /AXStaticText/);
    assert.match(text, /--visible-only/, "Should forward --visible-only");
    assert.match(text, /--max-depth/, "Should forward --max-depth");
  });
});

// ===========================================================================
// Section 12: key_sequence keycodes handling
// ===========================================================================

test("key_sequence accepts array of keycodes", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "key_sequence",
      arguments: {
        udid: "00000000-0000-0000-0000-000000000000",
        keycodes: [4, 5, 6],
      },
    });
    const text = extractText(result);
    assert.match(text, /baepsae-native/);
    assert.match(text, /key-sequence/);
    assert.match(text, /--keycodes/);
    // Array [4,5,6] should be joined as "4,5,6"
    assert.match(text, /4,5,6/);
  });
});

test("key_sequence accepts comma-separated string of keycodes", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "key_sequence",
      arguments: {
        udid: "00000000-0000-0000-0000-000000000000",
        keycodes: "10,20,30",
      },
    });
    const text = extractText(result);
    assert.match(text, /--keycodes/);
    assert.match(text, /10,20,30/);
  });
});

test("key_sequence forwards delay option", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "key_sequence",
      arguments: {
        udid: "00000000-0000-0000-0000-000000000000",
        keycodes: [4, 5],
        delay: 0.1,
      },
    });
    const text = extractText(result);
    assert.match(text, /--delay/);
  });
});

// ===========================================================================
// Section 13: touch tool defaults
// ===========================================================================

test("touch defaults to --down --up when neither specified", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "touch",
      arguments: {
        udid: "00000000-0000-0000-0000-000000000000",
        x: 100,
        y: 200,
      },
    });
    const text = extractText(result);
    assert.match(text, /--down/, "Should default to --down");
    assert.match(text, /--up/, "Should default to --up");
  });
});

test("touch with only down flag omits up", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "touch",
      arguments: {
        udid: "00000000-0000-0000-0000-000000000000",
        x: 100,
        y: 200,
        down: true,
        up: false,
      },
    });
    const text = extractText(result);
    assert.match(text, /--down/);
    // Should not have --up in the command (but might appear elsewhere in output)
    const commandLine = text.split("\n").find((l) => l.startsWith("Command:"));
    assert.ok(commandLine, "Should have Command line");
    assert.ok(!commandLine.includes("--up"), "Command should not include --up when up=false");
  });
});

// ===========================================================================
// Section 14: swipe parameter forwarding
// ===========================================================================

test("swipe forwards all coordinates and optional parameters", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "swipe",
      arguments: {
        udid: "00000000-0000-0000-0000-000000000000",
        startX: 10,
        startY: 20,
        endX: 300,
        endY: 400,
        duration: 0.5,
        preDelay: 0.1,
        postDelay: 0.2,
      },
    });
    const text = extractText(result);
    assert.match(text, /--start-x/);
    assert.match(text, /--start-y/);
    assert.match(text, /--end-x/);
    assert.match(text, /--end-y/);
    assert.match(text, /--duration/);
    assert.match(text, /--pre-delay/);
    assert.match(text, /--post-delay/);
  });
});

// ===========================================================================
// Section 15: gesture parameter forwarding
// ===========================================================================

test("gesture forwards screen dimensions and timing parameters", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "gesture",
      arguments: {
        udid: "00000000-0000-0000-0000-000000000000",
        preset: "scroll-up",
        screenWidth: 390,
        screenHeight: 844,
        duration: 0.3,
        preDelay: 0.1,
        postDelay: 0.2,
      },
    });
    const text = extractText(result);
    assert.match(text, /gesture/);
    assert.match(text, /scroll-up/);
    assert.match(text, /--screen-width/);
    assert.match(text, /--screen-height/);
    assert.match(text, /--duration/);
    assert.match(text, /--pre-delay/);
    assert.match(text, /--post-delay/);
  });
});

// ===========================================================================
// Section 16: button parameter forwarding
// ===========================================================================

test("button forwards duration option", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "button",
      arguments: {
        udid: "00000000-0000-0000-0000-000000000000",
        buttonType: "home",
        duration: 1.5,
      },
    });
    const text = extractText(result);
    assert.match(text, /button/);
    assert.match(text, /home/);
    assert.match(text, /--duration/);
  });
});

// ===========================================================================
// Section 17: key_combo parameter forwarding
// ===========================================================================

test("key_combo formats modifiers as comma-separated list", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "key_combo",
      arguments: {
        udid: "00000000-0000-0000-0000-000000000000",
        modifiers: [224, 225],
        key: 4,
      },
    });
    const text = extractText(result);
    assert.match(text, /key-combo/);
    assert.match(text, /--modifiers/);
    assert.match(text, /224,225/);
    assert.match(text, /--key/);
  });
});

// ===========================================================================
// Section 18: drag_drop parameter forwarding
// ===========================================================================

test("drag_drop forwards all coordinates and optional duration", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "drag_drop",
      arguments: {
        bundleId: "com.example.app",
        startX: 10,
        startY: 20,
        endX: 300,
        endY: 400,
        duration: 1.0,
      },
    });
    const text = extractText(result);
    assert.match(text, /drag-drop/);
    assert.match(text, /--start-x/);
    assert.match(text, /--start-y/);
    assert.match(text, /--end-x/);
    assert.match(text, /--end-y/);
    assert.match(text, /--duration/);
  });
});

// ===========================================================================
// Section 19: scroll parameter forwarding
// ===========================================================================

test("scroll forwards delta and coordinate options", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "scroll",
      arguments: {
        bundleId: "com.example.app",
        deltaX: 0,
        deltaY: -5,
        x: 200,
        y: 300,
      },
    });
    const text = extractText(result);
    assert.match(text, /scroll/);
    assert.match(text, /--delta-x/);
    assert.match(text, /--delta-y/);
    assert.match(text, /-x/);
    assert.match(text, /-y/);
  });
});

// ===========================================================================
// Section 20: right_click parameter forwarding
// ===========================================================================

test("right_click forwards coordinate and selector options", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "right_click",
      arguments: {
        bundleId: "com.example.app",
        x: 50,
        y: 100,
      },
    });
    const text = extractText(result);
    assert.match(text, /right-click/);
    assert.match(text, /-x/);
    assert.match(text, /-y/);
  });
});

test("right_click with udid and all=true forwards --all and --udid", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "right_click",
      arguments: {
        udid: "00000000-0000-0000-0000-000000000000",
        id: "test-button",
        all: true,
      },
    });
    const text = extractText(result);
    assert.match(text, /right-click/);
    assert.match(text, /--all/);
    assert.match(text, /--udid/);
  });
});

test("right_click routes with mac target", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "right_click",
      arguments: {
        bundleId: "com.example.app",
        id: "test-button",
      },
    });
    const text = extractText(result);
    assert.match(text, /right-click/);
    assert.match(text, /--bundle-id/);
    assert.doesNotMatch(text, /--udid/);
  });
});

// ===========================================================================
// Section 21: screenshot_app output option
// ===========================================================================

test("screenshot_app forwards output option", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "screenshot_app",
      arguments: {
        bundleId: "com.example.app",
        output: "/tmp/test-screenshot.png",
      },
    });
    const text = extractText(result);
    assert.match(text, /screenshot-app/);
    assert.match(text, /--output/);
  });
});

// ===========================================================================
// Section 22: record_video extra lines and timeout
// ===========================================================================

test("record_video output includes recording duration and output file", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "record_video",
      arguments: {
        udid: "00000000-0000-0000-0000-000000000000",
        durationSeconds: 2,
        output: ".tmp-test-artifacts/test-record.mov",
      },
    });
    const text = extractText(result);
    assert.match(text, /Recording duration: 2s/);
    assert.match(text, /Output file:.*test-record\.mov/);
  });
});

test("record_video defaults to 10s duration when not specified", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "record_video",
      arguments: {
        udid: "00000000-0000-0000-0000-000000000000",
        output: ".tmp-test-artifacts/test-record-default.mov",
      },
    });
    const text = extractText(result);
    assert.match(text, /Recording duration: 10s/);
  });
});

// ===========================================================================
// Section 23: stream_video extra lines
// ===========================================================================

test("stream_video output includes capture duration and output file", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "stream_video",
      arguments: {
        udid: "00000000-0000-0000-0000-000000000000",
        durationSeconds: 2,
        output: ".tmp-test-artifacts/test-stream.mov",
      },
    });
    const text = extractText(result);
    assert.match(text, /Capture duration: 2s/);
    assert.match(text, /Output file:.*test-stream\.mov/);
  });
});

// ===========================================================================
// Section 24: resolveNativeBinary with BAEPSAE_NATIVE_PATH env override
// ===========================================================================

test("BAEPSAE_NATIVE_PATH override uses specified binary", async () => {
  // Create a fake executable to test the env override
  const tmpDir = path.join(os.tmpdir(), `baepsae-unit-test-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });

  const fakeBinary = path.join(tmpDir, "fake-baepsae-native");
  // Write a simple script that echoes a known string
  writeFileSync(fakeBinary, '#!/bin/sh\necho "FAKE_NATIVE_BINARY"\n');
  chmodSync(fakeBinary, 0o755);

  try {
    await withClient(async (client) => {
      // list_apps calls runNative which calls resolveNativeBinary
      const result = await client.callTool({
        name: "list_apps",
        arguments: {},
      });
      const text = extractText(result);
      // The executable path should point to our fake binary
      assert.match(text, /fake-baepsae-native/, "Should use the overridden binary path");
      assert.match(text, /FAKE_NATIVE_BINARY/, "Should contain output from fake binary");
    }, { BAEPSAE_NATIVE_PATH: fakeBinary });
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("BAEPSAE_NATIVE_PATH with non-executable file returns error", async () => {
  const tmpDir = path.join(os.tmpdir(), `baepsae-unit-test-noexec-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });

  const nonExecFile = path.join(tmpDir, "not-executable");
  writeFileSync(nonExecFile, "not a binary");
  chmodSync(nonExecFile, 0o644); // not executable

  try {
    await withClient(async (client) => {
      const result = await client.callTool({
        name: "list_apps",
        arguments: {},
      });
      assert.equal(result.isError ?? false, true);
      const text = extractText(result);
      assert.match(text, /not executable/);
    }, { BAEPSAE_NATIVE_PATH: nonExecFile });
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ===========================================================================
// Section 25: executeCommand timeout and error handling
// ===========================================================================

test("native command shows non-zero exit code as error", async () => {
  // Use a guaranteed-missing macOS app name so native target resolution fails.
  await withClient(async (client) => {
    const missingAppName = `__baepsae_missing_app_${Date.now()}__`;
    const result = await client.callTool({
      name: "analyze_ui",
      arguments: { appName: missingAppName },
    });
    const text = extractText(result);
    assert.match(text, /Exit code:/, "Should show exit code in output");
    assert.equal(result.isError ?? false, true);
  });
});

test("simctl command with invalid UDID returns error", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "open_url",
      arguments: { udid: "INVALID-UDID", url: "https://example.com" },
    });
    assert.equal(result.isError ?? false, true);
    const text = extractText(result);
    assert.match(text, /Exit code:/, "Should show exit code");
  });
});

// ===========================================================================
// Section 26: list_simulators routes through simctl
// ===========================================================================

test("list_simulators routes through xcrun simctl", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "list_simulators",
      arguments: {},
    });
    const text = extractText(result);
    assert.match(text, /Executable:.*xcrun/, "Should execute through xcrun");
    assert.match(text, /simctl/, "Command should include simctl");
    assert.match(text, /list/, "Command should include list");
  });
});

// ===========================================================================
// Section 27: open_url, install_app, launch_app route through simctl
// ===========================================================================

test("open_url routes through simctl with correct args", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "open_url",
      arguments: { udid: "fake-udid", url: "https://example.com" },
    });
    const text = extractText(result);
    assert.match(text, /simctl/);
    assert.match(text, /openurl/);
  });
});

test("install_app resolves path and routes through simctl", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "install_app",
      arguments: { udid: "fake-udid", path: "/tmp/nonexistent.app" },
    });
    const text = extractText(result);
    assert.match(text, /simctl/);
    assert.match(text, /install/);
  });
});

test("launch_app forwards args and env to simctl", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "launch_app",
      arguments: {
        udid: "fake-udid",
        bundleId: "com.example.app",
        args: ["--debug"],
        env: { MY_VAR: "value" },
      },
    });
    const text = extractText(result);
    assert.match(text, /simctl/);
    assert.match(text, /launch/);
  });
});

// ===========================================================================
// Section 28: screenshot path handling
// ===========================================================================

test("screenshot generates auto-named output file when none specified", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "screenshot",
      arguments: { udid: "fake-udid" },
    });
    const text = extractText(result);
    assert.match(text, /Output file:.*simulator-screenshot-.*\.png/);
  });
});

// ===========================================================================
// Section 29: Tool content shape validation
// ===========================================================================

test("tool results always have content array with text type entries", async () => {
  await withClient(async (client) => {
    // Test a variety of tool responses
    const results = await Promise.all([
      client.callTool({ name: "baepsae_help", arguments: {} }),
      client.callTool({ name: "baepsae_version", arguments: {} }),
      client.callTool({ name: "list_simulators", arguments: {} }),
      client.callTool({
        name: "analyze_ui",
        arguments: {},
      }),
    ]);

    for (const result of results) {
      assert.ok(Array.isArray(result.content), "content should be an array");
      assert.ok(result.content.length > 0, "content should not be empty");
      for (const item of result.content) {
        assert.equal(item.type, "text", "content items should be type text");
        assert.equal(typeof item.text, "string", "text should be a string");
        assert.ok(item.text.length > 0, "text should not be empty");
      }
    }
  });
});

// ===========================================================================
// Section 30: tap with pre/post delay parameters
// ===========================================================================

test("tap forwards preDelay and postDelay options", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "tap",
      arguments: {
        udid: "00000000-0000-0000-0000-000000000000",
        x: 100,
        y: 200,
        preDelay: 0.5,
        postDelay: 0.3,
      },
    });
    const text = extractText(result);
    assert.match(text, /--pre-delay/);
    assert.match(text, /--post-delay/);
  });
});

// ===========================================================================
// Section 31: get_focused_app routes to native
// ===========================================================================

test("get_focused_app routes to native binary", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "get_focused_app",
      arguments: {},
    });
    const text = extractText(result);
    assert.match(text, /baepsae-native/);
    assert.match(text, /get-focused-app/);
  });
});

// ===========================================================================
// Section 32: key with duration option
// ===========================================================================

test("key forwards duration option", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({
      name: "key",
      arguments: {
        udid: "00000000-0000-0000-0000-000000000000",
        keycode: 40,
        duration: 0.5,
      },
    });
    const text = extractText(result);
    assert.match(text, /key/);
    assert.match(text, /--duration/);
  });
});

// ===========================================================================
// Cleanup
// ===========================================================================

test("cleanup: remove unit test artifacts", async () => {
  const artifactDir = path.join(projectRoot, ".tmp-test-artifacts");
  rmSync(artifactDir, { recursive: true, force: true });
});
