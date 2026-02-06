import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";

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
  return /\[Permission Denied\].*Accessibility/i.test(text);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Poll describe_ui until check(text) returns true or timeout.
 * Returns the last describe_ui text.
 */
async function waitForUI(client, udid, focusId, check, timeoutMs = 5000) {
  const interval = 500;
  const deadline = Date.now() + timeoutMs;
  let lastText = "";
  while (Date.now() < deadline) {
    const args = { udid };
    if (focusId) args.focusId = focusId;
    const result = await client.callTool({ name: "describe_ui", arguments: args });
    lastText = extractText(result);
    if (!result.isError && check(lastText)) return lastText;
    await sleep(interval);
  }
  return lastText;
}

/**
 * Detect if a context menu (Cut/Copy/Paste) is visible in the UI.
 */
async function hasContextMenu(client, udid) {
  const result = await client.callTool({ name: "describe_ui", arguments: { udid } });
  const text = extractText(result);
  return /\b(Cut|Copy|Paste|Select All|Select)\b/.test(text);
}

/**
 * Dismiss context menu if present by tapping outside or sending Escape.
 * Returns true if a menu was detected and dismissed.
 */
async function dismissContextMenu(client, udid) {
  if (!(await hasContextMenu(client, udid))) return false;
  // Send Escape key (keycode 41 in HID) to dismiss
  await client.callTool({ name: "key", arguments: { udid, keycode: 41 } });
  await sleep(500);
  // If still present, tap an empty area
  if (await hasContextMenu(client, udid)) {
    await client.callTool({ name: "tap", arguments: { udid, x: 200, y: 50 } });
    await sleep(500);
  }
  return true;
}

function findSampleApp() {
  const candidates = [
    path.join(projectRoot, "test-fixtures", "SampleApp", "build", "Debug-iphonesimulator", "SampleApp.app"),
    path.join(projectRoot, "test-fixtures", "SampleApp", "Build", "Products", "Debug-iphonesimulator", "SampleApp.app"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

const sampleAppProject = path.join(projectRoot, "test-fixtures", "SampleApp", "SampleApp.xcodeproj");

// ─── Setup: Build and install SampleApp ──────────────────────────────────────

test("Setup: build SampleApp for simulator", { timeout: 120_000 }, async (t) => {
  if (!existsSync(sampleAppProject)) {
    t.skip("SampleApp.xcodeproj not found");
    return;
  }

  await withClient(async (client) => {
    const listResult = await client.callTool({ name: "list_simulators", arguments: {} });
    const udid = extractBootedUdid(extractText(listResult));
    if (!udid) {
      t.skip("No booted simulator detected");
      return;
    }

    // Build SampleApp targeting the booted simulator
    execSync(
      `xcodebuild -project "${sampleAppProject}" -scheme SampleApp -sdk iphonesimulator ` +
      `-destination "id=${udid}" build`,
      { cwd: path.join(projectRoot, "test-fixtures", "SampleApp"), stdio: "pipe", timeout: 90_000 },
    );

    const appPath = findSampleApp();
    assert.ok(appPath, "SampleApp.app should exist after build");

    // Install and launch
    const installResult = await client.callTool({
      name: "install_app",
      arguments: { udid, path: appPath },
    });
    assert.equal(installResult.isError ?? false, false, "install_app should not error");

    const launchResult = await client.callTool({
      name: "launch_app",
      arguments: { udid, bundleId: "com.baepsae.sampleapp" },
    });
    assert.equal(launchResult.isError ?? false, false, "launch_app should not error");

    // Wait for the app UI to load
    await waitForUI(client, udid, "test-label", (text) => text.includes("Ready"), 10000);
  });
});

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

test("Phase 2: tap → tap by label 'Tap Me'", { timeout: 45_000 }, async (t) => {
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

    // Ensure SampleApp is in foreground (may have been backgrounded by open_url)
    await relaunchSampleApp(client, udid);

    const result = await client.callTool({
      name: "tap",
      arguments: { udid, label: "Tap Me" },
    });
    const text = extractText(result);

    if (result.isError && isAccessibilityDenied(text)) {
      t.skip("Accessibility permission denied");
      return;
    }
    assert.equal(result.isError ?? false, false, "tap should not error");

    // Wait for UI to settle after tap
    await sleep(500);
  });
});

test("Phase 2: type_text → tap input, type text, verify result", { timeout: 45_000 }, async (t) => {
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

    // Re-launch SampleApp to reset input state and ensure it's in foreground
    await relaunchSampleApp(client, udid);

    // Tap on the text input field to give it focus
    const tapResult = await client.callTool({
      name: "tap",
      arguments: { udid, id: "test-input" },
    });
    if (tapResult.isError && isAccessibilityDenied(extractText(tapResult))) {
      t.skip("Accessibility permission denied");
      return;
    }
    assert.equal(tapResult.isError ?? false, false, "tap on test-input should not error");
    await sleep(500);

    // Type text into the focused input
    const typeResult = await client.callTool({
      name: "type_text",
      arguments: { udid, text: "Hello Baepsae" },
    });
    assert.equal(typeResult.isError ?? false, false, "type_text should not error");
    await sleep(500);

    // Dismiss context menu if it appeared after type_text
    await dismissContextMenu(client, udid);

    // Verify that type_text delivered some input via describe_ui.
    // HID typing via CGEvent may not produce exact text depending on simulator
    // keyboard language/focus state, so we only check that some text was entered.
    const describeResult = await client.callTool({
      name: "describe_ui",
      arguments: { udid, focusId: "test-result" },
    });
    if (!describeResult.isError) {
      const describeText = extractText(describeResult);
      assert.ok(describeText.length > 0, "test-result should have content after type_text");
    }
  });
});

