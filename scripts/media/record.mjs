// README 영상용 녹화: 예제 덱(examples/showcase)에서 빨간펜을 실제로 조작하며
// 화면 프레임(1920×1080 JPEG, 변할 때마다)과 커서·클릭·키·초점·단계 이벤트를 기록한다.
// 합성은 stage.html + render.mjs가 한다.
//
//   node scripts/media/record.mjs [ko|en ...] [01 02 03 04 ...]     (인자가 없으면 전부)
//   결과: scripts/media/.cache/rec/<lang>/<clip>/{fNNNNN.jpg, manifest.json}
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const BIN = path.join(ROOT, 'bin', 'redpen.mjs');
const DECK_SRC = path.join(ROOT, 'examples', 'showcase');
const CACHE = path.join(ROOT, 'scripts', 'media', '.cache');
const CHROME = process.env.CHROME_PATH || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => fs.existsSync(p));
const VW = 1280;
const VH = 720;
const K = 1.5; // CSS px → footage px (1920×1080)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

/* ---------- 언어별 문구 ---------- */
const T = {
  ko: {
    file: 'index.html', slides: 'slides.js',
    del: '그리고 이것은 매우 중요합니다.', repFrom: '12분', repTo: '15분',
    cmtOn: '평균 2분', cmt: '이 숫자를 굵게 강조해줘',
    area: '여기에 전후 비교 그림 추가',
    sketch: ['큰 숫자', '설명 한 줄'], sketchDone: '완료', sketchMenu: '새 배치 스케치',
    delMenu: '이 슬라이드 삭제 표시',
    send: 'AI에게 보내기',
    reply: '3건 반영했어요 — 문장 삭제, 12분 → 15분, "평균 2분" 굵게',
    apply: (s) => s.replace(' 그리고 이것은 매우 중요합니다.', '').replace('"평균 12분"', '"평균 15분"').replace('"평균 2분"', '"**평균 2분**"'),
  },
  en: {
    file: 'en.html', slides: 'slides.en.js',
    del: 'And this is very important.', repFrom: '12 min', repTo: '15 min',
    cmtOn: '2 min on average', cmt: 'Make this number bold',
    area: 'Add a before/after picture here',
    sketch: ['Big number', 'One line of text'], sketchDone: 'Done', sketchMenu: 'Sketch a new layout',
    delMenu: 'Mark this slide for deletion',
    send: 'Send to AI',
    reply: 'Applied 3 marks — sentence removed, 12 → 15 min, "2 min on average" in bold',
    apply: (s) => s.replace(' And this is very important.', '').replace('"12 min on average"', '"15 min on average"').replace('"2 min on average"', '"**2 min on average**"'),
  },
};

/* ---------- 녹화기 ---------- */
class Recorder {
  constructor(page, dir) {
    this.page = page;
    this.dir = dir;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    this.frames = [];
    this.events = [];
    this.n = 0;
    this.cursor = { x: VW * 0.62, y: VH * 0.78 };
  }

  now() { return Date.now() - this.t0; }

