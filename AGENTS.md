# PROJECT KNOWLEDGE BASE

**Generated:** 2026-02-06 14:50:24 +0900
**Commit:** 8c42a9d
**Branch:** main

## OVERVIEW
`mcp-baepsae` is a local MCP server for iOS simulator automation.
TypeScript exposes MCP tools; Swift provides a native CLI bridge used by tool handlers.

## STRUCTURE
```text
mcp-baepsae/
├── src/              # MCP server + tool registry (TypeScript)
├── native/           # Swift native binary project
├── tests/            # MCP contract + real simulator smoke tests
├── dist/             # TypeScript build output (generated)
├── bundled/          # legacy bundled binary/frameworks (artifact)
└── package.json      # build/test entry scripts
```

## WHERE TO LOOK
| Task | Location | Notes |
|---|---|---|
| Add/change MCP tool schema | `src/index.ts` | Tool names are snake_case in MCP surface |
| Change native command behavior | `native/Sources/main.swift` | Native commands are kebab-case |
| Adjust build chain | `package.json`, `native/Package.swift` | `build` runs TS then Swift |
| Update contract tests | `tests/mcp.contract.test.mjs` | Uses SDK stdio client against `dist/index.js` |
| Update real smoke checks | `tests/mcp.real.test.mjs` | Requires booted simulator |

## CODE MAP
| Symbol | Type | Location | Role |
|---|---|---|---|
| `resolveNativeBinary` | function | `src/index.ts` | Resolve native executable path (`BAEPSAE_NATIVE_PATH` override first) |
| `executeCommand` | function | `src/index.ts` | Process spawn, timeout, signal escalation, stdout/stderr capture |
| `runNative` / `runSimctl` | function | `src/index.ts` | Bridge MCP tools to native CLI or direct simctl |
| `server.tool(...)` | tool registrations | `src/index.ts` | MCP tool contract + validation + dispatch |
| `parse(arguments:)` | function | `native/Sources/main.swift` | CLI arg parser for native binary |
| `runParsed(_:)` | function | `native/Sources/main.swift` | Command dispatch + unsupported command signaling |

## CONVENTIONS
- Keep generated/vendor trees out of reasoning scope unless debugging packaging: `dist/`, `node_modules/`, `native/.build/`, `bundled/`.
- Maintain name mapping consistency: MCP tool names (snake_case) vs native subcommands (kebab-case).
- Return MCP tool failures via structured `{ content: text[], isError: true }`; do not throw uncaught errors from handlers.
- Use Node built-in test runner (`node --test`), not Jest/Vitest.

## ANTI-PATTERNS (THIS PROJECT)
- Editing `dist/` directly.
- Treating `bundled/` or `native/.build/` as source-of-truth code.
- Adding a tool in one layer only (Node or native) without updating the other and tests.
- Changing visible version strings without updating contract tests.

## UNIQUE STYLES
- Tool list is intentionally broad in TypeScript while several native commands are explicit placeholders.
- Real smoke tests create temporary artifacts under `.tmp-test-artifacts/` and clean them up.

## COMMANDS
```bash
npm run build        # tsc + swift build --package-path native -c release
npm test             # contract/integration suite
npm run test:real    # real simulator smoke tests
npm run verify       # test + test:real
```

## NOTES
- Real tests skip when no booted simulator is detected.
- Native placeholder commands currently return explicit "not implemented" errors by design.
