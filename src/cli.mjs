import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store } from './store.mjs';
import { renderRounds } from './prompt.mjs';
import { readJSON, writeJSON, isAlive, sleep, openBrowser } from './util.mjs';
import { tr, pick, setLang } from './client/i18n/index.js';
import { explicitLang, systemLang } from './lang.mjs';

const BIN = fileURLToPath(new URL('../bin/redpen.mjs', import.meta.url));
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PKG_NAME = readJSON(path.join(ROOT, 'package.json'), {}).name || 'redpen';
const SKILL = path.join(ROOT, 'skills', 'redpen', 'SKILL.md');
const skillDirs = (home = os.homedir()) => [
  ['Claude Code', path.join(home, '.claude', 'skills', 'redpen')],
  ['Codex', path.join(home, '.codex', 'skills', 'redpen')],
];
const LAST = path.join(process.env.REDPEN_HOME || path.join(os.homedir(), '.redpen'), 'last.json');

const COMMANDS = new Set(['open', 'serve', 'wait', 'pending', 'done', 'status', 'stop', 'setup', 'help', 'version']);
const BOOLEAN_FLAGS = new Set(['no-open', 'help', 'version', 'claude', 'codex', 'remove', 'json', 'quiet', 'stop']);

const HELP = {
  ko: `✒️  redpen — HTML 슬라이드 빨간펜 리뷰

브라우저에서 HTML 위에 직접 고칠 곳(삭제·수정·코멘트)을 표시하면,
슬라이드 번호·원문·문맥·소스 위치가 담긴 수정 요청으로 AI 세션에 전달합니다.

사용법
  redpen <html>                       리뷰 화면 열기 (= redpen open)
  redpen open <html> [--port 4545] [--slide ".slide"] [--lang ko|en] [--no-open]
  redpen wait [html] [--reply "…"] [--timeout 초]
                                      (AI용) 브라우저에서 보낼 때까지 기다렸다가 수정 요청 출력
  redpen pending [html]               (AI용) 대기 중인 수정 요청 출력
  redpen done [html] --reply "…" [--stop]
                                      (AI용) 반영 결과를 브라우저에 알리고 대기 종료 (--stop: 리뷰 화면도 끄기)
  redpen status [html]                상태 보기
  redpen stop [html]                  리뷰 서버 종료
  redpen setup [--claude] [--codex] [--remove]
                                      Claude Code·Codex에 redpen 스킬 설치

html을 생략하면 마지막으로 연 파일을 사용합니다. 폴더를 주면 그 안의 index.html을 엽니다.
--slide 로 슬라이드 요소 선택자를 직접 지정할 수 있습니다 (자동 감지가 틀릴 때).
--lang (또는 환경 변수 REDPEN_LANG) 으로 화면과 수정 요청의 언어를 고릅니다: ko 또는 en (기본: 시스템 언어).`,
  en: `✒️  redpen — a red pen for HTML slides

Mark what to fix (delete · replace · comment) right on the HTML in your browser, and it reaches
your AI session as an edit request with slide numbers, original text, context and source locations.

Usage
  redpen <html>                       open the review page (= redpen open)
  redpen open <html> [--port 4545] [--slide ".slide"] [--lang ko|en] [--no-open]
  redpen wait [html] [--reply "…"] [--timeout sec]
                                      (for the AI) wait until the browser sends, then print the edit request
  redpen pending [html]               (for the AI) print pending edit requests
  redpen done [html] --reply "…" [--stop]
                                      (for the AI) report the result to the browser and stop waiting
                                      (--stop: turn the review page off too)
  redpen status [html]                show the status
  redpen stop [html]                  stop the review server
  redpen setup [--claude] [--codex] [--remove]
                                      install the redpen skill for Claude Code and Codex

Without html, the file you opened last is used. Given a folder, its index.html is opened.
--slide sets the slide element selector yourself (when auto-detection gets it wrong).
--lang (or the REDPEN_LANG environment variable) picks the language of the page and the edit requests:
ko or en (default: your system language).`,
};

const out = (s = '') => process.stdout.write(`${s}\n`);
const err = (s = '') => process.stderr.write(`${s}\n`);
const q = (s) => JSON.stringify(s);
const write = (text) => new Promise((resolve) => process.stdout.write(text, resolve));

