# mcp-baepsae 제품 개요

## 프로젝트 소개

**mcp-baepsae**는 iOS Simulator와 macOS 앱 자동화를 위한 로컬 MCP(Model Context Protocol) 서버입니다. AI 에이전트가 iOS 시뮬레이터 및 macOS 네이티브 앱을 직접 조작할 수 있도록 32개의 MCP 도구를 제공합니다.

- 버전: 4.0.1
- 라이선스: MIT
- 저장소: https://github.com/oozoofrog/mcp-baepsae
- 플랫폼: macOS 14 이상 전용

---

## 대상 사용자

- **AI 도구 개발자**: Claude, Cursor 등 MCP 호환 AI 클라이언트에서 iOS/macOS 자동화가 필요한 개발자
- **iOS/macOS 테스트 엔지니어**: 시뮬레이터 기반 UI 테스트를 자동화하려는 QA 엔지니어
- **앱 개발자**: 개발 과정에서 반복적인 UI 검증 작업을 자동화하려는 iOS/macOS 앱 개발자

---

## 핵심 기능

### 정보 도구 (2개)

| 도구 | 설명 |
|------|------|
| `baepsae_help` | 사용 가능한 모든 MCP 도구 목록과 사용법 제공 |
| `baepsae_version` | 현재 baepsae 및 네이티브 바이너리 버전 정보 반환 |

### 시뮬레이터 관리 도구 (8개)

| 도구 | 설명 |
|------|------|
| `list_simulators` | 사용 가능한 iOS 시뮬레이터 목록 조회 |
| `open_url` | 시뮬레이터에서 URL 열기 (딥 링크 테스트) |
| `install_app` | 시뮬레이터에 앱 설치 |
| `launch_app` | 시뮬레이터에서 앱 실행 |
| `terminate_app` | 실행 중인 앱 종료 |
| `uninstall_app` | 시뮬레이터에서 앱 제거 |
| `list_apps` | 설치된 앱 목록 조회 |
| `button` | 시뮬레이터 하드웨어 버튼 조작 |

### 스코프 UI 도구 (각 14개, 시뮬레이터용 `sim_` / macOS용 `mac_`)

각 접두사(`sim_`, `mac_`)별로 동일한 인터페이스를 제공하는 도구 세트입니다.

| 도구 | 설명 |
|------|------|
| `describe_ui` | 화면의 접근성 요소 계층 구조 설명 |
| `search_ui` | 특정 UI 요소 검색 |
| `tap` | 화면 특정 좌표 탭 |
| `type` | 텍스트 입력 |
| `swipe` | 스와이프 제스처 실행 |
| `key` / `key_sequence` / `key_combo` | 키보드 입력 |
| `touch` | 터치 이벤트 시뮬레이션 |
| `right_click` | 우클릭 이벤트 |
| `scroll` | 스크롤 동작 |
| `drag_drop` | 드래그 앤 드롭 |
| `list_windows` | 열린 창 목록 조회 |
| `activate_app` | 앱 포커스 활성화 |
| `screenshot_app` | 앱 스크린샷 캡처 |

### 입력 도구 (5개)

| 도구 | 설명 |
|------|------|
| `key` | 단일 키 입력 |
| `key_sequence` | 연속 키 입력 시퀀스 |
| `key_combo` | 키 조합 입력 (예: Cmd+C) |
| `touch` | 터치 이벤트 |
| `gesture` | 복합 제스처 |

### 미디어 도구 (4개)

| 도구 | 설명 |
|------|------|
| `screenshot` | 화면 스크린샷 캡처 |
| `record_video` | 화면 비디오 녹화 |
| `stream_video` | 실시간 화면 스트리밍 |

### 시스템 도구 (5개)

| 도구 | 설명 |
|------|------|
| `list_windows` | 모든 앱 창 목록 조회 |
| `activate_app` | 특정 앱 활성화 |
| `menu_action` | 메뉴 바 항목 실행 |
| `get_focused_app` | 현재 포커스된 앱 정보 반환 |
| `clipboard` | 클립보드 내용 읽기/쓰기 |

---

## 주요 사용 사례

### 1. 자동화 테스트

AI 에이전트가 iOS 시뮬레이터에서 앱을 실행하고, UI 요소를 탐색하며, 탭·스와이프·텍스트 입력 등의 인터랙션을 수행해 기능 테스트를 자동화합니다.

### 2. UI 검사 및 접근성 분석

`describe_ui`, `search_ui` 도구를 활용해 화면의 접근성 요소 트리를 분석하고 UI 구조를 파악합니다. WCAG 접근성 검증 자동화에 활용할 수 있습니다.

### 3. 앱 수명주기 관리

`install_app`, `launch_app`, `terminate_app`, `uninstall_app`을 통해 시뮬레이터에서 앱 설치·실행·종료·제거 과정을 스크립트화합니다.

### 4. 미디어 캡처 및 CI 통합

스크린샷과 비디오 녹화 기능으로 테스트 결과물을 자동 수집하고 CI/CD 파이프라인에 증거 자료로 포함합니다.

### 5. macOS 앱 자동화

`mac_` 접두사 도구들을 통해 macOS 네이티브 앱의 UI 요소를 조작하고 메뉴 액션을 실행합니다.

---

## 플랫폼 요구사항

| 요구사항 | 세부 사항 |
|----------|-----------|
| 운영체제 | macOS 14 (Sonoma) 이상 |
| Xcode | `xcrun simctl` 사용을 위한 Xcode 설치 필요 |
| 접근성 권한 | 시스템 환경설정 > 개인 정보 보호 > 접근성에서 권한 허용 필요 |
| Node.js | TypeScript MCP 레이어 실행을 위한 Node.js 런타임 |
| Swift | 네이티브 바이너리 빌드를 위한 Swift 컴파일러 (Swift 6.0) |
