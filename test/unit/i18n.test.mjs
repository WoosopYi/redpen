import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import en from '../../src/client/i18n/en.js';
import { tr, setLang, lang, withLang, pick } from '../../src/client/i18n/index.js';
import { renderRounds, where } from '../../src/prompt.mjs';
import { normLang, explicitLang } from '../../src/lang.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const HANGUL = /\p{Script=Hangul}/u;

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === 'i18n' ? [] : sourceFiles(p);
    return /\.(m?js)$/.test(d.name) ? [p] : [];
  });
}

test('every Korean text in the code has an English entry', () => {
  const missing = [];
  for (const file of sourceFiles(path.join(ROOT, 'src'))) {
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // comments
      for (const m of line.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)) {
        const key = m[1].replace(/\\n/g, '\n').replace(/\\'/g, "'");
        if (HANGUL.test(key) && !(key in en)) missing.push(`${path.relative(ROOT, file)}:${i + 1}  ${key}`);
      }
    });
  }
  assert.deepEqual(missing, [], `add these to src/client/i18n/en.js:\n${missing.join('\n')}`);
});

test('tr fills placeholders once, supports function entries and falls back to Korean', () => {
  setLang('ko');
  assert.equal(tr('슬라이드 {n}', { n: 3 }), '슬라이드 3');
  setLang('en');
  try {
    assert.equal(lang(), 'en');
    assert.equal(tr('슬라이드 {n}', { n: 3 }), 'Slide 3');
    assert.equal(tr('{n}개', { n: 1 }), '1 item');
    assert.equal(tr('{n}개', { n: 4 }), '4 items');
    assert.equal(tr('순서: {from}번째 → {to}번째', { from: 2, to: 11 }), 'Order: 2nd → 11th');
    assert.equal(tr('대상: {path}', { path: '{n} literally' }), 'File: {n} literally', 'filled-in values are not scanned again');
    assert.equal(tr('아직 번역 없는 문장'), '아직 번역 없는 문장');
    assert.equal(withLang('ko', () => tr('닫기')), '닫기');
    assert.equal(tr('닫기'), 'Close', 'withLang restores the language');
    assert.equal(pick({ ko: '가', en: 'A' }), 'A');
    assert.equal(where({ x: 0.7, y: 0.7, w: 0.2, h: 0.2 }), 'bottom right');
  } finally {
    setLang('ko');
  }
  setLang('fr');
  assert.equal(lang(), 'ko', 'unknown languages fall back to Korean');
});

const round = (lang) => ({
  round: 3,
  lang,
  deck: { path: '/tmp/deck/index.html', slideSelector: '.slide', slideCount: 6, sourceFiles: ['index.html', 'slides.js'] },
  deckComment: 'Bigger text everywhere',
  slideSources: { 2: { status: 'exact', total: 1, hits: [{ file: 'slides.js', line: 40 }] } },
  items: [
    { n: 1, type: 'delete', target: 'text', slide: { index: 2, title: 'Intro' }, text: { exact: 'very', prefix: 'is ', suffix: ' good', spans: true }, source: { status: 'notfound', total: 0, hits: [] } },
    { n: 2, type: 'replace', target: 'text', slide: { index: 2, title: 'Intro' }, text: { exact: '2023', prefix: '', suffix: '' }, replacement: '2024', comment: 'the table too', orphan: true },
    { n: 3, type: 'comment', target: 'element', slide: { index: 2 }, comment: 'add an icon', element: { tag: 'img', startTag: '<img src="a.png">', box: { x: 0.1, y: 0.6, w: 0.4, h: 0.3 } }, source: { status: 'ambiguous', total: 9, hits: Array.from({ length: 8 }, (_, i) => ({ file: 's.js', line: i + 1 })) } },
    { n: 4, type: 'comment', target: 'region', slide: { index: 2 }, comment: 'diagram', region: { x: 0.6, y: 0.1, w: 0.3, h: 0.3, overlaps: [{ tag: 'p', text: 'hello' }] } },
    { n: 5, type: 'delete', target: 'element', slide: { index: 3 }, element: { tag: 'div', text: 'old' } },
    { n: 6, type: 'comment', target: 'slide', slide: { index: 3, startTag: '<section class="slide">' }, comment: 'split it' },
    { n: 7, type: 'delete', target: 'slide', slide: { index: 5, startTag: '<section class="slide">' } },
    {
      n: 8, type: 'layout', target: 'element', slide: { index: 2 }, element: { tag: 'h2', text: 'Title' },
      layout: {
        from: { x: 0.1, y: 0.1, w: 0.4, h: 0.1 }, to: { x: 0.3, y: 0.2, w: 0.6, h: 0.12 }, fit: 'box', snaps: ['aligned to the slide\'s left edge'],
        gap: { from: 40, to: 50 }, padding: { from: [32, 32, 32, 32], to: [24, 16, 24, 16] }, font: { from: 30, to: 24 },
        ctx: { parent: { tag: 'div', selector: 'div.row', display: 'flex', direction: 'column', count: 3 }, index: 0 },
      },
    },
    { n: 9, type: 'layout', target: 'element', slide: { index: 2 }, element: { tag: 'div' }, layout: { from: { x: 0.5, y: 0.4, w: 0.4, h: 0.4 }, to: { x: 0.5, y: 0.4, w: 0.3, h: 0.3 }, fit: 'scale', reorder: { from: 0, to: 1, count: 2, after: '“Card”' } } },
    { n: 10, type: 'layout', target: 'sketch', slide: { index: 4 }, sketch: { boxes: [{ x: 0.05, y: 0.3, w: 0.45, h: 0.6, label: 'Big photo', inside: [] }, { x: 0.55, y: 0.3, w: 0.4, h: 0.6, label: '' }] } },
    { n: 11, type: 'layout', target: 'slide', slide: { index: 4, startTag: '<section>' }, move: { from: 4, to: 5, total: 6, after: 'Q&A' } },
  ],
});

