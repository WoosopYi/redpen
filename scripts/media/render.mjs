// README 영상 합성: stage.html을 프레임마다 찍어 GIF(README용)와 MP4(고화질)로 만든다.
//   FFMPEG=<ffmpeg 경로> node scripts/media/render.mjs [ko|en ...] [00 01 02 03 04 ...] [--preview 1.5,6,9] [--workers 4]
//   결과: docs/media/<lang>/<이름>.gif · scripts/media/.cache/out/<lang>/<이름>.mp4
//   (00은 녹화 없는 개요, 01~04는 record.mjs의 녹화가 먼저 있어야 한다)
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
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
const FPS = 30;
const NAMES = { '00': '00-overview', '01': '01-text', '02': '02-layout', '03': '03-areas-slides', '04': '04-send' };
const GIF = { width: 1280, fps: 15 };

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const langs = args.filter((a) => a === 'ko' || a === 'en');
const clips = args.filter((a) => NAMES[a]);
const preview = flag('--preview');
const previewDir = path.join(CACHE, 'preview', flag('--preview-dir') || String(Date.now()));
const workers = Number(flag('--workers') || 4);

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

async function openStage(browser, port, lang, clip) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error(`[${lang} ${clip}] page error`, e.message));
  await page.goto(`http://127.0.0.1:${port}/stage.html`);
  const info = await page.evaluate((l, c) => window.setup(l, c), lang, clip);
  return { page, info };
}

async function renderRange(browser, port, lang, clip, from, to, dir) {
  const { page } = await openStage(browser, port, lang, clip);
  for (let i = from; i < to; i++) {
    await page.evaluate((t) => window.renderAt(t), i / FPS);
    await page.screenshot({ path: path.join(dir, `f${String(i).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 92 });
  }
  await page.close();
}

function ff(argv) {
  const r = spawnSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', ...argv], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${argv.join(' ')}`);
}

const srv = await serve();
const port = srv.address().port;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--force-color-profile=srgb', '--hide-scrollbars'] });
try {
  for (const lang of langs.length ? langs : ['ko', 'en']) {
    for (const clip of clips.length ? clips : Object.keys(NAMES)) {
      if (preview) {
        const dir = previewDir; fs.mkdirSync(dir, { recursive: true });
        const { page, info } = await openStage(browser, port, lang, clip);
        console.log(`[${lang} ${clip}] ${info.duration.toFixed(2)}s`);
        for (const t of preview.split(',').map(Number)) {
          await page.evaluate((x) => window.renderAt(x), t);
          const f = path.join(dir, `${lang}-${clip}-${t.toFixed(2)}.jpg`);
          await page.screenshot({ path: f, type: 'jpeg', quality: 90 });
          console.log(f);
        }
        await page.close();
        continue;
      }
      const dir = path.join(CACHE, 'frames', lang, clip);
      fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
      const { page, info } = await openStage(browser, port, lang, clip); await page.close();
      const N = info.frames; const per = Math.ceil(N / workers); const jobs = [];
      for (let w = 0; w < workers; w++) { const a = w * per, b = Math.min(N, a + per); if (a < b) jobs.push(renderRange(browser, port, lang, clip, a, b, dir)); }
      const t0 = Date.now();
      await Promise.all(jobs);
      const outDir = path.join(CACHE, 'out', lang); fs.mkdirSync(outDir, { recursive: true });
      const gifDir = path.join(ROOT, 'docs', 'media', lang); fs.mkdirSync(gifDir, { recursive: true });
      const mp4 = path.join(outDir, `${NAMES[clip]}.mp4`);
      const gif = path.join(gifDir, `${NAMES[clip]}.gif`);
      const input = ['-framerate', String(FPS), '-i', path.join(dir, 'f%05d.jpg')];
      ff([...input, '-vf', 'format=rgb24,scale=out_range=limited:out_color_matrix=bt709,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '20',
        '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-movflags', '+faststart', mp4]);
      ff([...input, '-vf', `fps=${GIF.fps},scale=${GIF.width}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff:max_colors=192[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`, gif]);
      const mb = (f) => (fs.statSync(f).size / 1048576).toFixed(2);
      console.log(`[${lang} ${clip}] ${info.duration.toFixed(1)}s, ${N} frames in ${((Date.now() - t0) / 1000).toFixed(0)}s → gif ${mb(gif)}MB · mp4 ${mb(mp4)}MB`);
    }
  }
} finally {
  await browser.close();
  srv.close();
}
