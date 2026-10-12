# html-redesign · 빨간펜(redpen)

HTML 슬라이드를 브라우저에서 직접 표시해 고치고(텍스트·요소·영역·레이아웃), 그 표시를 Claude Code·Codex 세션에 수정 요청으로 전달하는 로컬 도구. 사용법은 README.md.

## 작업 규칙

- **기능 하나를 끝낼 때마다 커밋하고 푸시한다.** 여러 기능을 한 커밋에 섞지 않는다.
  1. `npm test` (단위 테스트) — 브라우저 쪽(`src/client/`)을 건드렸으면 `npm run test:e2e`도 돌린다.
  2. 커밋 메시지는 한국어 conventional commit: `feat: …`, `fix: …`, `docs: …`, `test: …`, `refactor: …` — 본문에 무엇을·왜.
  3. `git push` — origin은 비공개 저장소 `WoosopYi/html-redesign`, 기본 브랜치 `main`.
- 푸시는 이 저장소의 로컬 credential helper가 WoosopYi 계정 토큰을 쓰도록 설정돼 있다. `gh auth switch`로 전역 계정을 바꾸지 않는다. gh API가 필요하면 `GH_TOKEN=$(gh auth token --user WoosopYi) gh …`.
- 사용자의 실제 덱(예: `~/orca/projects/education/…`)은 직접 수정하지 않는다. 확인은 `/tmp`에 복사해서 한다.
- UI·프롬프트 문구는 한국어. 브라우저 코드는 의존성 없는 ES 모듈로 유지한다.

## 구조

- `src/cli.mjs` 명령(open/wait/pending/done/status/stop/setup) · `src/server.mjs` 로컬 서버(127.0.0.1, Host·Origin·Sec-Fetch 검사, SSE) · `src/store.mjs` 파일 상태(`<덱 폴더>/.redpen/`) · `src/locate.mjs` 화면 문구 → 소스 `파일:행` · `src/prompt.mjs` AI가 받는 프롬프트
- `src/client/` 브라우저 오버레이(UI는 shadow DOM)
  - `interact.js` 입력 처리(덱 단축키·클릭과 충돌 방지) · `actions.js` 표시 생성·편집·전송 · `state.js` 상태·되돌리기·자동 저장
  - `layout.js` 레이아웃 모드: 이동·순서·크기·글자/간격/여백/방향/열 — 덱에 인라인 스타일로 미리보기하고 정확히 원상복구
  - `sketch.js` 새 배치 스케치 · `anchor.js` 위치 기록·재부착 · `slides.js` 슬라이드 감지·이동 · `summary.js` 레이아웃 요약 문구
- `skills/redpen/SKILL.md` Claude Code·Codex 공용 스킬 — 바꾸면 `node bin/redpen.mjs setup`으로 다시 설치
- 테스트: `test/unit/*.test.mjs`(node:test), `test/e2e/run.mjs`(puppeteer-core + 설치된 Chrome)
