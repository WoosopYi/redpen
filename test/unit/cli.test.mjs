import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store } from '../../src/store.mjs';

const BIN = fileURLToPath(new URL('../../bin/redpen.mjs', import.meta.url));
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'redpen-home-'));
const env = { ...process.env, REDPEN_HOME: HOME, REDPEN_LANG: 'ko' };
const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'redpen-cli-')));
const deck = path.join(dir, 'index.html');
fs.writeFileSync(deck, '<html><head></head><body><section class="slide">하나</section><section class="slide">둘</section></body></html>');
const store = new Store(deck).ensure();

const run = (...args) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env });
function start(...args) {
  const child = spawn(process.execPath, [BIN, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  child.stdout.on('data', (d) => { stdout += d; });
  return new Promise((resolve) => child.on('exit', (code) => resolve({ code, stdout })));
}
const round = (comment) => store.createRound({
  deck: { path: deck, slideSelector: '.slide', slideCount: 2 },
  deckComment: '',
  items: [{ n: 1, type: 'comment', target: 'slide', slide: { index: 1, title: '둘' }, comment }],
});

after(() => run('stop', deck));

test('help and errors', () => {
  assert.match(run('--help').stdout, /redpen open <html>/);
  const missing = run('pending', path.join(dir, 'nope.html'));
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /파일을 찾을 수 없습니다/);
});

test('pending prints nothing-to-do, then delivers a round exactly once', () => {
  assert.match(run('pending', deck).stdout, /대기 중인 수정 요청이 없습니다/);
  round('첫 요청');
  const out = run('pending', deck).stdout;
  assert.match(out, /빨간펜 수정 요청 · 1차/);
  assert.match(out, /첫 요청/);
  assert.match(out, /redpen wait .* --reply/, 'recovering a queued request resumes automatic receiving');
  assert.equal(store.readRound(1).delivered.via, 'pending');
  // still unanswered → shown again (the agent may have lost context), but not re-claimed
  assert.match(run('pending', deck).stdout, /1차/);
});

test('the pending prompt restores waiting after replying to recovered feedback', async () => {
  const prompt = run('pending', deck).stdout;
  const next = /`redpen wait ("(?:[^"\\]|\\.)*") --reply/.exec(prompt);
  assert.ok(next, 'pending recommends a command that continues the review');
  const waiting = start('wait', JSON.parse(next[1]), '--reply', '두 장으로 나눴어요');
  try {
    for (let i = 0; i < 100 && !store.readAgent(); i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(store.readAgent(), 'AI waits for the next request after replying');
    assert.equal(store.readRound(1).replies[0].message, '두 장으로 나눴어요');
    assert.match(run('pending', deck).stdout, /없습니다/);
    assert.ok(store.readAgent(), 'no new feedback does not end the wait');
  } finally {
    run('done', deck, '--reply', '끝');
    const result = await waiting;
    assert.equal(result.code, 0);
    assert.match(result.stdout, /리뷰를 마쳤습니다/);
  }
});

test('wait times out with exit code 2', async () => {
  const r = await start('wait', deck, '--timeout', '1');
  assert.equal(r.code, 2);
  assert.match(r.stdout, /시간 초과/);
});

test('wait blocks until the browser submits, registers itself, then cleans up', async () => {
  const waiting = start('wait', deck);
  for (let i = 0; i < 100 && !store.readAgent(); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(store.readAgent(), 'agent.json written while waiting');
  round('두 번째 요청');
  const r = await waiting;
  assert.equal(r.code, 0);
  assert.match(r.stdout, /· 2차/);
  assert.match(r.stdout, /redpen wait .* --reply/);
  assert.equal(store.readAgent(), null);
  assert.equal(store.readRound(2).delivered.via, 'wait');
});

test('wait --reply answers the previous round before waiting again; done stops a waiter', async () => {
  const waiting = start('wait', deck, '--reply', '2차 반영 완료');
  for (let i = 0; i < 100 && !store.readAgent(); i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal(store.readRound(2).replies[0].message, '2차 반영 완료');
  run('done', deck, '--reply', '끝');
  const r = await waiting;
  assert.equal(r.code, 0);
  assert.match(r.stdout, /리뷰를 마쳤습니다/);
});

test('done never answers a round no agent has received', () => {
  const r = round('아직 아무도 안 받은 요청');
  run('done', deck, '--reply', '엉뚱한 답장');
  assert.deepEqual(store.readRound(r.round).replies, []);
  assert.equal(store.readRound(r.round).delivered, null);
  assert.match(run('pending', deck).stdout, /아직 아무도 안 받은 요청/); // still there for the agent
  run('done', deck, '--reply', '반영 완료');
});

test('stop leaves unrelated processes alone when server.json is stale', async () => {
  const bystander = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });
  const saved = store.readServer();
  store.writeServer({ pid: bystander.pid, port: 1, url: 'http://localhost:1/x', deckPath: deck });
  assert.match(run('stop', deck).stdout, /실행 중인 리뷰 서버가 없습니다/);
  assert.equal(bystander.exitCode, null);
  assert.doesNotThrow(() => process.kill(bystander.pid, 0), 'bystander still alive');
  bystander.kill();
  if (saved) store.writeServer(saved);
});

test('a newer wait takes over; the older one steps aside without claiming', async () => {
  const older = start('wait', deck);
  for (let i = 0; i < 100 && !store.readAgent(); i++) await new Promise((r) => setTimeout(r, 100));
  const firstPid = store.readAgent().pid;
  const newer = start('wait', deck);
  for (let i = 0; i < 100 && store.readAgent()?.pid === firstPid; i++) await new Promise((r) => setTimeout(r, 100));
  const r1 = await older;
  assert.equal(r1.code, 0);
  assert.match(r1.stdout, /이어받아/);
  const n = round('새 세션이 받을 요청').round;
  const r2 = await newer;
  assert.match(r2.stdout, new RegExp(`· ${n}차`));
  assert.equal(store.readRound(n).delivered.via, 'wait');
  run('done', deck, '--reply', '확인');
});

test('status --json summarizes the review', () => {
  const s = JSON.parse(run('status', deck, '--json').stdout);
  assert.equal(s.deckPath, deck);
  assert.equal(s.rounds.length, 4);
  assert.ok(s.server?.url.startsWith('http://localhost:'), 'wait started the review server');
});
