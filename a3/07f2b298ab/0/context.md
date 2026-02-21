# Session Context

**Session ID:** 2e10f86f-7588-41ca-98b1-6987d458823c

**Commit Message:** Implement the following plan:

# PR Review Fix Plan: `feat/bundled-nativ

## Prompt

Implement the following plan:

# PR Review Fix Plan: `feat/bundled-native-binary`

## Context
PR 리뷰(4개 전문 에이전트 병렬 분석)에서 발견된 Critical/High 이슈를 수정합니다. 핵심 문제: 바이너리 없이 npm 배포 가능, Linux에서 Mach-O 오판, 테스트 누락.

---

## Step 1: CI 파이프라인 안전장치 (C1+C2)
**File**: `.github/workflows/release.yml`

- upload-artifact에 `if-no-files-found: error` 추가 (line 35-39)
- `chmod +x` 이후 바이너리 검증 단계 추가:
  ```yaml
  - name: Verify native binary
    run: |
      file bundled/baepsae-native
      file bundled/baepsae-native | grep -q 'Mach-O' || { echo "ERROR: not a Mach-O binary"; exit 1; }
  ```

## Step 2: 플랫폼 가드 (`src/utils.ts` H2)
**File**: `src/utils.ts` (line 78-82)

candidates 배열에서 `bundled/` 경로를 darwin 전용으로 제한:
```typescript
const candidates = [
    ...(process.platform === "darwin"
      ? [resolve(PACKAGE_ROOT, "bundled", NATIVE_BINARY_NAME)]
      : []),
    resolve(PACKAGE_ROOT, "native", ".build", "release", NATIVE_BINARY_NAME),
    resolve(PACKAGE_ROOT, "native", ".build", "debug", NATIVE_BINARY_NAME),
];
```

## Step 3: postinstall 실행 검증 (`package.json` H1)
**File**: `package.json` (line 24)

`-x` 검사를 실제 `--version` 실행 검증으로 교체:
```
"postinstall": "if [ -f bundled/baepsae-native ] && bundled/baepsae-native --version >/dev/null 2>&1; then exit 0; fi; if [ \"$(uname)\" = \"Darwin\" ] && command -v swift >/dev/null 2>&1; then npm run build:native; fi"
```

## Step 4: bundled 경로 단위 테스트 (H3)
**File**: `tests/unit.test.mjs` (Section 24 이후)

기존 `BAEPSAE_NATIVE_PATH` 테스트 패턴을 따라 2개 테스트 추가:
1. `bundled/` 디렉토리에 가짜 실행파일 → 번들 바이너리가 release보다 우선 선택됨
2. `BAEPSAE_NATIVE_PATH` + `bundled/` 동시 존재 → env 오버라이드가 우선

방식: 프로젝트 루트 `bundled/`에 임시 shell script 생성, `finally`에서 정리. `.gitignore`에 `bundled/` 포함되어 있어 안전.

## Step 5: CLAUDE.md 문서 업데이트 (C3)
**File**: `CLAUDE.md` (line 35)

```
- `resolveNativeBinary()` — finds the native binary (env override `BAEPSAE_NATIVE_PATH` → bundled → release → debug fallback)
```

## Step 6: bundle-native.sh 에러 메시지 개선 (M1)
**File**: `scripts/bundle-native.sh` (line 9-15)

`npm run build:native` 실패 시 Swift toolchain 설치 안내 메시지 추가.

---

## Verification
```bash
npm test              # 기존 + 새 단위 테스트 통과 확인
npm run build         # TypeScript + Swift 빌드 성공
# bundled/ 테스트는 unit test에서 자동 생성/정리
```


If you need specific details from before exiting plan mode (like exact code snippets, error messages, or content you generated), read the full transcript at: /Users/oozoofrog/.REDACTED.jsonl

If this plan can be broken down into multiple independent tasks, consider using the TeamCreate tool to create a team and parallelize the work.

## Summary

모든 테스트 통과. 변경 사항을 요약합니다.

`★ Insight ─────────────────────────────────────`
이 수정에서 적용된 방어 계층 패턴:
1. **빌드 시점 검증** (CI `if-no-files-found: error` + `file | grep Mach-O`) — 잘못된 아티팩트가 애초에 배포되지 않도록 차단
2. **런타임 플랫폼 가드** (`process.platform === "darwin"`) — Linux에서 Mach-O 바이너리를 candidates에서 제외해 `isExecutable()` 오판 방지
3. **설치 시점 검증** (`--version` 실행) — `-x` 플래그는 파일 퍼미션만 확인하지만, 실제 실행은 아키텍처 호환성까지 검증

이처럼 **다중 계층 방어(defense in depth)**를 적용하면 단일 검증이 실패해도 다른 계층이 문제를 잡아냅니다.
`─────────────────────────────────────────────────`

## 변경 요약

| Step | 파일 | 변경 내용 |
|------|------|----------|
| 1 | `.github/workflows/release.yml` | `if-no-files-found: error` 추가 + Mach-O 바이너리 검증 단계 |
| 2 | `src/utils.ts` | `bundled/` 경로를 `darwin` 전용으로 제한 |
| 3 | `package.json` | postinstall에서 `-x` → `--version` 실행 검증 |
| 4 | `tests/unit.test.mjs` | 2개 테스트 추가 (bundled 우선순위, env 오버라이드 우선) |
| 5 | `CLAUDE.md` | `resolveNativeBinary()` 설명에 `bundled` 경로 추가 |
| 6 | `scripts/bundle-native.sh` | Swift 빌드 실패 시 toolchain 설치 안내 메시지 |

테스트 결과: **unit 77/77 통과, contract 16/16 통과**

## Key Actions

- - **Read**: /Volumes/eyedisk/develop/oozoofrog/mcp-baepsae/.github/workflows/release.yml
- - **Read**: /Volumes/eyedisk/develop/oozoofrog/mcp-baepsae/src/utils.ts
- - **Read**: /Volumes/eyedisk/develop/oozoofrog/mcp-baepsae/package.json
- - **Read**: /Volumes/eyedisk/develop/oozoofrog/mcp-baepsae/scripts/bundle-native.sh
- - **Read**: /Volumes/eyedisk/develop/oozoofrog/mcp-baepsae/CLAUDE.md
- - **Read**: /Volumes/eyedisk/develop/oozoofrog/mcp-baepsae/tests/unit.test.mjs
- - **Edit**: /Volumes/eyedisk/develop/oozoofrog/mcp-baepsae/.github/workflows/release.yml
- - **Edit**: /Volumes/eyedisk/develop/oozoofrog/mcp-baepsae/.github/workflows/release.yml
- - **Edit**: /Volumes/eyedisk/develop/oozoofrog/mcp-baepsae/src/utils.ts
- - **Edit**: /Volumes/eyedisk/develop/oozoofrog/mcp-baepsae/package.json
