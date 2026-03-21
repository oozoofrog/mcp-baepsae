import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { TOOL_MANIFEST, TOOL_CATEGORY_ORDER, formatToolManifestMarkdown } from "../dist/tool-manifest.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

function readReadme(fileName) {
  return fs.readFileSync(path.join(projectRoot, fileName), "utf8");
}

function extractStatusBlock(readme, heading, usageMarker) {
  const start = readme.indexOf(heading);
  assert.notEqual(start, -1, "도구 상태 블록 헤더를 찾을 수 없습니다.");

  const end = readme.indexOf(usageMarker, start);
  assert.notEqual(end, -1, "도구 상태 블록 뒤의 Usage Examples 섹션을 찾을 수 없습니다.");

  return readme.slice(start, end).trimEnd();
}

function extractTableRows(block) {
  return block.split("\n").filter((line) => line.startsWith("|"));
}

test("tool manifest is internally unique and ordered by category", () => {
  const names = TOOL_MANIFEST.map((entry) => entry.name);
  assert.equal(new Set(names).size, names.length, "tool manifest contains duplicate tool names");

  const categories = TOOL_CATEGORY_ORDER;
  assert.equal(categories.length, new Set(categories).size, "category order contains duplicates");

  const block = formatToolManifestMarkdown();
  const rows = extractTableRows(block);
  assert.equal(rows.length, categories.length + 2, "unexpected number of table rows in manifest markdown");
  assert.equal(rows[0], "| Category | Tools |");
  assert.equal(rows[1], "|---|---|");
});

test("README tool status blocks match the committed manifest", () => {
  const expectedRowsEn = extractTableRows(formatToolManifestMarkdown());
  const expectedRowsKr = [
    "| 분류 | 도구 |",
    "|---|---|",
    "| UI | `analyze_ui`, `query_ui`, `tap`, `tap_tab`, `type_text`, `swipe`, `scroll`, `drag_drop` |",
    "| Input | `key`, `key_sequence`, `key_combo`, `touch` |",
    "| System | `list_windows`, `activate_app`, `screenshot_app`, `right_click` |",
    "| iOS 시뮬레이터 전용 | `list_simulators`, `screenshot`, `record_video`, `stream_video`, `open_url`, `install_app`, `launch_app`, `terminate_app`, `uninstall_app`, `button`, `gesture` |",
    "| macOS / 시스템 | `list_apps`, `menu_action`, `get_focused_app`, `clipboard` |",
    "| 유틸리티 | `baepsae_help`, `baepsae_version` |",
  ];

  for (const [fileName, expectedRows, heading, usageMarker] of [
    ["README.md", expectedRowsEn, "### Official public MCP surface: unified generic tools", "\n## Usage Examples"],
    ["README-KR.md", expectedRowsKr, "### 공식 공개 MCP 표면: unified generic tools", "\n## 사용 예시"],
  ]) {
    const block = extractStatusBlock(readReadme(fileName), heading, usageMarker);
    const rows = extractTableRows(block);
    assert.deepEqual(rows, expectedRows, `${fileName} tool table rows drifted`);
  }
});
