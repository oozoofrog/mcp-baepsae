# TESTS KNOWLEDGE BASE

## OVERVIEW
`tests/` verifies MCP contract behavior and real simulator smoke behavior.

## WHERE TO LOOK
| Task | Location | Notes |
|---|---|---|
| Tool registry/shape checks | `tests/mcp.contract.test.mjs` | Uses stdio MCP client against `dist/index.js` |
| Real simulator validation | `tests/mcp.real.test.mjs` | Requires booted simulator, validates artifacts |
| Shared test harness pattern | `withClient(...)` helper in both files | Ensures connect/close lifecycle symmetry |

## CONVENTIONS
- Use Node built-in runner (`node --test`) and ESM `.mjs` files.
- Contract tests should be simulator-agnostic whenever possible.
- Real smoke tests must skip gracefully if no booted simulator is detected.
- Temporary files belong under `.tmp-test-artifacts/` and must be cleaned up.

## ANTI-PATTERNS
- Do not hardcode machine-specific paths outside temp artifact directory.
- Do not assert fragile text unless validating explicit error-contract behavior.
- Do not make real tests mandatory for environments without simulator availability.
