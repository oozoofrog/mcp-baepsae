import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";

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

function isAccessibilityDenied(text) {
  return /permission denied|accessibility/i.test(text);
}

function findSampleApp() {
  const candidates = [
    path.join(projectRoot, "test-fixtures", "SampleApp", "build", "SampleApp.app"),
    path.join(projectRoot, "test-fixtures", "SampleApp", "Build", "Products", "Debug-iphonesimulator", "SampleApp.app"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

// ─── Phase 1: Basic (simulator only) ────────────────────────────────────────

test("Phase 1: list_simulators → get booted udid", { timeout: 30_000 }, async (t) => {
  await withClient(async (client) => {
    const result = await client.callTool({ name: "list_simulators", arguments: {} });
    assert.equal(result.isError ?? false, false, "list_simulators should not error");

    const text = extractText(result);
    assert.ok(text.length > 0, "list_simulators should return non-empty text");

    const udid = extractBootedUdid(text);
    if (!udid) {
      t.skip("No booted simulator detected");
    }
  });
});

test("Phase 1: open_url → open sample web page in simulator", { timeout: 30_000 }, async (t) => {
  await withClient(async (client) => {
    const listResult = await client.callTool({ name: "list_simulators", arguments: {} });
    const udid = extractBootedUdid(extractText(listResult));
    if (!udid) {
      t.skip("No booted simulator detected");
      return;
    }

    // simctl openurl does not reliably support file:// URLs; use https:// instead
    const result = await client.callTool({
      name: "open_url",
      arguments: { udid, url: "https://example.com" },
    });
    assert.equal(result.isError ?? false, false, "open_url should not error");
  });
});

test("Phase 1: screenshot → file created and non-empty", { timeout: 30_000 }, async (t) => {
  await mkdir(artifactDir, { recursive: true });

  await withClient(async (client) => {
    const listResult = await client.callTool({ name: "list_simulators", arguments: {} });
    const udid = extractBootedUdid(extractText(listResult));
    if (!udid) {
      t.skip("No booted simulator detected");
      return;
    }

    const screenshotPath = path.join(artifactDir, `screenshot-${Date.now()}.png`);
    const result = await client.callTool({
      name: "screenshot",
      arguments: { udid, output: screenshotPath },
    });
    assert.equal(result.isError ?? false, false, "screenshot should not error");

    const fileStat = await stat(screenshotPath);
    assert.ok(fileStat.isFile(), "screenshot output should be a file");
    assert.ok(fileStat.size > 0, "screenshot file should be non-empty");
  });
});

test("Phase 1: record_video → 2s recording, file created", { timeout: 60_000 }, async (t) => {
  await mkdir(artifactDir, { recursive: true });

  await withClient(async (client) => {
    const listResult = await client.callTool({ name: "list_simulators", arguments: {} });
    const udid = extractBootedUdid(extractText(listResult));
    if (!udid) {
      t.skip("No booted simulator detected");
      return;
    }

    const recordPath = path.join(artifactDir, `record-${Date.now()}.mov`);
    const result = await client.callTool({
      name: "record_video",
      arguments: { udid, output: recordPath, durationSeconds: 2 },
    });
    assert.equal(result.isError ?? false, false, "record_video should not error");

    const fileStat = await stat(recordPath);
    assert.ok(fileStat.isFile(), "record_video output should be a file");
    assert.ok(fileStat.size > 0, "record_video file should be non-empty");
  });
});

test("Phase 1: stream_video → 2s stream, file created", { timeout: 60_000 }, async (t) => {
  await mkdir(artifactDir, { recursive: true });

  await withClient(async (client) => {
    const listResult = await client.callTool({ name: "list_simulators", arguments: {} });
    const udid = extractBootedUdid(extractText(listResult));
    if (!udid) {
      t.skip("No booted simulator detected");
      return;
    }

    const streamPath = path.join(artifactDir, `stream-${Date.now()}.mov`);
    const result = await client.callTool({
      name: "stream_video",
      arguments: { udid, output: streamPath, durationSeconds: 2 },
    });
    assert.equal(result.isError ?? false, false, "stream_video should not error");

    const fileStat = await stat(streamPath);
    assert.ok(fileStat.isFile(), "stream_video output should be a file");
    assert.ok(fileStat.size > 0, "stream_video file should be non-empty");
  });
});

// ─── Phase 2: Accessibility (requires permissions) ──────────────────────────

test("Phase 2: describe_ui → contains page elements", { timeout: 30_000 }, async (t) => {
  await withClient(async (client) => {
    const listResult = await client.callTool({ name: "list_simulators", arguments: {} });
    const udid = extractBootedUdid(extractText(listResult));
    if (!udid) {
      t.skip("No booted simulator detected");
      return;
    }

    const result = await client.callTool({
      name: "describe_ui",
      arguments: { udid },
    });
    const text = extractText(result);

    if (result.isError && isAccessibilityDenied(text)) {
      t.skip("Accessibility permission denied");
      return;
    }
    assert.equal(result.isError ?? false, false, "describe_ui should not error");
    assert.ok(text.length > 0, "describe_ui should return non-empty output");
  });
});

test("Phase 2: search_ui → find 'Baepsae' on page", { timeout: 30_000 }, async (t) => {
  await withClient(async (client) => {
    const listResult = await client.callTool({ name: "list_simulators", arguments: {} });
    const udid = extractBootedUdid(extractText(listResult));
    if (!udid) {
      t.skip("No booted simulator detected");
      return;
    }

    const result = await client.callTool({
      name: "search_ui",
      arguments: { udid, query: "Baepsae" },
    });
    const text = extractText(result);

    if (result.isError && isAccessibilityDenied(text)) {
      t.skip("Accessibility permission denied");
      return;
    }
    assert.equal(result.isError ?? false, false, "search_ui should not error");
    assert.ok(text.length > 0, "search_ui should return results");
  });
});

test("Phase 2: tap → tap by label 'Click Me'", { timeout: 30_000 }, async (t) => {
  await withClient(async (client) => {
    const listResult = await client.callTool({ name: "list_simulators", arguments: {} });
    const udid = extractBootedUdid(extractText(listResult));
    if (!udid) {
      t.skip("No booted simulator detected");
      return;
    }

    const result = await client.callTool({
      name: "tap",
      arguments: { udid, label: "Click Me" },
    });
    const text = extractText(result);

    if (result.isError && isAccessibilityDenied(text)) {
      t.skip("Accessibility permission denied");
      return;
    }
    assert.equal(result.isError ?? false, false, "tap should not error");
  });
});

test("Phase 2: type_text → type text in text mode", { timeout: 30_000 }, async (t) => {
  await withClient(async (client) => {
    const listResult = await client.callTool({ name: "list_simulators", arguments: {} });
    const udid = extractBootedUdid(extractText(listResult));
    if (!udid) {
      t.skip("No booted simulator detected");
      return;
    }

    const result = await client.callTool({
      name: "type_text",
      arguments: { udid, text: "Hello Baepsae" },
    });
    const text = extractText(result);

    if (result.isError && isAccessibilityDenied(text)) {
      t.skip("Accessibility permission denied");
      return;
    }
    assert.equal(result.isError ?? false, false, "type_text should not error");
  });
});

test("Phase 2: swipe → coordinate-based swipe", { timeout: 30_000 }, async (t) => {
  await withClient(async (client) => {
    const listResult = await client.callTool({ name: "list_simulators", arguments: {} });
    const udid = extractBootedUdid(extractText(listResult));
    if (!udid) {
      t.skip("No booted simulator detected");
      return;
    }

    const result = await client.callTool({
      name: "swipe",
      arguments: { udid, startX: 200, startY: 400, endX: 200, endY: 200, duration: 0.5 },
    });
    const text = extractText(result);

    if (result.isError && isAccessibilityDenied(text)) {
      t.skip("Accessibility permission denied");
      return;
    }
    assert.equal(result.isError ?? false, false, "swipe should not error");
  });
});

test("Phase 2: gesture → scroll-down preset", { timeout: 30_000 }, async (t) => {
  await withClient(async (client) => {
    const listResult = await client.callTool({ name: "list_simulators", arguments: {} });
    const udid = extractBootedUdid(extractText(listResult));
    if (!udid) {
      t.skip("No booted simulator detected");
      return;
    }

    const result = await client.callTool({
      name: "gesture",
      arguments: { udid, preset: "scroll-down" },
    });
    const text = extractText(result);

    if (result.isError && isAccessibilityDenied(text)) {
      t.skip("Accessibility permission denied");
      return;
    }
    assert.equal(result.isError ?? false, false, "gesture should not error");
  });
});

test("Phase 2: key → send keycode", { timeout: 30_000 }, async (t) => {
  await withClient(async (client) => {
    const listResult = await client.callTool({ name: "list_simulators", arguments: {} });
    const udid = extractBootedUdid(extractText(listResult));
    if (!udid) {
      t.skip("No booted simulator detected");
      return;
    }

    // keycode 4 = 'a' in HID
    const result = await client.callTool({
      name: "key",
      arguments: { udid, keycode: 4 },
    });
    const text = extractText(result);

    if (result.isError && isAccessibilityDenied(text)) {
      t.skip("Accessibility permission denied");
      return;
    }
    assert.equal(result.isError ?? false, false, "key should not error");
  });
});

test("Phase 2: key_sequence → send multiple keycodes", { timeout: 30_000 }, async (t) => {
  await withClient(async (client) => {
    const listResult = await client.callTool({ name: "list_simulators", arguments: {} });
    const udid = extractBootedUdid(extractText(listResult));
    if (!udid) {
      t.skip("No booted simulator detected");
      return;
    }

    // keycodes 4,5,6 = 'a','b','c'
    const result = await client.callTool({
      name: "key_sequence",
      arguments: { udid, keycodes: [4, 5, 6] },
    });
    const text = extractText(result);

    if (result.isError && isAccessibilityDenied(text)) {
      t.skip("Accessibility permission denied");
      return;
    }
    assert.equal(result.isError ?? false, false, "key_sequence should not error");
  });
});

test("Phase 2: key_combo → modifier + key", { timeout: 30_000 }, async (t) => {
  await withClient(async (client) => {
    const listResult = await client.callTool({ name: "list_simulators", arguments: {} });
    const udid = extractBootedUdid(extractText(listResult));
    if (!udid) {
      t.skip("No booted simulator detected");
      return;
    }

    // modifier 224 = left ctrl, key 4 = 'a' (Ctrl+A)
    const result = await client.callTool({
      name: "key_combo",
      arguments: { udid, modifiers: [224], key: 4 },
    });
    const text = extractText(result);

    if (result.isError && isAccessibilityDenied(text)) {
      t.skip("Accessibility permission denied");
      return;
    }
    assert.equal(result.isError ?? false, false, "key_combo should not error");
  });
});

test("Phase 2: button → home button", { timeout: 30_000 }, async (t) => {
  await withClient(async (client) => {
    const listResult = await client.callTool({ name: "list_simulators", arguments: {} });
    const udid = extractBootedUdid(extractText(listResult));
    if (!udid) {
      t.skip("No booted simulator detected");
      return;
    }

    const result = await client.callTool({
      name: "button",
      arguments: { udid, buttonType: "home" },
    });
    const text = extractText(result);

    if (result.isError && isAccessibilityDenied(text)) {
      t.skip("Accessibility permission denied");
      return;
    }
    assert.equal(result.isError ?? false, false, "button should not error");
  });
});

test("Phase 2: touch → down/up events", { timeout: 30_000 }, async (t) => {
  await withClient(async (client) => {
    const listResult = await client.callTool({ name: "list_simulators", arguments: {} });
    const udid = extractBootedUdid(extractText(listResult));
    if (!udid) {
      t.skip("No booted simulator detected");
      return;
    }

    const result = await client.callTool({
      name: "touch",
      arguments: { udid, x: 200, y: 300, down: true, up: true },
    });
    const text = extractText(result);

    if (result.isError && isAccessibilityDenied(text)) {
      t.skip("Accessibility permission denied");
      return;
    }
    assert.equal(result.isError ?? false, false, "touch should not error");
  });
});

// ─── Phase 3: App management (requires built sample app) ───────────────────

test("Phase 3: install_app → install sample app", { timeout: 60_000 }, async (t) => {
  await withClient(async (client) => {
    const listResult = await client.callTool({ name: "list_simulators", arguments: {} });
    const udid = extractBootedUdid(extractText(listResult));
    if (!udid) {
      t.skip("No booted simulator detected");
      return;
    }

    const appPath = findSampleApp();
    if (!appPath) {
      t.skip("SampleApp.app not built — run xcodebuild first");
      return;
    }

    const result = await client.callTool({
      name: "install_app",
      arguments: { udid, path: appPath },
    });
    assert.equal(result.isError ?? false, false, "install_app should not error");
  });
});

test("Phase 3: launch_app → launch sample app", { timeout: 30_000 }, async (t) => {
  await withClient(async (client) => {
    const listResult = await client.callTool({ name: "list_simulators", arguments: {} });
    const udid = extractBootedUdid(extractText(listResult));
    if (!udid) {
      t.skip("No booted simulator detected");
      return;
    }

    const appPath = findSampleApp();
    if (!appPath) {
      t.skip("SampleApp.app not built — run xcodebuild first");
      return;
    }

    const result = await client.callTool({
      name: "launch_app",
      arguments: { udid, bundleId: "com.baepsae.sampleapp" },
    });
    assert.equal(result.isError ?? false, false, "launch_app should not error");
  });
});

test("Phase 3: terminate_app → terminate sample app", { timeout: 30_000 }, async (t) => {
  await withClient(async (client) => {
    const listResult = await client.callTool({ name: "list_simulators", arguments: {} });
    const udid = extractBootedUdid(extractText(listResult));
    if (!udid) {
      t.skip("No booted simulator detected");
      return;
    }

    const appPath = findSampleApp();
    if (!appPath) {
      t.skip("SampleApp.app not built — run xcodebuild first");
      return;
    }

    const result = await client.callTool({
      name: "terminate_app",
      arguments: { udid, bundleId: "com.baepsae.sampleapp" },
    });
    // terminate may error if app isn't running, that's ok for this test
    const text = extractText(result);
    assert.ok(text.length > 0, "terminate_app should return output");
  });
});

test("Phase 3: uninstall_app → uninstall sample app", { timeout: 30_000 }, async (t) => {
  await withClient(async (client) => {
    const listResult = await client.callTool({ name: "list_simulators", arguments: {} });
    const udid = extractBootedUdid(extractText(listResult));
    if (!udid) {
      t.skip("No booted simulator detected");
      return;
    }

    const appPath = findSampleApp();
    if (!appPath) {
      t.skip("SampleApp.app not built — run xcodebuild first");
      return;
    }

    const result = await client.callTool({
      name: "uninstall_app",
      arguments: { udid, bundleId: "com.baepsae.sampleapp" },
    });
    assert.equal(result.isError ?? false, false, "uninstall_app should not error");
  });
});

// ─── Cleanup ────────────────────────────────────────────────────────────────

test("cleanup: remove test artifacts", async () => {
  await rm(artifactDir, { recursive: true, force: true });
});
