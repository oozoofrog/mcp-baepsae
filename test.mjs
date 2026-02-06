/**
 * Quick local test for mcp-axe
 * Usage: node test.mjs [url]
 * Default URL: https://example.com
 */

import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";

const url = process.argv[2] || "https://example.com";

console.log(`\n=== mcp-axe Local Test ===`);
console.log(`Target: ${url}\n`);

try {
  // 1. Browser launch test
  console.log("[1/4] Launching Chromium...");
  const browser = await chromium.launch({ headless: true });
  console.log("  OK");

  // 2. Page navigation test
  console.log(`[2/4] Navigating to ${url}...`);
  const context = await browser.newContext({
    bypassCSP: true,
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  console.log(`  OK (title: "${await page.title()}")`);

  // 3. axe-core scan test
  console.log("[3/4] Running axe-core scan...");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();

  console.log(`  OK`);
  console.log(`  - Violations: ${results.violations.length}`);
  console.log(`  - Passes: ${results.passes.length}`);
  console.log(`  - Incomplete: ${results.incomplete.length}`);
  console.log(`  - Inapplicable: ${results.inapplicable.length}`);

  // 4. Show violations detail
  if (results.violations.length > 0) {
    console.log("\n[4/4] Violation Details:");
    results.violations.forEach((v, i) => {
      const impact = (v.impact || "unknown").toUpperCase();
      console.log(`\n  ${i + 1}. [${impact}] ${v.id}`);
      console.log(`     ${v.help}`);
      console.log(`     Affected: ${v.nodes.length} element(s)`);
      v.nodes.slice(0, 3).forEach((node) => {
        const selector = Array.isArray(node.target)
          ? node.target.join(" > ")
          : node.target;
        console.log(`     - ${selector}`);
      });
    });
  } else {
    console.log("\n[4/4] No violations found!");
  }

  await page.close();
  await context.close();
  await browser.close();

  console.log("\n=== All tests passed! ===\n");
} catch (error) {
  console.error("\n=== TEST FAILED ===");
  console.error(error.message);
  process.exit(1);
}