test('an English round renders a fully English prompt', () => {
  for (const channel of ['wait', 'pending', 'clipboard']) {
    const md = renderRounds([round('en')], { channel });
    const korean = md.split('\n').filter((l) => HANGUL.test(l));
    assert.deepEqual(korean, [], `Korean left in the ${channel} prompt`);
  }
  const md = renderRounds([round('en')], { channel: 'wait' });
  assert.match(md, /^# ✒️ Redpen edit request · round 3/);
  assert.match(md, /## How to apply/);
  assert.match(md, /- Requests: 🗑 Delete 3 · ✏️ Replace 1 · 💬 Comment 3 · 📐 Layout 4 · 📌 deck-wide instruction 1/);
  assert.match(md, /- Original: `very` \(the selection spans several tags\)/);
  assert.match(md, /- New: `2024`/);
  assert.match(md, /Source: exact text not found/);
  assert.match(md, /Source candidates: .* and 3 more/);
  assert.match(md, /- Area: top right of the slide \(x 60–90%, y 10–40%\)/);
  assert.match(md, /- Now: top left of the slide \(x 10–50%, y 10–20%\) · the 1st of 3 slots in `div\.row` \(flex · column\)/);
  assert.match(md, /Box size: width 40% → 60%, height 10% → 12%/);
  assert.match(md, /Order: 1st → 2nd — after “Card”/);
  assert.match(md, /Size: scale down to 75%/);
  assert.match(md, /1\. "Big photo" — middle left \(x 5–50%, y 30–90%\) · there now: empty space/);
  assert.match(md, /2\. \(unnamed box\)/);
  assert.match(md, /Move this slide to \*\*position 6\*\* \(now 5 of 6 — at the very end \(after “Q&A”\)\)/);
  assert.match(md, /## When you are done/);
});

test('rounds keep the language they were sent in; old rounds are Korean', () => {
  assert.match(renderRounds([round('ko')]), /^# ✒️ 빨간펜 수정 요청 · 3차/);
  const { lang: _, ...old } = round('ko');
  assert.match(renderRounds([old]), /빨간펜 수정 요청/);
  assert.match(renderRounds([round('ko')], { lang: 'en' }), /Redpen edit request/, 'an explicit lang wins');
});

test('language names and the --lang / REDPEN_LANG precedence', () => {
  assert.equal(normLang('ko_KR.UTF-8'), 'ko');
  assert.equal(normLang('en-US'), 'en');
  assert.equal(normLang('Korean'), 'ko');
  assert.equal(normLang('ja'), null);
  const saved = process.env.REDPEN_LANG;
  try {
    process.env.REDPEN_LANG = 'en';
    assert.equal(explicitLang(undefined), 'en');
    assert.equal(explicitLang('ko'), 'ko', 'the flag beats the environment');
    delete process.env.REDPEN_LANG;
    assert.equal(explicitLang(undefined), null);
    assert.throws(() => explicitLang('fr'), /ko \| en/);
  } finally {
    if (saved === undefined) delete process.env.REDPEN_LANG;
    else process.env.REDPEN_LANG = saved;
  }
});

test('the CLI speaks English with REDPEN_LANG=en', () => {
  const run = (env) => spawnSync(process.execPath, [path.join(ROOT, 'bin', 'redpen.mjs'), '--help'], { encoding: 'utf8', env: { ...process.env, ...env } });
  const enHelp = run({ REDPEN_LANG: 'en' }).stdout;
  assert.match(enHelp, /a red pen for HTML slides/);
  assert.ok(!HANGUL.test(enHelp), 'no Korean in the English help');
  assert.match(run({ REDPEN_LANG: 'ko' }).stdout, /빨간펜 리뷰/);
});
