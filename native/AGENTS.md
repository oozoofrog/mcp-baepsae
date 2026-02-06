# NATIVE KNOWLEDGE BASE

## OVERVIEW
`native/` hosts the Swift executable (`baepsae-native`) invoked by MCP handlers.

## STRUCTURE
```text
native/
├── Package.swift      # SwiftPM manifest
├── Sources/main.swift # CLI parser + command dispatcher
└── .build/            # generated build artifacts (ignore)
```

## WHERE TO LOOK
| Task | Location | Notes |
|---|---|---|
| Add native command keyword | `Sources/main.swift` (`supportedCommands`) | Keep kebab-case |
| Parse CLI options | `parse(arguments:)` | Supports `--flag value` and `--flag=value` |
| Execute simctl/system command | `runProcess` | Streams stdio through native process |
| Command routing | `runParsed(_:)` | Maps to simctl or returns unsupported |
| Build settings | `Package.swift` | Product name + platform constraints |

## CONVENTIONS
- Use kebab-case command names to match Node mapping.
- Keep error semantics stable: unsupported path exits with code `2`, other failures with `1`.
- Prefer explicit `NativeError` cases over generic thrown strings.
- Keep simulator interactions through `xcrun simctl` unless deliberately introducing framework APIs.

## ANTI-PATTERNS
- Do not rely on anything under `native/.build/` as editable source.
- Do not change executable name in `Package.swift` without updating Node binary resolution.
- Do not silently swallow unsupported commands; return explicit unsupported errors.
