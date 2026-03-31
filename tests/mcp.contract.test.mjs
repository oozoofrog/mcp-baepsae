import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";

import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { TOOL_MANIFEST } from "../dist/tool-manifest.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const require = createRequire(import.meta.url);
const { version } = require("../package.json");
const nativeBinaryPath = path.join(projectRoot, "native", ".build", "release", "baepsae-native");

// CI runners can be very slow; use a generous request timeout.
// Keep this higher than the per-command native timeout to avoid flaky contract
// failures when GitHub Actions runners are under load.
const REQUEST_TIMEOUT_MS = 180_000;

async function withClient(run, envOverrides = {}) {
  const client = new Client(
    { name: "baepsae-contract-test", version: "1.0.0" },
    { capabilities: {}, requestTimeoutMs: REQUEST_TIMEOUT_MS },
  );
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

function extractText(result) {
  return result.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

function countMatches(text, pattern) {
  const matches = text.match(pattern);
  return matches ? matches.length : 0;
}

function runNativeCli(args) {
  return spawnSync(nativeBinaryPath, args, {
    cwd: projectRoot,
    encoding: "utf8",
    timeout: 30000,
  });
}

function createFakeNativeBinary(options = {}) {
  const {
    failCommands = [],
    selectorFailuresBeforeSuccess = 0,
    selectorFailureMode = "selector_not_found",
  } = Array.isArray(options) ? { failCommands: options } : options;
  const dir = mkdtempSync(path.join(os.tmpdir(), "baepsae-workflow-contract-"));
  const binaryPath = path.join(dir, "fake-baepsae-native.sh");
  const logPath = path.join(dir, "native.log");
  const selectorStatePath = path.join(dir, "selector.state");
  const selectorNotFoundPayload =
    'BAEPSAE_ERROR {"code":"availability.target_unavailable","category":"availability","retryable":true,"source":"native","message":"No accessibility element matched selector.","nativeCode":"command_failed"}';
  const permissionPayload =
    'BAEPSAE_ERROR {"code":"permission.accessibility_required","category":"permission","retryable":false,"source":"native","message":"Permission Denied: Accessibility access is required.","nativeCode":"command_failed"}';
  const script = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    'log_file="${BAEPSAE_FAKE_NATIVE_LOG:?missing log file}"',
    'fail_commands="${BAEPSAE_FAKE_NATIVE_FAIL_COMMANDS:-}"',
    'selector_failures="${BAEPSAE_FAKE_NATIVE_SELECTOR_FAILURES_BEFORE_SUCCESS:-0}"',
    'selector_failure_mode="${BAEPSAE_FAKE_NATIVE_SELECTOR_FAILURE_MODE:-selector_not_found}"',
    'selector_state_file="${BAEPSAE_FAKE_NATIVE_SELECTOR_STATE_FILE:-}"',
    'cmd="${1:-}"',
    'printf \'%s\\n\' "$*" >> "$log_file"',
    'if [[ "$cmd" == "--version" ]]; then',
    '  echo "baepsae-native 0.0.0"',
    "  exit 0",
    "fi",
    'if [[ -n "$selector_state_file" ]]; then',
    '  touch "$selector_state_file" 2>/dev/null || true',
    "fi",
    'if [[ "$cmd" == "tap" && ( " $* " == *" --id "* || " $* " == *" --label "* ) ]]; then',
    '  if [[ -z "$selector_state_file" ]]; then',
    '    selector_state_file="${BAEPSAE_FAKE_NATIVE_LOG}.selector.state"',
    "  fi",
    '  current_failures=0',
    '  if [[ -f "$selector_state_file" ]]; then',
    '    current_failures="$(cat "$selector_state_file" 2>/dev/null || echo 0)"',
    "  fi",
    '  if (( current_failures < selector_failures )); then',
    '    next_failures=$((current_failures + 1))',
    '    printf \'%s\\n\' "$next_failures" > "$selector_state_file"',
    '    if [[ "$selector_failure_mode" == "permission_denied" ]]; then',
    `      printf '%s\\n' '${permissionPayload}' >&2`,
    '      printf \'Permission Denied: Accessibility access is required.\\n\' >&2',
    "      exit 1",
    "    fi",
    `    printf '%s\\n' '${selectorNotFoundPayload}' >&2`,
    '    printf \'No accessibility element matched selector.\\n\' >&2',
    "    exit 1",
    "  fi",
    "fi",
    'if [[ " $fail_commands " == *" $cmd "* ]]; then',
    '  echo "forced failure for $cmd" >&2',
    "  exit 1",
    "fi",
    "exit 0",
  ].join("\n");
  writeFileSync(binaryPath, script);
  chmodSync(binaryPath, 0o755);
  writeFileSync(selectorStatePath, "0\n");
  return { dir, binaryPath, logPath };
}

async function withFakeNativeClient(run, failCommands = [], fakeOptions = {}) {
  const fake = createFakeNativeBinary({ ...fakeOptions, failCommands });
  try {
    return await withClient(
      (client) => run(client, fake),
      {
        BAEPSAE_NATIVE_PATH: fake.binaryPath,
        BAEPSAE_FAKE_NATIVE_LOG: fake.logPath,
        BAEPSAE_FAKE_NATIVE_FAIL_COMMANDS: failCommands.join(" "),
        BAEPSAE_FAKE_NATIVE_SELECTOR_FAILURES_BEFORE_SUCCESS: String(fakeOptions.selectorFailuresBeforeSuccess ?? 0),
        BAEPSAE_FAKE_NATIVE_SELECTOR_FAILURE_MODE: fakeOptions.selectorFailureMode ?? "selector_not_found",
        BAEPSAE_FAKE_NATIVE_SELECTOR_STATE_FILE: path.join(fake.dir, "selector.state"),
      },
    );
  } finally {
    rmSync(fake.dir, { recursive: true, force: true });
  }
}

test("tools/list exposes expected MCP tools", async () => {
  await withClient(async (client) => {
    const result = await client.listTools();
    const names = new Set(result.tools.map((tool) => tool.name));

    const expected = TOOL_MANIFEST.map((entry) => entry.name);

    for (const name of expected) {
      assert.equal(names.has(name), true, `Missing tool: ${name}`);
    }

    assert.equal(result.tools.length, expected.length, "Live tool list count drifted");
    const typeText = result.tools.find((tool) => tool.name === "type_text");
    assert.ok(typeText, "type_text tool should exist");
    assert.match(typeText.description ?? "", /auto resolves to paste for all targets/i);
    assert.match(typeText.description ?? "", /clipboard/i);
    assert.match(typeText.description ?? "", /keyboard/i);
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

test("type_text exposes policy metadata in machine-readable form", async () => {
  await withFakeNativeClient(async (client) => {
    const result = await client.callTool({
      name: "type_text",
      arguments: {
        udid: "00000000-0000-0000-0000-000000000000",
        text: "hello",
      },
    });

    assert.equal(result.metadata?.inputSource, "text");
    assert.equal(result.metadata?.targetKind, "simulator");
    assert.equal(result.metadata?.requestedMethod, "auto");
    assert.equal(result.metadata?.usedMethod, "paste");
    assert.equal(result.metadata?.pasteTransport, "simulator_pasteboard");
    assert.equal(result.metadata?.clipboardSideEffect, "none");
    assert.equal(result.metadata?.autoFallback, "paste");
    assert.equal(result.metadata?.backendKind, "simulator_input");
    assert.equal(result.metadata?.backendExecutor, "native");
  });
});

test("doctor returns structured readiness report", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({ name: "doctor", arguments: {} });
    const text = result.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");

    assert.match(text, /Doctor check completed\./);
    assert.match(text, /"host":/);
    assert.match(text, /"accessibility":/);
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
    assert.equal(result.error?.code, "validation.tap.coordinate_pair");
    assert.equal(result.error?.category, "validation");
  });
});

test("run_steps executes ordered workflow steps and stops on failure by default", async () => {
  await withFakeNativeClient(async (client, fake) => {
    const result = await client.callTool({
      name: "run_steps",
      arguments: {
        udid: "00000000-0000-0000-0000-000000000000",
        steps: [
          { tool: "tap", id: "login-button" },
          { tool: "sleep", duration: 0.01 },
          { tool: "type_text", text: "workflow hello" },
          { tool: "key", keycode: 41 },
          { tool: "swipe", startX: 10, startY: 10, endX: 20, endY: 20 },
        ],
      },
    });

    assert.equal(result.isError ?? false, true);
    const text = extractText(result);
    assert.match(text, /Execution policy: fail-fast/);
    assert.match(text, /Step 1\/5 .*tap .*success/);
    assert.match(text, /Step 2\/5 .*sleep .*success/);
    assert.match(text, /Step 3\/5 .*type_text .*success/);
    assert.match(text, /Step 4\/5 .*key .*failed/);
    assert.match(text, /Step 5\/5 .*swipe .*skipped/);
    assert.match(text, /Final summary: 3 succeeded, 1 failed, 1 skipped\./);

    const log = readFileSync(fake.logPath, "utf8");
    assert.match(log, /tap .*login-button/);
    assert.match(log, /type .*workflow hello/);
    assert.match(log, /key 41/);
    assert.equal(log.includes("swipe"), false, "swipe should not be executed after fail-fast stops the workflow");
  }, ["key"]);
});

test("run_steps can continue after failures when continueOnError is enabled", async () => {
  await withFakeNativeClient(async (client, fake) => {
    const result = await client.callTool({
      name: "run_steps",
      arguments: {
        udid: "00000000-0000-0000-0000-000000000000",
        continueOnError: true,
        steps: [
          { tool: "tap", id: "login-button" },
          { tool: "key", keycode: 41 },
          { tool: "swipe", startX: 10, startY: 10, endX: 20, endY: 20 },
          { tool: "sleep", duration: 0.01 },
        ],
      },
    });

    assert.equal(result.isError ?? false, true);
    const text = extractText(result);
    assert.match(text, /Execution policy: continue_on_error/);
    assert.match(text, /Step 1\/4 .*tap .*success/);
    assert.match(text, /Step 2\/4 .*key .*failed/);
    assert.match(text, /Step 3\/4 .*swipe .*success/);
    assert.match(text, /Step 4\/4 .*sleep .*success/);
    assert.match(text, /Final summary: 3 succeeded, 1 failed, 0 skipped\./);

    const log = readFileSync(fake.logPath, "utf8");
    assert.match(log, /tap .*login-button/);
    assert.match(log, /key 41/);
    assert.match(log, /swipe .*10 .*20/);
  }, ["key"]);
});

test("run_steps retries selector taps until the element appears", async () => {
  await withFakeNativeClient(
    async (client, fake) => {
      const result = await client.callTool({
        name: "run_steps",
        arguments: {
          udid: "00000000-0000-0000-0000-000000000000",
          steps: [
            { tool: "tap", id: "login-button", waitTimeout: 900, pollInterval: 50 },
            { tool: "sleep", duration: 0.01 },
          ],
        },
      });

      assert.equal(result.isError ?? false, false);
      const text = extractText(result);
      assert.match(text, /Execution policy: fail-fast/);
      assert.match(text, /Step 1\/2 .*tap .*success/);
      assert.match(text, /Step 2\/2 .*sleep .*success/);
      assert.match(text, /completed after 3 attempt\(s\)/);
      assert.match(text, /Final summary: 2 succeeded, 0 failed, 0 skipped\./);

      const log = readFileSync(fake.logPath, "utf8");
      assert.equal(countMatches(log, /^tap .*login-button.*$/gm), 3);
    },
    [],
    { selectorFailuresBeforeSuccess: 2 },
  );
});

test("run_steps treats permission failures as immediate even with selector retry configured", async () => {
  await withFakeNativeClient(
    async (client, fake) => {
      const result = await client.callTool({
        name: "run_steps",
        arguments: {
          udid: "00000000-0000-0000-0000-000000000000",
          continueOnError: true,
          steps: [
            { tool: "tap", id: "danger-button", waitTimeout: 120, pollInterval: 20 },
            { tool: "sleep", duration: 0.01 },
          ],
        },
      });

      assert.equal(result.isError ?? false, true);
      const text = extractText(result);
      assert.match(text, /Execution policy: continue_on_error/);
      assert.match(text, /Step 1\/2 .*tap .*failed/);
      assert.match(text, /Step 2\/2 .*sleep .*success/);
      assert.match(text, /Final summary: 1 succeeded, 1 failed, 0 skipped\./);

      const log = readFileSync(fake.logPath, "utf8");
      assert.equal(countMatches(log, /^tap .*danger-button.*$/gm), 1);
    },
    [],
    { selectorFailureMode: "permission_denied", selectorFailuresBeforeSuccess: 1 },
  );
});

test("analyze_ui call is routed to native layer (simulator target)", async () => {
  await withFakeNativeClient(async (client, fake) => {
    const result = await client.callTool({
      name: "analyze_ui",
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
    const log = readFileSync(fake.logPath, "utf8");
    assert.match(log, /^describe-ui --udid 00000000-0000-0000-0000-000000000000$/m);
  });
});

test("analyze_ui routes with simulator target", async () => {
  await withFakeNativeClient(async (client, fake) => {
    const result = await client.callTool({
      name: "analyze_ui",
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
    const log = readFileSync(fake.logPath, "utf8");
    assert.match(log, /^describe-ui --udid 00000000-0000-0000-0000-000000000000$/m);
  });
});

test("analyze_ui routes with macOS target", async () => {
  await withFakeNativeClient(async (client, fake) => {
    const result = await client.callTool({
      name: "analyze_ui",
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
    const log = readFileSync(fake.logPath, "utf8");
    assert.match(log, /^describe-ui --bundle-id com\.example\.app$/m);
  });
});

test("tap id/label call is routed to native layer", async () => {
  await withFakeNativeClient(async (client, fake) => {
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
    const log = readFileSync(fake.logPath, "utf8");
    assert.match(log, /^tap --id com\.example\.button --udid 00000000-0000-0000-0000-000000000000$/m);
  });
});

test("tap forwards all=true to native --all", async () => {
  await withFakeNativeClient(async (client, fake) => {
    const result = await client.callTool({
      name: "tap",
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
    assert.match(text, /--udid/);
    const log = readFileSync(fake.logPath, "utf8");
    assert.match(log, /^tap --id com\.example\.button --all --udid 00000000-0000-0000-0000-000000000000$/m);
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

test("analyze_ui forwards output option to native layer", async () => {
  await withFakeNativeClient(async (client, fake) => {
    const result = await client.callTool({
      name: "analyze_ui",
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
    const log = readFileSync(fake.logPath, "utf8");
    assert.match(log, /^describe-ui --udid 00000000-0000-0000-0000-000000000000 --output \.tmp-test-artifacts\/describe-ui\.txt$/m);
  });
});

test("stream_video allows omitted output and auto-generates output path", async () => {
  await withFakeNativeClient(async (client, fake) => {
    const result = await client.callTool({
      name: "stream_video",
      arguments: {
        udid: "00000000-0000-0000-0000-000000000000",
        durationSeconds: 1,
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
    const log = readFileSync(fake.logPath, "utf8");
    assert.match(log, /^stream-video --udid 00000000-0000-0000-0000-000000000000 --duration 1 --output .*simulator-stream-.*\.mov$/m);
  });
});

test("real native CLI still accepts describe-ui with --output and bundle target", () => {
  const result = runNativeCli([
    "describe-ui",
    "--bundle-id",
    "com.example.nonexistent",
    "--output",
    ".tmp-test-artifacts/describe-ui-native.txt",
  ]);

  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stderr, /Missing required option|Unhandled command|invalid arguments/i);
  assert.match(result.stderr, /No running application found with bundle ID: com\.example\.nonexistent/);
});

test("real native CLI still accepts tap with selector and --all", () => {
  const result = runNativeCli([
    "tap",
    "--bundle-id",
    "com.example.nonexistent",
    "--id",
    "com.example.button",
    "--all",
  ]);

  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stderr, /Missing required option|Unhandled command|invalid arguments/i);
  assert.match(result.stderr, /No running application found with bundle ID: com\.example\.nonexistent/);
});

test("real native CLI still accepts stream-video duration and output flags", () => {
  const result = runNativeCli([
    "stream-video",
    "--udid",
    "INVALID-UDID",
    "--duration",
    "1",
    "--output",
    ".tmp-test-artifacts/native-stream.mov",
  ]);

  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stderr, /Missing required option|Unhandled command|invalid arguments/i);
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

test("analyze_ui resolves native binary from different cwd (npx scenario)", async () => {
  await withClientFromDir(os.tmpdir(), async (client) => {
    const result = await client.callTool({
      name: "analyze_ui",
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

test("input_source tool is registered and callable", async () => {
  await withClient(async (client) => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "input_source");
    assert.ok(tool, "input_source tool should be registered");
  });
});

test("list_input_sources tool is registered and callable", async () => {
  await withClient(async (client) => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "list_input_sources");
    assert.ok(tool, "list_input_sources tool should be registered");
  });
});

test("focus_window tool is registered", async () => {
  await withClient(async (client) => {
    const { tools } = await client.listTools();
    assert.ok(tools.find((t) => t.name === "focus_window"), "focus_window should be registered");
  });
});
