# Priority 1 Research — Failure Taxonomy

이 문서는 Simulator AX tree / selector / `tap_tab` 연구에서 반복적으로 만날 실패를 **같은 언어로 기록**하기 위한 분류표다.

우선순위:

**hard gates > 재현성 > root cause 설명 가능성**

---

## Top-level categories

| taxon | category | meaning |
|---|---|---|
| `environment.*` | 환경 | 시뮬레이터/권한/앱 상태 문제 |
| `scope.*` | 스코프 | `iOSContentGroup` vs chrome/auxiliary 범위 문제 |
| `selector.*` | 셀렉터 | id/label/query 매칭 실패 |
| `tabbar.*` | 탭바 | `tap_tab` 전용 구조 탐지 실패 |
| `geometry.*` | 지오메트리 | frame/좌표/visible 판정 문제 |
| `timing.*` | 타이밍 | 상태 반영 지연 / polling 부족 |
| `backend.*` | 입력 백엔드 | CGEvent / IndigoHID 차이 |
| `assertion.*` | 검증 | 동작은 했으나 기대 anchor 검증 실패 |

---

## Detailed taxonomy

### `environment.no_booted_simulator`
- 의미: booted simulator가 없어 실험 자체가 성립하지 않음
- 대표 신호: preflight 또는 `list_simulators`에서 booted 없음
- 다음 액션: boot 후 재실험

### `environment.accessibility_denied`
- 의미: AX permission 부족
- 대표 신호: Permission Denied / accessibility required
- 다음 액션: 권한 부여 후 재실험

### `environment.app_not_ready`
- 의미: 앱 설치/실행/foreground 전환이 충분히 완료되지 않음
- 대표 신호: focusId 탐색 전반 실패
- 다음 액션: relaunch + anchor wait

---

### `scope.content_only_miss`
- 의미: 기본 content scope에서는 못 찾지만 `--all` 또는 auxiliary 탐색에서는 찾음
- 대표 신호:
  - 기본 `query_ui` 실패
  - `analyze_ui --all`에서는 보임
- 다음 액션:
  - auxiliary 후보 수집
  - scope fallback 강화 검토

### `scope.multi_window_content_root_mismatch`
- 의미: Simulator에 여러 device window가 열려 있어 기본 content root가 현재 대상 device가 아닌 다른 window를 가리킴
- 대표 신호:
  - `tap(id:...)` 기본 scope 실패
  - 같은 selector가 `all=true`에서는 성공
  - `focusId` 기반 `analyze_ui`는 찾지만 `tap`은 못 찾음
- 다음 액션:
  1. simulator content root를 첫 번째 iOSContentGroup이 아니라 **target device window 기준**으로 선택
  2. simulator selector path 기본 동작을 다중 window 안전하게 재설계
  3. 이 수정 후 selector path를 양성 대조군으로 다시 측정

### `scope.chrome_only_element`
- 의미: 대상 element가 app content가 아니라 simulator chrome/tooling에 존재
- 대표 신호: toolbar/tab strip/host chrome에만 존재
- 다음 액션: `--all` 필요성 명시

### `scope.visible_only_false_negative`
- 의미: 요소는 존재하지만 `visibleOnly` 필터에서 누락
- 대표 신호: 일반 검색 성공, visibleOnly 검색 실패
- 다음 액션: screenBounds/frame 해석 점검

---

### `selector.id_not_found`
- 의미: `focusId` 또는 `id` 셀렉터가 기대 element를 찾지 못함
- 대표 신호: `Could not find element with id ...`
- 다음 액션:
  - AX tree raw capture
  - id 실제 노출 여부 확인

### `selector.label_not_found`
- 의미: label 기반 매칭 실패
- 대표 신호: label query/tap 실패
- 다음 액션:
  - `query_ui` broad query로 label 텍스트 노출 여부 확인
  - normalizeText 전략 점검

### `selector.query_false_negative`
- 의미: element는 명확히 보이는데 `query_ui` 검색이 못 찾음
- 대표 신호:
  - `analyze_ui focusId` 성공
  - 같은 텍스트 `query_ui` 실패
- 다음 액션:
  - search attributes 범위 재검토

---

### `tabbar.not_found`
- 의미: `findTabBarElement`가 어떤 tab bar도 찾지 못함
- 대표 신호: `No tab bar found in the application UI`
- 현재 상태: **live probe에서 실제 발생**
- 다음 액션:
  1. `analyze_ui --all`
  2. `role=AXTabGroup/AXRadioGroup` 탐색
  3. 하단 wide group heuristic 캡처

### `tabbar.frame_missing`
- 의미: 탭바는 찾았지만 frame이 없어 index→coordinate 변환 불가
- 대표 신호: `Tab bar element has no frame attribute`
- 다음 액션: child frame 기반 fallback 검토

### `tabbar.count_zero`
- 의미: 탭바 children이 없고 `--tab-count`도 없음
- 대표 신호: `Tab bar has no children...`
- 다음 액션: explicit tabCount 사용 후 구조 비교

