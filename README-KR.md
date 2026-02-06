# mcp-baepsae

<p align="center">
  <img src="assets/baepsae.png" width="300" alt="baepsae">
</p>

> **뱁새** (붉은머리오목눈이) — 한국의 작은 새. 동글동글 통통한 몸에 삐약삐약 부지런히 돌아다니는 모습이 특징입니다. 황새를 따라가다 가랑이가 찢어질 뻔해도 포기하지 않는 근성의 아이콘. 이 프로젝트도 작지만 부지런히 시뮬레이터를 쪼아댑니다.

TypeScript MCP 레이어와 Swift 네이티브 브리지를 사용하는 iOS 시뮬레이터 및 macOS 앱 자동화용 로컬 MCP 서버입니다.

영문 문서는 [README.md](./README.md)를 참고하세요.

## 목차

- [사전 요구 사항](#사전-요구-사항)
- [설치](#설치)
- [MCP 설정 (권장)](#mcp-설정-권장)
- [클라이언트 매트릭스](#클라이언트-매트릭스)
- [For LLM](#for-llm)
- [수동 설정 (대안)](#수동-설정-대안)
- [프로젝트 구조](#프로젝트-구조)
- [명령어](#명령어)
- [MCP 도구 구현 상태](#mcp-도구-구현-상태)
- [트러블슈팅](#트러블슈팅)

## 사전 요구 사항

- macOS 14+
- Xcode + iOS Simulator
- Node.js 18+
- Swift 6+

## 설치

### 옵션 A) npm (가장 간편)

```bash
# 설치 없이 바로 실행
npx mcp-baepsae

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
claude mcp add baepsae -- npx -y mcp-baepsae

# Codex CLI
codex mcp add baepsae -- npx -y mcp-baepsae
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
| `--runtime npx` | `npx -y mcp-baepsae` | npm 레지스트리, 전역 설치 불필요 |
| `--runtime bunx` | `bunx mcp-baepsae` | Bun 사용자 |
| `--runtime global` | `mcp-baepsae` | `npm install -g mcp-baepsae` 이후 |

## 수동 설정 (대안)

`scripts/install.sh`를 사용하지 않을 때:

### npx 사용 (npm 사용자 권장)

```bash
# Claude Code
claude mcp add baepsae -- npx -y mcp-baepsae

# Codex CLI
codex mcp add baepsae -- npx -y mcp-baepsae

# Gemini CLI
gemini mcp add --scope user --transport stdio baepsae npx -y mcp-baepsae
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

- MCP 서버: `src/index.ts`
- 네이티브 바이너리 프로젝트: `native/`
- 네이티브 바이너리 출력: `native/.build/release/baepsae-native`
- 테스트: `tests/mcp.contract.test.mjs`, `tests/mcp.real.test.mjs`

## 명령어

```bash
npm run build       # TypeScript + Swift 네이티브 빌드
npm test            # 계약/통합 테스트
npm run test:real   # 실제 시뮬레이터 스모크 테스트 (부팅된 시뮬레이터 필요)
npm run verify      # test + test:real
npm run setup:mcp   # scripts/install.sh 실행 alias
```

## MCP 도구 구현 상태

총 32개 도구가 end-to-end 구현 완료되었습니다.

### iOS 시뮬레이터 전용 (11개)

| 도구 | 설명 |
|---|---|
| `list_simulators` | iOS 시뮬레이터 목록 조회 |
| `screenshot` | 시뮬레이터 스크린샷 캡처 |
| `record_video` | 시뮬레이터 화면 녹화 |
| `stream_video` | 비디오 프레임 스트리밍 |
| `open_url` | 시뮬레이터에서 URL 열기 (Safari/딥링크) |
| `install_app` | .app/.ipa 설치 |
| `launch_app` | Bundle ID로 앱 실행 |
| `terminate_app` | 실행 중인 앱 종료 |
| `uninstall_app` | 앱 제거 |
| `button` | 하드웨어 버튼 (home/lock/side/siri/apple-pay) |
| `gesture` | 프리셋 제스처 (scroll/swipe-edge) |

### macOS 전용 (4개)

| 도구 | 설명 |
|---|---|
| `list_apps` | 실행 중인 macOS 앱 목록 조회 |
| `scroll` | 스크롤 휠 이벤트 |
| `menu_action` | 메뉴 바 액션 실행 |
| `get_focused_app` | 포커스된 앱 정보 조회 |

### 공통 — iOS 시뮬레이터 + macOS (15개)

| 도구 | 설명 |
|---|---|
| `describe_ui` | 접근성 트리 조회 (페이지네이션, 필터, 서브트리, 요약 지원) |
| `search_ui` | UI 요소 검색 (텍스트/ID/라벨) |
| `tap` | 좌표 또는 ID/라벨로 탭 (더블클릭 지원) |
| `type_text` | 텍스트 입력 |
| `swipe` | 스와이프 제스처 |
| `key` | HID 키코드 입력 |
| `key_sequence` | 연속 키코드 입력 |
| `key_combo` | 수정키 + 키 조합 |
| `touch` | 터치 다운/업 이벤트 |
| `right_click` | 우클릭 (ID/라벨 또는 좌표) |
| `drag_drop` | 드래그 앤 드롭 |
| `clipboard` | 클립보드 읽기/쓰기 |
| `list_windows` | 앱 윈도우 목록 |
| `activate_app` | 앱을 포그라운드로 전환 |
| `screenshot_app` | 앱 윈도우 스크린샷 |

### 유틸리티 (2개)

| 도구 | 설명 |
|---|---|
| `baepsae_help` | 도움말 표시 |
| `baepsae_version` | 버전 정보 표시 |

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
