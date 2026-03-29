# Priority 1 Research — TabViewOnly Fixture Design

## Objective

`tap_tab`의 실제 신뢰성을 검증하기 위한 **격리된 SwiftUI TabView fixture**를 설계한다.

현재 `SampleApp`은 `TabView`를 포함하지만, 상단의 별도 네비게이션 버튼(`nav-basic`, `nav-scroll`, `nav-drag`)이 있어 `tap_tab`이 실패해도 대부분의 real smoke test가 통과한다. 따라서 `tap_tab` 전용 fixture가 필요하다.

## Why the current fixture is insufficient

- 현재 `ContentView`는 상단 버튼으로 탭 이동이 가능하다.
  - `test-fixtures/SampleApp/SampleApp/ContentView.swift`
- real smoke tests 역시 실제 탭 바 대신 `nav-*` 버튼을 사용한다.
  - `tests/mcp.real.test.mjs`
- live probe 결과, 현재 `tap_tab`은 SampleApp에서 다음 오류를 냈다:
  - `No tab bar found in the application UI. Ensure the app has a visible tab bar.`

즉, 지금 fixture는 **TabView accessibility 노출 실패**를 가린다.

---

## Fixture goals

1. **오직 하단 탭바만으로 이동 가능**해야 한다.
2. 각 탭은 **명확한 화면 anchor**를 노출해야 한다.
3. `tap_tab` 성공/실패를 **5초 이내에 판정**할 수 있어야 한다.
4. `analyze_ui`, `query_ui`, `tap_tab` 세 도구가 모두 같은 fixture에서 평가 가능해야 한다.

---

## Proposed fixture shape

### Option A — same SampleApp, extra screen (recommended first)

기존 `SampleApp` 안에 연구용 화면을 추가한다.

예상 파일:

- `test-fixtures/SampleApp/SampleApp/TabViewOnlyResearchView.swift`

예상 진입 방식:

- 앱 시작 직후 바로 research view를 띄우거나
- deep link / launch argument로 research view를 띄운다

장점:

- 기존 build/install 흐름 재사용 가능
- real smoke test에 붙이기 쉽다

단점:

- 기존 화면과 상태가 섞이면 연구 purity가 낮아질 수 있다

### Option B — separate SampleApp scheme (best isolation, second step)

예상 구조:

- `test-fixtures/TabViewResearchApp/...`

장점:

- 완전 분리
- 다른 fixture와 충돌 적음

단점:

- build/install/test 유지 비용 증가

---

## Recommended first implementation

### Screen structure

`TabView`만 있는 단일 화면:

- Tab 0: `Home`
- Tab 1: `Scroll`
- Tab 2: `Form`
- Tab 3: `State`

각 탭은 아래 anchor를 가진다:

| tab index | tab label | anchor text | anchor id |
|---|---|---|---|
| 0 | Home | `Research Home` | `research-home-anchor` |
| 1 | Scroll | `Research Scroll` | `research-scroll-anchor` |
| 2 | Form | `Research Form` | `research-form-anchor` |
| 3 | State | `Research State` | `research-state-anchor` |

### Hard requirements

- 상단 `nav-*` 버튼 같은 **대체 이동 수단 금지**
- 각 탭의 `tabItem`은 처음에는 **텍스트 + SF Symbol** 모두 포함
- 각 탭 화면 안에는 최소 1개의 `accessibilityIdentifier`가 있는 anchor 배치
- 첫 버전은 portrait iPhone 기준으로만 검증

### Nice-to-have follow-ups

- 같은 fixture에 `badge`, `disabled tab`, 긴 label 탭 추가
- iPad / compact-width / landscape 변형 추가

---

## Suggested identifiers

### View anchors

- `research-home-anchor`
- `research-scroll-anchor`
- `research-form-anchor`
- `research-state-anchor`

### Optional intra-tab elements

- `research-scroll-list`
- `research-form-input`
- `research-form-result`
- `research-state-toggle`

### Launch control

가능하면 launch argument 또는 env로 분기:

- `BAEPSAE_SAMPLE_SCREEN=tabview-research`

이렇게 하면 기존 smoke path를 깨지 않고 연구용 screen만 강제로 띄울 수 있다.

---

## Research questions this fixture should answer

