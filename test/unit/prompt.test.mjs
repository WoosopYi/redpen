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
  assert.match(renderRounds([round], { channel: 'pending' }), /redpen done "\/tmp\/deck\/index\.html"/);
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

test('formatSource / where helpers', () => {
  assert.match(formatSource({ status: 'notfound', total: 0, hits: [] }), /못 찾음/);
  assert.match(formatSource({ status: 'guess', total: 3, pick: 1, hits: [{ file: 'a', line: 1 }, { file: 'a', line: 9, endLine: 11 }] }), /`a:9-11` \(같은 문구 3곳 중 2번째로 추정\)/);
  assert.equal(where({ x: 0.7, y: 0.7, w: 0.2, h: 0.2 }), '오른쪽 아래');
  assert.equal(where({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }), '가운데');
  assert.equal(where({ x: 0.4, y: 0.05, w: 0.2, h: 0.1 }), '위쪽 가운데');
});
