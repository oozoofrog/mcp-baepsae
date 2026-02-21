# mcp-baepsae 프로젝트 구조

## 디렉토리 트리

```
mcp-baepsae/
├── src/                        # TypeScript MCP 레이어
│   ├── index.ts                # 진입점: MCP 서버 설정 및 도구 등록
│   ├── types.ts                # 공유 TypeScript 인터페이스 정의
│   ├── utils.ts                # 공유 유틸리티 및 상수
│   ├── version.ts              # 버전 정보
│   └── tools/                  # 도구 등록 모듈
│       ├── info.ts             # 정보 도구 (help, version)
│       ├── simulator.ts        # 시뮬레이터 관리 도구
│       ├── ui.ts               # UI 자동화 도구
│       ├── input.ts            # 입력 도구
│       ├── media.ts            # 미디어 도구
│       └── system.ts           # 시스템 도구
│
├── native/                     # Swift 네이티브 브리지
│   ├── Sources/
│   │   ├── main.swift          # 진입점: 명령어 디스패치 스위치
│   │   ├── Types.swift         # 공유 타입 (TargetApp, NativeError 등)
│   │   ├── Utils.swift         # 공유 유틸리티 (인자 파싱, 마우스/키보드 이벤트)
│   │   ├── Version.swift       # 버전 정보
│   │   └── Commands/           # 명령어 핸들러 모듈
│   │       ├── UICommands.swift        # UI 자동화 명령어
│   │       ├── InputCommands.swift     # 입력 명령어
│   │       ├── MediaCommands.swift     # 미디어 명령어
│   │       ├── SystemCommands.swift    # 시스템 명령어
│   │       └── WindowCommands.swift    # 창 관리 명령어
│   └── Tests/
│       └── BaepsaeNativeTests/         # Swift XCTest 테스트
│
├── tests/                      # Node.js ESM 테스트 파일
│   ├── mcp.contract.test.mjs   # MCP 계약 테스트
│   ├── unit.test.mjs           # 단위 테스트 (69개)
│   └── mcp.real.test.mjs       # 실제 시뮬레이터 스모크 테스트
│
├── dist/                       # TypeScript 컴파일 출력 (자동 생성)
├── scripts/                    # 빌드 및 설치 스크립트
├── test-fixtures/              # E2E 테스트용 샘플 앱
├── package.json                # npm 패키지 설정
├── tsconfig.json               # TypeScript 컴파일러 설정
└── native/Package.swift        # Swift 패키지 설정
```

---

## 핵심 파일 위치 및 역할

### TypeScript MCP 레이어 (`src/`)

| 파일 | 역할 |
|------|------|
| `src/index.ts` | MCP 서버 인스턴스 생성, `--version` 플래그 처리, 각 도구 모듈의 `registerXxxTools()` 호출 |
| `src/types.ts` | `ToolTextResult`, `CommandExecutionOptions` 등 공유 인터페이스 정의 |
| `src/utils.ts` | `resolveNativeBinary()`, `executeCommand()`, `runNative()`, `runSimctl()`, `toToolResult()` 핵심 유틸리티 |
| `src/version.ts` | 패키지 버전 상수 |

### 도구 모듈 (`src/tools/`)

각 모듈은 `registerXxxTools(server)` 함수를 export하며 MCP 도구를 서버에 등록합니다.

| 모듈 | 등록 도구 |
|------|-----------|
| `info.ts` | `baepsae_help`, `baepsae_version` |
| `simulator.ts` | `list_simulators`, `open_url`, `install_app`, `launch_app`, `terminate_app`, `uninstall_app` |
| `ui.ts` | `describe_ui`, `search_ui`, `tap`, `type_text`, `swipe`, `scroll`, `drag_drop` (sim/mac 스코프) |
| `input.ts` | `key`, `key_sequence`, `key_combo`, `button`, `touch`, `gesture` |
| `media.ts` | `stream_video`, `record_video`, `screenshot` |
| `system.ts` | `list_windows`, `activate_app`, `screenshot_app`, `right_click`, `menu_action`, `clipboard` |

