# redpen · 빨간펜

HTML 슬라이드를 브라우저에서 직접 표시해 고치고(텍스트·요소·영역·레이아웃), 그 표시를 Claude Code·Codex 세션에 수정 요청으로 전달하는 로컬 도구. 사용법은 README.md(영어, GitHub 첫 화면)와 README.ko.md(한국어).

## 작업 규칙

- **기능 하나를 끝낼 때마다 커밋하고 푸시한다.** 여러 기능을 한 커밋에 섞지 않는다.
  1. `npm test` (단위 테스트) — 브라우저 쪽(`src/client/`)을 건드렸으면 `npm run test:e2e`도 돌린다.
  2. 커밋 메시지는 한국어 conventional commit: `feat: …`, `fix: …`, `docs: …`, `test: …`, `refactor: …` — 본문에 무엇을·왜.
  3. `git push` — origin은 `WoosopYi/redpen`(예전 이름 html-redesign, 로컬 폴더 이름은 그대로), 기본 브랜치 `main`.
- 푸시는 이 저장소의 로컬 credential helper가 WoosopYi 계정 토큰을 쓰도록 설정돼 있다. `gh auth switch`로 전역 계정을 바꾸지 않는다. gh API가 필요하면 `GH_TOKEN=$(gh auth token --user WoosopYi) gh …`.
- 사용자의 실제 덱은 직접 수정하지 않는다. 확인은 `/tmp`에 복사해서 한다.
- UI·CLI·프롬프트 문구는 한국어로 쓰고 `tr('한국어 원문', { 자리값 })`으로 감싼 뒤, 같은 문장을 키로 `src/client/i18n/en.js`에 영어를 넣는다 (빠지면 `test/unit/i18n.test.mjs`가 잡는다). 긴 글은 `pick({ ko, en })`. 브라우저 코드는 의존성 없는 ES 모듈로 유지한다.

## 배포 (npm `@woosopyi/redpen` — 아직 배포 전. 저장소는 먼저 공개했고, 그동안 README는 GitHub에서 설치하는 명령을 안내한다)

1. `package.json`·`package-lock.json`의 `version`을 올린다 (화면 코드가 바뀌면 열린 탭은 알아서 새로고침). 첫 배포 때는 README.md·README.ko.md 설치 안내도 `npm install -g @woosopyi/redpen`, 업데이트는 `npm update -g @woosopyi/redpen`으로 되돌린다 (npm 페이지에 README가 그대로 실린다).
2. `npm test` · `npm run test:e2e` · `npm pack --dry-run`으로 담길 파일 확인 (테스트·예제·문서 이미지는 빠져야 한다).
3. `npm publish` — `publishConfig.access: public`이라 공개로 올라간다. 올린 버전은 되돌리기 어려우니 사용자 확인 후에만.

## 구조

- `src/cli.mjs` 명령(open/wait/pending/done/status/stop/setup) · `src/server.mjs` 로컬 서버(127.0.0.1, Host·Origin·Sec-Fetch 검사, SSE) · `src/store.mjs` 파일 상태(`<덱 폴더>/.redpen/`) · `src/locate.mjs` 화면 문구 → 소스 `파일:행` · `src/prompt.mjs` AI가 받는 프롬프트
- 언어: `src/client/i18n/`(tr·en.js — 브라우저·CLI·프롬프트 공용) · `src/lang.mjs` `--lang`/`REDPEN_LANG`/시스템 언어 결정. 서버가 언어를 정해 화면(config.js)에 알리고, 보낸 수정 요청(round)마다 언어를 기록한다
- `src/client/` 브라우저 오버레이(UI는 shadow DOM)
  - `interact.js` 입력 처리(덱 단축키·클릭과 충돌 방지) · `actions.js` 표시 생성·편집·전송 · `state.js` 상태·되돌리기·자동 저장
  - `layout.js` 레이아웃 모드: 이동·순서·크기·글자/간격/여백/방향/열 — 덱에 인라인 스타일로 미리보기하고 정확히 원상복구
  - `sketch.js` 새 배치 스케치 · `anchor.js` 위치 기록·재부착 · `slides.js` 슬라이드 감지·이동 · `summary.js` 레이아웃 요약 문구
- `examples/showcase/` 영상용 예제 덱(실제 덱 엔진·디자인, `index.html` 한국어 · `en.html` 영어) · `scripts/media/` README 영상: `record.mjs`(예제 덱에서 실제 화면 녹화) → `render.mjs`(`stage.html`로 합성 → `docs/media/<lang>/*.gif`). 화면이 바뀌면 `FFMPEG=<경로> npm run media`로 다시 만든다. README 맨 위 이미지는 `npm run screenshots`(`scripts/screenshots.mjs` → `docs/hero*.png`, 제목 로고는 `docs/logo.svg`)
- `skills/redpen/SKILL.md` Claude Code·Codex 공용 스킬 — 바꾸면 `node bin/redpen.mjs setup`으로 다시 설치
- 테스트: `test/unit/*.test.mjs`(node:test), `test/e2e/run.mjs`(puppeteer-core + 설치된 Chrome)
