# mcp-baepsae 기술 스택

## 언어 선택 및 근거

### TypeScript 5.7 (MCP 레이어)

- **선택 이유**: MCP SDK가 TypeScript/JavaScript로 제공되며, Node.js 생태계가 MCP 서버 구현에 최적화되어 있음
- **컴파일 타겟**: ES2022
- **모듈 시스템**: Node16 ESM (`.mjs` 확장자 지원)
- **엄격 모드**: `strict: true` 활성화로 타입 안전성 보장
- **코드 규모**: 약 1,592라인

### Swift 6.0 (네이티브 브리지)

- **선택 이유**: AppKit, CoreGraphics, Accessibility API 등 macOS 네이티브 프레임워크 접근에 Swift가 필수적이며, Swift 6.0의 엄격한 동시성 모델이 UI 자동화의 안전성을 보장
- **코드 규모**: 약 2,020라인

---

## 프레임워크 개요

### MCP SDK (`@modelcontextprotocol/sdk ^1.0.0`)

AI 클라이언트와 MCP 서버 간의 표준 프로토콜 통신을 담당합니다.

- stdio 기반 통신 채널 제공
- 도구 등록 및 호출 처리
- 요청/응답 직렬화

### Zod (`zod ^3.25.76`)

MCP 도구의 입력 스키마 검증에 사용됩니다.

- 각 도구 핸들러에서 인자 타입 검증
- 런타임 타입 안전성 확보
- 에러 메시지 자동 생성

### AppKit / CoreGraphics (Swift 네이티브)

macOS UI 자동화의 핵심 프레임워크입니다.

- **AppKit**: 창 관리, 앱 활성화, 메뉴 조작
- **CoreGraphics**: 마우스 이벤트 생성, 좌표 변환, 스크린샷
- **Accessibility API**: UI 요소 탐색 및 조작 (접근성 트리 접근)

---

## 빌드 시스템

### 빌드 명령어

| 명령어 | 설명 |
|--------|------|
| `npm run build` | TypeScript(tsc) + Swift(릴리스) 전체 빌드 |
| `npm run build:ts` | TypeScript만 빌드 |
| `npm run build:native` | Swift만 빌드: `swift build --package-path native -c release` |

### 빌드 흐름

```
npm run build
    ├── tsc → dist/ 출력
    └── swift build -c release → native/.build/release/baepsae-native
```

### 자동 설치 빌드

`package.json`의 `postinstall` 스크립트가 macOS에서 `npm install` 시 네이티브 바이너리를 자동으로 빌드합니다.

### TypeScript 컴파일러 설정

- `target`: ES2022
- `module`: Node16
- `moduleResolution`: Node16
- `outDir`: `dist/`
- `strict`: true
- `esModuleInterop`: true

### Swift 패키지 설정 (`native/Package.swift`)

- Swift 버전: 6.0
- 빌드 구성: release (최적화 활성화)
- 타겟: `baepsae-native` 실행 파일

---

## 테스트 전략 및 도구

### TypeScript 테스트 (Node.js 내장 테스트 러너)

Jest나 Vitest가 아닌 Node.js 내장 테스트 러너(`node --test`)를 사용합니다.

| 파일 | 유형 | 설명 |
|------|------|------|
| `tests/mcp.contract.test.mjs` | 계약 테스트 | `@modelcontextprotocol/sdk` stdio 클라이언트로 `dist/index.js`에 대한 MCP 계약 검증 |
| `tests/unit.test.mjs` | 단위 테스트 | 엣지 케이스, 입력 검증, 파라미터 전달 검증 (69개 테스트, 시뮬레이터 불필요) |
| `tests/mcp.real.test.mjs` | 실제 테스트 | 실제 시뮬레이터 스모크 테스트 (부팅된 시뮬레이터 없을 시 우아하게 스킵) |

**주요 패턴**:
- `withClient(...)` 헬퍼로 MCP 클라이언트 connect/close 수명주기 관리
- 임시 아티팩트는 `.tmp-test-artifacts/`에 저장 후 정리

### Swift 테스트 (XCTest)

- 위치: `native/Tests/BaepsaeNativeTests/`
- 방식: 컴파일된 바이너리를 서브프로세스로 호출하는 통합 테스트
- 커버리지: 인자 파싱, 에러 메시지, 도움말 출력, 시뮬레이터 없이 작동하는 명령어

```bash
# TypeScript 테스트 실행
npm test                    # 빌드 + 계약 테스트
npm run test:real           # 빌드 + 실제 시뮬레이터 테스트
npm run test:e2e            # 빌드 + 샘플 앱 빌드 + 실제 테스트

# 단일 테스트 파일 실행
node --test tests/mcp.contract.test.mjs

# Swift 테스트 실행
swift test --package-path native
```

---

## 개발 환경 요구사항

| 요구사항 | 버전 | 용도 |
|----------|------|------|
| macOS | 14.0 이상 | 네이티브 API 지원 |
| Xcode | 최신 안정 버전 | Swift 컴파일러, `xcrun simctl` |
| Node.js | 18.0 이상 | TypeScript 런타임, 테스트 러너 |
| Swift | 6.0 | 네이티브 바이너리 컴파일 |
| npm | 8.0 이상 | 패키지 관리 |

**접근성 권한**: 시스템 환경설정 > 개인 정보 보호 및 보안 > 접근성에서 해당 앱(Claude, Terminal 등)에 권한 부여 필요

---

## 배포 및 배포 방식

### npm 패키지 배포

mcp-baepsae는 npm 패키지로 배포됩니다.

```bash
npm install -g mcp-baepsae
```

설치 시 `postinstall` 스크립트가 macOS 전용 Swift 네이티브 바이너리를 자동으로 빌드합니다.

### MCP 클라이언트 설정

Claude Desktop 또는 MCP 호환 클라이언트의 설정 파일에 다음과 같이 등록합니다.

```json
{
  "mcpServers": {
    "baepsae": {
      "command": "npx",
      "args": ["mcp-baepsae"]
    }
  }
}
```

### 네이티브 바이너리 경로 해석

`resolveNativeBinary()` 함수가 다음 순서로 바이너리를 탐색합니다.

1. 환경변수 `BAEPSAE_NATIVE_PATH` (수동 경로 지정)
2. 릴리스 빌드 경로 (`native/.build/release/baepsae-native`)
3. 디버그 빌드 경로 (개발 환경 폴백)

### 에러 처리 규칙

모든 도구 핸들러는 실패 시 반드시 아래 형태로 반환해야 하며, 예외를 전파하지 않아야 합니다.

```typescript
{ content: [{ type: "text", text: "..." }], isError: true }
```

---

## 의존성 관리

### 프로덕션 의존성

| 패키지 | 버전 | 역할 |
|--------|------|------|
| `@modelcontextprotocol/sdk` | ^1.0.0 | MCP 서버/클라이언트 프로토콜 구현 |
| `zod` | ^3.25.76 | 런타임 스키마 검증 |

### 개발 의존성

| 패키지 | 버전 | 역할 |
|--------|------|------|
| `@types/node` | 22.0.0 | Node.js 타입 정의 |
| `typescript` | 5.7.0 | TypeScript 컴파일러 |

### 외부 의존성 (시스템 설치 필요)

| 도구 | 제공 | 역할 |
|------|------|------|
| `xcrun simctl` | Xcode | iOS 시뮬레이터 제어 |
| `swift` | Xcode | 네이티브 바이너리 컴파일 |
