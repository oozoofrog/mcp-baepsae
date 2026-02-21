# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [5.0.0] - 2026-02-21

### Removed (Breaking)

- Removed 30 scoped MCP tools (`sim_*` / `mac_*` pairs):
  - `sim_describe_ui` / `mac_describe_ui` → merged into `analyze_ui`
  - `sim_search_ui` / `mac_search_ui` → merged into `query_ui`
  - `sim_tap` / `mac_tap` → merged into `tap`
  - `sim_type_text` / `mac_type_text` → merged into `type_text`
  - `sim_swipe` / `mac_swipe` → merged into `swipe`
  - `sim_scroll` / `mac_scroll` → merged into `scroll`
  - `sim_drag_drop` / `mac_drag_drop` → merged into `drag_drop`
  - `sim_key` / `mac_key` → merged into `key`
  - `sim_key_sequence` / `mac_key_sequence` → merged into `key_sequence`
  - `sim_key_combo` / `mac_key_combo` → merged into `key_combo`
  - `sim_touch` / `mac_touch` → merged into `touch`
  - `sim_list_windows` / `mac_list_windows` → merged into `list_windows`
  - `sim_activate_app` / `mac_activate_app` → merged into `activate_app`
  - `sim_screenshot_app` / `mac_screenshot_app` → merged into `screenshot_app`
  - `sim_right_click` / `mac_right_click` → merged into `right_click`

### Added / Changed

- 15 unified tools with flexible target resolution: pass `udid` for simulator, `bundleId` or `appName` for macOS
- Tool inventory reduced from 47 to 32 (~32% fewer context tokens per LLM turn)
- Unified target validation: exactly one of `udid`, `bundleId`, or `appName` required
- Updated help output and tests for unified tool surface

### Migration

```diff
- sim_describe_ui({ udid: "..." })
+ analyze_ui({ udid: "..." })

- mac_tap({ bundleId: "com.example.app", id: "login" })
+ tap({ bundleId: "com.example.app", id: "login" })

- sim_key({ udid: "...", key: "return" })
+ key({ udid: "...", key: "return" })
```

## [4.0.1] - 2026-02-20

### Fixed

- Include `native/Tests` in npm `files` field — fixes `postinstall` Swift build failure caused by missing `BaepsaeNativeTests` target path
- Sync hardcoded version fallbacks in `src/index.ts` and `src/utils.ts` to 4.0.1
- Update `server.json` version from 3.1.6 to 4.0.1

## [4.0.0] - 2026-02-20

### Removed (Breaking)

- Removed 15 legacy mixed-target MCP tools:
  - `describe_ui`, `search_ui`, `tap`, `type_text`, `swipe`, `key`, `key_sequence`, `key_combo`, `touch`, `right_click`, `scroll`, `drag_drop`, `list_windows`, `activate_app`, `screenshot_app`
- Removed mixed-target resolver/schema path (`resolveTargetArgs`, `mixedTargetSchema`) from TypeScript tool layer

### Added / Changed

- Target-scoped API is now mandatory for cross-target actions:
  - Simulator: `sim_*` (requires `udid`)
  - macOS: `mac_*` (requires `bundleId` or `appName`)
- Tool inventory reduced from 62 to 47 after legacy removal
- Updated help output, README, README-KR, and tests for scoped-only tool surface
- CI/test reliability improvements for slow runners (version flag timeout + MCP request timeout)
- Fast-path `--version`/`-v` flag: version output no longer loads MCP SDK or tool modules (dynamic import refactor)

### Migration

```diff
- describe_ui({ udid: "..." })
+ sim_describe_ui({ udid: "..." })

- tap({ bundleId: "com.example.app", id: "login" })
+ mac_tap({ bundleId: "com.example.app", id: "login" })
```

## [3.2.1] - 2026-02-11

### Fixed

- Contract tests no longer hardcode version — read from package.json dynamically

## [3.2.0] - 2026-02-10

### Added

