# SRC KNOWLEDGE BASE

## OVERVIEW
`src/index.ts` is the MCP surface and process-orchestration layer.

## WHERE TO LOOK
| Task | Location | Notes |
|---|---|---|
| Add new MCP tool | `src/index.ts` (`server.tool`) | Add schema + handler in one block |
| Native path resolution | `resolveNativeBinary` | Env override + release/debug fallbacks |
| Child-process behavior | `executeCommand` | Timeout, SIGINT/SIGTERM escalation, stream capture |
| Result formatting | `toToolResult` | Normalizes stdout/stderr + `isError` |
| Native routing | `runNative` | For non-simctl actions |
| Direct simctl routing | `runSimctl` | For list/screenshot/record paths |

## CONVENTIONS
- MCP tool names are snake_case (example: `record_video`, `key_sequence`).
- Native command names are kebab-case (example: `record-video`, `key-sequence`).
- Validate request arguments in Zod schema and guard logic before invoking native binary.
- Preserve structured error response shape: `content` text + explicit `isError`.

## ANTI-PATTERNS
- Do not bypass `runNative`/`runSimctl` and spawn ad-hoc commands in tool handlers.
- Do not add native-only command strings without corresponding MCP tool mapping.
- Do not change timeout or signal behavior without updating smoke/contract tests.
- Do not edit `dist/index.js`; regenerate via build.

## QUICK CHECKLIST (NEW TOOL)
1. Add tool registration (`server.tool`) with Zod schema.
2. Map arguments to native/simctl command consistently.
3. Add contract test case in `tests/mcp.contract.test.mjs`.
4. If simulator-dependent, extend `tests/mcp.real.test.mjs`.
