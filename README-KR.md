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

**접근성(Accessibility) 권한이 필요합니다.** UI 조회/입력 자동화 도구(예: `analyze_ui`, `tap`, `right_click`)를 사용할 때 필수입니다.

중요한 점은, 보통 권한 대상이 **자동화 대상 앱**이 아니라 **automation host / runtime process** 쪽이라는 것입니다.

### 보통 어떤 프로세스에 권한이 필요한가?

- **네이티브 바이너리를 직접 실행하는 경우**
  - 예: `baepsae-native ...`
  - 보통 `baepsae-native` 바이너리 자체와, 이를 실행한 터미널/셸 앱이 관련됩니다
- **Node / npx 런타임으로 실행하는 경우**
  - 예: `node dist/index.js`, `npx -y mcp-baepsae@latest`
  - 보통 런타임 프로세스(`node`)와, 이를 실행한 터미널 또는 MCP client 앱이 관련됩니다
- **Desktop / CLI MCP client를 통해 실행하는 경우**
  - 예: Claude Code, Codex CLI/Desktop, Gemini CLI
  - launch path 에 따라 MCP client 앱, 터미널 host, runtime process 중 여러 항목이 관련될 수 있습니다

### 권장 설정 순서

1. **시스템 설정** > **개인정보 보호 및 보안** > **손쉬운 사용(Accessibility)** 로 이동합니다.
2. 실제로 사용하는 터미널 또는 MCP client 앱을 허용합니다.
3. 목록에 보이면 런타임 프로세스(`node`, `bun` 등)도 허용합니다.
4. 네이티브 바이너리를 직접 실행하는 경우 `baepsae-native` 항목도 별도로 확인합니다.
5. 목록에 없으면 `+` 버튼으로 수동 추가합니다.

### 중요

권한을 켠 뒤에도 macOS가 즉시 반영하지 않는 경우가 있습니다.  
오류가 계속되면 `mcp-baepsae` 를 시작한 터미널, MCP client, 또는 runtime process 를 종료 후 다시 실행하세요.

시뮬레이터 타깃에서 선택자 기반 액션(`tap`/`right_click`의 `id`/`label`)은 기본적으로 **앱 내부 콘텐츠**를 탐색합니다. Simulator 크롬/시스템 UI까지 포함하려면 `all: true`를 사용하세요.

## 설치

### 옵션 A) npm (가장 간편)

```bash
# 설치 없이 바로 실행
npx mcp-baepsae@latest

# 또는 전역 설치
npm install -g mcp-baepsae
```

> macOS에서는 설치 시 Swift 네이티브 바이너리가 자동 빌드됩니다. Swift가 없어도 simctl 기반 기능은 정상 작동합니다.
>
> UI 조회/입력 자동화를 바로 사용할 계획이라면, 실제로 서버를 실행할 터미널 / MCP client / runtime process 에 먼저 접근성 권한을 부여해두는 것이 좋습니다.

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

> UI 자동화 도구를 사용하기 전에, 접근성 권한은 보통 **자동화 대상 앱**이 아니라 **host/runtime process** (`node`, terminal, MCP client) 에 필요하다는 점을 먼저 확인하세요.

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

`npx` 경로에서는 보통 spawn된 `node` 런타임과, 이를 실행한 터미널 / MCP client 가 관련 권한 대상입니다.

### 로컬 빌드 사용

```bash
# Claude Code (project)
claude mcp add --scope project --env="BAEPSAE_NATIVE_PATH=/ABS/PATH/native/.build/release/baepsae-native" baepsae -- node /ABS/PATH/dist/index.js

# Codex CLI
codex mcp add baepsae --env BAEPSAE_NATIVE_PATH=/ABS/PATH/native/.build/release/baepsae-native -- node /ABS/PATH/dist/index.js

# Gemini CLI
gemini mcp add --scope user --transport stdio -e BAEPSAE_NATIVE_PATH=/ABS/PATH/native/.build/release/baepsae-native baepsae node /ABS/PATH/dist/index.js
```