function parse(argv) {
  const flags = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      pos.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const key = eq > 0 ? a.slice(2, eq) : a.slice(2);
      if (eq > 0) flags[key] = a.slice(eq + 1);
      else if (BOOLEAN_FLAGS.has(key)) flags[key] = true;
      else if (i + 1 < argv.length) flags[key] = argv[++i];
      else flags[key] = true;
    } else if (a === '-h') flags.help = true;
    else if (a === '-v') flags.version = true;
    else pos.push(a);
  }
  let cmd = pos[0] && COMMANDS.has(pos[0]) ? pos.shift() : null;
  if (!cmd) cmd = flags.help ? 'help' : flags.version ? 'version' : pos.length ? 'open' : 'help';
  return { cmd, pos, flags };
}

function resolveDeck(arg) {
  let p = arg;
  if (!p) {
    const last = readJSON(LAST, null);
    if (last?.deckPath && fs.existsSync(last.deckPath)) p = last.deckPath;
    else throw new Error(tr('HTML 파일 경로를 지정하세요. 예) redpen open slides/index.html'));
  }
  let abs = path.resolve(p);
  let st;
  try {
    st = fs.statSync(abs);
  } catch {
    throw new Error(tr('파일을 찾을 수 없습니다: {path}', { path: abs }));
  }
  if (st.isDirectory()) {
    abs = path.join(abs, 'index.html');
    if (!fs.existsSync(abs)) throw new Error(tr('폴더에 index.html이 없습니다: {path}', { path: path.dirname(abs) }));
  }
  return fs.realpathSync(abs);
}

function ping(port) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/__redpen/ping', headers: { host: `localhost:${port}` }, timeout: 1500 },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

async function runningServer(store) {
  const s = store.readServer();
  if (!s || !isAlive(s.pid)) return null;
  const info = await ping(s.port);
  return info && info.deckPath === store.deckPath ? { ...s, lang: info.lang || 'ko' } : null;
}

/** SIGTERM turns redpen off (open tabs show "turned off"); SIGUSR2 is a restart (tabs reconnect to the new server). */
async function stopServer(s, signal = 'SIGTERM') {
  try {
    process.kill(s.pid, signal);
  } catch {
    try {
      process.kill(s.pid, 'SIGTERM'); // no SIGUSR2 (Windows)
    } catch {
      /* already gone */
    }
  }
  for (let i = 0; i < 50 && isAlive(s.pid); i++) await sleep(100);
}

/**
 * Reuse the deck's running server, or start one. `lang` is a language asked for on purpose: with
 * `restart`, a server running in another language is replaced on the same port (open tabs reconnect
 * and reload in the new language); a new server gets it, or the system language.
 */
async function ensureServer(store, { port, lang = null, restart = false } = {}) {
  let s = await runningServer(store);
  if (s && restart && lang && s.lang !== lang) {
    port = port || s.port;
    await stopServer(s, 'SIGUSR2');
    s = null;
  }
  if (s) return { ...s, started: false };
  store.clearServer();
  const logFd = fs.openSync(store.file('server.log'), 'a');
  const args = [BIN, 'serve', store.deckPath, '--lang', lang || systemLang()];
  if (port) args.push('--port', String(port));
  const child = spawn(process.execPath, args, { cwd: store.deckDir, detached: true, stdio: ['ignore', logFd, logFd] });
  child.unref();
  fs.closeSync(logFd);
  let exited = false;
  child.on('exit', () => { exited = true; });
  for (let i = 0; i < 80 && !exited; i++) {
    await sleep(100);
    s = await runningServer(store);
    if (s) return { ...s, started: true };
  }
  throw new Error(tr('리뷰 서버를 시작하지 못했습니다. 로그: {path}', { path: store.file('server.log') }));
}

/** Take every round nobody has picked up yet (exactly-once across concurrent waiters). */
function claimAll(store, via) {
  return store.undelivered()
    .filter((r) => store.claim(r.round, via))
    .map((r) => store.readRound(r.round));
}

/** Attach the AI's message to rounds it has been working on (or the latest one it actually received). */
function reply(store, message) {
  const open = store.inProgress();
  const targets = open.length ? open : store.rounds().filter((r) => r.delivered).slice(-1);
  for (const r of targets) store.addReply(r.round, message);
  return targets.map((r) => r.round);
}

// ---- commands ----------------------------------------------------------------

