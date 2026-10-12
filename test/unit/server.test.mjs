import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { startServer, injectClient } from '../../src/server.mjs';

let srv;
let dir;
let port;

function req(method, p, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: { host: `localhost:${port}`, ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', reject);
    if (body !== undefined) r.write(typeof body === 'string' ? body : JSON.stringify(body));
    r.end();
  });
}

const json = (body) => ({
  headers: { 'content-type': 'application/json', origin: `http://localhost:${port}` },
  body,
});

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'redpen-srv-'));
  const root = path.join(dir, 'deck');
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><html><head><title>t</title><script src="slides.js"></script></head><body><section class="slide">안녕하세요 여러분</section></body></html>');
  fs.writeFileSync(path.join(root, 'slides.js'), 'const t = "슬라이드 본문";\n');
  fs.writeFileSync(path.join(root, 'assets', 'clip.txt'), '0123456789');
  fs.writeFileSync(path.join(dir, 'secret.txt'), 'top secret');
  srv = await startServer({ deckPath: path.join(root, 'index.html'), port: 0 });
  port = srv.port;
});

after(() => srv?.close());

test('injectClient ignores look-alike tags inside comments and scripts', () => {
  const commented = injectClient('<html><head><!-- <meta charset="euc-kr"> --><title>t</title>');
  assert.match(commented, /<head><script type="module"[^>]*><\/script><!--/);
  const scripted = injectClient('<html><head><script>document.write("<head><meta charset=\\"utf-8\\">")</script>');
  assert.match(scripted, /<head><script type="module"[^>]*><\/script><script>document\.write/);
});

test('injectClient puts the overlay early in <head> (after the charset), with fallbacks', () => {
  assert.match(injectClient('<html><head><meta charset="utf-8"><script src="a.js">'), /<meta charset="utf-8"><script type="module" src="\/__redpen\/app\/main\.js"><\/script><script src="a\.js">/);
  assert.match(injectClient('<html><head><title>x</title>'), /<head><script type="module"/);
  assert.match(injectClient('<!doctype html><header>x</header>'), /^<!doctype html><script/);
  assert.match(injectClient('<p>no head</p>'), /^<script/);
});

test('serves the deck with the overlay injected and no caching', async () => {
  const r = await req('GET', '/index.html');
  assert.equal(r.status, 200);
  assert.match(r.body, /<head><script type="module" src="\/__redpen\/app\/main\.js">/); // no charset meta in this deck
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.equal((await req('GET', '/')).status, 302);
});

test('rejects foreign Host headers (DNS rebinding)', async () => {
  const r = await req('GET', '/index.html', { headers: { host: 'evil.example:80' } });
  assert.equal(r.status, 403);
});