로컬 빌드를 사용할 때는 보통 런타임(`node`)과 이를 실행한 앱을 함께 확인해야 합니다.  
디버깅 중 `baepsae-native` 를 직접 호출한다면 native binary 항목도 별도로 확인하세요.

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
npm run test:real:preflight  # 환경 진단만 출력
npm run test:real:sim        # iOS 시뮬레이터 단계만 실행 (Phase 4 제외)
npm run test:real:mac        # macOS Safari 단계만 실행
npm run verify      # test + test:real
npm run setup:mcp   # scripts/install.sh 실행 alias
```

## MCP 도구 구현 상태

총 35개 도구가 end-to-end 구현 완료되었습니다.

### 공식 공개 MCP 표면: unified generic tools

공개 API 표면은 단일 스킴으로 정리되어 있으며, `sim_*` / `mac_*` 이름 대신 target 인자를 받는 unified generic tools 를 사용합니다.

| 분류 | 도구 |
|---|---|
| UI | `analyze_ui`, `query_ui`, `tap`, `tap_tab`, `type_text`, `swipe`, `scroll`, `drag_drop` |
| Input | `key`, `key_sequence`, `key_combo`, `touch`, `input_source`, `list_input_sources` |
| Workflow | `run_steps` |
| System | `list_windows`, `activate_app`, `screenshot_app`, `right_click` |
| iOS 시뮬레이터 전용 | `list_simulators`, `screenshot`, `record_video`, `stream_video`, `open_url`, `install_app`, `launch_app`, `terminate_app`, `uninstall_app`, `button`, `gesture` |
| macOS / 시스템 | `list_apps`, `menu_action`, `get_focused_app`, `clipboard` |
| 유틸리티 | `baepsae_help`, `baepsae_version`, `doctor` |

대상 라우팅은 인자로 명시합니다: simulator 는 `udid`, macOS 는 `bundleId` / `appName`.

### `type_text` 정책

`type_text`는 다음 입력 소스 중 정확히 하나만 받습니다: `text`, `stdinText`, `file`.

- `method: "auto"`는 다음처럼 해석됩니다.
  - 시뮬레이터 대상: `paste`
  - macOS 대상: `keyboard`
- `method: "paste"`는 시뮬레이터 대상에서는 simulator pasteboard를, macOS 대상에서는 host clipboard를 잠시 바꿨다가 복원하는 경로를 사용합니다.
- `method: "keyboard"`는 항상 문자 단위 타이핑을 사용합니다.

`paste`를 사용하면 시뮬레이터 대상은 host clipboard를 건드리지 않고 simulator pasteboard를 갱신하며, macOS 대상은 host clipboard를 잠시 덮어쓴 뒤 복원합니다. 성공 응답에는 입력 소스, 대상 종류, 요청한 method, 실제 사용한 method, paste transport, auto fallback이 함께 보고됩니다.

### `tap_tab` 정책

`tap_tab`는 **semantic-first, geometry-last** 전략을 사용합니다.

- 먼저 탭 바 아래에 노출된 actionable descendant를 찾습니다.
- SwiftUI/Simulator 조합에서 실제 탭 버튼 descendant가 드러나지 않으면, 같은 탭 전환 의미를 가진 **semantic proxy row**(예: 상단 탭 전환 버튼)를 사용할 수 있습니다.
- 그런 semantic 경로가 없을 때만 마지막으로 탭 바 geometry fallback을 사용합니다.

이 정책이 필요한 이유는 SwiftUI `TabView`가 Simulator에서 종종 실제 탭 버튼 없이 `AXGroup text="Tab Bar"`로만 노출되기 때문입니다.

## 사용 예시

**인덱스로 탭 전환하기 (`tap_tab` semantic fallback 포함):**
```javascript
// query_ui/tap selector로 개별 탭 버튼을 안정적으로 잡기 어려울 때 사용
tap_tab({ udid: "...", index: 1, tabCount: 3 })
```

**시뮬레이터 내부 앱 접근성 퀵스타트:**
```javascript
// 1) 대상 시뮬레이터에서 앱 실행
launch_app({ udid: "...", bundleId: "com.example.app" })

// 2) 접근성 트리 조회/검색 (기본: 앱 내부 콘텐츠 스코프)
analyze_ui({ udid: "..." })
query_ui({ udid: "...", query: "로그인" })

// 3) 접근성 ID/라벨로 상호작용
tap({ udid: "...", id: "login-button" })

// 선택: Simulator 크롬/시스템 UI까지 탐색하려면
tap({ udid: "...", label: "Home", all: true })
```

## 트러블슈팅

### 접근성 권한 체크리스트

- 권한 대상은 보통 **target app** 이 아니라 **automation host/runtime process** 입니다.
- 먼저 `doctor` 를 실행해서 host process, parent process, native binary, booted simulator availability, accessibility readiness 를 한 번에 확인하세요.
- 오류 메시지에서 다음 항목을 먼저 확인하세요.
  - **current host process**
  - **parent process**
  - **inferred launch mode**
- `npx` / `node` 경유 실행이라면 런타임과 이를 실행한 터미널 / MCP client 에 권한을 줍니다.
- `baepsae-native` 직접 실행이라면 native binary 항목과 이를 실행한 터미널 / 셸 앱을 확인합니다.
- 권한 변경 후에는 launching process 를 재시작한 뒤 다시 시도하세요.

- Claude 설정 중 `Invalid environment variable format` 오류:
  - 최신 `scripts/install.sh`를 사용하거나 `--env="KEY=value"` 형식을 사용하세요.
- `Missing native binary` 오류:
  - `npm run build` 실행 후 `native/.build/release/baepsae-native` 파일 존재 여부를 확인하세요.
- 접근성 권한 오류가 모호한 경우:
  - 현재 버전은 오류 메시지에 host / parent process 진단 정보와 inferred launch mode 를 함께 보여주므로 어떤 실행 파일에 권한을 줘야 할지 추적할 수 있습니다.
- 실제 스모크 테스트 진단:
  - `npm run test:real:preflight`로 전체 스위트를 돌리지 않고 환경/기능(capability) 진단만 출력할 수 있습니다.
  - `npm run test:real:sim`으로 시뮬레이터 중심 범위만, `npm run test:real:mac`으로 macOS Safari 범위만 실행할 수 있습니다.
- 여러 Simulator 창이 열려 있어 selector가 다른 기기를 잡는 경우:
  - 현재 버전은 simulator selector를 먼저 대상 `udid` 창에 맞춰 scope 합니다.
  - 의도적으로 Simulator 크롬/시스템 UI를 다뤄야 하면 `all: true`를 사용하세요.
- OpenCode에서 `baepsae`가 보이지 않는 경우:
  - `bash scripts/install.sh --tool opencode --skip-install --skip-build`를 다시 실행하고 `~/.config/opencode/opencode.json`을 확인하세요.
- Copilot 자동 등록이 안 되는 경우:
  - Copilot MCP 등록은 interactive/session 기반이므로 `--interactive` 옵션으로 다시 실행하세요.
- 실사용 스모크 테스트가 skip 되는 경우:
  - iOS 시뮬레이터를 먼저 부팅한 뒤 `npm run test:real`을 실행하세요.
