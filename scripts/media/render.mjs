// README 영상 합성: stage.html을 프레임마다 찍어 GIF(README용)와, 원하면 MP4(고화질)를 만든다.
//   FFMPEG=<ffmpeg 경로> node scripts/media/render.mjs [ko|en ...] [01 02 03 04 ...] [--mp4] [--preview 1.5,6,9] [--workers 8]
//   결과: docs/media/<lang>/<이름>.gif · (--mp4) scripts/media/.cache/out/<lang>/<이름>.mp4
//   (record.mjs의 녹화가 먼저 있어야 한다)
//
// 속도: Chrome은 이미 GPU로 그리고, 시간은 프레임을 찍는 데 든다. 그래서
//   - 작업자마다 Chrome을 따로 띄운다 — puppeteer는 한 브라우저 안의 스크린샷을 한 번에 하나씩만 찍는다.
//   - page.screenshot 대신 CDP로 바로 찍고, 브라우저는 모든 클립에 다시 쓴다.
//   - 인코딩(ffmpeg)은 다음 클립을 찍는 동안 뒤에서 돌린다.
//   - GIF만 만들 때는 GIF 프레임(15fps)만 찍는다. MP4는 30fps라 --mp4일 때만.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const HERE = path.join(ROOT, 'scripts', 'media');
const CACHE = path.join(HERE, '.cache');
const FONTS = path.join(ROOT, 'examples', 'showcase', 'fonts');
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const CHROME = process.env.CHROME_PATH || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => fs.existsSync(p));
const NAMES = { '01': '01-text', '02': '02-layout', '03': '03-areas-slides', '04': '04-send' };
const GIF = { width: 1280, fps: 15 };
const MP4_FPS = 30;
const CHUNK = 12; // 작업자가 한 번에 가져가는 프레임 수

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const langs = args.filter((a) => a === 'ko' || a === 'en');
const clips = args.filter((a) => NAMES[a]);
const preview = flag('--preview');
const previewDir = path.join(CACHE, 'preview', flag('--preview-dir') || String(Date.now()));
const mp4 = args.includes('--mp4');
const fps = mp4 ? MP4_FPS : GIF.fps;
// 이 Mac(M3 Max, 14코어)에서는 8개가 가장 빨랐다. 더 늘리면 Chrome끼리 CPU를 다툰다.
const cores = os.availableParallelism?.() ?? os.cpus().length;
const workers = preview ? 1 : Number(flag('--workers')) || Math.max(2, Math.min(8, Math.ceil(cores * 0.6)));

const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let file = null;
      if (u === '/' || u === '/stage.html') file = path.join(HERE, 'stage.html');
      else if (u.startsWith('/fonts/')) file = path.join(FONTS, u.slice(7));
      else if (u.startsWith('/rec/')) file = path.join(CACHE, 'rec', u.slice(5));
      if (!file || file.includes('..') || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'max-age=3600' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

async function launchWorker() {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', protocolTimeout: 120000, args: ['--force-color-profile=srgb', '--hide-scrollbars'] });
  const page = (await browser.pages())[0] || await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('page error', e.message));
  return { browser, page, cdp: await page.createCDPSession() };
}

// Chrome의 오류 보고 도우미가 브라우저보다 오래 살아 파이프를 붙잡으면 이 스크립트가 끝나지 않는다.
async function closeWorker(w) {
  const proc = w.browser.process();
  await w.browser.close();
  for (const s of [proc?.stdin, proc?.stdout, proc?.stderr]) s?.destroy();
}

async function openStage(w, port, lang, clip) {
  await w.page.goto(`http://127.0.0.1:${port}/stage.html`);
  return w.page.evaluate((l, c) => window.setup(l, c), lang, clip);
}

async function shoot(w, file, quality = 92) {
  const { data } = await w.cdp.send('Page.captureScreenshot', { format: 'jpeg', quality });
  await fs.promises.writeFile(file, Buffer.from(data, 'base64'));
}

// 모든 작업자가 같은 클립을 열고, 프레임을 CHUNK개씩 나눠 가져가며 찍는다.
async function capture(pool, port, lang, clip, dir) {
  const [info] = await Promise.all(pool.map((w) => openStage(w, port, lang, clip)));
  const n = Math.round(info.duration * fps);
  let next = 0;
  await Promise.all(pool.map(async (w) => {
    for (let a = next; a < n; a = next) {
      next = a + CHUNK;
      for (let i = a; i < Math.min(n, a + CHUNK); i++) {
        await w.page.evaluate((t) => window.renderAt(t), i / fps);
        await shoot(w, path.join(dir, `f${String(i).padStart(5, '0')}.jpg`));
      }
    }
  }));
  return { ...info, frames: n };
}

function ff(argv) {
  return new Promise((resolve, reject) => {
    const c = spawn(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', ...argv], { stdio: 'inherit' });
    c.on('error', reject);
    c.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg failed: ${argv.join(' ')}`))));
  });
}

async function encode(lang, clip, dir) {
  const gifDir = path.join(ROOT, 'docs', 'media', lang); fs.mkdirSync(gifDir, { recursive: true });
  const gif = path.join(gifDir, `${NAMES[clip]}.gif`);
  const input = ['-framerate', String(fps), '-i', path.join(dir, 'f%05d.jpg')];
  const jobs = [ff([...input, '-vf', `fps=${GIF.fps},scale=${GIF.width}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff:max_colors=192[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`, gif])];
  const outs = [gif];
  if (mp4) {
    const outDir = path.join(CACHE, 'out', lang); fs.mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, `${NAMES[clip]}.mp4`);
    jobs.push(ff([...input, '-vf', 'format=rgb24,scale=out_range=limited:out_color_matrix=bt709,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '20',
      '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-movflags', '+faststart', file]));
    outs.push(file);
  }
  await Promise.all(jobs);
  return outs.map((f) => `${path.extname(f).slice(1)} ${(fs.statSync(f).size / 1048576).toFixed(2)}MB`).join(' · ');
}

const T0 = Date.now();
const sec = (t) => ((Date.now() - t) / 1000).toFixed(1);
const srv = await serve();
const port = srv.address().port;
const pool = await Promise.all(Array.from({ length: workers }, launchWorker));
const encodes = [];
try {
  for (const lang of langs.length ? langs : ['ko', 'en']) {
    for (const clip of clips.length ? clips : Object.keys(NAMES)) {
      if (preview) {
        const dir = previewDir; fs.mkdirSync(dir, { recursive: true });
        const info = await openStage(pool[0], port, lang, clip);
        console.log(`[${lang} ${clip}] ${info.duration.toFixed(2)}s`);
        for (const t of preview.split(',').map(Number)) {
          await pool[0].page.evaluate((x) => window.renderAt(x), t);
          const f = path.join(dir, `${lang}-${clip}-${t.toFixed(2)}.jpg`);
          await shoot(pool[0], f, 90);
          console.log(f);
        }
        continue;
      }
      const dir = path.join(CACHE, 'frames', lang, clip);
      fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
      const t0 = Date.now();
      const info = await capture(pool, port, lang, clip, dir);
      const shot = sec(t0);
      encodes.push(encode(lang, clip, dir).then((sizes) => {
        console.log(`[${lang} ${clip}] ${info.duration.toFixed(1)}s · ${info.frames} frames ${shot}s → ${sizes}`);
      }));
    }
  }
  await Promise.all(encodes);
  if (!preview) console.log(`done in ${sec(T0)}s (workers ${workers}${mp4 ? ', mp4' : ''})`);
} finally {
  await Promise.all(pool.map(closeWorker));
  srv.close();
}