/** After `npm update -g`, the skill copies made by `redpen setup` would be stale: refresh the installed ones. */
function syncSkills() {
  let want;
  try {
    want = fs.readFileSync(SKILL, 'utf8');
  } catch {
    return;
  }
  for (const [name, dir] of skillDirs()) {
    const file = path.join(dir, 'SKILL.md');
    let have;
    try {
      have = fs.readFileSync(file, 'utf8');
    } catch {
      continue; // not installed for this agent
    }
    if (have === want) continue;
    try {
      fs.writeFileSync(file, want);
      out(`✅ ${tr('{name} 스킬을 이 버전으로 바꿨습니다: {path}', { name, path: file })}`);
    } catch {
      /* read-only: leave it */
    }
  }
}

async function cmdOpen(pos, flags) {
  const deckPath = resolveDeck(pos[0]);
  syncSkills();
  const store = new Store(deckPath).ensure();
  fs.rmSync(store.file('closed.json'), { force: true }); // opened again after ⏻ / done --stop
  if (typeof flags.slide === 'string') store.writeSettings({ slideSelector: flags.slide.trim() || null });
  const s = await ensureServer(store, { port: flags.port, lang: flags.lang, restart: true });
  writeJSON(LAST, { deckPath, at: Date.now() });
  if (!flags['no-open']) openBrowser(s.url);
  out(`✒️  ${tr(s.started ? '빨간펜 리뷰 화면을 열었습니다: {url}' : '빨간펜 리뷰 화면이 이미 실행 중입니다: {url}', { url: s.url })}`);
  out(`   ${tr('대상: {path}', { path: deckPath })}`);
  out('');
  out(tr('브라우저에서 고칠 곳을 표시하고 [AI에게 보내기]를 누르세요.'));
  out(tr('AI 에이전트는 이 명령으로 수정 요청을 받습니다:  {cmd}', { cmd: `redpen wait ${q(deckPath)}` }));
}

async function cmdServe(pos, flags) {
  const deckPath = resolveDeck(pos[0]);
  const { startServer } = await import('./server.mjs');
  const log = (m) => out(`[${new Date().toISOString()}] ${m}`);
  const srv = await startServer({
    deckPath,
    port: flags.port !== undefined ? Number(flags.port) : 4545,
    idleMinutes: flags.idle !== undefined ? Number(flags.idle) : 120,
    lang: flags.lang || systemLang(),
    log,
  });
  const stop = (reason) => {
    srv.close(reason);
    setTimeout(() => process.exit(0), 50);
  };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => stop('stop'));
  if (process.platform !== 'win32') process.on('SIGUSR2', () => stop('restart')); // e.g. open --lang: tabs reconnect
  srv.server.on('redpen-closed', () => setTimeout(() => process.exit(0), 50));
}

async function cmdWait(pos, flags) {
  const deckPath = resolveDeck(pos[0]);
  const store = new Store(deckPath).ensure();
  const startedAt = Date.now();
  const timeout = Number(flags.timeout) || 0;
  const stopFile = store.file('stop');
  // Register first so the browser goes straight from "AI 반영 중" to "AI 대기 중" when the reply lands.
  store.writeAgent({ pid: process.pid, since: startedAt });
  if (typeof flags.reply === 'string' && flags.reply.trim()) reply(store, flags.reply.trim());
  if (readJSON(store.file('closed.json'), null)) {
    // turned off with ⏻ (or done --stop): don't bring the review page back and wait for nobody
    store.clearAgent(process.pid);
    await write(`${tr('사용자가 브라우저에서 빨간펜을 종료했습니다 (리뷰 끝). 다시 기다리지 마세요.')}\n`);
    process.exit(0);
  }

  let server = null;
  try {
    server = await ensureServer(store, { lang: flags.lang });
  } catch (e) {
    err(e.message);
  }

  const cleanup = () => store.clearAgent(process.pid);
  process.on('exit', cleanup);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => {
      cleanup();
      process.exit(130);
    });
  }

  err(`⏳ ${tr('브라우저에서 [AI에게 보내기]를 누를 때까지 기다립니다')}${server ? ` — ${server.url}` : ''}`);
  const deadline = timeout ? startedAt + timeout * 1000 : Infinity;
  for (;;) {
    // The newest waiter wins: a leftover `redpen wait` (e.g. from an old session) must not take the next round.
    const current = readJSON(store.file('agent.json'), null);
    if (current && current.pid !== process.pid && isAlive(current.pid) && current.since >= startedAt) {
      await write(`${tr('다른 redpen wait가 대기를 이어받아 이 대기는 끝냅니다.')}\n`);
      process.exit(0);
    }
    if (!current) store.writeAgent({ pid: process.pid, since: startedAt });
    const got = claimAll(store, 'wait');
    if (got.length) {
      cleanup();
      await write(renderRounds(got, { channel: 'wait' }));
      process.exit(0);
    }
    const stop = readJSON(stopFile, null);
    const stopAt = typeof stop === 'number' ? stop : stop?.at;
    if (stopAt && stopAt > startedAt) {
      fs.rmSync(stopFile, { force: true });
      cleanup();
      await write(`${stop?.by === 'browser'
        ? tr('사용자가 브라우저에서 빨간펜을 종료했습니다 (리뷰 끝). 다시 기다리지 마세요.')
        : tr('리뷰를 마쳤습니다 (redpen done). 더 기다리지 않습니다.')}\n`);
      process.exit(0);
    }
    if (Date.now() > deadline) {
      cleanup();
      await write(`${tr('(시간 초과) {n}초 동안 새 수정 요청이 없었습니다. 계속 기다리려면 다시 실행하세요:', { n: timeout })}\nredpen wait ${q(deckPath)}\n`);
      process.exit(2);
    }
    await sleep(500);
  }
}

