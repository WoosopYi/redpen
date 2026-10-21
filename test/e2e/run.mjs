// End-to-end test: drives the real review UI in Chrome against the example decks, plays the AI side
// with `redpen wait` / `redpen done`, and checks what the agent receives.
//   npm run test:e2e            (CHROME_PATH=... to override the browser, HEADFUL=1 to watch)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const BIN = path.join(ROOT, 'bin', 'redpen.mjs');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'redpen-e2e-'));
const CHROME = process.env.CHROME_PATH || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].find((p) => fs.existsSync(p));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
let step = 0;
function check(cond, label, detail) {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.log(`  ✗ ${label}${detail !== undefined ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  }
}
const title = (t) => console.log(`\n[${++step}] ${t}`);

function copyExample(name) {
  const dst = path.join(OUT, name);
  fs.cpSync(path.join(ROOT, 'examples', name), dst, { recursive: true, filter: (p) => !p.includes('.redpen') });
  return path.join(dst, 'index.html');
}

process.env.REDPEN_HOME = OUT; // keep the user's "last opened deck" untouched
process.env.REDPEN_LANG = 'ko'; // Korean UI unless a scenario asks for --lang en

const opened = new Set();
function cli(...args) {
  if (args[0] === 'open') opened.add(args[1]);
  return execFileSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });
}

function startWait(deck, extra = []) {
  const child = spawn(process.execPath, [BIN, 'wait', deck, ...extra], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  const done = new Promise((resolve) => child.on('exit', (code) => resolve({ code, stdout, stderr })));
  return { child, done };
}

async function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, reject) => { t = setTimeout(() => reject(new Error(`timeout: ${label}`)), ms); });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(t);
  }
}

// ---- page helpers --------------------------------------------------------------------

function helpers(page) {
  const shadow = (sel) => page.evaluate((s) => {
    const el = document.getElementById('__redpen-host')?.shadowRoot?.querySelector(s);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height, visible: cs.display !== 'none' && cs.visibility !== 'hidden' && b.width > 0, text: el.textContent };
  }, sel);
  const shadowAll = (sel) => page.evaluate((s) => [...(document.getElementById('__redpen-host')?.shadowRoot?.querySelectorAll(s) || [])].map((el) => el.textContent), sel);
  const clickShadow = async (sel) => {
    const b = await shadow(sel);
    if (!b?.visible) throw new Error(`not visible: ${sel}`);
    await page.mouse.click(b.x, b.y);
    await sleep(150);
  };
  const clickShadowText = async (sel, text) => {
    const b = await page.evaluate((s, t) => {
      const el = [...document.getElementById('__redpen-host').shadowRoot.querySelectorAll(s)].find((e) => e.textContent.includes(t));
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, sel, text);
    if (!b) throw new Error(`not found: ${sel} "${text}"`);
    await page.mouse.click(b.x, b.y);
    await sleep(150);
  };
  /** Rect of a text inside the visible slide (start of `from` to end of `to`). */
  const textRect = (from, to = from) => page.evaluate((a, b) => {
    const visible = [...document.querySelectorAll('.slide')].find((s) => getComputedStyle(s).visibility !== 'hidden' && Number(getComputedStyle(s).opacity) > 0.5) || document.body;
    const find = (t, end) => {
      const w = document.createTreeWalker(visible, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const i = n.data.indexOf(t);
        if (i < 0) continue;
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + t.length);
        const rects = [...r.getClientRects()];
        const rr = end ? rects[rects.length - 1] : rects[0];
        return { x: end ? rr.right : rr.left, y: rr.top + rr.height / 2 };
      }
      return null;
    };
    const s = find(a, false);
    const e = find(b, true);
    return s && e ? { x0: s.x, y0: s.y, x1: e.x, y1: e.y } : null;
  }, from, to);
  const dragSelect = async (from, to) => {
    const r = await textRect(from, to);
    if (!r) throw new Error(`text not on screen: ${from}`);
    await page.mouse.move(r.x0 + 1, r.y0);
    await page.mouse.down();
    await page.mouse.move((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, { steps: 4 });
    await page.mouse.move(r.x1 - 1, r.y1, { steps: 6 });
    await page.mouse.up();
    await sleep(300);
  };
  const items = () => page.evaluate(() => window.__redpen.S.items.map((it) => ({
    type: it.type, target: it.target, exact: it.text?.exact, replacement: it.replacement, comment: it.comment,
    slide: it.slide?.index, orphan: !!it._orphan, live: !!(it._range || it._el || it._slide),
  })));
  const activeSlide = () => page.evaluate(() => [...document.querySelectorAll('.slide')].findIndex((s) => s.classList.contains('active') || s.classList.contains('is-active')));
  const pressMod = async (key, shift = false) => {
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.down(mod);
    if (shift) await page.keyboard.down('Shift');
    await page.keyboard.press(key);
    if (shift) await page.keyboard.up('Shift');
    await page.keyboard.up(mod);
    await sleep(150);
  };
  const closePanel = async () => {
    if (await page.evaluate(() => window.__redpen.S.panelOpen)) await clickShadow('.bar .tb:not(.send):not(.hide-paused):not([data-mode])');
    await sleep(300);
  };
  const openPanel = async () => {
    if (!(await page.evaluate(() => window.__redpen.S.panelOpen))) await clickShadow('.bar .tb:not(.send):not(.hide-paused):not([data-mode])');
    await sleep(300);
  };
  const shot = async (name) => {
    const file = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: file });
    console.log(`    📸 ${file}`);
  };
  return { shadow, shadowAll, clickShadow, clickShadowText, textRect, dragSelect, items, activeSlide, pressMod, openPanel, closePanel, shot };
}

async function openPage(browser, url) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('redpen:onboarded', '1');
    if (!sessionStorage.getItem('rp-test-coach')) localStorage.setItem('redpen:layout-tip', '1');
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__redpenStarted && window.__redpen && document.getElementById('__redpen-host')?.shadowRoot?.querySelector('.bar'));
  await sleep(500);
  return { page, errors };
}

// ---- scenario 1: single-file deck ------------------------------------------------------

async function basicDeck(browser) {
  const deck = copyExample('basic');
  const out = cli('open', deck, '--no-open', '--port', '0');
  const url = /(http:\/\/localhost:\d+\/\S+)/.exec(out)[1];
  console.log(`\n=== basic deck: ${url}`);
  const { page, errors } = await openPage(browser, `${url}#3`);
  const $ = helpers(page);

  title('slide detection');
  const det = await page.evaluate(() => ({ n: window.__redpen.getSlides().els.length, sel: window.__redpen.getSlides().selector }));
  check(det.n === 6 && det.sel === '.slide', 'detects 6 `.slide` slides', det);
  check(await $.activeSlide() === 2, 'deck opened on slide 3 via #3');

  title('drag-select → selection bar → D marks deletion (click-to-advance deck must not advance)');
  await $.dragSelect('그리고 이것은 매우 중요합니다.');
  const bar = await $.shadow('.selbar');
  check(bar?.visible, 'selection bar appears');
  check(await $.activeSlide() === 2, 'slide did not advance on the drag-click');
  await page.keyboard.press('KeyD');
  await sleep(200);
  let list = await $.items();
  check(list.length === 1 && list[0].type === 'delete' && list[0].exact === '그리고 이것은 매우 중요합니다.', 'delete mark with exact text', list);
  check(!(await $.shadow('.selbar'))?.visible, 'selection bar hides after acting');
  const hl = await page.evaluate(() => CSS.highlights.get('redpen-delete')?.size);
  check(hl === 1, 'text is painted with the delete highlight', hl);

  title('replace via the selection bar button');
  await $.dragSelect('초안 작성');
  await $.clickShadow('.selbar .r');
  check((await $.shadow('.pop textarea'))?.visible, 'editor opens');
  await page.keyboard.type('초안 쓰기');
  await page.keyboard.press('Enter');
  await sleep(200);
  list = await $.items();
  const rep = list.find((i) => i.type === 'replace');
  check(rep && rep.exact === '초안 작성' && rep.replacement === '초안 쓰기', 'replace mark keeps original and replacement', rep);

  title('comment with the C shortcut (Korean input, Enter saves)');
  await $.dragSelect('잘하는 일');
  await page.keyboard.press('KeyC');
  await sleep(150);
  await page.keyboard.type('제목을 "AI가 잘하는 일"로 바꿔줘');
  await page.keyboard.press('Enter');
  await sleep(200);
  list = await $.items();
  check(list.some((i) => i.type === 'comment' && i.exact === '잘하는 일' && i.comment.includes('AI가 잘하는 일')), 'comment mark saved');

  title('clicking a pin reopens the mark with its text');
  const pins = await page.evaluate(() => [...document.getElementById('__redpen-host').shadowRoot.querySelectorAll('.pin.t-comment')]
    .map((p) => { const r = p.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }));
  await page.mouse.click(pins[0].x, pins[0].y);
  await sleep(250);
  const pop = await page.evaluate(() => {
    const el = document.getElementById('__redpen-host').shadowRoot.querySelector('.pop');
    return el && { value: el.querySelector('textarea').value, text: el.textContent };
  });
  check(pop?.value.includes('AI가 잘하는 일'), 'popover textarea holds the saved comment', pop?.value);
  check(pop && !/undefined|false/.test(pop.text), 'no stray undefined/false text', pop?.text);
  await page.keyboard.press('Escape');
  await sleep(150);
  check(!(await $.shadow('.pop')), 'Esc closes the popover');

  title('element mode: click a card → D deletes it');
  await $.clickShadow('.tb[data-mode="element"]');
  const cardRect = await page.evaluate(() => {
    const c = [...document.querySelectorAll('.slide.active .card')][1].getBoundingClientRect();
    return { x: c.left + 30, y: c.bottom - 20 };
  });
  await page.mouse.move(cardRect.x, cardRect.y);
  await sleep(150);
  check((await $.shadow('.hover-box'))?.visible, 'hover outline follows the pointer');
  await page.mouse.click(cardRect.x, cardRect.y);
  await sleep(200);
  check((await $.shadow('.lbar'))?.visible, 'element is selected with the layout bar');
  check(await $.activeSlide() === 2, 'clicking in element mode did not advance the slide');
  await page.keyboard.press('KeyD');
  await sleep(200);
  list = await $.items();
  const elDel = list.find((i) => i.target === 'element');
  check(elDel?.type === 'delete', 'element delete mark', elDel);

  title('region mode: draw a box → comment');
  await $.clickShadow('.tb[data-mode="region"]');
  const slideBox = await page.evaluate(() => {
    const r = document.querySelector('.slide.active').getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  const rx0 = slideBox.x + slideBox.w * 0.62;
  const ry0 = slideBox.y + slideBox.h * 0.08;
  await page.mouse.move(rx0, ry0);
  await page.mouse.down();
  await page.mouse.move(rx0 + slideBox.w * 0.3, ry0 + slideBox.h * 0.2, { steps: 8 });
  await page.mouse.up();
  await sleep(200);
  check((await $.shadow('.pop textarea'))?.visible, 'region editor opens');
  await page.keyboard.type('여기에 AI 아이콘 일러스트 추가');
  await page.keyboard.press('Enter');
  await sleep(200);
  list = await $.items();
  const reg = list.find((i) => i.target === 'region');
  check(reg?.comment === '여기에 AI 아이콘 일러스트 추가', 'region comment saved', reg);
  check(await $.activeSlide() === 2, 'region drawing did not advance the slide');
  await $.clickShadow('.tb[data-mode="text"]');

  title('slide menu: comment on the whole slide');
  await $.clickShadow('.bar .tb.hide-paused');
  await $.clickShadowText('.pop .menu button', '코멘트');
  await page.keyboard.type('카드 두 개를 세로로 배치하고 아이콘을 넣어줘');
  await page.keyboard.press('Enter');
  await sleep(200);
  list = await $.items();
  check(list.some((i) => i.target === 'slide' && i.type === 'comment' && i.slide === 2), 'slide comment saved on slide 3');
  check(list.length === 6, 'six marks so far', list.length);
  await $.clickShadow('.bar .tb:not(.send):not(.hide-paused):not([data-mode])');
  await sleep(350);
  await $.shot('basic-marks');

  title('deck buttons keep working while text is selected');
  await $.closePanel();
  await $.dragSelect('생성형 AI란 무엇인가');
  check((await $.shadow('.selbar'))?.visible, 'selection active');
  const next = await page.evaluate(() => { const r = document.getElementById('next').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.mouse.click(next.x, next.y);
  await sleep(400);
  check(await $.activeSlide() === 3, 'the deck\'s → button advanced to slide 4', await $.activeSlide());
  await page.keyboard.press('ArrowLeft');
  await sleep(400);
  check(await $.activeSlide() === 2, 'arrow key goes back to slide 3');

  title('undo / redo');
  await page.mouse.click(5, 5); // focus the page, nothing selected
  await $.pressMod('KeyZ');
  check((await $.items()).length === 5, 'undo removes the last mark');
  await $.pressMod('KeyZ', true);
  check((await $.items()).length === 6, 'redo brings it back');

  title('reload keeps the draft and re-anchors every mark');
  await sleep(600); // autosave debounce
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__redpenStarted && window.__redpen.S.items.length > 0);
  await sleep(600);
  list = await $.items();
  check(list.length === 6 && list.every((i) => i.live && !i.orphan), 'all 6 marks restored and anchored', list.map((i) => [i.target, i.live, i.orphan]));

  title('send while an agent waits: `redpen wait` receives the prompt');
  const waiter = startWait(deck);
  await page.waitForFunction(() => window.__redpen.S.agent.status === 'waiting', { timeout: 8000 }).catch(() => {});
  check(await page.evaluate(() => window.__redpen.S.agent.status) === 'waiting', 'browser shows AI 대기 중');
  await $.clickShadow('.bar .send');
  const result = await withTimeout(waiter.done, 10000, 'wait exits');
  const md = result.stdout;
  fs.writeFileSync(path.join(OUT, 'basic-round1.md'), md);
  console.log(`    📝 ${path.join(OUT, 'basic-round1.md')}`);
  check(result.code === 0, 'wait exits 0', result.code);
  check(md.includes('# ✒️ 빨간펜 수정 요청 · 1차'), 'prompt header');
  check(md.includes('## 슬라이드 3 · 「생성형 AI란」'), 'grouped under slide 3 with its title');
  check(md.includes('`그리고 이것은 매우 중요합니다.`'), 'exact deleted text');
  check(/- 변경: `초안 쓰기`/.test(md), 'replacement text');
  check(md.includes('**지시:** 제목을 "AI가 잘하는 일"로 바꿔줘'), 'comment instruction');
  check(/코멘트 · 영역[\s\S]*오른쪽 위/.test(md), 'region described as 오른쪽 위');
  check(/요소 삭제 `<div>`/.test(md), 'element deletion');
  check(/소스: `index\.html:\d+`/.test(md), 'source line hint for text');
  check(md.includes('redpen wait') && md.includes('--reply'), 'tells the agent how to report back');
  check((await $.items()).length === 0, 'browser draft cleared after sending');
  await page.waitForFunction(() => window.__redpen.S.agent.status === 'working', { timeout: 5000 }).catch(() => {});
  check(await page.evaluate(() => window.__redpen.S.agent.status) === 'working', 'browser shows AI 반영 중');

  title('agent edits the HTML → page reloads by itself; agent replies → toast');
  const html = fs.readFileSync(deck, 'utf8');
  fs.writeFileSync(deck, html.replace('그리고 이것은 매우 중요합니다. ', '').replace('초안 작성', '초안 쓰기'));
  await page.waitForFunction(() => document.body.textContent.includes('초안 쓰기'), { timeout: 8000 }).catch(() => {});
  await page.waitForFunction(() => window.__redpenStarted, { timeout: 8000 });
  check(await page.evaluate(() => document.body.textContent.includes('초안 쓰기')), 'reloaded with the edited HTML');
  await sleep(400);
  check(await $.activeSlide() === 2, 'stayed on slide 3 after reload');
  const doneOut = cli('done', deck, '--reply', '6건 모두 반영했어요. 영역에는 SVG 아이콘을 넣었습니다.');
  check(doneOut.includes('1차'), 'done attaches the reply to round 1', doneOut.trim());
  await sleep(1500);
  const toasts = await $.shadowAll('.toast');
  check(toasts.some((t) => t.includes('6건 모두 반영했어요')), 'reply shows up as a toast', toasts);
  check(await page.evaluate(() => window.__redpen.S.agent.status) === 'offline', 'AI status back to offline');
  await $.shot('basic-reply');

  title('history panel lists the round with the reply');
  await $.openPanel();
  await $.clickShadowText('.tab', '보낸 기록');
  const rounds = await $.shadowAll('.round');
  check(rounds.length === 1 && rounds[0].includes('반영 완료') && rounds[0].includes('SVG 아이콘'), 'round card with status + reply', rounds);
  await $.shot('basic-history');

  title('clipboard channel: copy marks the round as handled (no agent gets it)');
  await $.clickShadowText('.tab', '작성 중');
  await page.keyboard.press('Escape'); // close the panel so the text is reachable
  await sleep(300);
  await $.dragSelect('그럴듯한 다음 단어를');
  await page.keyboard.press('KeyD');
  await sleep(500);
  check((await $.items()).length === 1, 'new mark after the first round');
  await $.openPanel();
  await $.clickShadowText('.p-foot .btn', '복사');
  await sleep(800);
  const st = JSON.parse(cli('status', deck, '--json'));
  check(st.rounds.length === 2 && st.rounds[1].delivered?.via === 'clipboard', 'round 2 delivered via clipboard', st.rounds);
  const pending = cli('pending', deck);
  check(pending.includes('대기 중인 수정 요청이 없습니다'), 'pending has nothing for the agent');

  check(errors.length === 0, 'no page errors', errors);
  await page.close();
  cli('stop', deck);
}

// ---- scenario 2: JS-built deck (content lives in slides.js) ------------------------------

async function jsDeck(browser) {
  const deck = copyExample('js-deck');
  const out = cli('open', deck, '--no-open', '--port', '0');
  const url = /(http:\/\/localhost:\d+\/\S+)/.exec(out)[1];
  console.log(`\n=== js deck: ${url}`);
  const { page, errors } = await openPage(browser, `${url}#3`);
  const $ = helpers(page);

  title('slides rendered by JS are detected; selection works despite user-select:none');
  const n = await page.evaluate(() => window.__redpen.getSlides().els.length);
  check(n === 4, '4 slides', n);
  await $.dragSelect('왜 비어 있는지');
  check((await $.shadow('.selbar'))?.visible, 'selection bar appears on a user-select:none deck');
  await page.keyboard.press('Backspace');
  await sleep(200);
  await $.dragSelect('결측치는 지우기', '확인하세요');
  await page.keyboard.press('KeyC');
  await sleep(150);
  await page.keyboard.type('이 팁을 박스 위로 올려줘');
  await page.keyboard.press('Enter');
  await sleep(200);
  const list = await $.items();
  check(list.length === 2, 'two marks', list);
  check(list[1]?.exact?.startsWith('결측치는 지우기 전에 왜 비어 있는지'), 'cross-tag selection captured as plain text', list[1]?.exact);

  title('navigating from the list jumps slides via the deck\'s own navigation');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await sleep(500);
  check(await $.activeSlide() === 0, 'moved to slide 1 with the deck keys');
  await $.openPanel();
  await $.clickShadow('.panel .row');
  await sleep(800);
  check(await $.activeSlide() === 2, 'clicking a mark in the list brought slide 3 back', await $.activeSlide());
  await page.keyboard.press('Escape');
  await sleep(200);

  title('source hints point into slides.js');
  await $.clickShadowText('.p-foot .btn', '복사');
  await sleep(800);
  const md = cli('status', deck, '--json');
  const roundFile = path.join(path.dirname(deck), '.redpen', 'index.html', 'rounds', '0001.md');
  const prompt = fs.readFileSync(roundFile, 'utf8');
  fs.writeFileSync(path.join(OUT, 'js-round1.md'), prompt);
  console.log(`    📝 ${path.join(OUT, 'js-round1.md')}`);
  const slidesJs = fs.readFileSync(path.join(path.dirname(deck), 'slides.js'), 'utf8').split('\n');
  const tipLine = slidesJs.findIndex((l) => l.includes('왜 비어 있는지')) + 1;
  check(prompt.includes(`slides.js:${tipLine}`), `points at slides.js:${tipLine}`, prompt.match(/소스[^\n]*/g));
  check(prompt.includes('내용이 들어 있는 소스') && prompt.includes('`slides.js`'), 'lists slides.js as a content source');
  check(prompt.includes('## 슬라이드 3 · 「결측치 처리」'), 'slide title from data-title');
  check(JSON.parse(md).rounds.length === 1, 'one round recorded');

  check(errors.length === 0, 'no page errors', errors);
  await page.close();
  cli('stop', deck);
}

// ---- scenario 3: tricky deck (body onclick advance, no hash navigation) -----------------------

const EDGE_DECK = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>edge</title><style>
  body { margin: 0; font: 28px/1.6 sans-serif; } .slide { position: absolute; inset: 0; padding: 60px; visibility: hidden; } .slide.on { visibility: visible; }
</style></head>
<body onclick="next()">
  <section class="slide on" data-title="첫째"><h1>좋은 프롬프트의 네 가지 요소</h1><p>첫 번째 슬라이드 본문입니다. 여기서 문장을 고칩니다.</p></section>
  <section class="slide" data-title="둘째"><h1>좋은 프롬프트 예시</h1><p>두 번째 슬라이드 본문입니다.</p></section>
  <section class="slide" data-title="셋째"><p>세 번째 슬라이드</p></section>
<script>
  let cur = 0; const S = [...document.querySelectorAll('.slide')];
  function go(i) { cur = Math.max(0, Math.min(S.length - 1, i)); S.forEach((s, k) => s.classList.toggle('on', k === cur)); }
  function next() { go(cur + 1); }
  document.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') go(cur + 1); if (e.key === 'ArrowLeft') go(cur - 1); });
</script></body></html>`;

async function edgeDeck(browser) {
  const dir = path.join(OUT, 'edge');
  fs.mkdirSync(dir, { recursive: true });
  const deck = path.join(dir, 'index.html');
  fs.writeFileSync(deck, EDGE_DECK);
  const out = cli('open', deck, '--no-open', '--port', '0');
  const url = /(http:\/\/localhost:\d+\/\S+)/.exec(out)[1];
  console.log(`\n=== edge deck: ${url}`);
  const { page, errors } = await openPage(browser, url);
  const $ = helpers(page);
  const current = () => page.evaluate(() => [...document.querySelectorAll('.slide')].findIndex((s) => s.classList.contains('on')));

  title('decks that advance on a body onclick: selecting text never advances');
  await $.dragSelect('첫 번째 슬라이드 본문');
  check(await current() === 0, 'drag-select stayed on slide 1');
  await page.keyboard.press('Escape');
  const word = await $.textRect('본문입니다');
  await page.mouse.click(word.x0 + 6, word.y0, { clickCount: 1 });
  await page.mouse.click(word.x0 + 6, word.y0, { clickCount: 2 });
  await sleep(300);
  check(await current() === 0, 'double-click on a word stayed on slide 1');
  await page.keyboard.press('Escape');
  await page.mouse.click(1000, 800); // blank area: the deck's own click-to-advance still works
  await sleep(200);
  check(await current() === 1, 'clicking blank space still advances');
  await page.keyboard.press('ArrowLeft');
  await sleep(200);

  title('after the deck moves on, selection shortcuts do not hit hidden text');
  await $.dragSelect('첫 번째');
  await page.keyboard.press('ArrowRight');
  await sleep(250);
  await page.keyboard.press('KeyD');
  await sleep(250);
  check((await $.items()).length === 0, 'D after changing slides created no mark');
  check(!(await $.shadow('.selbar'))?.visible, 'selection bar is gone');
  await page.keyboard.press('ArrowLeft');
  await sleep(250);

  title('a half-typed comment is never thrown away');
  await $.dragSelect('여기서 문장을 고칩니다');
  await page.keyboard.press('KeyC');
  await sleep(150);
  await page.keyboard.type('임시 코멘트');
  await $.clickShadow('.bar .send');
  await sleep(300);
  const pop = await page.evaluate(() => document.getElementById('__redpen-host').shadowRoot.querySelector('.pop textarea')?.value);
  check(pop === '임시 코멘트', 'editor is still open with the text', pop);
  check(JSON.parse(cli('status', deck, '--json')).rounds.length === 0, 'nothing was sent');
  await $.clickShadow('.tb[data-mode="element"]');
  check(await page.evaluate(() => window.__redpen.S.mode) === 'text', 'mode switch refused while typing');
  await page.evaluate(() => document.getElementById('__redpen-host').shadowRoot.querySelector('.pop textarea').focus());
  await page.keyboard.press('Enter');
  await sleep(250);
  check((await $.items()).some((i) => i.comment === '임시 코멘트'), 'Enter saved the comment');

  title('when the text around an unsent mark changes, it is reported lost — not moved to another slide');
  await $.dragSelect('좋은 프롬프트');
  await page.keyboard.press('KeyD');
  await sleep(700); // autosave
  fs.writeFileSync(deck, EDGE_DECK.replace('좋은 프롬프트의 네 가지 요소', '프롬프트 작성의 네 가지 요소'));
  await page.waitForFunction(() => document.body.textContent.includes('프롬프트 작성의'), { timeout: 8000 }).catch(() => {});
  await page.waitForFunction(() => window.__redpenStarted && window.__redpen.S.items.length >= 2, { timeout: 8000 }).catch(() => {});
  await sleep(500);
  const mark = (await $.items()).find((i) => i.exact === '좋은 프롬프트');
  check(mark?.orphan === true && mark.slide === 0, 'mark is lost on slide 1 instead of jumping to slide 2', mark);

  check(errors.length === 0, 'no page errors', errors);

  title('if the review server dies (not turned off), the page says so');
  process.kill(JSON.parse(cli('status', deck, '--json')).server.pid, 'SIGKILL'); // a crash: no goodbye to the tab
  await page.waitForFunction(() => !!document.getElementById('__redpen-host').shadowRoot.querySelector('.banner.status'), { timeout: 9000 }).catch(() => {});
  const warn = await $.shadow('.banner.status');
  check(warn?.visible && /연결이 끊겨/.test(warn.text), 'disconnected banner shown', warn?.text);
  await page.close();
}

// ---- scenario 4: layout editing (move · resize · order · styles · sketch · slide move) --------

async function layoutDeck(browser) {
  const deck = copyExample('basic').replace('/basic/', '/basic/'); // fresh copy per scenario
  const dir = path.join(OUT, 'layout');
  fs.cpSync(path.dirname(deck), dir, { recursive: true, filter: (p) => !p.includes('.redpen') });
  const file = path.join(dir, 'index.html');
  const out = cli('open', file, '--no-open', '--port', '0');
  const url = /(http:\/\/localhost:\d+\/\S+)/.exec(out)[1];
  console.log(`\n=== layout: ${url}`);
  const { page, errors } = await openPage(browser, `${url}#3`);
  const $ = helpers(page);
  const items = () => page.evaluate(() => window.__redpen.S.items.map((i) => ({ type: i.type, target: i.target, L: i.layout, sketch: i.sketch, move: i.move })));
  const cards = () => page.evaluate(() => [...document.querySelectorAll('.slide.active .card')].map((c) => {
    const r = c.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height, translate: c.style.translate, scale: c.style.scale, fs: parseFloat(getComputedStyle(c).fontSize) };
  }));
  const gapNow = () => page.evaluate(() => getComputedStyle(document.querySelector('.slide.active .cols')).columnGap);
  const drag = async (x0, y0, x1, y1) => {
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 5 });
    await page.mouse.move(x1, y1, { steps: 5 });
    await page.mouse.up();
    await sleep(300);
  };
  const stepper = (n, plus) => page.evaluate((n, plus) => {
    const st = [...document.getElementById('__redpen-host').shadowRoot.querySelectorAll('.lbar .lstep')][n];
    const b = st.querySelectorAll('button')[plus ? 1 : 0].getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2, off: st.classList.contains('off') };
  }, n, plus);

  title('레이아웃 mode: first-use card, hint, then click selects with handles and a layout bar');
  check((await $.shadow('.tb[data-mode="element"]'))?.text.includes('레이아웃'), 'toolbar button is called 레이아웃');
  await page.evaluate(() => localStorage.removeItem('redpen:layout-tip'));
  await $.clickShadow('.tb[data-mode="element"]');
  check((await $.shadow('.lcoach'))?.visible, 'first-use how-to card shown');
  await $.clickShadowText('.lcoach .btn', '알겠어요');
  check(!(await $.shadow('.lcoach')), 'card dismissed');
  check((await $.shadow('.lhint'))?.visible, 'hint "바꿀 요소를 클릭하세요" while nothing is selected');
  check(await page.evaluate(() => localStorage.getItem('redpen:layout-tip')) === '1', 'card shown only once');
  const c0 = await cards();
  await page.mouse.click(c0[0].x + 60, c0[0].y + c0[0].h - 40);
  await sleep(250);
  check((await $.shadow('.lbar'))?.visible, 'layout bar shown');
  check((await $.shadow('.lh[data-h="se"]'))?.visible, 'resize handles shown');
  check(!(await $.shadow('.lhint'))?.visible, 'hint hidden once something is selected');
  check(await page.evaluate(() => import('/__redpen/app/config.js').then((m) => !!m.default.build)), 'page knows which tool build it runs');

  title('drag moves the element (live preview) and records a layout mark');
  await drag(c0[0].x + 80, c0[0].y + c0[0].h - 60, c0[0].x + 110, c0[0].y + c0[0].h - 10);
  let list = await items();
  let c = await cards();
  check(list.length === 1 && list[0].type === 'layout' && list[0].L.to, 'layout mark with a target box', list);
  check(c[0].translate && Math.abs(c[0].y - c0[0].y - 50) < 6, 'card previewed ~50px lower', c[0]);

  title('dragging it back near its original spot (purple) snaps exactly home and cancels the move');
  const back = { x: c0[0].x + 5 - c[0].x, y: c0[0].y + 7 - c[0].y }; // lands 5px/7px off the original spot
  await page.mouse.move(c[0].x + 80, c[0].y + c[0].h - 60);
  await page.mouse.down();
  await page.mouse.move(c[0].x + 80 + back.x / 2, c[0].y + c[0].h - 60 + back.y / 2 - 20, { steps: 5 });
  await page.mouse.move(c[0].x + 80 + back.x, c[0].y + c[0].h - 60 + back.y, { steps: 5 });
  const during = await page.evaluate(() => {
    const root = document.getElementById('__redpen-host').shadowRoot;
    const vis = (el) => !!el && el.style.display !== 'none' && el.getBoundingClientRect().width > 0;
    return { target: vis(root.querySelector('.ltarget')), ghost: [...root.querySelectorAll('.lghost')].some(vis) };
  });
  check(during.target && during.ghost, 'original spot drawn and lit up while dragging over it', during);
  await page.mouse.up();
  await sleep(300);
  list = await items();
  c = await cards();
  check(list.length === 0 && !c[0].translate && Math.abs(c[0].y - c0[0].y) < 1 && Math.abs(c[0].x - c0[0].x) < 1, 'exactly home: the move is cancelled', { list, c: c[0] });
  check((await $.shadowAll('.toast')).some((t) => t.includes('원래 위치')), 'toast "원래 위치로 되돌렸어요"');
  await drag(c0[0].x + 80, c0[0].y + c0[0].h - 60, c0[0].x + 110, c0[0].y + c0[0].h - 10);
  check((await items()).length === 1 && Math.abs((await cards())[0].y - c0[0].y - 50) < 6, 'moved down again for the next steps');

  title('corner handle resizes proportionally; + makes the text bigger');
  const se = await $.shadow('.lh[data-h="se"]');
  await drag(se.x, se.y, se.x + 60, se.y + 40);
  c = await cards();
  list = await items();
  check(Number(c[0].scale) > 1.05 && list[0].L.fit === 'scale', 'scaled preview', { scale: c[0].scale, fit: list[0].L.fit });
  let b = await stepper(0, true);
  await page.mouse.click(b.x, b.y);
  await sleep(150);
  await page.mouse.click(b.x, b.y);
  await sleep(250);
  list = await items();
  check(list[0].L.font && list[0].L.font.to > list[0].L.font.from, 'font size mark', list[0].L.font);
  check((await cards())[0].fs > c0[0].fs, 'font previewed bigger');

  title("with something selected: Shift+arrows nudge it; plain arrows and the deck's own ← → buttons turn the page");
  const x1 = (await items())[0].L.to.x;
  await page.keyboard.down('Shift');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.up('Shift');
  await sleep(200);
  const x2 = (await items())[0].L.to.x;
  check(Math.abs(x2 - x1 - 0.005) < 0.001 && await $.activeSlide() === 2, 'Shift+→ nudged it 0.5% right, same slide', { x1, x2 });
  const other = (await cards())[1];
  await page.mouse.move(other.x + 40, other.y + 40);
  await sleep(100);
  check((await $.shadow('.hover-box'))?.visible, 'hovering the other card outlines it');
  await page.keyboard.press('ArrowRight');
  await sleep(50);
  check(!(await $.shadow('.hover-box'))?.visible, 'no stale hover outline from the previous slide');
  await sleep(250);
  check(await $.activeSlide() === 3, '→ turns the page even with an element selected');
  check(!(await $.shadow('.lsel'))?.visible, 'the selection goes away with its slide');
  check((await $.shadowAll('.toast')).some((t) => t.includes('Shift+방향키')), 'one-time tip: Shift+arrows move the element');
  await page.keyboard.press('ArrowLeft');
  await sleep(300);
  check(await $.activeSlide() === 2 && (await cards())[0].translate, '← comes back, previews intact');
  const deckButton = (id) => page.evaluate((id) => {
    const r = document.getElementById(id).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, id);
  let nb = await deckButton('next');
  await page.mouse.click(nb.x, nb.y);
  await sleep(300);
  check(await $.activeSlide() === 3 && !(await $.shadow('.lsel'))?.visible && (await items()).length === 1, "the deck's → button turns the page in 레이아웃 mode (not picked)");
  nb = await deckButton('prev');
  await page.mouse.click(nb.x, nb.y);
  await sleep(300);
  check(await $.activeSlide() === 2, "the deck's ← button too");

  title('dropping a card on the front half of its sibling changes the order');
  c = await cards();
  await drag(c[1].x + 120, c[1].y + 260, c0[0].x + 70, c0[0].y + 200);
  list = await items();
  const reo = list.find((i) => i.L?.reorder);
  check(reo && reo.L.reorder.from === 1 && reo.L.reorder.to === 0, 'reorder 2nd → 1st', reo?.L.reorder);
  check(Math.abs((await cards())[1].x - c0[0].x) < 8, 'second card previewed in the first slot');

  title('parent grid: wider gap; side handle changes only the box');
  await $.clickShadowText('.lbar .lb', '상위 요소');
  b = await stepper(1, true);
  check(!b.off, 'gap stepper enabled for the grid');
  await page.mouse.click(b.x, b.y);
  await sleep(250);
  check(await gapNow() === '50px', 'gap 40px → 50px previewed', await gapNow());
  await page.keyboard.press('Escape');
  c = await cards();
  await page.mouse.click(c[1].x + 30, c[1].y + 30); // a click picks the card (box-like), not its heading
  await sleep(200);
  const e = await $.shadow('.lh[data-h="e"]');
  await drag(e.x, e.y, e.x - 80, e.y);
  list = await items();
  const boxed = list.find((i) => i.L?.fit === 'box');
  check(boxed && boxed.L.to.w < boxed.L.from.w && boxed.L.reorder, 'box-width change on the reordered card keeps its order', boxed?.L);
  check(await page.evaluate(() => [...document.getElementById('__redpen-host').shadowRoot.querySelectorAll('.lout.fixed')]
    .some((o) => o.style.display !== 'none' && o.getBoundingClientRect().width > 0)), 'target box outline drawn');
  await page.keyboard.press('Escape');

  title('pause shows the original deck; resume brings the previews back; undo works');
  await $.clickShadow('.bar .tb.pause');
  c = await cards();
  check(!c[0].translate && !c[1].translate && await gapNow() === '40px', 'paused: deck untouched', { c, gap: await gapNow() });
  await $.clickShadow('.bar .tb.pause');
  check((await cards())[0].translate && await gapNow() === '50px', 'resumed: previews back');
  const before = (await items()).map((i) => [i.target, i.L?.fit, !!i.L?.to, !!i.L?.reorder, !!i.L?.gap, !!i.L?.font]);
  await page.mouse.click(5, 5);
  await $.pressMod('KeyZ');
  const after = (await items()).map((i) => [i.target, i.L?.fit, !!i.L?.to, !!i.L?.reorder, !!i.L?.gap, !!i.L?.font]);
  check(after.every((i) => i[1] !== 'box') && after.length === before.length && after.some((i) => i[3]), 'undo reverts the box width but keeps the new order', { before, after });

  title('slide menu: new layout sketch and moving the slide');
  await $.clickShadowText('.tb', '텍스트');
  await $.clickShadow('.bar .tb.hide-paused');
  await $.clickShadowText('.pop .menu button', '새 배치 스케치');
  const area = await page.evaluate(() => {
    const r = document.getElementById('__redpen-host').shadowRoot.querySelector('.sk-area').getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  const box = async (x0, y0, x1, y1, label) => {
    await drag(area.x + area.w * x0, area.y + area.h * y0, area.x + area.w * x1, area.y + area.h * y1);
    await page.keyboard.type(label);
    await page.keyboard.press('Enter');
  };
  await box(0.05, 0.3, 0.5, 0.9, '큰 사진');
  await box(0.55, 0.3, 0.95, 0.9, '설명 세 줄');
  await page.keyboard.press('ArrowRight'); // must not change slides while sketching
  check(await $.activeSlide() === 2, 'deck stays on the slide while sketching');
  await $.shot('layout-sketch');
  await $.clickShadowText('.skbar .btn', '완료');
  list = await items();
  const sk = list.find((i) => i.target === 'sketch');
  check(sk && sk.sketch.boxes.map((x) => x.label).join('|') === '큰 사진|설명 세 줄', 'sketch with 2 labelled boxes', sk?.sketch);
  check(await page.evaluate(() => !!document.getElementById('__redpen-host').shadowRoot.querySelector('.skview')), 'sketch drawn on the slide');

  title('a dragged element snaps to the sketch box lines (purple areas)');
  await $.clickShadow('.tb[data-mode="element"]');
  const h2 = await page.evaluate(() => {
    const r = document.querySelector('.slide.active h2').getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  const boxLeft = area.x + area.w * 0.05;
  await page.mouse.move(h2.x + 30, h2.y + h2.h / 2);
  await page.mouse.down();
  await page.mouse.move(h2.x + 20, h2.y + h2.h / 2 + 60, { steps: 5 });
  await page.mouse.move(h2.x + 30 + (boxLeft + 3 - h2.x), h2.y + h2.h / 2 + 120, { steps: 5 }); // 3px right of the box's left line
  check((await $.shadow('.ltarget'))?.visible, 'the sketch box lights up');
  await page.mouse.up();
  await sleep(300);
  const h2x = await page.evaluate(() => document.querySelector('.slide.active h2').getBoundingClientRect().left);
  const h2item = (await items()).find((i) => i.target === 'element' && i.L?.snaps?.some((s) => s.includes('스케치 칸 1')));
  check(Math.abs(h2x - boxLeft) < 1 && h2item?.L.snaps.includes('스케치 칸 1「큰 사진」 왼쪽 선에 맞춤'), 'heading lined up with sketch box 1', { h2x, boxLeft, snaps: h2item?.L.snaps });
  await page.keyboard.press('Escape');
  await $.clickShadowText('.tb', '텍스트');
  await $.clickShadow('.bar .tb.hide-paused');
  await $.clickShadowText('.pop .menu button', '순서 옮기기');
  await $.clickShadowText('.pop .btn', '맨 앞으로');
  check((await items()).some((i) => i.target === 'slide' && i.move?.to === 0), 'slide-move mark (→ 1st)');
  await $.shot('layout-marks');

  title('the AI gets before → after layout instructions');
  const waiter = startWait(file);
  await page.waitForFunction(() => window.__redpen.S.agent.status === 'waiting', { timeout: 8000 }).catch(() => {});
  await $.clickShadow('.bar .send');
  const res = await withTimeout(waiter.done, 10000, 'wait exits');
  fs.writeFileSync(path.join(OUT, 'layout-round1.md'), res.stdout);
  console.log(`    📝 ${path.join(OUT, 'layout-round1.md')}`);
  const md = res.stdout;
  check(md.includes('📐 **레이아웃**'), 'layout rule included');
  check(/### #\d+ 📐 레이아웃 변경 · 요소 `<div>`/.test(md), 'element layout section');
  check(/- 지금: .*\(grid · 2열\) 안의 1번째 칸/.test(md), 'current position with grid context');
  check(/- 위치: 슬라이드 .*로 옮기기/.test(md), 'move instruction');
  check(/- 크기: \d+%로 키우기 — 비율 유지/.test(md), 'proportional size instruction');
  check(/- 글자 크기: 24px → \d+px \(\+\d+%\)/.test(md), 'font size instruction');
  check(/- 순서: 2번째 → 1번째 — 「잘하는 일/.test(md), 'order instruction');
  check(/간격\(gap\): 40px → 50px/.test(md), 'gap instruction');
  check(/- 맞춤: .*스케치 칸 1「큰 사진」 왼쪽 선에 맞춤/.test(md), 'snap to the sketch box explained');
  check(/### #\d+ 📐 새 배치 스케치[\s\S]*1\. "큰 사진" — 왼쪽/.test(md), 'sketch boxes in reading order');
  check(/이 슬라이드를 \*\*1번째\*\*로 옮기세요/.test(md), 'slide move instruction');
  await sleep(500);
  c = await cards();
  check(!c[0].translate && !c[1].translate && await gapNow() === '40px', 'previews cleared after sending');
  cli('done', file, '--reply', '레이아웃 반영 완료');
  check(errors.length === 0, 'no page errors', errors);
  await page.close();
}

// ---- scenario 5: marks follow slide switches without lag ------------------------------------

const FADE_DECK = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>fade</title><style>
  body { margin: 0; font: 32px/1.6 sans-serif; }
  .slide { position: absolute; inset: 0; padding: 80px; opacity: 0; visibility: hidden; transition: opacity .5s linear, visibility .5s linear; }
  .slide.on { opacity: 1; visibility: visible; }
</style></head><body>
  <section class="slide on"><p>첫 번째 슬라이드의 문장입니다</p></section>
  <section class="slide"><p>두 번째 슬라이드</p></section>
<script>
  let c = 0; const S = [...document.querySelectorAll('.slide')];
  const go = (i) => { S[c].classList.remove('on'); c = Math.max(0, Math.min(S.length - 1, i)); S[c].classList.add('on'); };
  document.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') go(c + 1); if (e.key === 'ArrowLeft') go(c - 1); });
</script></body></html>`;

/** Watch the first pin every animation frame for `ms`: [[t, 'hidden' | opacity], …] */
const samplePin = (page, ms) => page.evaluate((ms) => new Promise((resolve) => {
  const pin = document.getElementById('__redpen-host').shadowRoot.querySelector('.pin');
  const t0 = performance.now();
  const out = [];
  const tick = () => {
    const t = performance.now() - t0;
    out.push([Math.round(t), pin.style.display === 'none' ? 'hidden' : Number(pin.style.opacity || 1)]);
    if (t < ms) requestAnimationFrame(tick);
    else resolve(out);
  };
  requestAnimationFrame(tick);
}), ms);

async function switchDeck(browser) {
  // (a) a deck that hides the old slide at once: its marks must vanish on the very next frame
  const deck = copyExample('basic');
  const dir = path.join(OUT, 'switch');
  fs.cpSync(path.dirname(deck), dir, { recursive: true, filter: (p) => !p.includes('.redpen') });
  const file = path.join(dir, 'index.html');
  const url = /(http:\/\/localhost:\d+\/\S+)/.exec(cli('open', file, '--no-open', '--port', '0'))[1];
  console.log(`\n=== slide switching: ${url}`);
  let { page, errors } = await openPage(browser, `${url}#3`);
  let $ = helpers(page);

  title('comment pins disappear the moment the deck changes slides');
  await $.dragSelect('잘하는 일');
  await page.keyboard.press('KeyC');
  await sleep(150);
  await page.keyboard.type('제목을 바꿔줘');
  await page.keyboard.press('Enter');
  await sleep(400);
  const next = await page.evaluate(() => { const b = document.getElementById('next').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  let watch = samplePin(page, 500);
  await sleep(40);
  const clickAt = await page.evaluate(() => performance.now());
  await page.mouse.click(next.x, next.y);
  let rows = await watch;
  const t0 = rows.find(([, v]) => v === 'hidden')?.[0];
  check(t0 !== undefined && rows.filter(([t, v]) => t > t0 && v !== 'hidden').length === 0, 'pin hidden right after the deck\'s next button (and stays hidden)', rows.slice(0, 12));
  check(t0 !== undefined && t0 < 140, `hidden within a few frames (at ~${t0}ms of a 40ms+click window)`);
  await page.keyboard.press('ArrowLeft');
  await sleep(500);
  watch = samplePin(page, 400);
  await sleep(40);
  await page.keyboard.down('ArrowRight');
  await sleep(200); // key held: must not wait for keyup
  await page.keyboard.up('ArrowRight');
  rows = await watch;
  const tk = rows.find(([, v]) => v === 'hidden')?.[0];
  check(tk !== undefined && tk < 120, `pin hidden on keydown, not keyup (at ~${tk}ms, key held 200ms)`, rows.slice(0, 10));
  void clickAt;
  check(errors.length === 0, 'no page errors', errors);
  await page.close();
  cli('stop', file);

  // (b) a deck that fades slides out: marks fade along instead of popping over the next slide
  const fdir = path.join(OUT, 'fade');
  fs.mkdirSync(fdir, { recursive: true });
  const ffile = path.join(fdir, 'index.html');
  fs.writeFileSync(ffile, FADE_DECK);
  const furl = /(http:\/\/localhost:\d+\/\S+)/.exec(cli('open', ffile, '--no-open', '--port', '0'))[1];
  ({ page, errors } = await openPage(browser, furl));
  $ = helpers(page);
  title('on fading decks, marks fade out with their slide');
  await $.dragSelect('슬라이드의 문장');
  await page.keyboard.press('KeyC');
  await sleep(150);
  await page.keyboard.type('더 짧게');
  await page.keyboard.press('Enter');
  await sleep(400);
  watch = samplePin(page, 800);
  await sleep(30);
  await page.keyboard.press('ArrowRight');
  rows = await watch;
  const mid = rows.filter(([, v]) => typeof v === 'number' && v > 0.08 && v < 0.92);
  check(mid.length >= 3, `pin faded through ${mid.length} in-between frames`, rows.filter((_, i) => i % 3 === 0).slice(0, 16));
  check(rows.at(-1)[1] === 'hidden', 'pin gone once the slide has faded out');
  check(errors.length === 0, 'no page errors', errors);
  await page.close();
  cli('stop', ffile);
}

// ---- run ---------------------------------------------------------------------------------

if (!CHROME) {
  console.error('Chrome not found. Set CHROME_PATH.');
  process.exit(1);
}
// ---- scenario 6: English (--lang en), then switching the open page back to Korean --------------

const HANGUL = /\p{Script=Hangul}/u;

async function englishDeck(browser) {
  const dir = path.join(OUT, 'english');
  fs.cpSync(path.join(ROOT, 'examples', 'basic'), dir, { recursive: true, filter: (p) => !p.includes('.redpen') });
  const file = path.join(dir, 'index.html');
  const out = cli('open', file, '--no-open', '--port', '0', '--lang', 'en');
  const url = /(http:\/\/localhost:\d+\/\S+)/.exec(out)[1];
  console.log(`\n=== english: ${url}`);
  title('--lang en: CLI, toolbar, selection bar, layout mode and panel speak English');
  check(/Opened the Redpen review page/.test(out) && !HANGUL.test(out.replace(file, '')), 'CLI output in English', out);
  const { page, errors } = await openPage(browser, `${url}#3`);
  const $ = helpers(page);
  const text = (sel) => page.evaluate((s) => [...document.getElementById('__redpen-host').shadowRoot.querySelectorAll(s)].map((e) => e.textContent).join(' | '), sel);
  const bar = await text('.bar');
  check(['Text', 'Layout', 'Area', 'List', 'Send to AI', 'AI offline'].every((w) => bar.includes(w)) && !HANGUL.test(bar), 'toolbar in English', bar);
  await $.dragSelect('그리고 이것은 매우 중요합니다.');
  const selbar = await text('.selbar');
  check(/Delete.*Replace.*Comment/.test(selbar) && !HANGUL.test(selbar), 'selection bar in English', selbar);
  await page.keyboard.press('KeyD');
  await sleep(200);
  check((await $.shadowAll('.toast')).some((t) => t.includes('Marked for deletion')), 'toast in English');
  await page.evaluate(() => localStorage.removeItem('redpen:layout-tip'));
  await $.clickShadow('.tb[data-mode="element"]');
  const coachText = await text('.lcoach');
  check(coachText.includes('Layout mode') && !HANGUL.test(coachText), 'layout how-to card in English', coachText);
  await $.clickShadowText('.lcoach .btn', 'Got it');
  const card = await page.evaluate(() => {
    const r = document.querySelector('.slide.active .card').getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  await page.mouse.move(card.x + 60, card.y + card.h - 40);
  await page.mouse.down();
  await page.mouse.move(card.x + 80, card.y + card.h - 20, { steps: 4 });
  await page.mouse.move(card.x + 100, card.y + card.h + 10, { steps: 4 });
  await page.mouse.up();
  await sleep(400);
  const lbar = await text('.lbar');
  check(['Font', 'Gap', 'Padding', 'Center', 'Parent', 'Reset', 'moved'].every((w) => lbar.includes(w)) && !HANGUL.test(lbar), 'layout bar and its summary in English', lbar);
  await $.shot('english-layout');
  await page.keyboard.press('Escape');
  await $.openPanel();
  const panel = `${await text('.panel .tabs')} ${await text('.panel .p-foot')} ${await text('.panel .r-type')}`;
  check(/Draft/.test(panel) && /Sent/.test(panel) && /Send to AI/.test(panel) && !HANGUL.test(panel), 'panel in English', panel);
  await $.closePanel();

  title('the AI gets an English prompt (deck text stays as written)');
  const waiter = startWait(file);
  await page.waitForFunction(() => window.__redpen.S.agent.status === 'waiting', { timeout: 8000 }).catch(() => {});
  await $.clickShadow('.bar .send');
  const res = await withTimeout(waiter.done, 10000, 'wait exits');
  fs.writeFileSync(path.join(OUT, 'english-round1.md'), res.stdout);
  console.log(`    📝 ${path.join(OUT, 'english-round1.md')}`);
  const md = res.stdout;
  const rules = md.slice(md.indexOf('## How to apply'), md.indexOf('\n## Slide'));
  check(/^# ✒️ Redpen edit request · round 1/.test(md) && rules.length > 100 && !HANGUL.test(rules), 'English header and rules', rules.slice(0, 80));
  check(/### #\d+ 🗑 Delete text\n- Original: `그리고 이것은 매우 중요합니다\.`/.test(md), 'English item with the original Korean text', md.slice(0, 300));
  check(/### #\d+ 📐 Layout change · element `<div>`[\s\S]*- Now: .* of the slide/.test(md), 'English layout instructions');
  check(/## When you are done/.test(md), 'English closing instructions');
  await sleep(300);
  check((await $.shadowAll('.toast')).some((t) => /Sent edit request round 1/.test(t)), 'sent toast in English');
  cli('done', file, '--reply', 'Applied');
  check(errors.length === 0, 'no page errors', errors);

  title('redpen open --lang ko restarts the server on the same address and the open tab reloads in Korean');
  const out2 = cli('open', file, '--no-open', '--lang', 'ko');
  const url2 = /(http:\/\/localhost:\d+\/\S+)/.exec(out2)?.[1];
  check(url2 === url && /빨간펜 리뷰 화면을 열었습니다/.test(out2), 'same URL, new server', out2);
  const switched = await page.waitForFunction(
    () => document.getElementById('__redpen-host')?.shadowRoot?.querySelector('.tb[data-mode="element"]')?.textContent.includes('레이아웃'),
    { timeout: 10000 },
  ).then(() => true, () => false);
  check(switched, 'the open tab switched to Korean by itself');
  await sleep(300);
  check((await $.shadowAll('.toast')).some((t) => t.includes('화면 언어를 바꿨어요')), 'toast "화면 언어를 바꿨어요"');
  const real = errors.filter((e) => !/ERR_CONNECTION_REFUSED|Failed to load resource/.test(e));
  check(real.length === 0, 'no page errors besides the restart gap', real);
  await page.close();
}

// ---- scenario 7: turning redpen off (⏻ in the toolbar, redpen done --stop) ---------------------

async function quitDeck(browser) {
  const dir = path.join(OUT, 'quit');
  fs.cpSync(path.join(ROOT, 'examples', 'basic'), dir, { recursive: true, filter: (p) => !p.includes('.redpen') });
  const file = path.join(dir, 'index.html');
  const out = cli('open', file, '--no-open', '--port', '0');
  const url = /(http:\/\/localhost:\d+\/\S+)/.exec(out)[1];
  console.log(`\n=== quit: ${url}`);
  const { page, errors } = await openPage(browser, `${url}#3`);
  const $ = helpers(page);

  title('⏻ asks first, then ends the waiting AI, stops the server and hands the deck back');
  await $.dragSelect('그리고 이것은 매우 중요합니다.');
  await page.keyboard.press('KeyD'); // a mark that is never sent
  await sleep(300);
  const waiter = startWait(file);
  await page.waitForFunction(() => window.__redpen.S.agent.status === 'waiting', { timeout: 8000 }).catch(() => {});
  check((await $.shadow('.bar .tb.quit'))?.visible, '⏻ at the end of the toolbar');
  await $.clickShadow('.bar .tb.quit');
  const dialog = await $.shadow('.modal');
  check(dialog?.visible && /빨간펜을 끌까요/.test(dialog.text) && /저장돼서/.test(dialog.text) && /AI 세션에도/.test(dialog.text), 'a confirm says what happens', dialog?.text);
  await $.clickShadowText('.modal .btn', '종료');
  const res = await withTimeout(waiter.done, 8000, 'wait ends');
  check(res.code === 0 && /빨간펜을 종료했습니다/.test(res.stdout), 'the waiting AI is told the review is over', res.stdout);
  await sleep(400);
  check((await $.shadow('.endcard'))?.visible && !(await $.shadow('.bar'))?.visible, 'the tab says "빨간펜을 종료했어요"; the toolbar is gone');
  check(/리뷰 화면: 꺼짐/.test(cli('status', file)), 'the review server stopped');
  const marks = await page.evaluate(() => [...CSS.highlights.keys()].reduce((n, k) => n + CSS.highlights.get(k).size, 0));
  check(marks === 0, 'no marks painted over the deck any more', marks);
  await page.keyboard.press('ArrowRight');
  await sleep(300);
  check(await $.activeSlide() === 3, 'the deck works as usual again');
  await sleep(4500);
  check(!(await $.shadow('.banner.status')), 'no "connection lost" warning afterwards');
  const draft = JSON.parse(fs.readFileSync(path.join(dir, '.redpen', 'index.html', 'draft.json'), 'utf8'));
  check(draft.items.length === 1, 'the unsent mark was saved', draft.items.length);

  title('after ⏻ a stray `redpen wait` neither waits nor brings the server back');
  const stray = startWait(file);
  const r2 = await withTimeout(stray.done, 5000, 'stray wait exits');
  check(r2.code === 0 && /빨간펜을 종료했습니다/.test(r2.stdout) && /리뷰 화면: 꺼짐/.test(cli('status', file)), 'exits at once, the server stays off', r2.stdout);

  title('redpen open brings it back with the unsent mark; redpen done --stop turns it off again');
  const out2 = cli('open', file, '--no-open', '--port', '0');
  const url2 = /(http:\/\/localhost:\d+\/\S+)/.exec(out2)[1];
  await page.goto(`${url2}#3`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__redpenStarted && document.getElementById('__redpen-host')?.shadowRoot?.querySelector('.bar'));
  await sleep(500);
  check((await $.items()).length === 1, 'the unsent mark is back');
  const done = cli('done', file, '--reply', '마무리했어요', '--stop');
  await sleep(600);
  check(/리뷰 화면도 껐습니다/.test(done) && (await $.shadow('.endcard'))?.visible, 'done --stop: the open tab hands the deck back too', done);
  check(/리뷰 화면: 꺼짐/.test(cli('status', file)), 'and the server is off');
  const real = errors.filter((e) => !/ERR_CONNECTION_REFUSED|Failed to load resource/.test(e));
  check(real.length === 0, 'no page errors', real);
  await page.close();
}

// Marks made while an earlier round is being applied must survive renumbering.
async function slideIdentityDeck(browser) {
  const dir = path.join(OUT, 'slide-identity');
  fs.mkdirSync(dir, { recursive: true });
  const deck = path.join(dir, 'index.html');
  const data = {
    A: ['앞에서 삭제할 장', '앞쪽의 독립적인 내용'],
    B: ['중복 제목', 'B에만 있는 지역 설명'],
    C: ['중복 제목', 'C에만 있는 상세한 설명'],
    D: ['삭제할 대상', 'D에만 있는 마무리 설명'],
    E: ['이미 사라진 대상', 'E에만 있는 별도의 설명'],
  };
  const html = (keys) => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>slide identity</title><style>
    body{margin:0;font:24px sans-serif}.slide{position:absolute;inset:0;padding:60px;visibility:hidden}.slide.active{visibility:visible}.card,.box{padding:12px;margin:12px;background:#eee}
    </style></head><body><main id="deck">${keys.map((key, i) => `<section class="slide" id="slide-${i + 1}" data-key="${key}"><h1>${data[key][0]}</h1><p>${data[key][1]}</p><div class="card">반복 카드</div><div class="box">반복 레이아웃</div><p class="shared">모든 장의 반복 문구</p></section>`).join('\n')}</main><script>
    const slides=[...document.querySelectorAll('.slide')];function go(){const i=Math.max(0,Math.min(slides.length-1,(Number(location.hash.slice(1))||1)-1));slides.forEach((s,n)=>s.classList.toggle('active',n===i))}addEventListener('hashchange',go);go();
    </script></body></html>`;
  fs.writeFileSync(deck, html(['A', 'B', 'C', 'D', 'E']));
  const out = cli('open', deck, '--no-open', '--port', '0');
  const url = /(http:\/\/localhost:\d+\/\S+)/.exec(out)[1];
  const { page, errors } = await openPage(browser, `${url}#3`);
  const $ = helpers(page);
  const marks = () => page.evaluate(() => window.__redpen.S.items.map((it) => ({
    id: it.id, type: it.type, target: it.target, index: it.slide?.index,
    home: it._slide?.dataset.key || null, orphan: it._orphan, missing: it._slideMissing,
  })));

  title('new marks can be made while an earlier review round is being applied');
  await page.evaluate(async () => {
    const A = await import('/__redpen/app/actions.js');
    A.toggleSlideDelete(document.querySelector('[data-key="A"]'));
  });
  const first = startWait(deck);
  await page.waitForFunction(() => window.__redpen.S.agent.status === 'waiting');
  await $.clickShadow('.bar .send');
  await withTimeout(first.done, 8000, 'first round delivered');
  await page.waitForFunction(() => window.__redpen.S.agent.status === 'working');
  await page.evaluate(async () => {
    const A = await import('/__redpen/app/actions.js');
    const { S, mutate } = await import('/__redpen/app/state.js');
    const { slideMeta, describeRegion, describeElement } = await import('/__redpen/app/anchor.js');
    const get = (key) => document.querySelector(`[data-key="${key}"]`);
    const B = get('B'), C = get('C');
    const range = document.createRange();
    range.selectNodeContents(C.querySelector('.shared'));
    A.markText('delete', range);
    A.deleteElement(C.querySelector('.card'));
    A.toggleSlideDelete(get('D'));
    A.toggleSlideDelete(get('E'));
    const element = describeElement(C.querySelector('.box')).data;
    mutate(() => S.items.push(
      { id: 'region-B', type: 'comment', ...describeRegion(B, B.getBoundingClientRect()), comment: 'B 영역 코멘트', _slide: B },
      { id: 'comment-C', type: 'comment', target: 'slide', slide: slideMeta(C), comment: 'C 슬라이드 코멘트', _slide: C },
      { id: 'sketch-C', type: 'layout', target: 'sketch', slide: slideMeta(C), sketch: { boxes: [{ x: .1, y: .1, w: .4, h: .4, label: 'C 새 배치' }] }, _slide: C },
      { id: 'layout-C', type: 'layout', ...element, layout: { from: element.pos, to: null, font: { from: 24, to: 26 } }, _el: C.querySelector('.box'), _slide: C },
    ));
  });
  await sleep(700);
  check((await marks()).length === 8, 'eight new marks saved while AI is working');

  title('removing preceding slides follows identities despite duplicate titles, text and regenerated ids');
  fs.writeFileSync(deck, html(['B', 'C', 'D']));
  await page.waitForFunction(() => window.__redpen?.getSlides().els.length === 3 && window.__redpen.S.items.length === 8, { timeout: 8000 });
  await sleep(750);
  let list = await marks();
  check(list.filter((it) => it.home === 'C').length === 5 && list.filter((it) => it.home === 'C').every((it) => it.index === 1 && !it.orphan), 'text, element, comment, sketch and layout stay on C', list);
  check(list.find((it) => it.id === 'region-B')?.home === 'B', 'region stays on B');
  check(list.some((it) => it.type === 'delete' && it.target === 'slide' && it.home === 'D' && it.index === 2), 'slide deletion follows D to its current index');
  check(list.filter((it) => it.missing).length === 1 && list.find((it) => it.missing)?.orphan, 'deleted E stays unresolved instead of moving to another page');
  check(await page.$eval('.slide.active', (el) => el.dataset.key) === 'C', 'reload keeps the reviewer on the same logical slide');
  const persisted = JSON.parse(fs.readFileSync(path.join(dir, '.redpen/index.html/draft.json'), 'utf8'));
  check(persisted.items.find((it) => it.id === 'comment-C')?.slide.index === 1, 'rebased metadata is autosaved');

  title('engines that reuse positional DOM nodes cannot move marks to the replacement content');
  await page.evaluate(async () => {
    const { S, emit } = await import('/__redpen/app/state.js');
    // Exercise a region on its own: no lost text Range or element can trigger re-anchoring for it.
    window.__rpSavedMarks = S.items;
    S.items = S.items.filter((it) => it.id === 'region-B');
    emit('items');
    const nodes = [...document.querySelectorAll('.slide')];
    const contents = new Map(nodes.map((el) => [el.dataset.key, el.innerHTML]));
    ['C', 'D', 'B'].forEach((key, i) => {
      nodes[i].innerHTML = contents.get(key);
      nodes[i].dataset.key = key;
      nodes[i].classList.toggle('active', key === 'C');
    });
  });
  await page.waitForFunction(() => window.__redpen.S.items.find((it) => it.id === 'region-B')?.slide.index === 2);
  check((await marks())[0]?.home === 'B', 'a region-only draft also follows content changes in reused slide nodes');
  await page.evaluate(async () => {
    const { S, mutate } = await import('/__redpen/app/state.js');
    const A = await import('/__redpen/app/actions.js');
    mutate(() => { S.items = window.__rpSavedMarks; });
    delete window.__rpSavedMarks;
    A.anchorAll();
  });
  await page.waitForFunction(() => window.__redpen.S.items.find((it) => it.id === 'comment-C')?.slide.index === 0);
  list = await marks();
  check(list.filter((it) => it.home === 'C').length === 5 && list.find((it) => it.id === 'region-B')?.index === 2, 'marks follow logical slides instead of reused DOM slots', list);

  title('live DOM reordering also rebases marks without reloading');
  await page.evaluate(() => {
    const deck = document.getElementById('deck');
    deck.append(deck.querySelector('[data-key="C"]'));
    [...deck.children].forEach((el, i) => { el.id = `slide-${i + 1}`; });
  });
  await page.waitForFunction(() => window.__redpen.S.items.find((it) => it.id === 'comment-C')?.slide.index === 2);
  check((await marks()).filter((it) => it.home === 'C').every((it) => it.index === 2), 'all C marks follow its live DOM node');
  await sleep(600);

  title('deleting a marked slide holds its marks even when another copy of its heading remains');
  fs.writeFileSync(deck, html(['B', 'D']));
  await page.waitForFunction(() => window.__redpen?.getSlides().els.length === 2 && window.__redpen.S.items.length === 8, { timeout: 8000 });
  await sleep(700);
  list = await marks();
  check(list.filter((it) => it.missing && it.orphan && !it.home).length === 6, 'all five C marks and E deletion are held', list);
  check(list.find((it) => it.id === 'region-B')?.home === 'B', 'B never receives C marks with the same heading');

  title('the last remaining slide keeps its identity and deleted-slide requests cannot delete it');
  await page.evaluate(() => {
    document.querySelector('[data-key="B"]').remove();
    document.querySelector('[data-key="D"]').id = 'slide-1';
  });
  await page.waitForFunction(() => window.__redpen.S.items.filter((it) => it._slideMissing).length === 7);
  list = await marks();
  check(list.find((it) => it.home === 'D')?.index === 0 && list.filter((it) => it.missing).length === 7, 'D stays a slide; all other targets remain missing', list);
  const second = startWait(deck, ['--reply', '앞선 요청을 반영했습니다.']);
  await page.waitForFunction(() => window.__redpen.S.agent.status === 'waiting');
  await $.clickShadow('.bar .send');
  const result = await withTimeout(second.done, 8000, 'second round delivered');
  const state = JSON.parse(cli('status', deck, '--json'));
  const round = JSON.parse(fs.readFileSync(path.join(dir, '.redpen/index.html/rounds/0002.json'), 'utf8'));
  check(round.items.filter((it) => it.slideMissing && it.orphan).length === 7, 'submitted requests preserve unresolved identities');
  check((result.stdout.match(/- 이 슬라이드 전체를 지우세요\./g) || []).length === 1, 'only the surviving, correctly identified D gets a deletion instruction');
  check(result.stdout.includes('다른 슬라이드에 적용하지 말고') && result.stdout.includes('표시 당시 슬라이드 내용'), 'AI receives the held-item guard and captured slide content');
  check(state.rounds.length === 2 && errors.length === 0, 'two rounds, no browser errors', errors);
  await page.close();
  cli('stop', deck);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: process.env.HEADFUL ? false : 'new',
  args: ['--window-size=1440,900', '--no-first-run'],
});
const context = browser.defaultBrowserContext();
await context.overridePermissions('http://localhost', ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']).catch(() => {});
try {
  await basicDeck(browser);
  await jsDeck(browser);
  await edgeDeck(browser);
  await slideIdentityDeck(browser);
  await layoutDeck(browser);
  await switchDeck(browser);
  await englishDeck(browser);
  await quitDeck(browser);
} catch (err) {
  failures++;
  console.error(`\n💥 ${err.stack || err}`);
} finally {
  await browser.close();
  for (const deck of opened) {
    try {
      execFileSync(process.execPath, [BIN, 'stop', deck], { stdio: 'ignore' });
    } catch {
      /* already gone */
    }
  }
}
console.log(`\n${failures ? `❌ ${failures} check(s) failed` : '✅ all checks passed'} — artifacts in ${OUT}`);
process.exit(failures ? 1 : 0);