- CLI `--version` / `-v` flag support (#17)
- TypeScript unit tests: 69 tests covering edge cases, validation, and parameter forwarding (#11)
- Swift XCTest target: 43 tests for native binary argument parsing and error handling (#12)
- CHANGELOG.md (#14)
- Platform support section in README.md and README-KR.md (#19)

### Changed

- Refactored `src/index.ts` (1,100 lines) into 8 modular files (#8)
- Refactored `native/Sources/main.swift` (1,829 lines) into 8 modular files (#9)
- Improved native binary build failure error messages with platform-aware guidance (#18)
- CI: Added develop branch trigger (#10)

## [3.1.10] - 2026-02-08

### Changed

- Use `@latest` tag for npx/bunx commands to ensure latest version is always used

### Fixed

- CI: Add develop branch trigger (closes #10)

## [3.1.9] - 2026-02-08

### Added

- CLAUDE.md for Claude Code guidance
- npx scenario tests for native binary path resolution

### Fixed

- Resolve native binary from package root instead of cwd (#3, #4)

### Changed

- Add mcp-publisher and token files to .gitignore

## [3.1.8] - 2026-02-07

### Fixed

- CI: Auto-update server.json version from git tag

## [3.1.7] - 2026-02-07

### Fixed

- CI: Split mcp-publisher login and publish steps

## [3.1.6] - 2026-02-07

### Added

- MCP Registry auto-publish workflow

## [3.1.5] - 2026-02-07

### Added

- mcpName field for MCP Registry

## [3.1.4] - 2026-02-07

### Changed

- Version bump (no functional changes)

## [3.1.3] - 2026-02-07

### Fixed

- CI: Add npm@latest for Trusted Publishing OIDC support

### Changed

- Split CI workflow into CI (main/PR) and Release (tags)

## [3.1.2] - 2026-02-07

### Changed

- Improve Install and For LLM sections in README with npm support

## [3.1.1] - 2026-02-07

### Added

- macOS app support (`--bundle-id`, `--app-name`, `list-apps`)
- 9 new macOS tools with AX batch optimization, double-click, and macOS gesture support
- Pagination, subtree, filter, and summary options for `describe_ui` (removed maxNodes truncation)
- E2E real test suite with sample app and web fixtures
- UI commands in help text with enhanced E2E accessibility waiting
- GitHub Actions workflow for CI and NPM publishing
- npm distribution support (`.npmignore`, `postinstall` script, npm metadata)
- Baepsae logo and bird introduction to READMEs

### Fixed

- CI: Update Swift version to 6.0 to match Package.swift requirement (#1)
- Optimize npm package size and improve install scripts
- Address code review findings across TS, Swift, and tests

### Changed

- Switch to npm Trusted Publishing with OIDC
- Update READMEs to reflect full iOS Simulator + macOS support
- Update description

## [3.1.0] - 2026-02-06

### Added

- Initial release of mcp-baepsae
- TypeScript MCP layer with Zod validation
- Swift native bridge for AppKit/CoreGraphics/Accessibility APIs
- iOS Simulator tools: `list_simulators`, `screenshot`, `record_video`, `stream_video`, `open_url`, `install_app`, `launch_app`, `terminate_app`
- UI automation tools: `describe_ui`, `tap`, `type_text`, `swipe`, `key`, `key_sequence`, `key_combo`, `touch`
- Contract and integration tests

[5.0.0]: https://github.com/oozoofrog/mcp-baepsae/compare/v4.0.1...v5.0.0
[4.0.1]: https://github.com/oozoofrog/mcp-baepsae/compare/v4.0.0...v4.0.1
[4.0.0]: https://github.com/oozoofrog/mcp-baepsae/compare/v3.2.1...v4.0.0
[3.2.1]: https://github.com/oozoofrog/mcp-baepsae/compare/v3.2.0...v3.2.1
[3.2.0]: https://github.com/oozoofrog/mcp-baepsae/compare/v3.1.10...v3.2.0
[3.1.10]: https://github.com/oozoofrog/mcp-baepsae/compare/v3.1.9...v3.1.10
[3.1.9]: https://github.com/oozoofrog/mcp-baepsae/compare/v3.1.8...v3.1.9
[3.1.8]: https://github.com/oozoofrog/mcp-baepsae/compare/v3.1.7...v3.1.8
[3.1.7]: https://github.com/oozoofrog/mcp-baepsae/compare/v3.1.6...v3.1.7
[3.1.6]: https://github.com/oozoofrog/mcp-baepsae/compare/v3.1.5...v3.1.6
[3.1.5]: https://github.com/oozoofrog/mcp-baepsae/compare/v3.1.4...v3.1.5
[3.1.4]: https://github.com/oozoofrog/mcp-baepsae/compare/v3.1.3...v3.1.4
[3.1.3]: https://github.com/oozoofrog/mcp-baepsae/compare/v3.1.2...v3.1.3
[3.1.2]: https://github.com/oozoofrog/mcp-baepsae/compare/v3.1.1...v3.1.2
[3.1.1]: https://github.com/oozoofrog/mcp-baepsae/compare/v3.1.0...v3.1.1
[3.1.0]: https://github.com/oozoofrog/mcp-baepsae/releases/tag/v3.1.0