async function cmdPending(pos) {
  const deckPath = resolveDeck(pos[0]);
  const store = new Store(deckPath).ensure();
  const fresh = claimAll(store, 'pending');
  const freshIds = new Set(fresh.map((r) => r.round));
  const rounds = [...store.inProgress().filter((r) => !freshIds.has(r.round)), ...fresh].sort((a, b) => a.round - b.round);
  if (!rounds.length) {
    out(tr('대기 중인 수정 요청이 없습니다. 브라우저에서 [AI에게 보내기]를 누르면 여기에 나타납니다.'));
    if (!(await runningServer(store))) out(tr('리뷰 화면이 꺼져 있습니다. 열기: {cmd}', { cmd: `redpen open ${q(deckPath)}` }));
    return;
  }
  await write(renderRounds(rounds, { channel: 'pending' }));
}

async function cmdDone(pos, flags) {
  const deckPath = resolveDeck(pos[0]);
  const store = new Store(deckPath).ensure();
  const message = (typeof flags.reply === 'string' && flags.reply.trim()) || pos.slice(1).join(' ').trim() || tr('반영을 마쳤습니다.');
  const rounds = reply(store, message);
  if (store.readAgent()) writeJSON(store.file('stop'), Date.now());
  out(rounds.length
    ? `✅ ${tr('{rounds} 수정 요청에 결과를 남겼습니다. 브라우저에 표시됩니다.', { rounds: rounds.map((n) => tr('{n}차', { n })).join(', ') })}`
    : tr('남길 수정 요청이 없습니다 (아직 보낸 적이 없음).'));
  if (!flags.stop) return;
  writeJSON(store.file('closed.json'), { at: Date.now(), by: 'agent' });
  const s = await runningServer(store);
  if (s) {
    await sleep(2500); // let the open tab show the reply first; then it hands the deck back
    await stopServer(s);
    store.clearServer();
  }
  out(tr('리뷰 화면도 껐습니다.'));
}

async function cmdStatus(pos, flags) {
  const deckPath = resolveDeck(pos[0]);
  const store = new Store(deckPath);
  const server = await runningServer(store);
  const agent = store.readAgent();
  const draft = store.readDraft();
  const rounds = store.rounds();
  if (flags.json) {
    out(JSON.stringify({
      deckPath,
      server,
      agent,
      draftItems: draft.items.length,
      rounds: rounds.map((r) => ({ round: r.round, items: r.items.length, delivered: r.delivered, replies: r.replies })),
    }, null, 2));
    return;
  }
  out(tr('대상: {path}', { path: deckPath }));
  out(tr('리뷰 화면: {url}', { url: server ? server.url : tr('꺼짐') }));
  out(tr('AI 대기: {state}', { state: agent ? tr('예 (pid {pid})', { pid: agent.pid }) : tr('아니오') }));
  out(`${tr('작성 중인 표시: {n}개', { n: draft.items.length })}${draft.deckComment ? ` + ${tr('전체 지시')}` : ''}`);
  if (!rounds.length) return;
  out(tr('보낸 수정 요청:'));
  for (const r of rounds.slice(-8)) {
    const state = tr(r.replies.length ? '반영 완료' : r.delivered ? (r.delivered.via === 'clipboard' ? '복사됨' : 'AI가 받음') : '전달 대기');
    out(`  ${tr('{n}차', { n: r.round })} · ${tr('{n}개', { n: r.items.length })} · ${state}${r.replies.length ? ` — ${r.replies.at(-1).message.slice(0, 60)}` : ''}`);
  }
}

