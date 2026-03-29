import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function run(command, args, options = {}) {
  try {
    const stdout = execFileSync(command, args, {
      cwd: options.cwd ?? projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 20 * 1024 * 1024,
      env: options.env ? { ...process.env, ...options.env } : process.env,
    });
    return { ok: true, stdout, stderr: "" };
  } catch (error) {
    const stdout = error?.stdout?.toString?.() ?? "";
    const stderr = error?.stderr?.toString?.() ?? error?.message ?? String(error);
    if (options.allowFail) {
      return { ok: false, stdout, stderr };
    }
    throw new Error(`Command failed: ${command} ${args.join(" ")}\n${stderr || stdout}`);
  }
}

function listSwiftSources(directory) {
  const entries = readdirSync(directory, { withFileTypes: true });
  return entries
    .flatMap((entry) => {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return listSwiftSources(fullPath);
      }
      if (entry.isFile() && entry.name.endsWith(".swift") && entry.name !== "main.swift") {
        return [fullPath];
      }
      return [];
    })
    .sort();
}

function resolveSampleAppPath() {
  const candidates = [
    path.join(projectRoot, "test-fixtures", "SampleApp", "build", "Debug-iphonesimulator", "SampleApp.app"),
    path.join(projectRoot, "test-fixtures", "SampleApp", "Build", "Products", "Debug-iphonesimulator", "SampleApp.app"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function chooseSimulatorUdid() {
  const output = run("xcrun", ["simctl", "list", "devices", "available"]).stdout;
  const booted = output.match(/\(([0-9A-F-]{36})\)\s+\(Booted\)/i);
  if (booted) {
    return { udid: booted[1], booted: true };
  }

  const shutdownIPhone = output.match(/^\s+iPhone .* \(([0-9A-F-]{36})\) \(Shutdown\)\s*$/m);
  if (shutdownIPhone) {
    return { udid: shutdownIPhone[1], booted: false };
  }

  throw new Error("No available iPhone Simulator device found.");
}

async function ensureBootedSimulator(udid) {
  run("xcrun", ["simctl", "boot", udid], { allowFail: true });
  run("/usr/bin/open", ["-a", "Simulator", "--args", "-CurrentDeviceUDID", udid], { allowFail: true });

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const output = run("xcrun", ["simctl", "list", "devices", udid]).stdout;
    if (/\(Booted\)/.test(output)) {
      return;
    }
    await sleep(500);
  }

  throw new Error(`Simulator did not boot in time: ${udid}`);
}

async function ensureSampleAppInstalledAndLaunched(udid) {
  let sampleAppPath = resolveSampleAppPath();
  if (!sampleAppPath) {
    run("bash", ["scripts/build-sample-app.sh"]);
    sampleAppPath = resolveSampleAppPath();
  }
  if (!sampleAppPath) {
    throw new Error("SampleApp.app could not be found even after build.");
  }

  run("xcrun", ["simctl", "install", udid, sampleAppPath], { allowFail: true });
  run("xcrun", ["simctl", "terminate", udid, "com.baepsae.sampleapp"], { allowFail: true });
  await sleep(500);
  run("xcrun", ["simctl", "launch", udid, "com.baepsae.sampleapp", "--args", "--tabview-research"]);
  await sleep(2_000);

  return sampleAppPath;
}

function buildProbeBinary() {
  const tmpDir = path.join(os.tmpdir(), `baepsae-tabbar-actions-${Date.now()}`);
  const probePath = path.join(tmpDir, "Probe.swift");
  const binaryPath = path.join(tmpDir, "probe");
  const swiftSources = listSwiftSources(path.join(projectRoot, "native", "Sources"));

  const source = `
import AppKit
import CoreGraphics
import Foundation

struct FrameDump: Codable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct NodeDump: Codable {
    let role: String
    let subrole: String?
    let identifier: String?
    let texts: [String]
    let actions: [String]
    let frame: FrameDump?
    let childCount: Int
    let children: [NodeDump]?
}

struct CandidateDump: Codable {
    let reasons: [String]
    let node: NodeDump
}

struct Report: Codable {
    let udid: String
    let sampleAppBundleId: String
    let launchMode: String
    let contentRoot: NodeDump?
    let heuristicTabBar: NodeDump?
    let candidates: [CandidateDump]
}

func textValues(_ element: UIElement) -> [String] {
    let attrs = copyMultipleAttributes(element, [
        "AXLabel",
        kAXTitleAttribute as String,
        kAXDescriptionAttribute as String,
        kAXValueAttribute as String,
        "AXPlaceholderValue",
    ])
    var result: [String] = []
    for key in ["AXLabel", kAXTitleAttribute as String, kAXDescriptionAttribute as String, kAXValueAttribute as String, "AXPlaceholderValue"] {
        if let value = attrs[key], let string = stringFromCFTypeRef(value), !string.isEmpty {
            result.append(string)
        }
    }
    return Array(NSOrderedSet(array: result)) as? [String] ?? result
}

func frameDump(_ frame: CGRect?) -> FrameDump? {
    guard let frame else { return nil }
    return FrameDump(x: frame.origin.x, y: frame.origin.y, width: frame.size.width, height: frame.size.height)
}

func nodeDump(_ element: UIElement, depth: Int = 0, maxDepth: Int = 2) -> NodeDump {
    let role = StringAttribute(element, kAXRoleAttribute as CFString) ?? "unknown"
    let subrole = StringAttribute(element, kAXSubroleAttribute as CFString)
    let identifier = IdentifierAttribute(element)
    let texts = textValues(element)
    let actions = ActionNames(element)
    let frame = FrameAttribute(element)
    let children = Children(element)
    let childDumps: [NodeDump]?
    if depth < maxDepth {
        childDumps = children.map { nodeDump($0, depth: depth + 1, maxDepth: maxDepth) }
    } else {
        childDumps = nil
    }

    return NodeDump(
        role: role,
        subrole: subrole,
        identifier: identifier,
        texts: texts,
        actions: actions,
        frame: frameDump(frame),
        childCount: children.count,
        children: childDumps
    )
}

func candidateReasons(_ element: UIElement, contentFrame: CGRect?) -> [String] {
    let role = StringAttribute(element, kAXRoleAttribute as CFString) ?? "unknown"
    let texts = textValues(element).map(normalizeText)
    let frame = FrameAttribute(element)
    var reasons: [String] = []

    if role == "AXTabGroup" { reasons.append("role=AXTabGroup") }
    if role == "AXRadioGroup" { reasons.append("role=AXRadioGroup") }
    if role == "AXSegmentedControl" { reasons.append("role=AXSegmentedControl") }
    if texts.contains(where: { $0.contains("tab bar") }) { reasons.append("text contains 'tab bar'") }

    if role == "AXGroup", let frame, let contentFrame {
        let isWide = frame.width >= contentFrame.width * 0.60
        let isNearBottom = frame.origin.y >= contentFrame.origin.y + contentFrame.height * 0.65
        let plausibleHeight = frame.height >= 32 && frame.height <= 140
        if isWide && isNearBottom && plausibleHeight {
            reasons.append("wide bottom group inside content root")
        }
    }

    return reasons
}

func collectTabBarCandidates(in root: UIElement, contentFrame: CGRect?) -> [CandidateDump] {
    var stack: [UIElement] = [root]
    var visited = 0
    var candidates: [(element: UIElement, reasons: [String])] = []

    while let current = stack.popLast() {
        if visited > 1500 { break }
        visited += 1

        let reasons = candidateReasons(current, contentFrame: contentFrame)
        if !reasons.isEmpty {
            let isDuplicate = candidates.contains { existing in
                elementsAreEqual(existing.element, current)
            }
            if !isDuplicate {
                candidates.append((current, reasons))
            }
        }

        for child in Children(current).reversed() {
            stack.append(child)
        }
    }

    return candidates.map { candidate in
        CandidateDump(reasons: candidate.reasons, node: nodeDump(candidate.element))
    }
}

@main
struct Probe {
    static func main() throws {
        let udid = ProcessInfo.processInfo.environment["UDID"] ?? ""
        if udid.isEmpty {
            fatalError("UDID env is required")
        }

        try ensureAccessibilityTrusted()
        try activateSimulator(udid: udid)
        Thread.sleep(forTimeInterval: 1.0)

        let appRoot = try simulatorAccessibilityRootElement()
        let contentRoot = simulatorContentRootElement(from: appRoot)
        let heuristicTabBar = findTabBarElement(in: appRoot)
        let contentFrame = contentRoot.flatMap(FrameAttribute)
        let candidates = collectTabBarCandidates(in: contentRoot ?? appRoot, contentFrame: contentFrame)

        let report = Report(
            udid: udid,
            sampleAppBundleId: "com.baepsae.sampleapp",
            launchMode: "tabview-research",
            contentRoot: contentRoot.map { nodeDump($0, maxDepth: 1) },
            heuristicTabBar: heuristicTabBar.map { nodeDump($0, maxDepth: 3) },
            candidates: candidates
        )

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(report)
        print(String(decoding: data, as: UTF8.self))
    }
}
`;

  const fs = path.dirname(probePath);
  run("mkdir", ["-p", fs]);
  writeFileSync(probePath, source);
  run("swiftc", [...swiftSources, probePath, "-o", binaryPath], { cwd: projectRoot });
  return { binaryPath, tmpDir };
}

async function main() {
  const selected = chooseSimulatorUdid();
  await ensureBootedSimulator(selected.udid);
  const sampleAppPath = await ensureSampleAppInstalledAndLaunched(selected.udid);
  const { binaryPath } = buildProbeBinary();

  const probe = run(binaryPath, [], { env: { UDID: selected.udid } });
  const parsed = JSON.parse(probe.stdout);
  parsed.sampleAppPath = sampleAppPath;
  parsed.simulatorWasAlreadyBooted = selected.booted;

  console.log(JSON.stringify(parsed, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
