import * as api from './api.js';

/** Review state shared by every UI part. Item fields starting with `_` are runtime-only (live Range, element…). */
export const S = {
  mode: 'text', // text | element | region
  paused: false,
  items: [],
  deckComment: '',
  rounds: [],
  agent: { status: 'offline' },
  panelOpen: false,
  panelTab: 'draft',
  focusId: null,
  pendingRange: null, // selection being edited in a popover
};

const subscribers = new Set();
export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}
export function emit(kind = 'all') {
  for (const fn of subscribers) {
    try {
      fn(kind);
    } catch (err) {
      console.error('[redpen]', err);
    }
  }
}

export const clientId = Math.random().toString(36).slice(2, 10);

export function plain(item) {
  const o = {};
  for (const k of Object.keys(item)) if (k[0] !== '_') o[k] = item[k];
  return o;
}

// ---- persistence (debounced autosave of the draft) --------------------------

let saveTimer = 0;
let unsaved = false;
let paused = false;
let inflight = null;
let seq = 0;
const saveListeners = new Set();

/** Every write carries an increasing number so the server can drop out-of-order (stale) ones. */
export const nextSeq = () => ++seq;
export const draftPayload = () => ({ items: S.items.map(plain), deckComment: S.deckComment, clientId, seq: nextSeq() });

/** Listen for autosave health: fn(true) after a successful save, fn(false) when one fails. */
export function onSaveState(fn) {
  saveListeners.add(fn);
}
const report = (ok) => saveListeners.forEach((fn) => fn(ok));

export function saveSoon() {
  unsaved = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 350);
}

/** Wait for a save that is already on the wire. */
export async function settleSaves() {
  while (inflight) await inflight;
}

export async function saveNow() {
  clearTimeout(saveTimer);
  await settleSaves();
  if (!unsaved || paused) return;
  unsaved = false;
  inflight = api.saveDraft(draftPayload()).then(
    () => report(true),
    () => {
      unsaved = true;
      report(false);
    },
  ).finally(() => {
    inflight = null;
  });
  await inflight;
}

export const hasUnsaved = () => unsaved;

/** While sending, autosaves wait; marks made meanwhile are saved right after. */
export function pauseSaving(on) {
  paused = on;
  if (on) clearTimeout(saveTimer);
  else if (unsaved) saveSoon();
}

export function saveOnExit() {
  if (!unsaved) return;
  unsaved = false;
  api.beaconDraft(draftPayload());
}

/** Forget pending changes (the server already cleared the draft on submit). */
export function discardPendingSave() {
  clearTimeout(saveTimer);
  unsaved = false;
}

// ---- undo / redo --------------------------------------------------------------

const undoStack = [];
const redoStack = [];
const snapshot = () => JSON.stringify(S.items.map(plain));
let reanchor = () => {};
export function setReanchor(fn) {
  reanchor = fn;
}

/** Change items in an undoable way. */
export function mutate(fn) {
  undoStack.push(snapshot());
  if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0;
  fn();
  saveSoon();
  emit('items');
}

function restore(json) {
  const old = new Map(S.items.map((it) => [it.id, it]));
  S.items = JSON.parse(json).map((data) => {
    const prev = old.get(data.id);
    if (!prev) return data;
    for (const k of Object.keys(prev)) if (k[0] !== '_') delete prev[k];
    return Object.assign(prev, data);
  });
  reanchor();
  saveSoon();
  emit('items');
}

export function undo() {
  if (!undoStack.length) return false;
  redoStack.push(snapshot());
  restore(undoStack.pop());
  return true;
}

export function redo() {
  if (!redoStack.length) return false;
  undoStack.push(snapshot());
  restore(redoStack.pop());
  return true;
}

export function clearHistory() {
  undoStack.length = 0;
  redoStack.length = 0;
}

// ---- ordering: slide → slide-level first → top-to-bottom → left-to-right -------

const slideKey = (it) => (Number.isInteger(it.slide?.index) && !it.slide.single ? it.slide.index : -1);
const targetKey = (it) => (it.target === 'slide' || it.target === 'sketch' ? 0 : 1);

export function ordered(items = S.items) {
  return [...items].sort((a, b) => (slideKey(a) - slideKey(b))
    || (targetKey(a) - targetKey(b))
    || ((a.pos?.y ?? 0) - (b.pos?.y ?? 0))
    || ((a.pos?.x ?? 0) - (b.pos?.x ?? 0))
    || ((a.createdAt || 0) - (b.createdAt || 0)));
}

export function numbering() {
  const m = new Map();
  ordered().forEach((it, i) => m.set(it.id, i + 1));
  return m;
}

// Korean source labels: show them through tr() (i18n/index.js).
export const TYPE_LABEL = { delete: '삭제', replace: '수정', comment: '코멘트', layout: '레이아웃' };
export const TYPE_ICON = { delete: 'trash', replace: 'edit', comment: 'comment', layout: 'layout' };
export const TARGET_LABEL = { text: '텍스트', element: '요소', region: '영역', slide: '슬라이드', sketch: '스케치' };
