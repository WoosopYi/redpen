import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.mjs';
import { loadSources, annotate } from './locate.mjs';
import { renderRounds } from './prompt.mjs';
import { readJSON, writeJSON } from './util.mjs';
import { itemSummary } from './client/summary.js';
import { tr, setLang } from './client/i18n/index.js';

const CLIENT_DIR = fileURLToPath(new URL('./client/', import.meta.url));
export const VERSION = readJSON(fileURLToPath(new URL('../package.json', import.meta.url)), {})?.version || '0.0.0';

/** Fingerprint of the browser code being served (names, sizes, mtimes) — open tabs compare it to notice updates. */
export function clientBuild() {
  const parts = [VERSION];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, name);
      const st = fs.statSync(file);
      if (st.isDirectory()) walk(file);
      else if (name.endsWith('.js')) parts.push(`${path.relative(CLIENT_DIR, file)}:${st.size}:${Math.floor(st.mtimeMs)}`);
    }
  };
  try {
    walk(CLIENT_DIR);
  } catch {
    /* unreadable: fall back to the version */
  }
  let h = 0;
  for (const ch of parts.join('|')) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  return `${VERSION}-${(h >>> 0).toString(36)}`;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.pdf': 'application/pdf',
  '.wasm': 'application/wasm',
};

