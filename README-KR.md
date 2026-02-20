# mcp-baepsae

<p align="center">
  <img src="assets/baepsae.png" width="300" alt="baepsae">
</p>

> **뱁새** (붉은머리오목눈이) — 한국의 작은 새. 동글동글 통통한 몸에 삐약삐약 부지런히 돌아다니는 모습이 특징입니다. 황새를 따라가다 가랑이가 찢어질 뻔해도 포기하지 않는 근성의 아이콘. 이 프로젝트도 작지만 부지런히 시뮬레이터를 쪼아댑니다.

TypeScript MCP 레이어와 Swift 네이티브 브리지를 사용하는 iOS 시뮬레이터 및 macOS 앱 자동화용 로컬 MCP 서버입니다.

영문 문서는 [README.md](./README.md)를 참고하세요.

## 목차

- [사전 요구 사항](#사전-요구-사항)
- [플랫폼 지원](#플랫폼-지원)
- [설치](#설치)
- [권한](#권한)
- [MCP 설정 (권장)](#mcp-설정-권장)
- [클라이언트 매트릭스](#클라이언트-매트릭스)
- [For LLM](#for-llm)
- [수동 설정 (대안)](#수동-설정-대안)
- [프로젝트 구조](#프로젝트-구조)
- [명령어](#명령어)
- [MCP 도구 구현 상태](#mcp-도구-구현-상태)
- [사용 예시](#사용-예시)
- [트러블슈팅](#트러블슈팅)

## 사전 요구 사항

- macOS 14+
- Xcode + iOS Simulator
- Node.js 18+
- Swift 6+

## 플랫폼 지원

| 플랫폼 | 지원 여부 | 비고 |
|---|---|---|
| macOS | 지원 | 기본 플랫폼. iOS 시뮬레이터 및 접근성 API에 필수. |
| Linux | 미지원 | 네이티브 바이너리가 AppKit, CoreGraphics, Accessibility 프레임워크에 의존. |
| Windows | 미지원 | 네이티브 바이너리가 AppKit, CoreGraphics, Accessibility 프레임워크에 의존. |

**macOS 전용인 이유**

Swift 네이티브 브리지(`baepsae-native`)는 iOS 시뮬레이터 및 macOS 애플리케이션과 상호작용하기 위해 macOS 전용 프레임워크(AppKit, CoreGraphics, Accessibility)를 사용합니다. 이 프레임워크들은 Linux나 Windows에서 사용할 수 없습니다. TypeScript MCP 레이어 또한 Xcode Command Line Tools에 포함된 `xcrun simctl`에 의존하며, 이는 macOS에서만 사용 가능합니다.

**요구 사항 요약:**

- **macOS 14 이상** -- iOS 시뮬레이터 자동화 및 접근성 API 접근에 필요합니다.
- **Xcode 또는 Xcode Command Line Tools** -- 네이티브 바이너리의 Swift 6+ 컴파일 및 `xcrun simctl` 명령어 실행에 필요합니다.
- **Node.js >= 18.0.0** -- TypeScript MCP 서버 실행에 필요합니다.

## 권한

**접근성(Accessibility) 권한이 필요합니다.** UI 조회/입력 자동화 도구(권장: `sim_*` / `mac_*` 스코프 도구, 예: `sim_describe_ui`, `mac_tap`, `sim_right_click`)를 사용할 때 필수입니다. 기존 혼합 도구(`describe_ui`, `tap`, `right_click` 등)는 호환을 위해 유지되지만 deprecated 상태입니다.

1. **시스템 설정** > **개인정보 보호 및 보안** > **손쉬운 사용(Accessibility)** 로 이동합니다.
2. 사용 중인 터미널/실행기(Terminal, iTerm2, VSCode, `node`, `openclaw`)를 허용합니다.
3. 목록에 없으면 `+` 버튼으로 수동 추가합니다.

시뮬레이터 타깃에서 선택자 기반 액션(`sim_tap`/`sim_right_click` 또는 레거시 `tap`/`right_click`의 `id`/`label`)은 기본적으로 **앱 내부 콘텐츠**를 탐색합니다. Simulator 크롬/시스템 UI까지 포함하려면 `all: true`를 사용하세요.

## 설치

### 옵션 A) npm (가장 간편)

```bash
# 설치 없이 바로 실행
npx mcp-baepsae@latest

# 또는 전역 설치
npm install -g mcp-baepsae
```

> macOS에서는 설치 시 Swift 네이티브 바이너리가 자동 빌드됩니다. Swift가 없어도 simctl 기반 기능은 정상 작동합니다.

### 옵션 B) 소스에서 빌드

```bash
git clone https://github.com/oozoofrog/mcp-baepsae.git
cd mcp-baepsae
npm install
npm run build
```

## MCP 설정 (권장)

`scripts/install.sh`를 사용하면 각 AI 클라이언트의 MCP 설치 절차를 직접 호출합니다.

```bash
bash scripts/install.sh --tool all
```

## 클라이언트 매트릭스

| 클라이언트 | 설치 경로 | 스크립트 타깃 | 비고 |
|---|---|---|---|
| Claude Code | `claude mcp add` | `--tool claude-code` | `--claude-scope`로 다중 scope 지원 |
| Claude Desktop | `claude mcp add --scope user` | `--tool claude-desktop` | 사용자 전역 등록 |
| Codex CLI | `codex mcp add` | `--tool codex-cli` | Codex Desktop도 동일 설정 사용 |
| Codex Desktop | Codex CLI MCP 설정 공유 | `--tool codex-desktop` | CLI와 동일 레지스트리 |
| OpenCode | 전역 설정(`~/.config/opencode/opencode.json`) | `--tool opencode` | 설치 스크립트가 자동 갱신 |
| Gemini | `gemini mcp add` | `--tool gemini` | user scope 설치 |
| Google Antigravity | Gemini 호환 MCP 흐름 | `--tool antigravity` | Gemini MCP 명령 경로 사용 |
| GitHub Copilot | `copilot` 또는 `gh copilot` 세션 | `--tool copilot` | interactive/session 기반 |

## For LLM

LLM 에이전트가 이 MCP 서버를 설정할 때 필요한 모든 정보입니다.

### 빠른 시작 (한 줄)

```bash
# 지원하는 모든 클라이언트에 baepsae MCP 서버 등록
bash scripts/install.sh --tool all
```

저장소를 클론하지 않고 npm으로 설치한 경우 npx를 사용하세요:

```bash
# Claude Code
claude mcp add baepsae -- npx -y mcp-baepsae@latest

# Codex CLI
codex mcp add baepsae -- npx -y mcp-baepsae@latest
```

### 자동화 옵션

```bash
# 실제 실행 없이 명령만 출력
bash scripts/install.sh --tool all --dry-run

# 환경/의존성 점검
bash scripts/install.sh --tool all --doctor

# MCP 등록 제거
bash scripts/install.sh --tool all --uninstall
```

### 런타임 옵션

설치 스크립트는 `--runtime` 플래그로 다양한 런타임을 지원합니다:

| 플래그 | 명령어 | 사용 시점 |
|---|---|---|
| `--runtime node` (기본값) | `node dist/index.js` | 소스 빌드 |
| `--runtime npx` | `npx -y mcp-baepsae@latest` | npm 레지스트리, 전역 설치 불필요 |
| `--runtime bunx` | `bunx mcp-baepsae@latest` | Bun 사용자 |
| `--runtime global` | `mcp-baepsae` | `npm install -g mcp-baepsae` 이후 |

## 수동 설정 (대안)

`scripts/install.sh`를 사용하지 않을 때:

### npx 사용 (npm 사용자 권장)

```bash
# Claude Code
claude mcp add baepsae -- npx -y mcp-baepsae@latest

# Codex CLI
codex mcp add baepsae -- npx -y mcp-baepsae@latest

# Gemini CLI
gemini mcp add --scope user --transport stdio baepsae npx -y mcp-baepsae@latest
```

### 로컬 빌드 사용

```bash
# Claude Code (project)
claude mcp add --scope project --env="BAEPSAE_NATIVE_PATH=/ABS/PATH/native/.build/release/baepsae-native" baepsae -- node /ABS/PATH/dist/index.js

# Codex CLI
codex mcp add baepsae --env BAEPSAE_NATIVE_PATH=/ABS/PATH/native/.build/release/baepsae-native -- node /ABS/PATH/dist/index.js

# Gemini CLI
gemini mcp add --scope user --transport stdio -e BAEPSAE_NATIVE_PATH=/ABS/PATH/native/.build/release/baepsae-native baepsae node /ABS/PATH/dist/index.js
```

## 프로젝트 구조

- MCP 서버 진입점: `src/index.ts`
- 도구 모듈: `src/tools/` (info, simulator, ui, input, media, system)
- 공유 유틸리티: `src/utils.ts`, `src/types.ts`
- 네이티브 바이너리 진입점: `native/Sources/main.swift`
- 네이티브 커맨드 핸들러: `native/Sources/Commands/`
- 네이티브 바이너리 출력: `native/.build/release/baepsae-native`
- TS 테스트: `tests/mcp.contract.test.mjs`, `tests/unit.test.mjs`, `tests/mcp.real.test.mjs`
- Swift 테스트: `native/Tests/BaepsaeNativeTests/`

## 명령어

```bash
npm run build       # TypeScript + Swift 네이티브 빌드
npm test            # 계약/통합 테스트
npm run test:real   # 실제 시뮬레이터 스모크 테스트 (부팅된 시뮬레이터 필요)
npm run verify      # test + test:real
npm run setup:mcp   # scripts/install.sh 실행 alias
```

## MCP 도구 구현 상태

총 62개 도구가 end-to-end 구현 완료되었습니다.

### 타깃 분리 스코프 도구 (30개, 권장)

시뮬레이터/맥 타깃 혼동을 줄이려면 아래 `sim_*` / `mac_*` 도구를 우선 사용하세요.

| 시뮬레이터 스코프 | macOS 스코프 |
|---|---|
| `sim_describe_ui` | `mac_describe_ui` |
| `sim_search_ui` | `mac_search_ui` |
| `sim_tap` | `mac_tap` |
| `sim_type_text` | `mac_type_text` |
| `sim_swipe` | `mac_swipe` |
| `sim_key` | `mac_key` |
| `sim_key_sequence` | `mac_key_sequence` |
| `sim_key_combo` | `mac_key_combo` |
| `sim_touch` | `mac_touch` |
| `sim_right_click` | `mac_right_click` |
| `sim_scroll` | `mac_scroll` |
| `sim_drag_drop` | `mac_drag_drop` |
| `sim_list_windows` | `mac_list_windows` |
| `sim_activate_app` | `mac_activate_app` |
| `sim_screenshot_app` | `mac_screenshot_app` |

### 레거시 혼합 타깃 도구 (15개, deprecated)

호환성 유지를 위해 남아 있지만 `sim_*` / `mac_*`로 마이그레이션을 권장합니다.

`describe_ui`, `search_ui`, `tap`, `type_text`, `swipe`, `key`, `key_sequence`, `key_combo`, `touch`, `right_click`, `scroll`, `drag_drop`, `list_windows`, `activate_app`, `screenshot_app`

### iOS 시뮬레이터 전용 (11개)

`list_simulators`, `screenshot`, `record_video`, `stream_video`, `open_url`, `install_app`, `launch_app`, `terminate_app`, `uninstall_app`, `button`, `gesture`

### macOS / 시스템 전용 (4개)

`list_apps`, `menu_action`, `get_focused_app`, `clipboard`

### 유틸리티 (2개)

`baepsae_help`, `baepsae_version`

## 사용 예시

**시뮬레이터 내부 앱 접근성 퀵스타트:**
```javascript
// 1) 대상 시뮬레이터에서 앱 실행
launch_app({ udid: "...", bundleId: "com.example.app" })

// 2) 접근성 트리 조회/검색 (기본: 앱 내부 콘텐츠 스코프)
sim_describe_ui({ udid: "..." })
sim_search_ui({ udid: "...", query: "로그인" })

// 3) 접근성 ID/라벨로 상호작용
sim_tap({ udid: "...", id: "login-button" })

// 선택: Simulator 크롬/시스템 UI까지 탐색하려면
sim_tap({ udid: "...", label: "Home", all: true })
```

> 기존 혼합 도구(`describe_ui`, `tap` 등)는 여전히 동작하지만 deprecated 상태입니다. 새 코드에서는 `sim_*` / `mac_*` 사용을 권장합니다.

## 트러블슈팅

- Claude 설정 중 `Invalid environment variable format` 오류:
  - 최신 `scripts/install.sh`를 사용하거나 `--env="KEY=value"` 형식을 사용하세요.
- `Missing native binary` 오류:
  - `npm run build` 실행 후 `native/.build/release/baepsae-native` 파일 존재 여부를 확인하세요.
- OpenCode에서 `baepsae`가 보이지 않는 경우:
  - `bash scripts/install.sh --tool opencode --skip-install --skip-build`를 다시 실행하고 `~/.config/opencode/opencode.json`을 확인하세요.
- Copilot 자동 등록이 안 되는 경우:
  - Copilot MCP 등록은 interactive/session 기반이므로 `--interactive` 옵션으로 다시 실행하세요.
- 실사용 스모크 테스트가 skip 되는 경우:
  - iOS 시뮬레이터를 먼저 부팅한 뒤 `npm run test:real`을 실행하세요.