### Swift 네이티브 브리지 (`native/Sources/`)

| 파일 | 역할 |
|------|------|
| `main.swift` | CLI 진입점: `printHelp()`, `runParsed()` 디스패치 스위치, 에러 처리 |
| `Types.swift` | `TargetApp`, `NativeError`, `ParsedOptions` 등 공유 타입 |
| `Utils.swift` | 인자 파싱, 접근성 헬퍼, 마우스/키보드 이벤트, 좌표 변환 |

### 명령어 모듈 (`native/Sources/Commands/`)

| 파일 | 처리 명령어 |
|------|-------------|
| `UICommands.swift` | `describe-ui`, `search-ui`, `tap`, `type`, `swipe`, `scroll` |
| `InputCommands.swift` | `key`, `key-sequence`, `key-combo`, `button`, `touch`, `gesture` |
| `MediaCommands.swift` | `screenshot`, `record-video`, `screenshot-app`, `stream-video` |
| `SystemCommands.swift` | `list-apps`, `list-windows`, `activate-app`, `menu-action`, `get-focused-app`, `clipboard` |
| `WindowCommands.swift` | `right-click`, `drag-drop` |

---

## 모듈 조직 원칙

### TypeScript 도구 모듈

- 각 기능 영역별로 독립 파일로 분리
- 모든 모듈은 `registerXxxTools(server: McpServer)` 단일 함수 export
- `src/index.ts`에서 모든 모듈의 등록 함수를 순서대로 호출

### Swift 명령어 모듈

- 기능 영역별로 파일 분리 (UI, Input, Media, System, Window)
- `main.swift`의 `runParsed()` 스위치에서 명령어 문자열로 디스패치
- 공통 유틸리티는 `Utils.swift`에 집중

---

## 레이어 간 데이터 흐름

```
AI 클라이언트 (Claude 등)
        ↓ MCP 프로토콜 (stdio)
src/index.ts (MCP 서버)
        ↓ Zod 스키마 검증
src/tools/*.ts (도구 핸들러)
        ↓ runNative() 또는 runSimctl()
src/utils.ts (executeCommand)
        ↓ 자식 프로세스 생성
        ├── baepsae-native (Swift CLI) → AppKit/CoreGraphics/Accessibility API
        └── xcrun simctl → iOS 시뮬레이터
```

### 핵심 유틸리티 함수

| 함수 | 역할 |
|------|------|
| `resolveNativeBinary()` | 네이티브 바이너리 경로 탐색: 환경변수 `BAEPSAE_NATIVE_PATH` → 릴리스 빌드 → 디버그 빌드 순서 |
| `executeCommand()` | 자식 프로세스 실행, 타임아웃, SIGINT→SIGTERM 에스컬레이션, stdout/stderr 캡처 |
| `runNative()` | 도구 인자를 네이티브 CLI 명령어로 변환하여 실행 |
| `runSimctl()` | 도구 인자를 `xcrun simctl` 명령어로 변환하여 실행 |
| `toToolResult()` | 출력을 `{ content: text[], isError: boolean }` MCP 응답 형태로 정규화 |

---

## 레이어 간 명명 규칙

두 레이어 사이에 명확한 명명 규칙 차이가 있으며 일관되게 유지해야 합니다.

| 위치 | 규칙 | 예시 |
|------|------|------|
| MCP 도구 이름 | snake_case | `describe_ui`, `key_sequence` |
| Swift CLI 서브 명령어 | kebab-case | `describe-ui`, `key-sequence` |
| TypeScript 함수/변수 | camelCase | `runNative`, `toToolResult` |
| Swift 함수/변수 | camelCase | `handleDescribeUI`, `parseOptions` |

새 도구를 추가할 때는 반드시 두 레이어 모두 업데이트하고, 위 규칙을 준수해야 합니다.