test('other sites cannot embed deck files, but may link to the review page', async () => {
  const embed = await req('GET', '/slides.js', { headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'script' } });
  assert.equal(embed.status, 403);
  assert.doesNotMatch(embed.body, /슬라이드 본문/);
  const local = await req('GET', '/slides.js', { headers: { 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'no-cors' } });
  assert.equal(local.status, 403, 'another localhost port is a different origin too');
  const nav = await req('GET', '/index.html', { headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' } });
  assert.equal(nav.status, 200);
  const own = await req('GET', '/slides.js', { headers: { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'no-cors' } });
  assert.equal(own.status, 200);
});

test('every response forbids cross-origin embedding and MIME sniffing', async () => {
  const r = await req('GET', '/assets/clip.txt');
  assert.equal(r.headers['cross-origin-resource-policy'], 'same-origin');
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
});

test('never serves files outside the deck folder or review data', async () => {
  for (const p of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/assets/..%2f..%2fsecret.txt', '/.redpen/index.html/server.json', '/.REDPEN/index.html/server.json', '/.Redpen/.gitignore', '/x%00.txt']) {
    const r = await req('GET', p);
    assert.notEqual(r.status, 200, p);
    assert.doesNotMatch(r.body, /top secret|"pid"/, p);
  }
});

test('supports byte ranges and conditional requests for media', async () => {
  const r = await req('GET', '/assets/clip.txt', { headers: { range: 'bytes=2-5' } });
  assert.equal(r.status, 206);
  assert.equal(r.body, '2345');
  assert.equal(r.headers['content-range'], 'bytes 2-5/10');
  const full = await req('GET', '/assets/clip.txt');
  assert.equal((await req('GET', '/assets/clip.txt', { headers: { 'if-none-match': full.headers.etag } })).status, 304);
});

test('serves the client modules and a generated config', async () => {
  assert.match((await req('GET', '/__redpen/app/main.js')).body, /import config/);
  const cfg = await req('GET', '/__redpen/app/config.js');
  assert.match(cfg.body, /export default \{"deckName":"index\.html"/);
  assert.equal((await req('GET', '/__redpen/app/../server.mjs')).status, 404);
});

test('writes require a same-origin browser request', async () => {
  assert.equal((await req('PUT', '/__redpen/api/draft', { body: '{}' })).status, 403);
  assert.equal((await req('PUT', '/__redpen/api/draft', { headers: { origin: 'https://evil.example' }, body: '{}' })).status, 403);
  const ok = await req('PUT', '/__redpen/api/draft', json({ items: [{ id: 'a', type: 'delete', target: 'text' }], deckComment: 'hi' }));
  assert.equal(ok.status, 200);
  const state = JSON.parse((await req('GET', '/__redpen/api/state')).body);
  assert.equal(state.draft.items[0].id, 'a');
  assert.equal(state.agent.status, 'offline');
});

test('submit creates a round with source hints and clears the draft', async () => {
  assert.equal((await req('POST', '/__redpen/api/submit', json({ items: [], deckComment: '' }))).status, 400);
  const items = [
    { n: 1, type: 'delete', target: 'text', slide: { index: 0, total: 1, title: '' }, text: { exact: '슬라이드 본문', prefix: '', suffix: '', occurrence: 0, domCount: 1 } },
    { n: 2, type: 'bogus', target: 'text' },
  ];
  const r = await req('POST', '/__redpen/api/submit', json({ items, deckComment: '', meta: { slideSelector: '.slide', slideCount: 1 } }));
  assert.equal(r.status, 200);
  const res = JSON.parse(r.body);
  assert.equal(res.round, 1);
  assert.match(res.markdown, /소스: `slides\.js:1`/);
  assert.doesNotMatch(res.markdown, /bogus/);
  const state = JSON.parse((await req('GET', '/__redpen/api/state')).body);
  assert.equal(state.draft.items.length, 0);
  assert.equal(state.rounds[0].total, 1);
  const md = await req('GET', '/__redpen/api/round/1/markdown?channel=clipboard');
  assert.match(md.body, /빨간펜 수정 요청 · 1차/);
});

test('only files the page actually loaded trigger a reload', async () => {
  const root = path.join(dir, 'deck');
  const events = [];
  await new Promise((resolve, reject) => {
    const r = http.get({ host: '127.0.0.1', port, path: '/__redpen/api/events', headers: { host: `localhost:${port}` } }, (res) => {
      res.setEncoding('utf8');
      res.on('data', (chunk) => { for (const m of chunk.matchAll(/event: reload\ndata: (.*)\n/g)) events.push(JSON.parse(m[1])); });
      setTimeout(async () => {
        await req('GET', '/slides.js'); // the page loads slides.js…
        fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
        fs.writeFileSync(path.join(root, '.claude', 'settings.local.json'), '{}'); // …but not this
        fs.writeFileSync(path.join(root, 'notes.md'), 'unrelated');
        await new Promise((d) => setTimeout(d, 700));
        assert.equal(events.length, 0, `unexpected reload: ${JSON.stringify(events)}`);
        fs.appendFileSync(path.join(root, 'slides.js'), '// edit\n');
        await new Promise((d) => setTimeout(d, 900));
        r.destroy();
        resolve();
      }, 200);
    });
    r.on('error', (err) => (err.code === 'ECONNRESET' ? resolve() : reject(err)));
  });
  assert.ok(events.some((e) => e.files.includes('slides.js')), `expected a reload for slides.js, got ${JSON.stringify(events)}`);
});
