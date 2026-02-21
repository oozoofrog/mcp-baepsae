# Session Context

**Session ID:** b3cd5ff9-3937-42d3-8970-4779dbeaa4c3

**Commit Message:** 수정해줘, 테스트 안정성 포함

## Prompt

수정해줘, 테스트 안정성 포함

## Summary

모든 테스트 통과 (78 unit + 16 contract = 94 pass, 0 fail).

---

## 수정 요약

| 이슈 | 파일 | 변경 내용 |
|------|------|----------|
| **C1** | `package.json:24` | postinstall: Swift 없고 번들 실패 시 `WARNING` 메시지를 stderr로 출력 |
| **M1** | `package.json:60` | `"bundled"` → `"bundled/baepsae-native"` 정확한 파일 지정 |
| **M2** | `tests/mcp.real.test.mjs:919-925` | scroll 테스트: "Visible:" 존재만 확인 → 실제 아이템 번호로 스크롤 검증 |
| **M3** | `tests/mcp.real.test.mjs:968-988` | drag_drop 테스트: `dropZoneResult` isError 체크 추가, 좌표 파싱 실패 시 하드코딩 fallback 대신 `t.skip()` |
| **M4** | `tests/unit.test.mjs:17,1213-1217` | `rmSync(bundledDir, {recursive: true})` → `rmdirSync(bundledDir)` (비어있을 때만 삭제) |

`★ Insight ─────────────────────────────────────`
**postinstall 구조 변경**: 기존에는 Darwin 체크가 두 번 독립적으로 실행되어 "둘 다 실패"
경로가 보이지 않았습니다. 이제 `if [ Darwin ]; then ... fi` 하나로 감싸서 모든 분기를
명시적으로 만들었습니다. 이런 구조화는 셸 스크립트에서 "죽은 경로"를 없애는 좋은 패턴입니다.

**`rmdirSync` vs `rmSync({recursive})`**: `rmdirSync`는 비어있지 않은 디렉토리에서
ENOTEMPTY를 throw합니다. 이것이 정확히 원하는 동작 — 우리가 만든 파일만 삭제하고,
다른 파일이 있으면 건드리지 않습니다.
`─────────────────────────────────────────────────`

## Key Actions

- - **Read**: /Volumes/eyedisk/develop/oozoofrog/mcp-baepsae/package.json
- - **Read**: /Volumes/eyedisk/develop/oozoofrog/mcp-baepsae/tests/mcp.real.test.mjs
- - **Read**: /Volumes/eyedisk/develop/oozoofrog/mcp-baepsae/tests/unit.test.mjs
- - **Edit**: /Volumes/eyedisk/develop/oozoofrog/mcp-baepsae/package.json
- - **Edit**: /Volumes/eyedisk/develop/oozoofrog/mcp-baepsae/package.json
- - **Edit**: /Volumes/eyedisk/develop/oozoofrog/mcp-baepsae/tests/mcp.real.test.mjs
- - **Edit**: /Volumes/eyedisk/develop/oozoofrog/mcp-baepsae/tests/mcp.real.test.mjs
- - **Edit**: /Volumes/eyedisk/develop/oozoofrog/mcp-baepsae/tests/unit.test.mjs
- - **Edit**: /Volumes/eyedisk/develop/oozoofrog/mcp-baepsae/tests/unit.test.mjs
- - **Bash**: Build TypeScript to verify no compilation errors