async function cmdStop(pos) {
  const deckPath = resolveDeck(pos[0]);
  const store = new Store(deckPath);
  // Only signal a pid that answers as *our* server — a stale server.json may name an unrelated process.
  const s = await runningServer(store);
  if (s) {
    process.kill(s.pid, 'SIGTERM');
    out(tr('리뷰 서버를 종료했습니다.'));
  } else {
    out(tr('실행 중인 리뷰 서버가 없습니다.'));
  }
  store.clearServer();
}

const inNpxCache = (p) => p.split(path.sep).includes('_npx');

/** Is `cmd` installed on PATH? npx's own temporary bin folder doesn't count. */
function onPath(cmd) {
  return (process.env.PATH || '').split(path.delimiter).some((dir) => {
    if (!dir || inNpxCache(dir)) return false;
    try {
      fs.accessSync(path.join(dir, cmd), fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

async function cmdSetup(_pos, flags) {
  const home = os.homedir();
  const both = !flags.claude && !flags.codex;
  const [claude, codex] = skillDirs(home);
  const targets = [];
  if (flags.claude || both) targets.push(claude);
  if (flags.codex || (both && fs.existsSync(path.join(home, '.codex')))) targets.push(codex);

  if (flags.remove) {
    for (const [name, dir] of targets) {
      fs.rmSync(dir, { recursive: true, force: true });
      out(`🗑  ${tr('{name} 스킬 제거: {path}', { name, path: dir })}`);
    }
    const link = path.join(home, '.local', 'bin', 'redpen');
    let linked = null;
    try {
      linked = fs.readlinkSync(link);
    } catch {
      /* not a symlink of ours */
    }
    if (linked && path.resolve(path.dirname(link), linked) === BIN) {
      fs.rmSync(link, { force: true });
      out(`🗑  ${tr('redpen 명령 연결 제거: {path}', { path: link })}`);
    }
    return;
  }

  for (const [name, dir] of targets) {
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(SKILL, path.join(dir, 'SKILL.md'));
    out(`✅ ${tr('{name} 스킬 설치: {path}', { name, path: path.join(dir, 'SKILL.md') })}`);
  }

  if (!onPath('redpen') && inNpxCache(ROOT)) {
    // run through npx: this copy lives in npx's cache, so don't link the command to it
    out(`ℹ️  ${tr('redpen 명령을 계속 쓰려면 한 번 설치해 두세요: {cmd}', { cmd: `npm install -g ${PKG_NAME}` })}`);
  } else if (!onPath('redpen')) {
    const localBin = path.join(home, '.local', 'bin');
    const pathDirs = (process.env.PATH || '').split(path.delimiter);
    if (pathDirs.includes(localBin)) {
      fs.mkdirSync(localBin, { recursive: true });
      const link = path.join(localBin, 'redpen');
      fs.rmSync(link, { force: true });
      fs.symlinkSync(BIN, link);
      fs.chmodSync(BIN, 0o755);
      out(`✅ ${tr('redpen 명령 연결: {path}', { path: `${link} → ${BIN}` })}`);
    } else {
      out(`ℹ️  ${tr('redpen 명령이 PATH에 없습니다. 이 폴더에서 `npm link` 를 실행하세요: {path}', { path: ROOT })}`);
    }
  }
  out('');
  out(tr('사용: HTML을 만들던 AI 세션에서 "/redpen" (Claude Code) 또는 "$redpen" (Codex) 라고 입력하거나,'));
  out(tr('      "빨간펜으로 리뷰하자", "리뷰 반영해줘" 처럼 말하면 됩니다.'));
}

export async function main(argv) {
  const { cmd, pos, flags } = parse(argv);
  flags.lang = explicitLang(flags.lang); // --lang / REDPEN_LANG, or null
  setLang(flags.lang || systemLang());
  if (flags.help && cmd !== 'help') return out(pick(HELP));
  switch (cmd) {
    case 'open': return cmdOpen(pos, flags);
    case 'serve': return cmdServe(pos, flags);
    case 'wait': return cmdWait(pos, flags);
    case 'pending': return cmdPending(pos, flags);
    case 'done': return cmdDone(pos, flags);
    case 'status': return cmdStatus(pos, flags);
    case 'stop': return cmdStop(pos, flags);
    case 'setup': return cmdSetup(pos, flags);
    case 'version': return out(readJSON(path.join(ROOT, 'package.json'), {}).version);
    default: return out(pick(HELP));
  }
}
