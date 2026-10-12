import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readJSON, writeJSON, isAlive } from './util.mjs';

const pad = (n) => String(n).padStart(4, '0');

/** Folder name for a deck: readable (Korean names stay as-is) and unique even when sanitizing changed it. */
export function storeName(deckName) {
  const name = deckName.normalize('NFC');
  const safe = name.replace(/[^\p{L}\p{N}._-]+/gu, '_');
  if (safe === name) return safe;
  return `${safe}-${crypto.createHash('sha1').update(name).digest('hex').slice(0, 6)}`;
}

/**
 * File-based review state for one deck, kept next to it in `.redpen/<deck>/`.
 *
 *   draft.json            browser's unsent marks            (written by server)
 *   rounds/0001.json      a submitted batch of marks        (written by server, immutable)
 *   rounds/0001.md        the same batch rendered as a prompt
 *   rounds/0001.delivered who picked the batch up           (exclusive create → exactly-once delivery)
 *   rounds/0001.reply.json  AI's replies for the batch      (written by CLI)
 *   agent.json            pid of a running `redpen wait`    (written by CLI)
 *   server.json           pid/port of the review server     (written by server)
 *
 * Every file has a single writer, so no locking is needed.
 */
export class Store {
  constructor(deckPath) {
    this.deckPath = path.resolve(deckPath);
    this.deckDir = path.dirname(this.deckPath);
    this.deckName = path.basename(this.deckPath);
    this.base = path.join(this.deckDir, '.redpen');
    this.dir = path.join(this.base, storeName(this.deckName));
    this.roundsDir = path.join(this.dir, 'rounds');
  }

  ensure() {
    fs.mkdirSync(this.roundsDir, { recursive: true });
    const ignore = path.join(this.base, '.gitignore');
    if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, '# redpen review data (local only)\n*\n');
    return this;
  }

  file(name) {
    return path.join(this.dir, name);
  }

  // ---- draft -------------------------------------------------------------

  readDraft() {
    const d = readJSON(this.file('draft.json'), null);
    return {
      items: Array.isArray(d?.items) ? d.items : [],
      deckComment: typeof d?.deckComment === 'string' ? d.deckComment : '',
      updatedAt: d?.updatedAt || 0,
    };
  }

  writeDraft({ items = [], deckComment = '' }) {
    const draft = { items, deckComment, updatedAt: Date.now() };
    writeJSON(this.file('draft.json'), draft);
    return draft;
  }

  // ---- settings / server / agent ----------------------------------------

  readSettings() {
    return readJSON(this.file('settings.json'), {}) || {};
  }

  writeSettings(patch) {
    writeJSON(this.file('settings.json'), { ...this.readSettings(), ...patch });
  }

  readServer() {
    return readJSON(this.file('server.json'), null);
  }

  writeServer(info) {
    writeJSON(this.file('server.json'), info);
  }

  clearServer(pid) {
    const s = this.readServer();
    if (s && (!pid || s.pid === pid)) fs.rmSync(this.file('server.json'), { force: true });
  }

  /** The running `redpen wait` process, if any. */
  readAgent() {
    const a = readJSON(this.file('agent.json'), null);
    return a && isAlive(a.pid) ? a : null;
  }

  writeAgent(info) {
    writeJSON(this.file('agent.json'), info);
  }

  clearAgent(pid) {
    const a = readJSON(this.file('agent.json'), null);
    if (a && (!pid || a.pid === pid)) fs.rmSync(this.file('agent.json'), { force: true });
  }

  // ---- rounds ------------------------------------------------------------

  roundPath(n, ext) {
    return path.join(this.roundsDir, `${pad(n)}${ext}`);
  }

  roundIds() {
    try {
      return fs.readdirSync(this.roundsDir)
        .map((f) => /^(\d+)\.json$/.exec(f))
        .filter(Boolean)
        .map((m) => Number(m[1]))
        .sort((a, b) => a - b);
    } catch {
      return [];
    }
  }

  readRound(n) {
    const data = readJSON(this.roundPath(n, '.json'), null);
    if (!data) return null;
    const replies = readJSON(this.roundPath(n, '.reply.json'), null);
    return {
      ...data,
      delivered: readJSON(this.roundPath(n, '.delivered'), null),
      replies: Array.isArray(replies) ? replies : [],
    };
  }

  rounds() {
    return this.roundIds().map((n) => this.readRound(n)).filter(Boolean);
  }

  /**
   * Persist a submitted batch. With `claimVia`, the batch is marked delivered *before* it becomes
   * visible, so a waiting agent can never grab a batch the user only meant to copy to the clipboard.
   */
  createRound(data, { claimVia = null } = {}) {
    fs.mkdirSync(this.roundsDir, { recursive: true });
    const n = (this.roundIds().at(-1) || 0) + 1;
    const round = { ...data, round: n, createdAt: Date.now() };
    if (claimVia) this.claim(n, claimVia);
    writeJSON(this.roundPath(n, '.json'), round);
    return round;
  }

  writeRoundMarkdown(n, markdown) {
    fs.writeFileSync(this.roundPath(n, '.md'), markdown);
  }

  /** Mark a round as delivered. Returns false if someone else already took it. */
  claim(n, via) {
    try {
      fs.writeFileSync(
        this.roundPath(n, '.delivered'),
        JSON.stringify({ via, at: Date.now(), pid: process.pid }),
        { flag: 'wx' },
      );
      return true;
    } catch (err) {
      if (err.code === 'EEXIST') return false;
      throw err;
    }
  }

  addReply(n, message) {
    const file = this.roundPath(n, '.reply.json');
    const list = readJSON(file, []);
    const replies = Array.isArray(list) ? list : [];
    replies.push({ message, at: Date.now() });
    writeJSON(file, replies);
  }

  /** Rounds nobody has picked up yet. */
  undelivered() {
    return this.rounds().filter((r) => !r.delivered);
  }

  /** Rounds an agent picked up but has not answered yet. */
  inProgress() {
    return this.rounds().filter((r) => r.delivered && r.delivered.via !== 'clipboard' && !r.replies.length);
  }
}
