// README screenshots, in both languages, from the current UI:
//   npm run screenshots   → docs/screenshot.png (Korean UI, examples/basic) · docs/screenshot-en.png (English UI, examples/basic-en)
// Works on temp copies of the example decks, so the repo's examples never get a .redpen folder.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BIN = path.join(ROOT, 'bin', 'redpen.mjs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'redpen-shots-'));
const CHROME = process.env.CHROME_PATH || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].find((p) => fs.existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const env = { ...process.env, REDPEN_HOME: TMP };

const SHOTS = [
  {
    lang: 'ko', deck: 'basic', out: 'docs/screenshot.png',
    remove: '그리고 이것은 매우 중요합니다.',
    replace: ['초안 작성', '초안 쓰기'],
    comment: ['잘하는 일', '제목을 "AI가 잘하는 일"로 바꿔줘'],
    region: '여기에 AI 아이콘 일러스트 추가',
    slide: '카드 두 개를 세로로 배치하고 아이콘을 넣어줘',
  },
  {
    lang: 'en', deck: 'basic-en', out: 'docs/screenshot-en.png',
    remove: 'And this is very important.',
    replace: ['First drafts', 'Rough drafts'],
    comment: ['Good at', 'Rename this to "What AI is good at"'],
    region: 'Add an AI icon illustration here',
    slide: 'Stack the two cards vertically and add icons',
  },
];

async function shoot(browser, s) {
  const dir = path.join(TMP, s.deck);
  fs.cpSync(path.join(ROOT, 'examples', s.deck), dir, { recursive: true });
  const file = path.join(dir, 'index.html');
  const out = execFileSync(process.execPath, [BIN, 'open', file, '--no-open', '--port', '0', '--lang', s.lang], { encoding: 'utf8', env });
  const url = /(http:\/\/localhost:\d+\/\S+)/.exec(out)[1];
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('redpen:onboarded', '1');
    localStorage.setItem('redpen:layout-tip', '1');
    localStorage.setItem('redpen:nudge-tip', '1');
  });
  await page.goto(`${url}#3`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__redpenStarted && document.getElementById('__redpen-host')?.shadowRoot?.querySelector('.bar'));
  await sleep(600);

  const shadowBox = (sel) => page.evaluate((q) => {
    const el = document.getElementById('__redpen-host').shadowRoot.querySelector(q);
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, sel);
  const click = async (sel) => {
    const b = await shadowBox(sel);
    await page.mouse.click(b.x, b.y);
    await sleep(250);
  };
  const textBox = (t) => page.evaluate((needle) => {
    const slide = document.querySelector('.slide.active');
    const w = document.createTreeWalker(slide, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const i = n.data.indexOf(needle);
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + needle.length);
      const rects = [...r.getClientRects()];
      return { x0: rects[0].left + 1, y0: rects[0].top + rects[0].height / 2, x1: rects.at(-1).right - 1, y1: rects.at(-1).top + rects.at(-1).height / 2 };
    }
    throw new Error(`not on the slide: ${needle}`);
  }, t);
  const select = async (t) => {
    const r = await textBox(t);
    await page.mouse.move(r.x0, r.y0);
    await page.mouse.down();
    await page.mouse.move(r.x1, r.y1, { steps: 8 });
    await page.mouse.up();
    await sleep(350);
  };
  const type = async (text) => {
    await page.keyboard.type(text);
    await page.keyboard.press('Enter');
    await sleep(300);
  };

  // a slide-wide comment, an area comment, then text marks
  await click('.bar .tb.hide-paused');
  await page.evaluate(() => document.getElementById('__redpen-host').shadowRoot.querySelector('.pop .menu button.t-comment').click());
  await sleep(300);
  await type(s.slide);
  await click('.tb[data-mode="region"]');
  const lead = await textBox(s.remove);
  await page.mouse.move(1010, 95);
  await page.mouse.down();
  await page.mouse.move(1340, 230, { steps: 8 });
  await page.mouse.up();
  await sleep(350);
  await type(s.region);
  await click('.tb[data-mode="text"]');
  await select(s.remove);
  await page.keyboard.press('KeyD');
  await sleep(250);
  await select(s.replace[0]);
  await page.keyboard.press('KeyR');
  await sleep(300);
  await page.keyboard.down(process.platform === 'darwin' ? 'Meta' : 'Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up(process.platform === 'darwin' ? 'Meta' : 'Control');
  await type(s.replace[1]);
  await select(s.comment[0]);
  await page.keyboard.press('KeyC');
  await sleep(300);
  await type(s.comment[1]);

  // layout: drop the second card in front of the first (purple ghost + arrow)
  await click('.tb[data-mode="element"]');
  const cards = await page.evaluate(() => [...document.querySelectorAll('.slide.active .card')].map((c) => {
    const r = c.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }));
  await page.mouse.move(cards[1].x + 120, cards[1].y + cards[1].h - 60);
  await page.mouse.down();
  await page.mouse.move(cards[1].x - 100, cards[1].y + cards[1].h - 80, { steps: 6 });
  await page.mouse.move(cards[0].x + 60, cards[0].y + cards[0].h - 90, { steps: 6 });
  await page.mouse.up();
  await sleep(400);
  await page.keyboard.press('Escape');
  await page.mouse.move(lead.x0 + 200, 20);
  await click('.bar .tb:not(.send):not(.hide-paused):not([data-mode])'); // list panel
  await sleep(500);
  await page.screenshot({ path: path.join(ROOT, s.out) });
  console.log(`📸 ${s.out}`);
  await page.close();
  execFileSync(process.execPath, [BIN, 'stop', file], { env, stdio: 'ignore' });
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1440,900', '--no-first-run', '--lang=en-US'] });
try {
  for (const s of SHOTS) await shoot(browser, s);
} finally {
  await browser.close();
  fs.rmSync(TMP, { recursive: true, force: true });
}
