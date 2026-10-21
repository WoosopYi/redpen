import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderRounds, formatSource, where } from '../../src/prompt.mjs';

const round = {
  round: 2,
  createdAt: 0,
  deck: { path: '/tmp/deck/index.html', slideSelector: '.slide', slideCount: 12, sourceFiles: ['index.html', 'slides.js'] },
  deckComment: '전체적으로 글자를 키워줘',
  slideSources: { 2: { status: 'exact', total: 1, hits: [{ file: 'slides.js', line: 40, endLine: 40 }] } },
  items: [
    {
      n: 1, type: 'delete', target: 'text', slide: { index: 2, total: 12, title: '결측치 처리' },
      text: { exact: '그리고 이것은 매우 중요합니다.', prefix: '처리합니다. ', suffix: ' 다음으로', spans: false },
      selector: 'div#deck > section.slide:nth-of-type(3) > p', source: { status: 'exact', total: 1, hits: [{ file: 'slides.js', line: 42, endLine: 42 }] },
    },
    {
      n: 2, type: 'replace', target: 'text', slide: { index: 2, title: '결측치 처리' }, replacement: '2024년',
      text: { exact: '2023년', prefix: '', suffix: ' 기준' }, comment: '표 제목도 같이',
    },
    {
      n: 3, type: 'comment', target: 'region', slide: { index: 2, title: '결측치 처리' }, comment: '여기에 다이어그램',
      region: { x: 0.6, y: 0.1, w: 0.3, h: 0.3, where: '오른쪽 위', overlaps: [] },
    },
    {
      n: 4, type: 'comment', target: 'element', slide: { index: 5, title: '요약' }, comment: '줄 1\n줄 2',
      element: { tag: 'img', startTag: '<img src="a.png">', text: '', box: { x: 0.1, y: 0.6, w: 0.4, h: 0.3 }, selector: 'img' },
      source: { status: 'ambiguous', total: 9, hits: Array.from({ length: 8 }, (_, i) => ({ file: 'slides.js', line: i + 1, endLine: i + 1 })) },
    },
    { n: 5, type: 'delete', target: 'slide', slide: { index: 7, title: 'Q&A', startTag: '<section class="slide">' } },
  ],
};