const TEMP_FILE = /(^|[\\/])(\.#|#)|~$|\.sw[px]$|\.tmp$|(^|[\\/])4913$/;
const CLIENT_TAG = '<script type="module" src="/__redpen/app/main.js"></script>';

const TYPES = new Set(['delete', 'replace', 'comment', 'layout']);
const TARGETS = new Set(['text', 'element', 'region', 'slide', 'sketch']);

const clip = (s, n) => {
  s = String(s ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

/** Blank out comments, scripts and styles (same length) so tag look-alikes inside them are never matched. */
function maskInert(html) {
  return html.replace(/<!--[\s\S]*?(?:-->|$)|<(script|style)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, (m) => ' '.repeat(m.length));
}

/** Insert the overlay script early in <head> — after a charset declaration, so encoding sniffing still sees it. */
export function injectClient(html) {
  const masked = maskInert(html);
  const m = /<meta\b[^>]*charset[^>]*>/i.exec(masked.slice(0, 8192))
    || /<head\b[^>]*>/i.exec(masked) || /<html\b[^>]*>/i.exec(masked) || /<!doctype[^>]*>/i.exec(masked);
  if (!m) return CLIENT_TAG + html;
  const at = m.index + m[0].length;
  return html.slice(0, at) + CLIENT_TAG + html.slice(at);
}

function capStrings(value) {
  return JSON.parse(JSON.stringify(value, (_key, v) => (typeof v === 'string' && v.length > 50000 ? v.slice(0, 50000) : v)));
}

function sanitizeItems(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 1000).filter((it) => it && TYPES.has(it.type) && TARGETS.has(it.target)).map(capStrings);
}

function readBody(req, limit = 10 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('payload too large'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function listen(server, port, host, tries = 40) {
  return new Promise((resolve, reject) => {
    const attempt = (p, left) => {
      const onError = (err) => {
        server.off('listening', onListening);
        if (err.code === 'EADDRINUSE' && left > 0) attempt(p + 1, left - 1);
        else reject(err);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve(server.address().port);
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(p, host);
    };
    attempt(port, tries);
  });
}

/**
 * Serve one deck with the review overlay injected, plus the small API the overlay talks to.
 * Binds to 127.0.0.1 only and rejects foreign Host/Origin headers (DNS rebinding, cross-site writes).
 */
export async function startServer({ deckPath, port = 4545, idleMinutes = 120, lang = 'ko', log = () => {} }) {
  setLang(lang); // server messages and list summaries; each round also records it for its prompt
  const store = new Store(deckPath).ensure();
  const root = store.deckDir;
  const deckName = store.deckName;
  const clients = new Set();
  const draftSeq = new Map(); // clientId → last autosave sequence number
  const relKey = (rel) => rel.split(path.sep).join('/').normalize('NFC');
  const served = new Set([relKey(deckName)]); // files the browser has loaded from us
  let lastActivity = Date.now();
  let lastState = '';

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      log(`error: ${err.stack || err}`);
      if (!res.headersSent) send(res, 500, String(err.message || err));
      else res.end();
    });
  });
  const actualPort = await listen(server, port, '127.0.0.1');
  const origin = `http://localhost:${actualPort}`;
  const url = `${origin}/${encodeURIComponent(deckName)}`;
  const hosts = new Set([`localhost:${actualPort}`, `127.0.0.1:${actualPort}`]);
  const origins = new Set([...hosts].map((h) => `http://${h}`));

  // ---- helpers -------------------------------------------------------------

  function send(res, status, body, headers = {}) {
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(body);
  }

  function sendJSON(res, status, data) {
    send(res, status, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8' });
  }

  function broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(payload);
  }

  function summarize(r) {
    const counts = { delete: 0, replace: 0, comment: 0, layout: 0 };
    for (const it of r.items || []) counts[it.type] = (counts[it.type] || 0) + 1;
    return {
      round: r.round,
      createdAt: r.createdAt,
      counts,
      total: (r.items || []).length,
      deckComment: clip(r.deckComment, 200),
      delivered: r.delivered,
      replies: r.replies,
      items: (r.items || []).slice(0, 100).map((it) => ({
        n: it.n,
        type: it.type,
        target: it.target,
        slide: it.slide && !it.slide.single ? it.slide.index + 1 : null,
        text: it.type === 'layout' ? clip(itemSummary(it), 70)
          : it.text?.exact ? clip(it.text.exact, 70)
            : it.element ? `<${it.element.tag}>${it.element.text ? ` ${clip(it.element.text, 40)}` : ''}`
              : '',
        replacement: it.type === 'replace' ? clip(it.replacement, 70) : undefined,
        comment: it.comment ? clip(it.comment, 90) : undefined,
      })),
    };
  }

  function agentStatus(rounds) {
    const agent = store.readAgent();
    if (agent) return { status: 'waiting', since: agent.since };
    const open = rounds.filter((r) => r.delivered && r.delivered.via !== 'clipboard' && !r.replies.length
      && Date.now() - r.delivered.at < 45 * 60 * 1000);
    if (open.length) return { status: 'working', round: open.at(-1).round, since: open.at(-1).delivered.at };
    return { status: 'offline' };
  }

  function computeState() {
    const rounds = store.rounds();
    return { rounds: rounds.map(summarize), agent: agentStatus(rounds), build: clientBuild(), lang };
  }

  function pushState(force = false) {
    if (!clients.size && !force) return;
    const s = JSON.stringify(computeState());
    if (s === lastState && !force) return;
    lastState = s;
    broadcast('state', s);
  }

  // ---- routes --------------------------------------------------------------

  async function handle(req, res) {
    lastActivity = Date.now();
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    if (!hosts.has(req.headers.host)) return send(res, 403, 'Forbidden host');
    // Other sites may link here, but may not embed our files (e.g. <script src=".../slides.js"> would leak slide text).
    const site = req.headers['sec-fetch-site'];
    if ((site === 'cross-site' || site === 'same-site') && req.headers['sec-fetch-mode'] !== 'navigate') {
      return send(res, 403, 'Forbidden cross-site request');
    }
    const u = new URL(req.url, origin);
    let p;
    try {
      p = decodeURIComponent(u.pathname);
    } catch {
      return send(res, 400, 'Bad path');
    }
    if (p.includes('\0')) return send(res, 400, 'Bad path');
    if (p === '/') return send(res, 302, '', { Location: `/${encodeURIComponent(deckName)}` });
    if (p.startsWith('/__redpen/')) return internal(req, res, p.slice('/__redpen/'.length), u);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    if (p === `/${deckName}`) return serveDeck(req, res);
    return serveStatic(req, res, p);
  }

  async function internal(req, res, route, u) {
    if (route === 'ping') return sendJSON(res, 200, { ok: true, deckPath: store.deckPath, pid: process.pid, version: VERSION, lang });

    if (route === 'app/config.js') {
      const cfg = {
        deckName,
        deckPath: store.deckPath,
        slideSelector: store.readSettings().slideSelector || null,
        version: VERSION,
        build: clientBuild(),
        lang,
      };
      return send(res, 200, `export default ${JSON.stringify(cfg)};\n`, { 'Content-Type': MIME['.js'] });
    }
    if (route.startsWith('app/')) {
      const rel = path.normalize(route.slice(4));
      const abs = path.resolve(CLIENT_DIR, rel);
      if (!abs.startsWith(CLIENT_DIR) || !/\.(js|css)$/.test(abs)) return send(res, 404, 'Not found');
      try {
        const body = await fs.promises.readFile(abs);
        return send(res, 200, body, { 'Content-Type': MIME[path.extname(abs)] });
      } catch {
        return send(res, 404, 'Not found');
      }
    }

    if (!route.startsWith('api/')) return send(res, 404, 'Not found');
    const api = route.slice(4);

    if (req.method !== 'GET' && !origins.has(req.headers.origin)) return send(res, 403, 'Forbidden origin');

    if (api === 'state' && req.method === 'GET') {
      return sendJSON(res, 200, { ...computeState(), draft: store.readDraft(), deckPath: store.deckPath });
    }

    if (api === 'events' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      });
      res.write(`retry: 1500\nevent: state\ndata: ${JSON.stringify(computeState())}\n\n`);
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 20000);
      req.on('close', () => {
        clearInterval(ping);
        clients.delete(res);
        lastActivity = Date.now();
      });
      return undefined;
    }

    if (api === 'draft' && (req.method === 'PUT' || req.method === 'POST')) {
      const body = JSON.parse((await readBody(req)) || '{}');
      // A slow autosave must not overwrite a newer one from the same tab.
      if (body.clientId && Number.isFinite(body.seq)) {
        if (body.seq <= (draftSeq.get(body.clientId) || 0)) return sendJSON(res, 200, { ok: true, stale: true });
        draftSeq.set(body.clientId, body.seq);
      }
      const draft = store.writeDraft({
        items: Array.isArray(body.items) ? body.items.slice(0, 1000).map(capStrings) : [],
        deckComment: String(body.deckComment || '').slice(0, 50000),
      });
      broadcast('draft', { ...draft, clientId: body.clientId || null });
      return sendJSON(res, 200, { ok: true, updatedAt: draft.updatedAt });
    }

    if (api === 'submit' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const items = sanitizeItems(body.items);
      const deckComment = String(body.deckComment || '').slice(0, 50000);
      if (!items.length && !deckComment.trim()) return sendJSON(res, 400, { error: tr('보낼 표시가 없습니다.') });

      if (body.clientId && Number.isFinite(body.seq)) {
        draftSeq.set(body.clientId, Math.max(body.seq, draftSeq.get(body.clientId) || 0));
      }
      const meta = body.meta || {};
      const sources = loadSources(store.deckPath);
      const slideSources = annotate(items, sources);
      const channel = body.channel === 'clipboard' ? 'clipboard' : 'agent';
      const round = store.createRound({
        deck: {
          path: store.deckPath,
          name: deckName,
          slideSelector: meta.slideSelector || null,
          slideCount: meta.slideCount || null,
          sourceFiles: sources.map((f) => f.rel),
        },
        deckComment,
        items,
        slideSources,
        lang,
      }, { claimVia: channel === 'clipboard' ? 'clipboard' : null });
      store.writeRoundMarkdown(round.round, renderRounds([round], { channel: 'file' }));
      store.writeDraft({ items: [], deckComment: '' });
      broadcast('draft', { items: [], deckComment: '', updatedAt: Date.now(), clientId: body.clientId || null });
      pushState(true);
      log(`round ${round.round}: ${items.length} item(s) via ${channel}`);
      return sendJSON(res, 200, {
        round: round.round,
        markdown: renderRounds([round], { channel: channel === 'clipboard' ? 'clipboard' : 'wait' }),
        agent: computeState().agent,
      });
    }

    if (api === 'quit' && req.method === 'POST') {
      // ⏻ in the browser: a waiting `redpen wait` ends ("the user closed the review"), and until the next
      // `redpen open` a later `redpen wait` won't bring the server back on its own.
      const at = Date.now();
      if (store.readAgent()) writeJSON(store.file('stop'), { at, by: 'browser' });
      writeJSON(store.file('closed.json'), { at, by: 'browser' });
      log('quit from the browser');
      sendJSON(res, 200, { ok: true });
      setTimeout(() => close('quit'), 50);
      return undefined;
    }

    const md = /^round\/(\d+)\/markdown$/.exec(api);
    if (md && req.method === 'GET') {
      const round = store.readRound(Number(md[1]));
      if (!round) return send(res, 404, 'Not found');
      const channel = u.searchParams.get('channel') === 'clipboard' ? 'clipboard' : 'file';
      return send(res, 200, renderRounds([round], { channel }), { 'Content-Type': MIME['.md'] });
    }

    return send(res, 404, 'Not found');
  }

  async function serveDeck(req, res) {
    let raw;
    try {
      raw = await fs.promises.readFile(store.deckPath);
    } catch {
      return send(res, 404, tr('HTML 파일을 찾을 수 없습니다: {path}', { path: store.deckPath }));
    }
    // latin1 round-trips bytes exactly, so decks in other encodings (e.g. EUC-KR) are not mangled.
    const html = raw.toString('latin1');
    const declared = /<meta\b[^>]*charset\s*=\s*["']?\s*([\w-]+)/i.exec(maskInert(html.slice(0, 8192)))?.[1];
    const type = declared && !/^utf-?8$/i.test(declared) ? 'text/html' : MIME['.html'];
    const body = Buffer.from(injectClient(html), 'latin1');
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    return res.end(req.method === 'HEAD' ? undefined : body);
  }

  async function serveStatic(req, res, p) {
    const rel = path.normalize(p).replace(/^[/\\]+/, '');
    // No dotfiles at all: .redpen, .git, .env… (also covers .REDPEN on case-insensitive disks)
    if (rel.split(/[/\\]/).some((seg) => seg.startsWith('.'))) return send(res, 404, 'Not found');
    const abs = path.resolve(root, rel);
    if (abs !== root && !abs.startsWith(root + path.sep)) return send(res, 403, 'Forbidden');
    let file = abs;
    let st;
    try {
      st = await fs.promises.stat(file);
      if (st.isDirectory()) {
        file = path.join(file, 'index.html');
        st = await fs.promises.stat(file);
      }
    } catch {
      if (rel === 'favicon.ico') return send(res, 204, '');
      return send(res, 404, 'Not found');
    }
    served.add(relKey(path.relative(root, file)));
    const etag = `W/"${st.size}-${Math.floor(st.mtimeMs)}"`;
    const headers = {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      ETag: etag,
      'Last-Modified': st.mtime.toUTCString(),
      'Accept-Ranges': 'bytes',
    };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      return res.end();
    }
    const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    let start = 0;
    let end = st.size - 1;
    let status = 200;
    if (range && (range[1] || range[2])) {
      if (range[1] === '') {
        start = Math.max(0, st.size - Number(range[2]));
      } else {
        start = Number(range[1]);
        if (range[2] !== '') end = Math.min(Number(range[2]), st.size - 1);
      }
      if (start > end || start >= st.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
        return res.end();
      }
      status = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
    }
    headers['Content-Length'] = st.size ? end - start + 1 : 0;
    res.writeHead(status, headers);
    if (req.method === 'HEAD' || !st.size) return res.end();
    const stream = fs.createReadStream(file, { start, end });
    stream.on('error', () => res.destroy());
    return stream.pipe(res);
  }

  // ---- watchers ------------------------------------------------------------

  // Only files the page actually loaded trigger a reload (not .claude/, dist/, logs… next to the deck).
  let reloadTimer = null;
  const changed = new Set();
  const onFsEvent = (_event, filename) => {
    if (!filename) return;
    const rel = relKey(String(filename));
    if (TEMP_FILE.test(rel) || !served.has(rel)) return;
    changed.add(rel);
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      const files = [...changed];
      changed.clear();
      log(`changed: ${files.join(', ')}`);
      broadcast('reload', { files });
    }, 300);
  };
  let watcher = null;
  try {
    watcher = fs.watch(root, { recursive: true }, onFsEvent);
  } catch {
    try {
      watcher = fs.watch(root, onFsEvent);
    } catch (err) {
      log(`watch failed: ${err.message}`);
    }
  }
  watcher?.on('error', (err) => log(`watch error: ${err.message}`));

  const statePoll = setInterval(() => pushState(), 800);
  const idleCheck = setInterval(() => {
    if (!clients.size && idleMinutes > 0 && Date.now() - lastActivity > idleMinutes * 60 * 1000) {
      log('idle — shutting down');
      close('idle');
    }
  }, 60 * 1000);

  store.writeServer({ pid: process.pid, port: actualPort, url, deckPath: store.deckPath, startedAt: Date.now(), version: VERSION });
  log(`serving ${store.deckPath} at ${url}`);

  let closed = false;
  /** Shut down; open tabs are told first, so they hand the deck back instead of showing "connection lost". */
  function close(reason = 'stop') {
    if (closed) return;
    closed = true;
    clearInterval(statePoll);
    clearInterval(idleCheck);
    clearTimeout(reloadTimer);
    watcher?.close();
    if (reason !== 'restart') broadcast('closed', { reason });
    for (const res of clients) res.end();
    clients.clear();
    store.clearServer(process.pid);
    server.close();
    server.closeAllConnections?.();
    server.emit('redpen-closed');
  }

  return { server, port: actualPort, url, store, close };
}
