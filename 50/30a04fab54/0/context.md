# Session Context

**Session ID:** ec98672e-85d3-4b6a-920e-3c2e46b6442a

**Commit Message:** Implement the following plan:

# SampleApp Enhancement Plan

## Context

## Prompt

Implement the following plan:

# SampleApp Enhancement Plan

## Context

SampleApp은 mcp-baepsae의 iOS 시뮬레이터 MCP 도구를 dogfooding하는 테스트 앱이다.
현재 단일 VStack에 5개 UI 요소(label, input, result, button, list)만 있어 `scroll`, `drag_drop` 도구의 테스트가 불가능하다.

## Gap Analysis

| 시뮬레이터 도구 | 테스트 존재 | SampleApp 지원 |
|---|---|---|
| scroll | X | list 있지만 scroll wheel 검증 불가 |
| drag_drop | X | draggable 요소 없음 |
| 나머지 20개 도구 | O | O |

## Approach: TabView 기반 다중 페이지

기존 ContentView를 TabView로 감싸고, 탭별로 테스트 시나리오를 분리한다.
기존 test-label, test-input, test-result, test-button, test-list의 accessibility ID는 그대로 유지하여 기존 테스트 호환.

### Tab 구조

**Tab 1 — Basic (기존)**: 기존 ContentView 내용 유지
- test-label, test-input, test-result, test-button, test-list
- 기존 테스트 100% 호환

**Tab 2 — Scroll**: scroll 도구 검증용
- 100개 아이템 리스트 (`scroll-list`, accessibility ID)
- 스크롤 위치 표시 텍스트 (`scroll-position`, "Visible: Item 0 ~ Item 19" 형태)
- ScrollViewReader + GeometryReader로 visible range 추적

**Tab 3 — Drag & Drop**: drag_drop 도구 검증용
- 드래그 가능한 아이템들 (3개, `drag-item-0`, `drag-item-1`, `drag-item-2`)
- 드롭 존 (`drop-zone`)
- 드롭 결과 텍스트 (`drop-result`, "Dropped: Item 1" 형태)

### File Structure

```
test-fixtures/SampleApp/SampleApp/
├── SampleAppApp.swift          (수정: unchanged)
├── ContentView.swift            (수정: TabView wrapper 추가)
├── BasicTab.swift               (신규: 기존 UI 이동)
├── ScrollTab.swift              (신규: scroll 테스트용)
├── DragDropTab.swift            (신규: drag_drop 테스트용)
├── Info.plist                   (unchanged)
└── Assets.xcassets/             (unchanged)
```

### Test Additions (mcp.real.test.mjs)

**scroll 테스트:**
- SampleApp 실행 → Tab 2(Scroll) 탭 이동 → scroll 도구 호출 (deltaY: -5) → analyze_ui로 scroll-position 텍스트 변화 검증

**drag_drop 테스트:**
- SampleApp 실행 → Tab 3(Drag) 탭 이동 → drag-item-0 좌표 획득 → drop-zone 좌표 획득 → drag_drop 호출 → drop-result 텍스트 검증

## Team Structure

| Agent | Role | Files |
|---|---|---|
| swift-dev | SampleApp Swift 코드 작성 | `BasicTab.swift`, `ScrollTab.swift`, `DragDropTab.swift`, `ContentView.swift` 수정 |
| test-dev | real test 추가 | `tests/mcp.real.test.mjs` 에 scroll, drag_drop 테스트 추가 |

swift-dev가 먼저 완료 후 test-dev가 작업 (테스트가 UI 구조에 의존).

## Verification

1. `xcodebuild` 로 SampleApp 빌드 성공 확인
2. 시뮬레이터에서 앱 실행 후 3개 탭 전환 확인
3. 기존 테스트 통과: `npm run test:real`
4. 새 scroll/drag_drop 테스트 통과


If you need specific details from before exiting plan mode (like exact code snippets, error messages, or content you generated), read the full transcript at: /Users/oozoofrog/.REDACTED.jsonl

