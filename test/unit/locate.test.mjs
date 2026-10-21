import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { textPattern, findText, findElement, findSlide, loadSources, annotate } from '../../src/locate.mjs';

const file = (rel, text) => ({ rel, text, lines: null });

test('textPattern matches rendered text across tags, entities and whitespace', () => {
  const re = textPattern('중요합니다 그리고 A & B');
  assert.ok(re.test('<b>중요</b>합니다\n      그리고 A &amp; B'));
  re.lastIndex = 0;
  assert.ok(textPattern('이우섭 Architectural').test('<strong>이우섭</strong><br>Architectural'));
  assert.ok(textPattern('“인용”').test('&ldquo;인용&rdquo;'));
  assert.ok(textPattern('a · b').test('a &middot; b'));
  assert.equal(textPattern('   '), null);
});

test('textPattern stays fast on long, repetitive input (no catastrophic backtracking)', () => {
  const haystack = `${'<span>가</span> '.repeat(20000)}끝`;
  const t0 = Date.now();
  const re = textPattern('가 가 가 가 가 가 가 가 가 가 나');
  re.test(haystack);
  assert.ok(Date.now() - t0 < 1500, `took ${Date.now() - t0}ms`);
});

test('findText reports exact, ambiguous and order-guessed hits with line numbers', () => {
  const files = [
    file('index.html', '<h1>제목</h1>\n<p>반복 문구</p>\n'),
    file('slides.js', 'const a = `반복 문구`;\nconst b = `유일한 문장`;\nconst c = `반복 문구`;\n'),
  ];
  const exact = findText(files, '유일한 문장');
  assert.equal(exact.status, 'exact');
  assert.deepEqual(exact.hits[0], { file: 'slides.js', line: 2, endLine: 2 });

  const amb = findText(files, '반복 문구');
  assert.equal(amb.status, 'ambiguous');
  assert.equal(amb.total, 3);

  const guess = findText(files, '반복 문구', { occurrence: 1, domCount: 3 });
  assert.equal(guess.status, 'guess');
  assert.equal(guess.hits[guess.pick].file, 'slides.js');
  assert.equal(guess.hits[guess.pick].line, 1);

  assert.equal(findText(files, '없는 문장').status, 'notfound');
});

test('findText spans multiple lines for long selections', () => {
  const para = Array.from({ length: 30 }, (_, i) => `${i + 1}번째 문장입니다.`).join(' ');
  const files = [file('a.html', `<p>\n${para.slice(0, 120)}\n${para.slice(120)}\n</p>`)];
  const r = findText(files, para);
  assert.equal(r.status, 'exact');
  assert.equal(r.hits[0].line, 2);
  assert.equal(r.hits[0].endLine, 3);
});

test('findElement uses id, then src suffixes (JS that prefixes asset folders), then text', () => {
  const files = [file('slides.js', 'const A = "assets/";\nfig("core/career.png");\n<div id="intro">x</div>\n')];
  assert.equal(findElement(files, { attrs: { src: 'assets/core/career.png' } }).hits[0].line, 2);
  assert.equal(findElement(files, { attrs: { id: 'intro' } }).hits[0].line, 3);
  assert.equal(findElement(files, { attrs: {}, text: 'nothing here' }).status, 'notfound');
});

test('findSlide only trusts unambiguous titles', () => {
  const files = [file('s.js', 'slide("결측치 처리")\nslide("요약")\n')];
  assert.equal(findSlide(files, { title: '결측치 처리' }).hits[0].line, 1);
  assert.equal(findSlide(files, null), null);
});

test('source hints never identify a stale slide by a regenerated positional id', () => {
  const files = [file('index.html', '<section id="slide-1"><h1>원래 대상</h1></section>\n<section id="slide-2"><h1>다른 페이지</h1></section>')];
  const hint = findSlide(files, { index: 1, id: 'slide-2', title: '원래 대상' });
  assert.equal(hint.hits[0].line, 1);
  const items = [{ target: 'slide', type: 'delete', slideMissing: true, slide: { index: 1, id: 'slide-2', title: '삭제된 대상' } }];
  assert.deepEqual(annotate(items, files), {}, 'missing targets receive no misleading source hint');
});

test('loadSources collects the deck, local scripts, imports and data JSON — not CDN or minified files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'redpen-loc-'));
  fs.writeFileSync(path.join(dir, 'index.html'), `<script src="slides.js?v=2"></script><script src="https://cdn.example.com/x.js"></script><script src="vendor.min.js"></script><script type="module" src="./app.js"></script>`);
  fs.writeFileSync(path.join(dir, 'slides.js'), 'window.S = [];');
  fs.writeFileSync(path.join(dir, 'vendor.min.js'), '/* min */');
  fs.writeFileSync(path.join(dir, 'app.js'), "import data from './data/content.js';\nfetch('deck.json');");
  fs.mkdirSync(path.join(dir, 'data'));
  fs.writeFileSync(path.join(dir, 'data', 'content.js'), 'export default 1;');
  fs.writeFileSync(path.join(dir, 'deck.json'), '{}');
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  const rels = loadSources(path.join(dir, 'index.html')).map((f) => f.rel).sort();
  assert.deepEqual(rels, ['app.js', 'data/content.js', 'deck.json', 'index.html', 'slides.js']);
});

test('annotate attaches source hints to items and per-slide hints', () => {
  const files = [file('slides.js', 'slide("요약", `<li>좋은 질문이 좋은 분석을 만든다</li>`)\n')];
  const items = [{ type: 'delete', target: 'text', text: { exact: '좋은 질문이 좋은 분석을 만든다', occurrence: 0, domCount: 1 }, slide: { index: 3, title: '요약' } }];
  const slides = annotate(items, files);
  assert.equal(items[0].source.status, 'exact');
  assert.equal(slides[3].hits[0].file, 'slides.js');
});

test('captured slide identities do not guess duplicate source locations from stale DOM order', () => {
  const files = [file('slides.js', 'slide("B", "반복 문구")\nslide("C", "반복 문구")')];
  const items = [{ target: 'text', text: { exact: '반복 문구', occurrence: 0, domCount: 2 }, slide: { index: 0, title: 'C', anchor: { titleUnique: true } } }];
  annotate(items, files);
  assert.equal(items[0].source.status, 'ambiguous');
  assert.equal(items[0].source.pick, undefined, 'the C mark cannot receive B as a guessed source');
});