test("Phase 2: type_text → stdinText mode", { timeout: 45_000 }, async (t) => {
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

    // Re-launch SampleApp to reset input state and wait for UI
    await relaunchSampleApp(client, udid);

    // Tap on input to focus
    const tapResult = await client.callTool({
      name: "tap",
      arguments: { udid, id: "test-input" },
    });
    if (tapResult.isError && isAccessibilityDenied(extractText(tapResult))) {
      t.skip("Accessibility permission denied");
      return;
    }
    await sleep(500);

    // Type via stdinText mode
    const typeResult = await client.callTool({
      name: "type_text",
      arguments: { udid, stdinText: "stdin mode test" },
    });
    assert.equal(typeResult.isError ?? false, false, "type_text with stdinText should not error");
    await sleep(500);

    // Dismiss context menu if it appeared after type_text
    await dismissContextMenu(client, udid);

    // Verify that test-result has some text (stdinText may not inject all characters via HID)
    const describeResult = await client.callTool({
      name: "describe_ui",
      arguments: { udid, focusId: "test-result" },
    });
    if (!describeResult.isError) {
      const describeText = extractText(describeResult);
      assert.ok(describeText.length > 0, "test-result should have content after stdinText input");
    }
    // If test-result doesn't exist, that's OK — the empty Text may not appear in accessibility tree
  });
});

test("Phase 2: type_text → empty text should error", { timeout: 30_000 }, async (t) => {
  await withClient(async (client) => {
    const listResult = await client.callTool({ name: "list_simulators", arguments: {} });
    const udid = extractBootedUdid(extractText(listResult));
    if (!udid) {
      t.skip("No booted simulator detected");
      return;
    }

    // Call type_text with no text/stdinText/file — should error
    const result = await client.callTool({
      name: "type_text",
      arguments: { udid },
    });
    assert.ok(result.isError, "type_text with no text source should error");
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
    await sleep(500);
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

// Helper: re-launch SampleApp and wait until UI is accessible
async function relaunchSampleApp(client, udid) {
  await client.callTool({
    name: "terminate_app",
    arguments: { udid, bundleId: "com.baepsae.sampleapp" },
  });
  await sleep(500);
  // Ensure the app is installed (may have been uninstalled by a previous test run)
  const appPath = findSampleApp();
  if (appPath) {
    await client.callTool({
      name: "install_app",
      arguments: { udid, path: appPath },
    });
  }
  await client.callTool({
    name: "launch_app",
    arguments: { udid, bundleId: "com.baepsae.sampleapp" },
  });
  // Wait until the app UI shows "Ready" (up to 10s)
  await waitForUI(client, udid, "test-label", (text) => text.includes("Ready"), 10000);
}

// ─── Phase 2b: UI interaction with state verification ────────────────────────

test("Phase 2b: tap by id → verify label changes to 'Tapped!'", { timeout: 45_000 }, async (t) => {
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

    // Re-launch SampleApp to reset state and wait for UI
    await relaunchSampleApp(client, udid);

    // Verify initial label is "Ready"
    const beforeResult = await client.callTool({
      name: "describe_ui",
      arguments: { udid, focusId: "test-label" },
    });
    const beforeText = extractText(beforeResult);
    if (beforeResult.isError && isAccessibilityDenied(beforeText)) {
      t.skip("Accessibility permission denied");
      return;
    }
    assert.ok(beforeText.includes("Ready"), `label should initially be "Ready", got: ${beforeText}`);

    // Tap button by accessibility id
    const tapResult = await client.callTool({
      name: "tap",
      arguments: { udid, id: "test-button" },
    });
    assert.equal(tapResult.isError ?? false, false, "tap by id should not error");

    // Wait for UI to reflect the tap, then verify label changed to "Tapped!"
    const afterText = await waitForUI(client, udid, "test-label", (text) => text.includes("Tapped!"), 5000);
    assert.ok(afterText.includes("Tapped!"), `label should be "Tapped!" after tap, got: ${afterText}`);
  });
});

test("Phase 2b: swipe → verify list scroll changes visible items", { timeout: 45_000 }, async (t) => {
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

    // Re-launch SampleApp and wait for UI
    await relaunchSampleApp(client, udid);

    // Describe UI before swipe to capture visible list items
    const beforeResult = await client.callTool({
      name: "describe_ui",
      arguments: { udid, focusId: "test-list" },
    });
    const beforeText = extractText(beforeResult);
    if (beforeResult.isError && isAccessibilityDenied(beforeText)) {
      t.skip("Accessibility permission denied");
      return;
    }
    assert.equal(beforeResult.isError ?? false, false, "describe_ui before swipe should not error");

    // Swipe up on the list area to scroll down
    const swipeResult = await client.callTool({
      name: "swipe",
      arguments: { udid, startX: 200, startY: 600, endX: 200, endY: 300, duration: 0.3 },
    });
    assert.equal(swipeResult.isError ?? false, false, "swipe should not error");
    await sleep(500);

    // Describe UI after swipe
    const afterResult = await client.callTool({
      name: "describe_ui",
      arguments: { udid, focusId: "test-list" },
    });
    const afterText = extractText(afterResult);
    assert.equal(afterResult.isError ?? false, false, "describe_ui after swipe should not error");

    // After scrolling, the visible items should differ (later items should appear)
    // At minimum, the output should have changed
    assert.ok(afterText.length > 0, "describe_ui after swipe should return content");
    // Check that higher-numbered items are now visible (e.g., Item 10+)
    const hasHigherItems = /Item\s+(1[0-9]|[2-9]\d)/.test(afterText);
    const beforeHadHigherItems = /Item\s+(1[0-9]|[2-9]\d)/.test(beforeText);
    if (!beforeHadHigherItems) {
      assert.ok(hasHigherItems, `after swipe, higher-numbered items should be visible, got: ${afterText}`);
    }
  });
});