test('renders a complete, ordered prompt', () => {
  const md = renderRounds([round], { channel: 'wait' });
  assert.match(md, /^# ✒️ 빨간펜 수정 요청 · 2차/);
  assert.match(md, /대상 파일: `\/tmp\/deck\/index\.html`/);
  assert.match(md, /내용이 들어 있는 소스: `index\.html`, `slides\.js`/);
  assert.match(md, /문서 순서상 `\.slide` 요소 \(총 12장\)/);
  assert.match(md, /요청: 🗑 삭제 2 · ✏️ 수정 1 · 💬 코멘트 2 · 📌 전체 지시 1/);
  assert.match(md, /## 📌 전체 지시사항\n\n> 전체적으로 글자를 키워줘/);
  assert.match(md, /## 슬라이드 3 · 「결측치 처리」\n슬라이드 위치 참고: `slides\.js:40` 부근/);
  assert.match(md, /- 원문: `그리고 이것은 매우 중요합니다\.`/);
  assert.match(md, /- 문맥: …처리합니다\. ⟦그리고 이것은 매우 중요합니다\.⟧ 다음으로…/);
  assert.match(md, /소스: `slides\.js:42`/);
  assert.match(md, /- 변경: `2024년`\n/);
  assert.match(md, /- \*\*메모:\*\* 표 제목도 같이/);
  assert.match(md, /영역: 슬라이드 오른쪽 위 \(가로 60–90%, 세로 10–40%\)/);
  assert.match(md, /영역 안 요소: 없음 \(빈 공간\)/);
  assert.match(md, /- \*\*지시:\*\*\n  > 줄 1\n  > 줄 2/);
  assert.match(md, /소스 후보: .* 외 3곳/);
  assert.match(md, /## 슬라이드 8 · 「Q&A」[\s\S]*슬라이드 통째로 삭제[\s\S]*이 슬라이드 전체를 지우세요/);
  assert.match(md, /redpen wait "\/tmp\/deck\/index\.html" --reply/);
  // slide groups appear in order
  assert.ok(md.indexOf('## 슬라이드 3') < md.indexOf('## 슬라이드 6') && md.indexOf('## 슬라이드 6') < md.indexOf('## 슬라이드 8'));
});

test('closing instructions depend on how the prompt is delivered', () => {
  for (const channel of ['wait', 'pending']) {
    const md = renderRounds([round], { channel });
    assert.match(md, /redpen wait "\/tmp\/deck\/index\.html" --reply/, `${channel} resumes automatic receiving`);
    assert.match(md, /exec_command[\s\S]*session_id[\s\S]*write_stdin/, `${channel} explains how Codex keeps waiting`);
    const commands = [...md.matchAll(/`(redpen (?:wait|done) [^`]+)`/g)].map((m) => m[1]);
    assert.equal(commands.length, 2);
    assert.match(commands[1], /^redpen done .* --stop$/, 'ending the review is a separate, explicit action');
  }
  assert.match(renderRounds([round], { channel: 'file' }), /redpen done "\/tmp\/deck\/index\.html"/);
  const clip = renderRounds([round], { channel: 'clipboard' });
  assert.doesNotMatch(clip, /redpen (wait|done)/);
  assert.match(clip, /요약해 주세요/);
});

test('code spans survive backticks and long text is shortened in the middle', () => {
  const r = structuredClone(round);
  r.items = [{ n: 1, type: 'delete', target: 'text', slide: { single: true }, text: { exact: 'use `npm` now', prefix: '', suffix: '' } }];
  assert.match(renderRounds([r]), /원문: ``\s?use `npm` now\s?``/);
  r.items[0].text.exact = '가'.repeat(1000);
  assert.match(renderRounds([r]), /…\(중략, 총 1000자\)…/);
  assert.match(renderRounds([r]), /## 페이지/);
});

test('multiple rounds share one set of rules', () => {
  const md = renderRounds([round, { ...round, round: 3 }], { channel: 'wait' });
  assert.equal(md.match(/## 반영 규칙/g).length, 1);
  assert.match(md, /· 3차/);
});

test('deleted slide marks cannot share a target group or deletion directive with a renumbered survivor', () => {
  const r = {
    round: 1, deck: { path: '/tmp/deck/index.html' },
    items: [
      { n: 1, type: 'delete', target: 'slide', slideMissing: true, orphan: true, slide: { index: 1, title: '삭제된 원래 페이지', anchor: { text: '이전 페이지 본문' } } },
      { n: 2, type: 'delete', target: 'slide', slide: { index: 1, title: '지금의 다른 페이지', anchor: { text: '다른 페이지 본문' } } },
    ],
  };
  const md = renderRounds([r]);
  assert.equal((md.match(/## 슬라이드 2/g) || []).length, 2, 'same old number does not merge different slide identities');
  assert.equal((md.match(/- 이 슬라이드 전체를 지우세요\./g) || []).length, 1, 'missing targets have no actionable deletion directive');
  assert.match(md, /같은 번호의 다른 슬라이드에 적용하지 말고/);
  assert.match(md, /표시 당시 슬라이드 내용: `이전 페이지 본문`/);
  const en = renderRounds([{ ...r, lang: 'en' }]);
  assert.match(en, /Do not apply this item to another slide/);
  assert.equal(/\p{Script=Hangul}/u.test(en.replace(/삭제된 원래 페이지|이전 페이지 본문|지금의 다른 페이지|다른 페이지 본문/g, '')), false);
});

test('formatSource / where helpers', () => {
  assert.match(formatSource({ status: 'notfound', total: 0, hits: [] }), /못 찾음/);
  assert.match(formatSource({ status: 'guess', total: 3, pick: 1, hits: [{ file: 'a', line: 1 }, { file: 'a', line: 9, endLine: 11 }] }), /`a:9-11` \(같은 문구 3곳 중 2번째로 추정\)/);
  assert.equal(where({ x: 0.7, y: 0.7, w: 0.2, h: 0.2 }), '오른쪽 아래');
  assert.equal(where({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }), '가운데');
  assert.equal(where({ x: 0.4, y: 0.05, w: 0.2, h: 0.1 }), '위쪽 가운데');
});

test('layout marks become before → after instructions with their layout context', () => {
  const r = {
    round: 4,
    deck: { path: '/tmp/deck/index.html', slideSelector: '.slide', slideCount: 6 },
    items: [
      {
        n: 1, type: 'layout', target: 'element', slide: { index: 2, title: '생성형 AI란' },
        element: { tag: 'div', startTag: '<div class="card">', text: '조심할 일 최신 정보', selector: 'div.cols > div.card:nth-of-type(2)' },
        layout: {
          from: { x: 0.51, y: 0.37, w: 0.43, h: 0.48 },
          to: { x: 0.06, y: 0.37, w: 0.473, h: 0.528 },
          fit: 'scale',
          snaps: ['슬라이드 가로 가운데에 맞춤'],
          reorder: { from: 1, to: 0, count: 2, before: '「잘하는 일」', after: null },
          font: { from: 24, to: 29 },
          gap: { from: 40, to: 50 },
          padding: { from: [32, 32, 32, 32], to: [24, 24, 24, 24] },
          direction: { from: 'row', to: 'column' },
          columns: { from: 2, to: 3 },
          ctx: { display: 'block', parent: { tag: 'div', selector: 'div#stage > section.slide:nth-of-type(3) > div.cols', display: 'grid', columns: 2, count: 2 }, index: 1 },
        },
        source: { status: 'exact', total: 1, hits: [{ file: 'index.html', line: 63, endLine: 63 }] },
      },
      {
        n: 2, type: 'layout', target: 'element', slide: { index: 2, title: '생성형 AI란' },
        element: { tag: 'h2', startTag: '<h2>', text: '제목' },
        layout: { from: { x: 0.1, y: 0.1, w: 0.4, h: 0.1 }, to: { x: 0.3, y: 0.1, w: 0.6, h: 0.12 }, fit: 'box', snaps: [], ctx: {} },
      },
      {
        n: 3, type: 'layout', target: 'sketch', slide: { index: 2, title: '생성형 AI란' }, comment: '사진을 크게',
        sketch: { boxes: [
          { x: 0.05, y: 0.3, w: 0.45, h: 0.6, label: '큰 사진', where: '왼쪽 가운데', inside: [{ tag: 'div', text: '잘하는 일 초안 작성, 요약, 번역, 아이디어 확장, 형식 바꾸기' }] },
          { x: 0.55, y: 0.3, w: 0.4, h: 0.6, label: '', where: '오른쪽 가운데', inside: [] },
        ] },
      },
      { n: 4, type: 'layout', target: 'slide', slide: { index: 4, title: '정리', startTag: '<section class="slide">' }, move: { from: 4, to: 0, total: 6, before: '표지', after: null } },
    ],
  };
  const md = renderRounds([r], { channel: 'pending' });
  assert.match(md, /요청: 📐 레이아웃 4/);
  assert.match(md, /5\. 📐 \*\*레이아웃\*\*/);
  assert.match(md, /### #1 📐 레이아웃 변경 · 요소 `<div>`/);
  assert.match(md, /- 지금: 슬라이드 오른쪽 가운데 \(가로 51–94%, 세로 37–85%\) · `section\.slide:nth-of-type\(3\) > div\.cols` \(grid · 2열\) 안의 2번째 칸 \(전체 2칸\)/);
  assert.match(md, /- 순서: 2번째 → 1번째 — 「잘하는 일」 앞으로/);
  assert.doesNotMatch(md.split('### #2')[0], /- 위치: 슬라이드 .*로 옮기기/, 'with a new order, the position follows from the order');
  assert.match(md, /- 크기: 110%로 키우기 — 비율 유지 \(너비 43% → 47%\)/);
  assert.match(md, /- 맞춤: 슬라이드 가로 가운데에 맞춤/);
  assert.match(md, /- 글자 크기: 24px → 29px \(\+21%\)/);
  assert.match(md, /간격\(gap\): 40px → 50px/);
  assert.match(md, /안쪽 여백\(padding\): 32px → 24px/);
  assert.match(md, /배치: 가로로 늘어놓기\(row\) → 세로로 쌓기\(column\)/);
  assert.match(md, /열 수: 2열 → 3열/);
  assert.match(md, /- 위치: DOM `div\.cols > div\.card:nth-of-type\(2\)` · 소스: `index\.html:63`/);
  assert.match(md, /### #2[\s\S]*- 위치: 슬라이드 .*로 옮기기[\s\S]*- 상자 크기: 너비 40% → 60%, 높이 10% → 12%/);
  assert.match(md, /### #3 📐 새 배치 스케치[\s\S]*1\. "큰 사진" — 왼쪽 가운데 \(가로 5–50%, 세로 30–90%\) · 지금 그 자리: `<div>` "잘하는 일 초안 작성, 요약, 번역, 아이디어 확장,…"/);
  assert.match(md, /2\. \(이름 없는 칸\) — 오른쪽 가운데 .* · 지금 그 자리: 빈 공간/);
  assert.match(md, /- \*\*메모:\*\* 사진을 크게/);
  assert.match(md, /### #4 📐 슬라이드 순서 옮기기\n- 이 슬라이드를 \*\*1번째\*\*로 옮기세요 \(지금 5번째, 전체 6장 — 지금의 「표지」 앞\)\./);
});