  async start() {
    this.t0 = Date.now();
    this.cdp = await this.page.createCDPSession();
    this.cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
      const f = `f${String(this.n++).padStart(5, '0')}.jpg`;
      fs.writeFileSync(path.join(this.dir, f), Buffer.from(data, 'base64'));
      this.frames.push({ f, t: Math.max(0, Math.round(metadata.timestamp * 1000 - this.t0)) });
      this.cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    });
    await this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: VW * K, maxHeight: VH * K, everyNthFrame: 1 });
    this.log('cursor', this.cursor);
  }

  /** The screencast pauses on navigation: start it again once the page has reloaded. */
  async resume() {
    await this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: VW * K, maxHeight: VH * K, everyNthFrame: 1 }).catch(() => {});
  }

  async stop() {
    await sleep(300);
    await this.cdp.send('Page.stopScreencast').catch(() => {});
  }

  log(type, data = {}) {
    const e = { t: this.now(), type, ...data };
    for (const k of ['x', 'y']) if (k in e) e[k] = Math.round(e[k] * K);
    if (e.rect) e.rect = e.rect.map((v) => Math.round(v * K));
    this.events.push(e);
    return e;
  }

  mark(name) { this.log('mark', { name }); }

  /** Where the camera should look (CSS px rect); z = 1 for the whole screen. */
  focus(rect, z = null) { this.log('focus', { rect: [rect.x, rect.y, rect.w, rect.h], z }); }
  wide() { this.log('focus', { rect: [0, 0, VW, VH], z: 1 }); }

  async move(x, y, dur = 650) {
    const from = { ...this.cursor };
    const steps = Math.max(10, Math.round(dur / 16));
    for (let i = 1; i <= steps; i++) {
      const k = ease(i / steps);
      const cx = from.x + (x - from.x) * k;
      const cy = from.y + (y - from.y) * k;
      await this.page.mouse.move(cx, cy);
      this.log('cursor', { x: cx, y: cy });
      await sleep(dur / steps);
    }
    this.cursor = { x, y };
  }

  async click(x, y, { dur = 650, pre = 160, post = 260 } = {}) {
    await this.move(x, y, dur);
    await sleep(pre);
    this.log('click', { x, y });
    await this.page.mouse.down();
    await sleep(80);
    await this.page.mouse.up();
    await sleep(post);
  }

  async drag(x0, y0, x1, y1, { dur = 900, via = null } = {}) {
    await this.move(x0, y0, 600);
    await sleep(140);
    this.log('down', { x: x0, y: y0 });
    await this.page.mouse.down();
    await sleep(90);
    if (via) await this.move(via.x, via.y, dur * 0.45);
    await this.move(x1, y1, via ? dur * 0.55 : dur);
    await sleep(120);
    await this.page.mouse.up();
    this.log('up', { x: x1, y: y1 });
    await sleep(250);
  }

  async key(code, label) {
    this.log('key', { key: code.replace(/^Key/, ''), label });
    await this.page.keyboard.press(code);
    await sleep(220);
  }

  async type(text, delay = 55) {
    this.log('typing', { text });
    for (const ch of text) {
      await this.page.keyboard.type(ch);
      await sleep(delay);
    }
  }

  save(extra = {}) {
    fs.writeFileSync(path.join(this.dir, 'manifest.json'), JSON.stringify({
      size: { w: VW * K, h: VH * K }, frames: this.frames, events: this.events, ...extra,
    }));
  }
}

/* ---------- 페이지 도우미 ---------- */
const ui = (page, sel, text = null) => page.evaluate((s, t) => {
  const root = document.getElementById('__redpen-host').shadowRoot;
  const shown = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
  const el = [...root.querySelectorAll(s)].find((e) => shown(e) && (!t || e.textContent.includes(t)));
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
}, sel, text);

const deck = (page, sel, i = 0) => page.evaluate((s, k) => {
  const el = document.querySelectorAll(`.slide.is-active ${s}`)[k];
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
}, sel, i);

const textBox = (page, needle) => page.evaluate((t) => {
  const slide = document.querySelector('.slide.is-active');
  const w = document.createTreeWalker(slide, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const i = n.data.indexOf(t);
    if (i < 0) continue;
    const r = document.createRange();
    r.setStart(n, i);
    r.setEnd(n, i + t.length);
    const rs = [...r.getClientRects()];
    const all = r.getBoundingClientRect();
    return { x0: rs[0].left + 1, y0: rs[0].top + rs[0].height / 2, x1: rs.at(-1).right - 1, y1: rs.at(-1).top + rs.at(-1).height / 2, x: all.left, y: all.top, w: all.width, h: all.height };
  }
  throw new Error(`not on the slide: ${t}`);
}, needle);

const pad = (r, p, q = p) => ({ x: r.x - p, y: r.y - q, w: r.w + 2 * p, h: r.h + 2 * q });
const union = (...rs) => {
  const x = Math.min(...rs.map((r) => r.x));
  const y = Math.min(...rs.map((r) => r.y));
  return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y };
};

async function goSlide(page, n) {
  await page.evaluate((k) => window.__deck.go(k - 1), n);
  await sleep(450);
}