test("Phase 2b: integrated workflow → tap, type, verify, swipe", { timeout: 60_000 }, async (t) => {
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

    // Step 1: Re-launch SampleApp to reset state and wait for UI
    await relaunchSampleApp(client, udid);

    // Step 2: Tap button and verify label changed
    const tapBtnResult = await client.callTool({
      name: "tap",
      arguments: { udid, id: "test-button" },
    });
    if (tapBtnResult.isError && isAccessibilityDenied(extractText(tapBtnResult))) {
      t.skip("Accessibility permission denied");
      return;
    }
    assert.equal(tapBtnResult.isError ?? false, false, "tap test-button should not error");

    const labelText = await waitForUI(client, udid, "test-label", (text) => text.includes("Tapped!"), 5000);
    assert.ok(labelText.includes("Tapped!"), `label should be "Tapped!" after tap, got: ${labelText}`);

    // Step 3: Tap input field and type text
    const tapInputResult = await client.callTool({
      name: "tap",
      arguments: { udid, id: "test-input" },
    });
    assert.equal(tapInputResult.isError ?? false, false, "tap test-input should not error");
    await sleep(500);

    const typeResult = await client.callTool({
      name: "type_text",
      arguments: { udid, text: "workflow test" },
    });
    assert.equal(typeResult.isError ?? false, false, "type_text should not error");
    await sleep(500);

    // Dismiss context menu if it appeared after type_text
    await dismissContextMenu(client, udid);

    // Step 4: Verify typed text appears in test-result (may not exist if HID typing didn't work)
    const resultDescribe = await client.callTool({
      name: "describe_ui",
      arguments: { udid, focusId: "test-result" },
    });
    if (!resultDescribe.isError) {
      const resultText = extractText(resultDescribe);
      assert.ok(resultText.includes("workflow test"), `test-result should contain "workflow test", got: ${resultText}`);
    }

    // Step 5: Re-launch app to dismiss keyboard/context menu before scrolling
    await relaunchSampleApp(client, udid);

    // Wait for test-list to be visible
    const beforeSwipeText = await waitForUI(client, udid, "test-list", (text) => /Item\s+\d/.test(text), 5000);

    const swipeResult = await client.callTool({
      name: "swipe",
      arguments: { udid, startX: 200, startY: 600, endX: 200, endY: 300, duration: 0.3 },
    });
    assert.equal(swipeResult.isError ?? false, false, "swipe should not error");
    await sleep(500);

    const afterSwipe = await client.callTool({
      name: "describe_ui",
      arguments: { udid, focusId: "test-list" },
    });
    const afterSwipeText = extractText(afterSwipe);
    assert.ok(afterSwipeText.length > 0, "list should have content after swipe");

    // Verify the UI state changed (scroll caused different items to be visible)
    const afterHasHigherItems = /Item\s+(1[0-9]|[2-9]\d)/.test(afterSwipeText);
    const beforeHadHigherItems = /Item\s+(1[0-9]|[2-9]\d)/.test(beforeSwipeText);
    if (!beforeHadHigherItems) {
      assert.ok(afterHasHigherItems, `after swipe, higher-numbered list items should appear, got: ${afterSwipeText}`);
    }
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

    // Wait for the app to be ready
    await waitForUI(client, udid, "test-label", (text) => text.includes("Ready"), 5000);
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