If this plan can be broken down into multiple independent tasks, consider using the TeamCreate tool to create a team and parallelize the work.

## Summary

모든 테스트 통과입니다. 구현 내용을 요약합니다.

---

## 구현 완료

**변경된 파일 5개:**

| 파일 | 역할 |
|---|---|
| `ContentView.swift` | TabView 래퍼로 교체 (Basic/Scroll/Drag 3탭) |
| `BasicTab.swift` _(신규)_ | 기존 ContentView 내용 이동, 기존 accessibility ID 100% 유지 |
| `ScrollTab.swift` _(신규)_ | 100개 아이템 List + `onAppear`/`onDisappear`로 가시 범위 추적 |
| `DragDropTab.swift` _(신규)_ | `DragGesture(coordinateSpace: .global)` + GeometryReader 드롭 감지 |
| `project.pbxproj` | 새 Swift 파일 3개 등록 |
| `mcp.real.test.mjs` | Phase 2c: scroll/drag_drop 테스트 2개 추가 |

**검증:** `xcodebuild` BUILD SUCCEEDED, `npm test` 16/16 통과

---

● **Learn by Doing**

**Context:** `drag_drop` 테스트에서 `analyze_ui` 결과를 파싱해 좌표를 추출하려 하지만, 파싱 실패 시 폴백 좌표(`{ x: 195, y: 220 }`, `{ x: 195, y: 480 }`)를 사용합니다. 이 폴백은 현재 하드코딩되어 있어 시뮬레이터 해상도(iPhone 14 vs 16 Pro 등)에 따라 오작동할 수 있습니다.

**Your Task:** `tests/mcp.real.test.mjs`의 `parseCenterFromText` 함수 바로 아래에 `TODO(human)` 주석이 있습니다. 시뮬레이터 해상도에 무관하게 동작하는 폴백 좌표 계산 방식을 2~5줄로 구현하세요.

**Guidance:** 고려할 수 있는 접근들:
- `analyze_ui` 결과에서 화면 크기 힌트를 추출해 중앙부 계산
- `query_ui`로 각 요소의 좌표를 다른 패턴으로 재시도
- 폴백보다 먼저 `tap { id: "drag-item-0" }`으로 요소가 존재하는지 확인 후 스킵 처리

어떤 전략을 선택하든 "시뮬레이터가 없으면 skip"하는 기존 패턴을 유지해야 합니다.

## Key Actions

- - **Glob**: test-fixtures/SampleApp/SampleApp/**/*
- - **Glob**: tests/*.mjs
- - **Read**: /Volumes/eyedisk/develop/oozoofrog/mcp-baepsae/test-fixtures/SampleApp/SampleApp/ContentView.swift
- - **Read**: /Volumes/eyedisk/develop/oozoofrog/mcp-baepsae/tests/mcp.real.test.mjs
- - **Glob**: test-fixtures/SampleApp/**/*.pbxproj
- - **Read**: /Volumes/eyedisk/develop/oozoofrog/mcp-baepsae/test-fixtures/SampleApp/SampleApp/SampleAppApp.swift
- - **Read**: /Volumes/eyedisk/develop/oozoofrog/mcp-baepsae/test-fixtures/SampleApp/SampleApp.xcodeproj/project.pbxproj
- - **TaskCreate**: test-fixtures/SampleApp/SampleApp/BasicTab.swift 파일 생성. 기존 ContentView의 VStack 내용을 BasicTab struct으로 이동. 모든 accessibility ID 유지 (test-label, test-input, test-result, test-button, test-list).
- - **TaskCreate**: 100개 아이템 List + scroll-position 텍스트. onAppear/onDisappear로 visibleItems Set을 유지하여 "Visible: Item X ~ Item Y" 포맷 표시. accessibility ID: scroll-list, scroll-position
- - **TaskCreate**: 3개의 DragGesture 아이템(drag-item-0..2) + drop-zone + drop-result 텍스트. DragGesture coordinateSpace: .global + GeometryReader로 드롭 감지.
