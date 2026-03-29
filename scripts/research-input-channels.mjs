import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const realNativePath = path.join(projectRoot, "native", ".build", "release", "baepsae-native");

function extractText(result) {
  return result.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

function parseFrameFromText(text) {
  const match = text.match(/frame=\(x:([\d.]+),y:([\d.]+),w:([\d.]+),h:([\d.]+)\)/);
  if (!match) return null;
  return {
    x: parseFloat(match[1]),
    y: parseFloat(match[2]),
    width: parseFloat(match[3]),
    height: parseFloat(match[4]),
  };
}

function extractLargestFrameFromLines(text, predicate) {
  const lines = text.split("\n").filter((line) => predicate(line));
  let best = null;
  for (const line of lines) {
    const frame = parseFrameFromText(line);
    if (!frame) continue;
    const area = frame.width * frame.height;
    if (!best || area > best.area) {
      best = { line, frame, area };
    }
  }
  return best ? { line: best.line, frame: best.frame } : null;
}

function chooseSimulatorUdid() {
  const output = execFileSync("xcrun", ["simctl", "list", "devices", "available"], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const booted = output.match(/\(([0-9A-F-]{36})\)\s+\(Booted\)/i);
  if (booted) return booted[1];

  const shutdownIPhone = output.match(/^\s+iPhone .* \(([0-9A-F-]{36})\) \(Shutdown\)\s*$/m);
  if (shutdownIPhone) return shutdownIPhone[1];

  throw new Error("No available iPhone Simulator device found.");
}

async function sleep(ms) {
  return await new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureBootedSimulator(udid) {
  try {
    execFileSync("xcrun", ["simctl", "boot", udid], { cwd: projectRoot, stdio: "pipe" });
  } catch {
    // ignore
  }
  try {
    execFileSync("/usr/bin/open", ["-a", "Simulator", "--args", "-CurrentDeviceUDID", udid], {
      cwd: projectRoot,
      stdio: "pipe",
    });
  } catch {
    // ignore
  }

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const output = execFileSync("xcrun", ["simctl", "list", "devices", udid], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (/\(Booted\)/.test(output)) {
      return;
    }
    await sleep(500);
  }

  throw new Error(`Simulator did not boot in time: ${udid}`);
}

const sampleAppPath = [
  path.join(projectRoot, "test-fixtures", "SampleApp", "build", "Debug-iphonesimulator", "SampleApp.app"),
  path.join(projectRoot, "test-fixtures", "SampleApp", "Build", "Products", "Debug-iphonesimulator", "SampleApp.app"),
].find((candidate) => existsSync(candidate));

async function withClient(run) {
  const client = new Client({ name: "baepsae-input-channel-research", version: "1.0.0" });
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

async function call(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  return { result, text: extractText(result) };
}

async function relaunchDefaultSampleApp(client, udid) {
  await call(client, "terminate_app", { udid, bundleId: "com.baepsae.sampleapp" }).catch(() => {});
  await sleep(500);
  if (sampleAppPath) {
    await call(client, "install_app", { udid, path: sampleAppPath });
  }
  await call(client, "launch_app", { udid, bundleId: "com.baepsae.sampleapp" });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const probe = await call(client, "analyze_ui", { udid, focusId: "nav-basic", maxDepth: 1 });
    if (!probe.result.isError && probe.text.includes("Basic")) {
      return;
    }
    await sleep(500);
  }
  throw new Error("SampleApp default screen did not become ready in time.");
}

function toContentRelativePoint(frame, contentFrame, xRatio = 0.5, yRatio = 0.5) {
  return {
    x: Math.round(frame.x - contentFrame.x + frame.width * xRatio),
    y: Math.round(frame.y - contentFrame.y + frame.height * yRatio),
  };
}

function toWindowRelativePoint(frame, windowFrame, xRatio = 0.5, yRatio = 0.5) {
  return {
    x: Math.round(frame.x - windowFrame.x + frame.width * xRatio),
    y: Math.round(frame.y - windowFrame.y + frame.height * yRatio),
  };
}

async function waitForAnchor(client, udid, focusId, pattern, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let lastText = "";
  while (Date.now() < deadline) {
    const result = await call(client, "analyze_ui", { udid, focusId, maxDepth: 1 });
    lastText = result.text;
    if (!result.result.isError && pattern.test(result.text)) {
      return { ok: true, text: result.text };
    }
    await sleep(400);
  }
  return { ok: false, text: lastText };
}

async function runChannel(client, udid, channel, sourceFocusId, contentPoint, windowPoint) {
  switch (channel) {
    case "selector_tap":
      return await call(client, "tap", { udid, id: sourceFocusId });
    case "coord_tap_content":
      return await call(client, "tap", { udid, x: contentPoint.x, y: contentPoint.y });
    case "coord_tap_window":
      return await call(client, "tap", { udid, x: windowPoint.x, y: windowPoint.y });
    case "touch_content":
      return await call(client, "touch", { udid, x: contentPoint.x, y: contentPoint.y, down: true, up: true, delay: 0.02 });
    case "touch_window":
      return await call(client, "touch", { udid, x: windowPoint.x, y: windowPoint.y, down: true, up: true, delay: 0.02 });
    case "micro_drag_content":
      return await call(client, "drag_drop", {
        udid,
        startX: contentPoint.x,
        startY: contentPoint.y,
        endX: contentPoint.x + 2,
        endY: contentPoint.y + 2,
        duration: 0.02,
        holdDuration: 0,
      });
    case "micro_drag_window":
      return await call(client, "drag_drop", {
        udid,
        startX: windowPoint.x,
        startY: windowPoint.y,
        endX: windowPoint.x + 2,
        endY: windowPoint.y + 2,
        duration: 0.02,
        holdDuration: 0,
      });
    default:
      throw new Error(`Unknown channel: ${channel}`);
  }
}

async function measureCase(client, udid, config) {
  await relaunchDefaultSampleApp(client, udid);

  const targetResult = await call(client, "analyze_ui", { udid, focusId: config.sourceFocusId, maxDepth: 1 });
  const targetFrame = parseFrameFromText(targetResult.text);
  const allTree = await call(client, "analyze_ui", { udid, all: true, maxDepth: 8 });
  const contentCandidate = extractLargestFrameFromLines(
    allTree.text,
    (line) => line.includes("subrole=iOSContentGroup"),
  );
  const windowCandidate = extractLargestFrameFromLines(
    allTree.text,
    (line) => line.includes("role=AXWindow subrole=AXStandardWindow"),
  );
  const contentFrame = contentCandidate?.frame ?? null;
  const windowFrame = windowCandidate?.frame ?? null;

  if (!targetFrame || !contentFrame || !windowFrame) {
    return {
      ...config,
      ok: false,
      reason: "frame_missing",
      targetFrame,
      contentFrame,
      windowFrame,
    };
  }

  const contentPoint = toContentRelativePoint(targetFrame, contentFrame);
  const windowPoint = toWindowRelativePoint(targetFrame, windowFrame);

  const channelResult = await runChannel(
    client,
    udid,
    config.channel,
    config.sourceFocusId,
    contentPoint,
    windowPoint,
  );
  await sleep(900);

  const verification = await waitForAnchor(client, udid, config.expectedFocusId, config.expectedPattern, 5000);

  return {
    ...config,
    ok: verification.ok,
    channelIsError: !!channelResult.result.isError,
    contentPoint,
    windowPoint,
    targetFrame,
    contentFrame,
    windowFrame,
    channelText: channelResult.text,
    verificationText: verification.text,
  };
}

async function main() {
  const udid = chooseSimulatorUdid();
  await ensureBootedSimulator(udid);

  const summary = await withClient(async (client) => {
    const cases = [
      {
        sourceFocusId: "nav-scroll",
        expectedFocusId: "scroll-position",
        expectedPattern: /Visible:\s*Item\s+\d+\s*~\s*Item\s+\d+/,
        channels: [
          "selector_tap",
          "coord_tap_content",
          "coord_tap_window",
          "touch_content",
          "touch_window",
          "micro_drag_content",
          "micro_drag_window",
        ],
      },
      {
        sourceFocusId: "test-button",
        expectedFocusId: "test-label",
        expectedPattern: /Tapped!/,
        channels: [
          "selector_tap",
          "coord_tap_content",
          "coord_tap_window",
          "touch_content",
          "touch_window",
          "micro_drag_content",
          "micro_drag_window",
        ],
      },
    ];

    const results = [];
    for (const group of cases) {
      for (const channel of group.channels) {
        results.push(await measureCase(client, udid, { ...group, channel }));
      }
    }

    return {
      udid,
      results,
      successes: results.filter((entry) => entry.ok).map((entry) => ({
        sourceFocusId: entry.sourceFocusId,
        channel: entry.channel,
      })),
    };
  });

  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = summary.successes.length > 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
