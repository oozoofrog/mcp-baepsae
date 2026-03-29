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

function extractBootedUdid(text) {
  const match = text.match(/\(([0-9A-F-]{36})\)\s+\(Booted\)/i);
  return match ? match[1] : null;
}

function parseFrame(text) {
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
    const frame = parseFrame(line);
    if (!frame) continue;
    const area = frame.width * frame.height;
    if (!best || area > best.area) {
      best = { line, frame, area };
    }
  }
  return best ? { line: best.line, frame: best.frame } : null;
}

function parseWindowFrame(text) {
  const match = text.match(/\(([\d.]+),([\d.]+),([\d.]+),([\d.]+)\)/);
  if (!match) return null;
  return {
    x: parseFloat(match[1]),
    y: parseFloat(match[2]),
    width: parseFloat(match[3]),
    height: parseFloat(match[4]),
  };
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

async function ensureBootedSimulator(udid) {
  try {
    execFileSync("xcrun", ["simctl", "boot", udid], { cwd: projectRoot, stdio: "pipe" });
  } catch {
    // already booted or transient boot error
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

async function sleep(ms) {
  return await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withClient(run) {
  const client = new Client({ name: "baepsae-tap-tab-research", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    cwd: projectRoot,
    stderr: "pipe",
    env: {
      ...process.env,
      BAEPSAE_NATIVE_PATH: process.env.BAEPSAE_NATIVE_PATH ?? realNativePath,
      BAEPSAE_INPUT_BACKEND: process.env.BAEPSAE_INPUT_BACKEND ?? "cgevent",
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

async function relaunchSampleApp(client, udid) {
  await call(client, "terminate_app", { udid, bundleId: "com.baepsae.sampleapp" }).catch(() => {});
  await sleep(500);
  if (sampleAppPath) {
    await call(client, "install_app", { udid, path: sampleAppPath });
  }
  await call(client, "launch_app", {
    udid,
    bundleId: "com.baepsae.sampleapp",
    args: ["--tabview-research"],
  });
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const probe = await call(client, "analyze_ui", { udid, focusId: "research-home-anchor", maxDepth: 1 });
    if (!probe.result.isError && probe.text.includes("Research Home")) {
      return;
    }
    await sleep(500);
  }
  await sleep(1500);
}

async function main() {
  const summary = await withClient(async (client) => {
    const udid = chooseSimulatorUdid();
    await ensureBootedSimulator(udid);

    await relaunchSampleApp(client, udid);

    const allTree = await call(client, "analyze_ui", { udid, all: true, maxDepth: 8 });
    const contentRootCandidate = extractLargestFrameFromLines(
      allTree.text,
      (line) => line.includes("subrole=iOSContentGroup"),
    );
    const tabBarCandidate = extractLargestFrameFromLines(
      allTree.text,
      (line) => line.includes("role=AXGroup text=Tab Bar"),
    );
    const windowCandidate = extractLargestFrameFromLines(
      allTree.text,
      (line) => line.includes("role=AXWindow subrole=AXStandardWindow"),
    );
    const tabBarLine = tabBarCandidate?.line ?? null;
    const tabBarFrame = tabBarCandidate?.frame ?? null;
    const contentFrame = contentRootCandidate?.frame ?? null;
    const windowFrame = windowCandidate?.frame ?? null;

    if (!tabBarFrame || !contentFrame || !windowFrame) {
      return {
        udid,
        tabBarLine,
        contentFrame,
        windowFrame,
        hits: [],
        attempts: [],
        note: "Tab bar frame, content frame, or window frame could not be determined.",
      };
    }

    const targetIndex = 1;
    const tabCount = 4;
    const xRatioCandidates = [0.35, 0.5, 0.65];
    const yRatioCandidates = [0.3, 0.45, 0.6];
    const bases = ["window", "content"];
    const attempts = [];
    const hits = [];
    const slotWidth = tabBarFrame.width / tabCount;

    for (const base of bases) {
      for (const xRatio of xRatioCandidates) {
        for (const yRatio of yRatioCandidates) {
          const absoluteX = tabBarFrame.x + slotWidth * targetIndex + slotWidth * xRatio;
          const absoluteY = tabBarFrame.y + tabBarFrame.height * yRatio;
          const x =
            base === "window"
              ? absoluteX - windowFrame.x
              : absoluteX - contentFrame.x;
          const y =
            base === "window"
              ? absoluteY - windowFrame.y
              : absoluteY - contentFrame.y;

        await relaunchSampleApp(client, udid);
        await call(client, "tap", { udid, x, y });
        await sleep(1200);

        const scrollPosition = await call(client, "analyze_ui", { udid, focusId: "research-scroll-anchor", maxDepth: 1 });
        const ok = !scrollPosition.result.isError && /Research Scroll/.test(scrollPosition.text);

        const entry = {
          base,
          xRatio,
          yRatio,
          x: Math.round(x * 10) / 10,
          y: Math.round(y * 10) / 10,
          ok,
          tail: scrollPosition.text.split("\n").slice(-3).join(" | "),
        };
        attempts.push(entry);
        if (ok) hits.push(entry);
        }
      }
    }

    return {
      udid,
      tabBarLine,
      tabBarFrame,
      contentFrame,
      windowFrame,
      targetIndex,
      tabCount,
      attempts,
      hits,
      note: hits.length > 0
        ? "At least one coordinate switched to the Scroll tab."
        : "No tested coordinate switched to the Scroll tab.",
    };
  });

  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = summary.hits?.length ? 0 : 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
