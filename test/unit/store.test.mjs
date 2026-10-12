import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store, storeName } from '../../src/store.mjs';

function tmpDeck() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'redpen-store-'));
  const deck = path.join(dir, 'my deck.html');
  fs.writeFileSync(deck, '<html></html>');
  return deck;
}

test('ensure() creates a self-ignoring .redpen folder next to the deck', () => {
  const deck = tmpDeck();
  const s = new Store(deck).ensure();
  assert.ok(fs.existsSync(s.roundsDir));
  assert.match(path.basename(s.dir), /^my_deck\.html-[0-9a-f]{6}$/);
  assert.match(fs.readFileSync(path.join(path.dirname(deck), '.redpen', '.gitignore'), 'utf8'), /^\*$/m);
});

test('store folders never collide: Korean names kept, sanitized names get a hash', () => {
  assert.equal(storeName('index.html'), 'index.html');
  assert.equal(storeName('발표.html'), '발표.html');
  assert.notEqual(storeName('발표.html'), storeName('교육.html'));
  assert.notEqual(storeName('a b.html'), storeName('a_b.html'));
  assert.equal(storeName('발표.html'.normalize('NFD')), storeName('발표.html'), 'NFD/NFC spellings share one folder');
});

test('draft round-trips and tolerates garbage', () => {
  const s = new Store(tmpDeck()).ensure();
  assert.deepEqual(s.readDraft().items, []);
  s.writeDraft({ items: [{ id: 'a' }], deckComment: 'x' });
  assert.equal(s.readDraft().items[0].id, 'a');
  fs.writeFileSync(s.file('draft.json'), '{broken');
  assert.deepEqual(s.readDraft(), { items: [], deckComment: '', updatedAt: 0 });
});

test('rounds are numbered and claimed exactly once', () => {
  const s = new Store(tmpDeck()).ensure();
  const r1 = s.createRound({ items: [{ type: 'delete' }] });
  const r2 = s.createRound({ items: [] });
  assert.equal(r1.round, 1);
  assert.equal(r2.round, 2);
  assert.deepEqual(s.undelivered().map((r) => r.round), [1, 2]);
  assert.equal(s.claim(1, 'wait'), true);
  assert.equal(s.claim(1, 'pending'), false);
  assert.deepEqual(s.undelivered().map((r) => r.round), [2]);
  assert.deepEqual(s.inProgress().map((r) => r.round), [1]);
  s.addReply(1, '반영 완료');
  s.addReply(1, '추가 메모');
  assert.deepEqual(s.inProgress(), []);
  assert.deepEqual(s.readRound(1).replies.map((r) => r.message), ['반영 완료', '추가 메모']);
});

test('createRound with claimVia is never visible as undelivered', () => {
  const s = new Store(tmpDeck()).ensure();
  const r = s.createRound({ items: [] }, { claimVia: 'clipboard' });
  assert.equal(s.readRound(r.round).delivered.via, 'clipboard');
  assert.deepEqual(s.undelivered(), []);
  assert.deepEqual(s.inProgress(), [], 'clipboard rounds are not "in progress" for an agent');
});

test('agent presence ignores dead processes', () => {
  const s = new Store(tmpDeck()).ensure();
  s.writeAgent({ pid: process.pid, since: 1 });
  assert.equal(s.readAgent().pid, process.pid);
  s.writeAgent({ pid: 999999, since: 1 });
  assert.equal(s.readAgent(), null);
  s.clearAgent();
  assert.equal(fs.existsSync(s.file('agent.json')), false);
});
