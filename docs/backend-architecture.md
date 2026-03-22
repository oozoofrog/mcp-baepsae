# Backend architecture

This branch introduces a small TS-level backend abstraction so tool handlers can
talk about execution families explicitly without removing the existing
`runNative()` / `runSimctl()` helpers.

## Backend domains

| Domain | Backend kind | Executor |
|---|---|---|
| `simulator` | `simctl` | `runSimctl()` |
| `accessibility` | `native_accessibility` | `runNative()` |
| `input` | `simulator_input` | `runNative()` |
| `utility` | `utility/runtime` | `runNative()` |

## Why this exists

- `simctl`-driven simulator operations are now distinguishable from native
  accessibility operations and simulator input operations in code.
- Tool handlers can select a backend domain with `runBackend("simulator" | "accessibility" | "input" | "utility", ...)`.
- The abstraction stays thin so the current native bridge remains the source of
  truth for command execution.
- Mixed native commands can stay on direct `runNative()` temporarily when a
  single backend label would be misleading for current behavior.

## Extension point

Future drivers can add a new backend domain by:

1. Extending `BACKEND_KINDS` / `BACKEND_DOMAIN_TO_KIND`.
2. Adding the descriptor in `src/backend.ts`.
3. Wiring a new tool path through `runBackend()`.
4. Adding a unit test for the new domain mapping.