1. `tap_tab`이 **AXTabGroup / AXRadioGroup 없이도** 작동하는가?
2. `analyze_ui --all`에서 탭바는 어떤 role/subrole/frame으로 보이는가?
3. `findTabBarElement` 휴리스틱이 현재 SwiftUI TabView를 놓치는 이유는 무엇인가?
4. 탭 수 auto-detect(`Children(tabBar).count`)가 실제 구조와 일치하는가?

### Latest live finding

2026-03-29 live probe에서 현재 SampleApp은 다음과 같이 노출되었다.

- `role=AXGroup text=Tab Bar frame=(x:818.0,y:896.5,w:400.0,h:82.5)`
- raw descendant/action dump 결과:
  - `childCount = 0`
  - `actions = [AXScrollToVisible, AXCancel, AXShowMenu]`
  - 즉, **숨은 AXButton / AXPress descendant는 현재 fixture에서 확인되지 않음**

즉, 이제 문제는 단순히 “탭바를 못 찾는다”가 아니라:

1. 탭바는 보이는데
2. semantic descendant press에 쓸 숨은 버튼은 안 보이고
3. `tap_tab`/직접 coordinate tap 이후에도
4. 상태 전환이 안 일어나는지

를 분리해서 조사해야 한다.

### Updated pure-fixture finding

같은 날 `--tabview-research` launch arg로 **상단 `nav-*` 버튼을 제거한 순수 TabView fixture**에서도 다시 측정했다.

- 결과는 동일했다:
  - `role=AXGroup text=Tab Bar`
  - `childCount = 0`
  - `actions = [AXScrollToVisible, AXCancel, AXShowMenu]`
  - `AXPress` 없음

즉, 현재까지의 evidence로는:

> **문제는 기존 fixture의 nav 버튼이 tab bar descendants를 가리고 있어서가 아니라, SwiftUI TabView가 Simulator accessibility tree에서 실제 actionable tab children을 노출하지 않는 쪽에 더 가깝다.**

---

## Probe plan

각 상태에서 아래 데이터를 수집한다.

### Baseline probes

1. `analyze_ui { udid, maxDepth: 4 }`
2. `analyze_ui { udid, all: true, maxDepth: 5 }`
3. `analyze_ui { udid, all: true, role: "AXTabGroup", maxDepth: 6 }`
4. `analyze_ui { udid, all: true, role: "AXRadioGroup", maxDepth: 6 }`
5. `query_ui { udid, query: "Home", maxDepth: 5 }`
6. `query_ui { udid, query: "Scroll", maxDepth: 5 }`

### Interaction probes

1. `tap_tab { udid, index: 1, tabCount: 4 }`
2. `tap_tab { udid, index: 2, tabCount: 4 }`
3. `tap_tab { udid, index: 3, tabCount: 4 }`
4. 각 단계 뒤 `analyze_ui { focusId: "<expected anchor>" }`

---

## Acceptance criteria

`tap_tab` 연구 기준 통과는 아래를 모두 만족해야 한다.

1. `tap_tab` 호출이 3회 연속 non-error
2. 각 탭 전환 뒤 기대 anchor가 5초 이내에 등장
3. 동일 조건에서 최소 2회 재현
4. `--tab-count`를 생략해도 동작하거나, 실패 시 구조적 이유가 설명 가능

---

## Failure signals to record

- `tabbar_not_found`
- `tabbar_frame_missing`
- `tab_count_zero`
- `tab_index_mismatch`
- `tap_succeeds_but_anchor_does_not_change`
- `anchor_changes_only_with_all=true`
- `anchor_visible_but_query_ui_misses_it`

---

## Next implementation recommendation

첫 구현은 **기존 SampleApp에 launch-gated research screen 추가**가 가장 비용 대비 효율이 좋다.

우선순위:

1. `TabViewOnlyResearchView.swift` 추가
2. launch argument/env로 진입 가능하게 연결
3. real test에 `tap_tab` 전용 phase 추가
4. 그 뒤 별도 app/scheme 분리 여부 판단

## Updated fallback conclusion

현재 evidence를 종합하면 `tap_tab`의 현실적인 우선순위는 아래와 같다.

1. **tab bar 내부 actionable descendants**
2. **content root 상단의 semantic proxy button row**
3. **마지막에만 geometry fallback**

이 전략은 SampleApp 같은 앱에서 실제로 효과가 있었고, 순수 TabView fixture에서는 1·2가 모두 비어 geometry fallback만 남는다는 점도 확인했다.
