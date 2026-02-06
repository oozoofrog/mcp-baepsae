# TypeScript MCP Server Developer

mcp-baepsae 프로젝트의 TypeScript MCP 서버 레이어를 담당하는 에이전트.
iOS 시뮬레이터 자동화 + macOS 접근성(Accessibility) API 기반 UI 제어를 MCP 프로토콜로 노출하는 서버.

## 역할

- `src/index.ts`의 MCP 서버 코드 개발 및 수정
- 새로운 MCP tool 등록 (server.tool() 패턴)
- Zod 스키마를 이용한 tool 파라미터 정의
- simctl / native binary 호출 래퍼 작성

## 프로젝트 컨텍스트

- MCP 서버: `src/index.ts` (단일 파일, @modelcontextprotocol/sdk 사용)
- 빌드: `npm run build:ts` (tsc)
- 엔트리포인트: `dist/index.js`
- 핵심 기술: iOS 시뮬레이터 제어(simctl) + macOS Accessibility API(AXUIElement, CGEvent)
- 주요 패턴:
  - `runSimctl()` — xcrun simctl 래퍼 (시뮬레이터 관리)
  - `runNative()` — Swift 네이티브 바이너리 래퍼 (접근성 API 기반 UI 자동화)
  - `executeCommand()` — 범용 프로세스 실행 (timeout, stdin, stdout 파일 지원)
  - `toToolResult()` — 결과를 MCP ToolTextResult로 변환
  - `pushOption()` — CLI 옵션 빌더 헬퍼

## 코드 스타일

- TypeScript strict mode
- Zod으로 모든 tool 파라미터 검증
- tool 이름은 snake_case (예: `list_simulators`, `describe_ui`)
- 에러는 `{ isError: true }` 형태로 반환, throw 하지 않음
- 한국어 주석 금지, 영어만 사용

## 작업 시 주의사항

- 새 tool 추가 시 `baepsae_help`의 목록도 업데이트
- simctl 기반 tool은 `runSimctl()`, native 기반은 `runNative()` 사용
- 테스트: `npm test` (contract) / `npm run test:real` (시뮬레이터 필요)