async function selectText(rec, page, needle, dur = 700) {
  const r = await textBox(page, needle);
  await rec.drag(r.x0, r.y0, r.x1, r.y1, { dur });
  return r;
}

/* ---------- 장면 ---------- */
const CLIPS = {
  // 01 텍스트: 드래그 → D 삭제 · R 수정 · C 코멘트
  async '01'(rec, page, L) {
    await goSlide(page, 7);
    const lead = await deck(page, '.lead');
    const table = await deck(page, '.tbl');
    rec.wide();
    await sleep(700);
    rec.mark('s1');
    rec.focus(pad(lead, 40, 60));
    await sleep(500);
    await selectText(rec, page, L.del);
    await sleep(350);
    await rec.key('KeyD', 'delete');
    await sleep(1100);
    rec.mark('s2');
    const rep = await textBox(page, L.repFrom);
    rec.focus(pad(union(rep, table), 30, 30));
    await sleep(500);
    await selectText(rec, page, L.repFrom, 500);
    await sleep(300);
    await rec.key('KeyR', 'replace');
    await sleep(500);
    await rec.type(L.repTo, 90);
    await sleep(300);
    await rec.key('Enter');
    await sleep(1100);
    rec.mark('s3');
    await selectText(rec, page, L.cmtOn, 600);
    await sleep(300);
    await rec.key('KeyC', 'comment');
    await sleep(500);
    await rec.type(L.cmt, 60);
    await sleep(300);
    await rec.key('Enter');
    await sleep(900);
    rec.wide();
    await rec.move(VW * 0.5, VH * 0.86, 700);
    await sleep(1400);
    rec.mark('end');
  },

  // 02 레이아웃: 선택 → 끌어서 순서 바꾸기 → 모서리로 크기, + 로 글자
  async '02'(rec, page) {
    await goSlide(page, 3);
    const cards = [await deck(page, '.card', 0), await deck(page, '.card', 1), await deck(page, '.card', 2)];
    const row = union(...cards);
    rec.wide();
    await sleep(600);
    rec.mark('s1');
    const btn = await ui(page, '.tb[data-mode="element"]');
    await rec.click(btn.cx, btn.cy);
    await sleep(400);
    rec.focus(pad(union(await deck(page, '.title'), row), 40, 50));
    await rec.click(cards[2].x + cards[2].w * 0.55, cards[2].y + cards[2].h * 0.72);
    await sleep(900);
    rec.mark('s2');
    const from = { x: cards[2].x + cards[2].w * 0.5, y: cards[2].y + cards[2].h * 0.6 };
    const to = { x: cards[0].x + cards[0].w * 0.22, y: cards[0].y + cards[0].h * 0.55 };
    await rec.drag(from.x, from.y, to.x, to.y, { dur: 1700, via: { x: cards[1].x + cards[1].w * 0.5, y: cards[1].y + cards[1].h * 0.9 } });
    await sleep(1200);
    rec.mark('s3');
    const se = await ui(page, '.lh[data-h="se"]');
    rec.focus(pad(union(await ui(page, '.lsel'), await ui(page, '.lbar')), 60, 60));
    await rec.drag(se.cx, se.cy, se.cx + 56, se.cy + 40, { dur: 800 });
    await sleep(700);
    const plus = await page.evaluate(() => {
      const st = document.getElementById('__redpen-host').shadowRoot.querySelectorAll('.lbar .lstep')[0];
      const r = st.querySelectorAll('button')[1].getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    rec.focus(pad(union(await ui(page, '.lsel'), await ui(page, '.lbar')), 60, 60));
    await rec.click(plus.x, plus.y, { dur: 700, post: 350 });
    await rec.click(plus.x, plus.y, { dur: 200, post: 900 });
    rec.wide();
    await rec.move(VW * 0.5, VH * 0.4, 700);
    await sleep(1300);
    rec.mark('end');
  },

  // 03 영역·슬라이드: 빈 곳에 범위 → 새 배치 스케치 → 슬라이드 삭제 표시
  async '03'(rec, page, L) {
    await goSlide(page, 4);
    rec.wide();
    await sleep(600);
    rec.mark('s1');
    const btn = await ui(page, '.tb[data-mode="region"]');
    await rec.click(btn.cx, btn.cy);
    const slide = await page.evaluate(() => { const r = document.querySelector('.slide.is-active').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    const a = { x0: slide.x + slide.w * 0.6, y0: slide.y + slide.h * 0.3, x1: slide.x + slide.w * 0.94, y1: slide.y + slide.h * 0.72 };
    await rec.drag(a.x0, a.y0, a.x1, a.y1, { dur: 800 });
    await sleep(350);
    await rec.type(L.area, 40);
    await sleep(300);
    await rec.key('Enter');
    await sleep(1000);
    rec.mark('s2');
    await goSlide(page, 8);
    rec.wide();
    const menuBtn = await ui(page, '.bar .tb.hide-paused');
    await rec.click(menuBtn.cx, menuBtn.cy);
    await sleep(350);
    const sk = await ui(page, '.pop .menu button', L.sketchMenu);
    await rec.click(sk.cx, sk.cy, { dur: 500 });
    await sleep(600);
    const area = await ui(page, '.sk-area');
    const box = async (fx0, fy0, fx1, fy1, label) => {
      await rec.drag(area.x + area.w * fx0, area.y + area.h * fy0, area.x + area.w * fx1, area.y + area.h * fy1, { dur: 560 });
      await sleep(150);
      await rec.type(label, 40);
      await rec.key('Enter');
      await sleep(250);
    };
    await box(0.05, 0.28, 0.48, 0.88, L.sketch[0]);
    await box(0.53, 0.28, 0.95, 0.88, L.sketch[1]);
    const done = await ui(page, '.skbar .btn', L.sketchDone);
    await rec.click(done.cx, done.cy, { dur: 600, post: 900 });
    rec.mark('s3');
    await goSlide(page, 9);
    const menu2 = await ui(page, '.bar .tb.hide-paused');
    await rec.click(menu2.cx, menu2.cy);
    await sleep(350);
    const del = await ui(page, '.pop .menu button', L.delMenu);
    await rec.click(del.cx, del.cy, { dur: 500, post: 500 });
    await rec.move(VW * 0.5, VH * 0.45, 500);
    await sleep(900);
    rec.mark('end');
  },

  // 04 보내기 → AI가 원문 수정 → 자동 새로고침 + 답장
  async '04'(rec, page, L, ctx) {
    await goSlide(page, 7);
    // off camera: the three marks from 01, and an AI session waiting
    for (const [needle, keyCode, text] of [[L.del, 'KeyD'], [L.repFrom, 'KeyR', L.repTo], [L.cmtOn, 'KeyC', L.cmt]]) {
      const r = await textBox(page, needle);
      await page.mouse.move(r.x0, r.y0);
      await page.mouse.down();
      await page.mouse.move(r.x1, r.y1, { steps: 8 });
      await page.mouse.up();
      await sleep(300);
      await page.keyboard.press(keyCode);
      await sleep(300);
      if (text) {
        await page.keyboard.type(text);
        await page.keyboard.press('Enter');
        await sleep(300);
      }
    }
    await page.mouse.move(rec.cursor.x, rec.cursor.y);
    const waiter = ctx.wait();
    await page.waitForFunction(() => window.__redpen.S.agent.status === 'waiting', { timeout: 10000 });
    await sleep(800);
    await rec.start();
    rec.wide();
    await sleep(600);
    rec.mark('s1');
    const list = await page.evaluate(() => {
      const b = [...document.getElementById('__redpen-host').shadowRoot.querySelectorAll('.bar .tb')].find((x) => x.querySelector('.count:not(.mini)'));
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await rec.click(list.x, list.y);
    await sleep(1200);
    rec.mark('s2');
    const send = await ui(page, '.panel .btn.red');
    rec.focus(pad(send, 160, 120), 1.6);
    await rec.click(send.cx, send.cy, { dur: 800, post: 200 });
    const prompt = await waiter;
    await sleep(700);
    await page.keyboard.press('Escape'); // close the list: the fixed slide stays in view
    await sleep(300);
    rec.wide();
    rec.mark('s3');
    rec.log('terminal', { text: prompt });
    await rec.move(VW * 0.45, VH * 0.55, 900);
    await sleep(2600);
    // the AI edits the source; the page reloads by itself
    const file = path.join(ctx.dir, L.slides);
    fs.writeFileSync(file, L.apply(fs.readFileSync(file, 'utf8')));
    rec.log('edit', { file: L.slides });
    await page.waitForNavigation({ timeout: 10000 }).catch(() => {});
    await page.waitForFunction(() => window.__redpenStarted && document.getElementById('__redpen-host')?.shadowRoot?.querySelector('.bar'));
    await rec.resume();
    rec.mark('reloaded');
    await sleep(900);
    ctx.reply(L.reply);
    rec.mark('s4');
    const table = await deck(page, '.tbl');
    const lead = await deck(page, '.lead');
    rec.focus(pad(union(table, lead), 30, 30));
    await sleep(3400);
    rec.mark('end');
  },
};

/* ---------- 실행 ---------- */
const args = process.argv.slice(2);
const langs = args.filter((a) => T[a]);
const clips = args.filter((a) => CLIPS[a]);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--force-color-profile=srgb', '--hide-scrollbars', `--window-size=${VW},${VH}`] });
try {
  for (const lang of langs.length ? langs : Object.keys(T)) {
    for (const clip of clips.length ? clips : Object.keys(CLIPS)) {
      const L = T[lang];
      const work = path.join(CACHE, 'work', `${lang}-${clip}`);
      fs.rmSync(work, { recursive: true, force: true });
      fs.cpSync(DECK_SRC, work, { recursive: true, filter: (p) => !p.includes('.redpen') });
      const file = path.join(work, L.file);
      const env = { ...process.env, REDPEN_HOME: path.join(CACHE, 'home'), REDPEN_LANG: lang };
      const out = execFileSync(process.execPath, [BIN, 'open', file, '--no-open', '--port', '0', '--lang', lang], { encoding: 'utf8', env });
      const url = /(http:\/\/localhost:\d+\/\S+)/.exec(out)[1];
      const page = await browser.newPage();
      await page.setViewport({ width: VW, height: VH, deviceScaleFactor: K });
      await page.evaluateOnNewDocument(() => {
        for (const k of ['redpen:onboarded', 'redpen:layout-tip', 'redpen:nudge-tip']) localStorage.setItem(k, '1');
        // the deck's own ← → buttons are hidden so the toolbar stands alone
        document.addEventListener('DOMContentLoaded', () => {
          const st = document.createElement('style');
          st.textContent = '#controls { display: none !important; }';
          document.head.append(st);
        });
      });
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__redpenStarted && document.getElementById('__redpen-host')?.shadowRoot?.querySelector('.bar'));
      await page.evaluate(() => document.fonts.ready);
      await sleep(500);
      const rec = new Recorder(page, path.join(CACHE, 'rec', lang, clip));
      await page.mouse.move(rec.cursor.x, rec.cursor.y);
      const children = [];
      const ctx = {
        dir: work,
        wait: () => new Promise((resolve) => {
          const c = spawn(process.execPath, [BIN, 'wait', file], { env, stdio: ['ignore', 'pipe', 'ignore'] });
          children.push(c);
          let s = '';
          c.stdout.on('data', (d) => { s += d; });
          c.on('exit', () => resolve(s));
        }),
        reply: (msg) => children.push(spawn(process.execPath, [BIN, 'wait', file, '--reply', msg], { env, stdio: 'ignore' })),
      };
      if (clip !== '04') await rec.start();
      console.log(`● ${lang} ${clip}`);
      await CLIPS[clip](rec, page, L, ctx);
      await rec.stop();
      rec.save({ lang, clip });
      console.log(`  ${rec.frames.length} frames, ${(rec.now() / 1000).toFixed(1)}s`);
      for (const c of children) c.kill();
      await page.close();
      execFileSync(process.execPath, [BIN, 'stop', file], { env, stdio: 'ignore' });
    }
  }
} finally {
  await browser.close();
}
