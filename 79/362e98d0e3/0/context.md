# Session Context

**Session ID:** 59d484b6-b7bf-42b0-80fb-271881af8a51

**Commit Message:** Implement the following plan:

# PR Review Round 2 Fix Plan: `feat/bundl

## Prompt

Implement the following plan:

# PR Review Round 2 Fix Plan: `feat/bundled-native-binary`

## Context
4개 전문 에이전트(코드 리뷰, silent failure, 테스트 커버리지, 타입 설계) 병렬 리뷰 결과에서 발견된 이슈를 수정합니다. 이전 라운드(Step 1-6)에서 이미 커밋된 변경 위에 추가 수정합니다.

---

## Fix 1: `postinstall` 플랫폼 가드 추가
**File**: `package.json` (line 24)
**에이전트**: Code Reviewer + Silent Failure Hunter + Test Coverage (3개 합의)

비-macOS에서 Mach-O 바이너리 실행 시도 방지. Darwin 가드를 번들 체크에 추가:
```
"postinstall": "if [ \"$(uname)\" = \"Darwin\" ] && [ -f bundled/baepsae-native ] && bundled/baepsae-native --version >/dev/null 2>&1; then exit 0; fi; if [ \"$(uname)\" = \"Darwin\" ] && command -v swift >/dev/null 2>&1; then npm run build:native; fi"
```

## Fix 2: 후보 배열 우선순위 주석 추가
**File**: `src/utils.ts` (line 77, candidates 배열 위)
**에이전트**: Type Design Analyzer + Silent Failure Hunter (2개 합의)

```typescript
  // Resolution priority (first match wins):
  // 1. Bundled pre-built binary (darwin only, for npm package users)
  // 2. Release build (local swift build)
  // 3. Debug build (development fallback)
  const candidates = [
```

## Fix 3: 테스트 cleanup `rmSync` recursive 추가
**File**: `tests/unit.test.mjs` (line 1216, 1277)
**에이전트**: Code Reviewer + Test Coverage (2개 합의)

`rmSync(bundledDir, { force: true })` → `rmSync(bundledDir, { recursive: true, force: true })` (2곳)

## Fix 4: 동적 import를 정적 import로 변경
**File**: `tests/unit.test.mjs` (line 17 + lines 1180-1182, 1232-1234)
**에이전트**: Code Reviewer

파일 상단 import에 `readFileSync` 추가:
```javascript
import { writeFileSync, chmodSync, mkdirSync, rmSync, readFileSync } from "node:fs";
```
테스트 내 `await import("node:fs").then((fs) => fs.readFileSync(...))` → `readFileSync(...)` (2곳)

## Fix 5: `bundle-native.sh` 번들 후 `--version` 검증 추가
**File**: `scripts/bundle-native.sh` (line 28 이전)
**에이전트**: Silent Failure Hunter + Test Coverage (2개 합의)

```bash
echo "Verifying bundled binary..."
if ! "$BUNDLED_DIR/baepsae-native" --version; then
  echo "Error: bundled binary failed verification (--version check failed)"
  exit 1
fi
```

## Fix 6: 비실행 번들 바이너리 폴백 테스트 추가
**File**: `tests/unit.test.mjs` (Section 24b, 기존 2개 테스트 뒤)
**에이전트**: Test Coverage Analyzer

번들 바이너리가 존재하지만 실행 불가(`chmod 0o644`)일 때 release build로 폴백하는지 검증:
- 기존 bundled 테스트와 동일한 save/restore 패턴 사용
- `bundledBinary` 생성 후 `chmodSync(bundledBinary, 0o644)` 설정
- `list_apps` 호출 시 `native/.build/release/baepsae-native` 경로가 사용되는지 확인
- bundled 바이너리 출력("SHOULD_NOT_RUN")이 포함되지 않는지 확인

---

## Verification
```bash
npm run build:ts     # TypeScript 빌드 성공
npm test             # 단위 + 계약 테스트 통과 (새 테스트 포함)
```


If you need specific details from before exiting plan mode (like exact code snippets, error messages, or content you generated), read the full transcript at: /Users/oozoofrog/.REDACTED.jsonl

If this plan can be broken down into multiple independent tasks, consider using the TeamCreate tool to create a team and parallelize the work.

## Summary

모든 테스트 통과 — 계약 테스트 16개 + 단위 테스트 78개 (새로 추가된 `non-executable bundled binary falls back to release build` 테스트 포함).

`★ Insight ─────────────────────────────────────`
**수정 요약:**
1. **Fix 1** (`package.json`): `postinstall`에 `$(uname) = Darwin` 가드 추가 — 비-macOS에서 Mach-O 바이너리 실행 시도 차단
2. **Fix 2** (`src/utils.ts`): `candidates` 배열 위에 우선순위 주석 — 코드 의도를 명확히 문서화
3. **Fix 3** (`tests/unit.test.mjs`): `rmSync`에 `recursive: true` 추가 — 디렉토리 정리 시 파일이 남아있어도 안전하게 삭제
4. **Fix 4** (`tests/unit.test.mjs`): 동적 `import("node:fs")` → 정적 `readFileSync` — 불필요한 동적 import 제거로 코드 일관성 향상
5. **Fix 5** (`scripts/bundle-native.sh`): 번들 후 `--version` 검증 — CI에서 손상된 바이너리 배포 방지
6. **Fix 6** (`tests/unit.test.mjs`): 비실행 번들 바이너리 폴백 테스트 — `chmod 0o644` 시나리오에서 release build로 정상 폴백 확인
`─────────────────────────────────────────────────`

## Key Actions

- - **Read**: /Volumes/eyedisk/develop/oozoofrog/mcp-baepsae/package.json
- - **Read**: /Volumes/eyedisk/develop/oozoofrog/mcp-baepsae/src/utils.ts
- - **Read**: /Volumes/eyedisk/develop/oozoofrog/mcp-baepsae/scripts/bundle-native.sh
- - **Read**: /Volumes/eyedisk/develop/oozoofrog/mcp-baepsae/tests/unit.test.mjs
- - **Edit**: /Volumes/eyedisk/develop/oozoofrog/mcp-baepsae/package.json
- - **Edit**: /Volumes/eyedisk/develop/oozoofrog/mcp-baepsae/src/utils.ts
- - **Edit**: /Volumes/eyedisk/develop/oozoofrog/mcp-baepsae/scripts/bundle-native.sh
- - **Edit**: /Volumes/eyedisk/develop/oozoofrog/mcp-baepsae/tests/unit.test.mjs
- - **Edit**: /Volumes/eyedisk/develop/oozoofrog/mcp-baepsae/tests/unit.test.mjs
- - **Edit**: /Volumes/eyedisk/develop/oozoofrog/mcp-baepsae/tests/unit.test.mjs
