# mcp-baepsae

<p align="center">
  <img src="assets/baepsae.png" width="300" alt="baepsae">
</p>

TypeScript MCP 레이어와 Swift 네이티브 브리지를 사용하는 iOS 시뮬레이터 자동화용 로컬 MCP 서버입니다.

영문 문서는 `README.md`를 참고하세요.

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

### 옵션 A) 로컬 저장소 빌드 사용 (권장)

```bash
git clone <your-repo-url>
cd mcp-baepsae
npm install
npm run build
```

### 옵션 B) 전역 CLI 설치

```bash
npm install -g .
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

LLM 에이전트가 이 저장소를 설치부터 설정까지 자동으로 구성할 때:

```bash
bash scripts/install.sh --tool all
```

자동화에 유용한 옵션:

```bash
# 실제 실행 없이 명령만 출력
bash scripts/install.sh --tool all --dry-run

# 환경/의존성 점검만 수행
bash scripts/install.sh --tool all --doctor

# MCP 등록 제거
bash scripts/install.sh --tool all --uninstall
```

## 수동 설정 (대안)

`scripts/install.sh`를 사용하지 않을 때:

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

현재 end-to-end 구현 완료:

- `list_simulators`
- `screenshot`
- `record_video`
- `describe_ui`
- `tap`
- `type_text`
- `swipe`
- `button`
- `key`
- `key_sequence`
- `key_combo`
- `touch`
- `gesture`
- `stream_video`

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