### `tabbar.index_mismatch`
- 의미: click은 했지만 기대한 탭이 아니라 다른 탭으로 이동
- 대표 신호: anchor mismatch
- 다음 액션:
  - frame segmentation 방식 검토
  - safe-area / content inset 영향 조사

### `tabbar.tap_no_state_change`
- 의미: `tap_tab` non-error지만 화면 anchor가 변하지 않음
- 대표 신호: command success + anchor unchanged
- 다음 액션:
  - click target 좌표 검증
  - backend 비교

### `tabbar.coordinate_nonresponsive`
- 의미: tab bar frame은 찾았고 직접 좌표 tap도 성공했지만 상태 전환이 일어나지 않음
- 대표 신호:
  - `analyze_ui --all`에서 `AXGroup text=Tab Bar` 확인
  - `tap`/`tap_tab` 모두 non-error
  - 기대 anchor(`scroll-position` 등) 미등장
- 다음 액션:
  1. tab bar children 노출 여부 확인
  2. index 분할 방식 재검토
  3. 실제 interactive hotspot grid search

### `tabbar.descendants_nonactionable`
- 의미: tab bar candidate는 보이지만 내부 child/button/actionable descendant가 노출되지 않음
- 대표 신호:
  - candidate role은 `AXGroup`
  - `childCount == 0` 또는 descendants에 `AXPress` 가능한 노드 부재
  - candidate actions도 `AXPress`가 아님
- 다음 액션:
  1. semantic descendant press 전략은 현재 fixture에서 보류
  2. isolated TabView fixture에서 다시 측정
  3. geometry fallback 또는 app-provided nav fallback 유지

---

### `geometry.frame_missing`
- 의미: 탐지된 요소에 `AXFrame`이 없음
- 대표 신호: double-click/right-click/tap fallback 불가
- 다음 액션: AXPress path 우선 여부 검토

### `geometry.coordinate_transform_mismatch`
- 의미: window-relative와 content-relative 좌표 변환이 어긋남
- 대표 신호: 같은 요소를 찾았는데 터치가 빗나감
- 다음 액션:
  - content bounds
  - window bounds
  - backend normalization 비교

### `geometry.space_mismatch_or_hotspot_unknown`
- 의미: AX frame은 확보됐지만 실제 입력 좌표 공간(window/content) 또는 hotspot 분포를 설명하지 못함
- 대표 신호:
  - ratio grid search를 돌렸는데도 0 hits
  - tabBarFrame / windowFrame / contentFrame이 서로 직관적으로 맞지 않음
  - explicit AXButton center tap도 재현적으로 실패
- 다음 액션:
  1. scale/offset 추정 실험 추가
  2. screenshot 기반 시각 좌표 모델 필요성 검토
  3. tap tool의 simulator 좌표 해석(window vs content) 재검토

### `geometry.offscreen_false_positive`
- 의미: frame은 있으나 실제 상호작용 가능 영역이 아님
- 대표 신호: visible 판정 통과 + interaction 실패
- 다음 액션: clipping/occlusion 사례 수집

---

### `timing.anchor_timeout`
- 의미: 액션 후 기대 anchor가 제한 시간 안에 나타나지 않음
- 대표 신호: polling timeout
- 다음 액션:
  - app settle time 증가
  - intermediate state capture

### `timing.post_action_transient`
- 의미: 잠깐 나타났다가 사라지는 transient state 때문에 판정이 흔들림
- 대표 신호: flaky pass/fail
- 다음 액션: shorter poll interval + repeated capture

---

### `backend.indigo_only`
- 의미: IndigoHID에서는 성공하지만 CGEvent에서는 실패
- 다음 액션: backend-specific ledger row 기록

### `backend.cgevent_only`
- 의미: CGEvent에서는 성공하지만 IndigoHID에서는 실패
- 다음 액션: simulator content normalization 확인

### `backend.both_fail`
- 의미: 입력 계층 이전의 구조/스코프 문제일 가능성이 큼
- 다음 액션: backend보다 AX tree 조사 우선

---

### `assertion.anchor_missing`
- 의미: 기대 anchor 자체가 accessibility tree에 노출되지 않음
- 대표 신호: fixture 설계 미흡
- 다음 액션: fixture anchor 강제 노출

### `assertion.anchor_ambiguous`
- 의미: 같은 텍스트/비슷한 id가 여러 개라 판정이 애매함
- 다음 액션: unique identifier 강화

---

## Minimum recording rule

실패를 기록할 때는 최소 아래를 같이 남긴다.

1. `tool`
2. `args`
3. `device/runtime`
4. `actual stderr or text`
5. `failure_taxon`
6. `next probe`

---

## Current known live failure

2026-03-29 live probe 기준 첫 confirmed case:

- `tool`: `tap_tab`
- `args`: `{ index: 1, tabCount: 3 }`
- `failure_taxon`: `tabbar.not_found`
- notes:
  - current SampleApp has TabView
  - but `tap_tab` still failed
  - real smoke tests currently bypass this by using `nav-*` buttons
