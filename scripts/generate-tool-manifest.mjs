import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const mode = process.argv[2] ?? "--check";

const manifestUrl = pathToFileURL(path.join(projectRoot, "dist", "tool-manifest.js")).href;
const { TOOL_MANIFEST, TOOL_CATEGORY_ORDER, TOOL_CATEGORY_LABELS_KR } = await import(manifestUrl);

const READMES = [
  {
    file: path.join(projectRoot, "README.md"),
    heading: "### Official public MCP surface: unified generic tools",
    usageMarker: "\n## Usage Examples",
  },
  {
    file: path.join(projectRoot, "README-KR.md"),
    heading: "### 공식 공개 MCP 표면: unified generic tools",
    usageMarker: "\n## 사용 예시",
  },
];

const uniqueNames = new Set(TOOL_MANIFEST.map((entry) => entry.name));
if (uniqueNames.size !== TOOL_MANIFEST.length) {
  throw new Error("tool manifest has duplicate tool names");
}

function extractBlock(text, heading, usageMarker) {
  const start = text.indexOf(heading);
  if (start === -1) throw new Error(`missing tool status block heading: ${heading}`);
  const end = text.indexOf(usageMarker, start);
  if (end === -1) throw new Error(`missing usage marker after tool block: ${usageMarker}`);
  return text.slice(start, end).trimEnd();
}

function extractRows(block) {
  return block.split("\n").filter((line) => line.startsWith("|"));
}

for (const readme of READMES) {
  const text = fs.readFileSync(readme.file, "utf8");
  const block = extractBlock(text, readme.heading, readme.usageMarker);
  const rows = extractRows(block);
  const expectedRows = readme.file.endsWith("README.md")
    ? [
        "| Category | Tools |",
        "|---|---|",
        ...TOOL_CATEGORY_ORDER.map((category) => `| ${category} | ${TOOL_MANIFEST.filter((entry) => entry.category === category).map((entry) => `\`${entry.name}\``).join(", ")} |`),
      ]
    : [
        "| 분류 | 도구 |",
        "|---|---|",
        ...TOOL_CATEGORY_ORDER.map((category) => `| ${TOOL_CATEGORY_LABELS_KR[category]} | ${TOOL_MANIFEST.filter((entry) => entry.category === category).map((entry) => `\`${entry.name}\``).join(", ")} |`),
      ];

  if (rows[0] !== expectedRows[0]) {
    throw new Error(`${path.basename(readme.file)} tool table header drifted`);
  }
  if (rows.join("\n") !== expectedRows.join("\n")) {
    throw new Error(`${path.basename(readme.file)} tool table drifted`);
  }
}

if (mode === "--write") {
  throw new Error("--write mode is not implemented; edit README files manually if needed");
}

console.log(JSON.stringify({
  toolCount: TOOL_MANIFEST.length,
  categories: TOOL_CATEGORY_ORDER,
  readmesChecked: READMES.map((entry) => path.basename(entry.file)),
}, null, 2));
