import { S, mutate } from './state.js';
import { ui } from './ui/root.js';
import { getSlides, slideOf, slideVisible, slideOpacity } from './slides.js';
import { describeElement, cssPath } from './anchor.js';
import { h, clamp, trunc, norm, uid } from './util.js';
import { icon } from './icons.js';
import { scheduleRender, registerRenderer, setHover } from './ui/overlay.js';
import { toast } from './ui/feedback.js';
import { popoverOpen } from './ui/popover.js';
import * as A from './actions.js';
import { layoutSummary } from './summary.js';

/*
 * Layout editing ("레이아웃" mode). Select an element, then
 *   drag            → move it (snaps to slide edges/center and other elements' lines)
 *   drop on sibling → change its order among siblings
 *   corner handles  → resize proportionally · side handles → change the box width/height
 *   layout bar      → font size, gap, padding, direction, columns, centering
 * Every change is previewed live on the deck with inline `translate` / `scale` / style overrides that are
 * restored exactly when the mark goes away, and sent to the AI as before → after layout instructions.
 */

const SNAP_PX = 6;
const HOME_PX = 12; // dragging back this close to the original position puts it exactly back
const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const NUDGE_TIP_KEY = 'redpen:nudge-tip';
const MEDIA = /^(img|video|svg|canvas|picture|iframe|object|embed)$/;
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const CURSOR = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };

// ---- geometry ---------------------------------------------------------------------

const r2 = (v) => Math.round(v * 100) / 100;
const pct = (v) => Math.round(v * 100);
const frac = (r, s) => (s.width && s.height
  ? { x: (r.left - s.left) / s.width, y: (r.top - s.top) / s.height, w: r.width / s.width, h: r.height / s.height }
  : { x: 0, y: 0, w: 0, h: 0 });
const rectOf = (f, s) => new DOMRect(s.left + f.x * s.width, s.top + f.y * s.height, f.w * s.width, f.h * s.height);
const slideFor = (el) => slideOf(el) || document.body;
const isSlideEl = (el) => getSlides().set.has(el);

export const isMedia = (el) => MEDIA.test(el.localName) || (!norm(el.textContent) && !!el.querySelector?.('img, video, svg, canvas, picture'));

/** CSS px → screen px factor of the coordinate space the element's `translate` lives in (e.g. a scaled 1920×1080 stage). */
function ancestorScale(el) {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (p.offsetWidth > 0) {
      const w = p.getBoundingClientRect().width;
      if (w > 0) return w / p.offsetWidth;
    }
  }
  return 1;
}

function inFlowKids(parent) {
  if (!parent) return [];
  return [...parent.children].filter((k) => {
    if (k.id === '__redpen-host' || !k.getClientRects().length) return false;
    const pos = getComputedStyle(k).position;
    return pos !== 'absolute' && pos !== 'fixed';
  });
}

function axisOf(rects) {
  if (rects.length < 2) return 'y';
  if (rects.every((r) => Math.abs(r.top - rects[0].top) < 6)) return 'x';
  if (rects.every((r) => Math.abs(r.left - rects[0].left) < 6)) return 'y';
  return 'grid';
}

function gridColumns(cs) {
  const v = cs.gridTemplateColumns;
  if (!v || v === 'none') return 0;
  return v.replace(/\[[^\]]*\]/g, ' ').trim().split(/\s+/).filter(Boolean).length;
}

const isFlex = (cs) => /flex/.test(cs.display);
const isGrid = (cs) => /grid/.test(cs.display);

/** Visible text with spaces between separate text pieces ("제목" + "03" → "제목 03"). */
function labelText(el) {
  const parts = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n && parts.length < 12; n = walker.nextNode()) {
    const t = n.data.trim();
    if (t) parts.push(t);
  }
  return norm(parts.join(' '));
}

export function shortName(el) {
  const t = labelText(el);
  return t ? `「${trunc(t, 14)}」` : `<${el.localName}>`;
}

function tagName(el) {
  const cls = [...el.classList].filter((c) => !/^(is-|has-)/.test(c)).slice(0, 2);
  return `${el.localName}${el.id ? `#${el.id}` : ''}${cls.map((c) => `.${c}`).join('')}`;
}

// ---- live preview engine ------------------------------------------------------------

const touched = new Map(); // element → { props: Map(prop → [value, priority]), hadStyle }

function put(el, prop, value) {
  let rec = touched.get(el);
  if (!rec) {
    rec = { props: new Map(), hadStyle: el.hasAttribute('style') };
    touched.set(el, rec);
  }
  if (!rec.props.has(prop)) rec.props.set(prop, [el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)]);
  el.style.setProperty(prop, value, 'important');
}

/** Put every inline style we touched back exactly as the deck had it. */
function restoreAll() {
  for (const [el, rec] of touched) {
    for (const [prop, [value, priority]] of rec.props) {
      if (value) el.style.setProperty(prop, value, priority);
      else el.style.removeProperty(prop);
    }
    if (!rec.hadStyle && !el.getAttribute('style')) el.removeAttribute('style');
  }
  touched.clear();
}

const layoutItems = () => S.items.filter((it) => it.type === 'layout' && it.target === 'element' && it.layout && it._el?.isConnected);
const findItem = (el) => S.items.find((it) => it.type === 'layout' && it.target === 'element' && it._el === el) || null;

function scaleFonts(el, factor) {
  if (!factor || Math.abs(factor - 1) < 0.001) return;
  const nodes = [el, ...[...el.querySelectorAll('*')].slice(0, 400)];
  const sizes = nodes.map((n) => {
    const cs = getComputedStyle(n);
    return [n, parseFloat(cs.fontSize), cs.lineHeight.endsWith('px') ? parseFloat(cs.lineHeight) : 0];
  });
  for (const [n, fs, lh] of sizes) {
    if (fs) put(n, 'font-size', `${r2(fs * factor)}px`);
    if (lh) put(n, 'line-height', `${r2(lh * factor)}px`);
  }
}

function applyStyles(el, L) {
  if (L.font) scaleFonts(el, L.font.to / L.font.from);
  if (L.gap) put(el, 'gap', `${L.gap.to}px`);
  if (L.padding) put(el, 'padding', L.padding.to.map((v) => `${v}px`).join(' '));
  if (L.direction) put(el, 'flex-direction', L.direction.to);
  if (L.columns) put(el, 'grid-template-columns', `repeat(${L.columns.to}, minmax(0, 1fr))`);
}

function addShift(map, el, dx, dy) {
  const s = map.get(el) || { dx: 0, dy: 0 };
  s.dx += dx;
  s.dy += dy;
  map.set(el, s);
}

/** Visual positions of siblings after the requested reorders (rows/columns laid out by size, grids by slot). */
function reorderShifts(parent, items, shift) {
  const kids = inFlowKids(parent);
  if (kids.length < 2) return;
  const slots = kids.map((k) => k.getBoundingClientRect());
  const order = kids.slice();
  for (const it of [...items].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))) {
    const from = order.indexOf(it._el);
    if (from < 0) continue;
    order.splice(from, 1);
    order.splice(clamp(it.layout.reorder.to, 0, order.length), 0, it._el);
  }
  const axis = axisOf(slots);
  if (axis === 'grid') {
    order.forEach((el, j) => {
      const i = kids.indexOf(el);
      if (i !== j) addShift(shift, el, slots[j].left - slots[i].left, slots[j].top - slots[i].top);
    });
    return;
  }
  const lead = axis === 'x' ? 'left' : 'top';
  const size = axis === 'x' ? 'width' : 'height';
  const sorted = [...slots].sort((a, b) => a[lead] - b[lead]);
  let gap = 0;
  for (let n = 1; n < sorted.length; n++) gap += sorted[n][lead] - (sorted[n - 1][lead] + sorted[n - 1][size]);
  gap = Math.max(0, gap / (sorted.length - 1));
  let cursor = sorted[0][lead];
  for (const el of order) {
    const r = slots[kids.indexOf(el)];
    const d = cursor - r[lead];
    if (Math.abs(d) > 0.5) addShift(shift, el, axis === 'x' ? d : 0, axis === 'y' ? d : 0);
    cursor += r[size] + gap;
  }
}

/** Put an element's visual box at its target (fractions of its slide). */
function placeAt(el, L) {
  const T = rectOf(L.to, slideFor(el).getBoundingClientRect());
  if (L.fit !== 'box') {
    const r0 = el.getBoundingClientRect();
    const s = r0.width > 0.5 ? T.width / r0.width : 1;
    if (Math.abs(s - 1) > 0.002) put(el, 'scale', String(Math.round(s * 1000) / 1000));
  }
  const r = el.getBoundingClientRect();
  const k = ancestorScale(el);
  put(el, 'translate', `${r2((T.left - r.left) / k)}px ${r2((T.top - r.top) / k)}px`);
}

/** Re-apply every layout preview from the items (after any change, reload, resize or resume). */
export function recompute() {
  restoreAll();
  if (S.paused) return;
  const items = layoutItems();
  if (!items.length) return;
  for (const it of items) applyStyles(it._el, it.layout);

  const shift = new Map();
  const byParent = new Map();
  for (const it of items) {
    const p = it._el.parentElement;
    if (!it.layout.reorder || !p) continue;
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p).push(it);
  }
  for (const [parent, list] of byParent) reorderShifts(parent, list, shift);

  const movers = items.filter((it) => it.layout.to);
  const moving = new Set(movers.map((it) => it._el));
  for (const [el, s] of shift) {
    if (moving.has(el)) continue;
    const k = ancestorScale(el);
    put(el, 'translate', `${r2(s.dx / k)}px ${r2(s.dy / k)}px`);
  }
  // outer elements first, so a moved box carries its moved children along correctly
  movers.sort((a, b) => (a._el.compareDocumentPosition(b._el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  for (const it of movers) placeAt(it._el, it.layout);
}

/** Measure something on the deck as it really is (previews off), then bring the previews back. */
export function withoutPreviews(fn) {
  return original(fn);
}

function original(fn) {
  restoreAll();
  try {
    return fn();
  } finally {
    recompute();
  }
}

// ---- items ------------------------------------------------------------------------

function context(el) {
  const cs = getComputedStyle(el);
  const p = el.parentElement;
  const pcs = p ? getComputedStyle(p) : null;
  const kids = inFlowKids(p);
  return {
    display: cs.display,
    position: cs.position,
    parent: p ? {
      tag: p.localName,
      selector: cssPath(p),
      display: pcs.display,
      direction: isFlex(pcs) ? pcs.flexDirection : null,
      columns: isGrid(pcs) ? gridColumns(pcs) : null,
      count: kids.length,
    } : null,
    index: kids.indexOf(el),
  };
}

function newItem(el) {
  const d = describeElement(el);
  const s = slideFor(el).getBoundingClientRect();
  return Object.assign({
    id: uid(),
    createdAt: Date.now(),
    type: 'layout',
    ...d.data,
    target: 'element',
    layout: {
      from: frac(el.getBoundingClientRect(), s),
      to: null,
      fit: 'scale',
      snaps: [],
      reorder: null,
      font: null,
      gap: null,
      padding: null,
      direction: null,
      columns: null,
      ctx: context(el),
    },
  }, { _el: el, _slide: d.slideEl });
}

const moved = (L) => !!L.to && ['x', 'y', 'w', 'h'].some((k) => Math.abs(L.to[k] - L.from[k]) > 0.002);
const empty = (L) => !moved(L) && !L.reorder && !L.font && !L.gap && !L.padding && !L.direction && !L.columns;

/** Create or update the element's layout mark (one per element; undoable). */
function commit(el, patch) {
  let it = findItem(el);
  let fresh = null;
  if (!it) {
    restoreAll(); // the "before" box must be measured without any preview; recompute() re-applies them
    fresh = newItem(el);
  }
  mutate(() => {
    if (fresh) {
      it = fresh;
      S.items.push(it);
    }
    patch(it.layout, it);
    if (it.layout.to && !moved(it.layout)) it.layout.to = null;
    if (empty(it.layout)) S.items = S.items.filter((x) => x !== it);
  });
}

// ---- selection UI -------------------------------------------------------------------

let sel = null; // { el }
let drag = null;
let barTimer = 0;
const N = {}; // DOM nodes
const marks = new Map(); // item id → { ghost, out, line }

export const selected = () => sel?.el || null;
export const dragging = () => !!drag?.started;

function promote(el) {
  const slide = slideOf(el);
  let e = el;
  while (e && e !== slide && e.parentElement && e.parentElement !== document.body && getComputedStyle(e).display === 'inline') e = e.parentElement;
  return e;
}

const BOXY = /^(img|video|svg|canvas|picture|iframe|figure|li|tr|button|table)$/;
const clear = (color) => !color || color === 'transparent' || /rgba\([^)]*,\s*0\s*\)$/.test(color);

/** Does it read as a box on screen (media, list item, or has a background, border or shadow)? */
function boxy(el) {
  if (BOXY.test(el.localName)) return true;
  const cs = getComputedStyle(el);
  if (cs.backgroundImage !== 'none' || !clear(cs.backgroundColor) || cs.boxShadow !== 'none') return true;
  return ['Top', 'Right', 'Bottom', 'Left'].some((k) => parseFloat(cs[`border${k}Width`]) > 0 && cs[`border${k}Style`] !== 'none' && !clear(cs[`border${k}Color`]));
}

/**
 * What a click means: the outermost box-like element under the pointer (a card, an image, a list item),
 * not the innermost text wrapper — like groups in a design tool. Inside `within` (the current selection)
 * the same rule picks the next level down; with no box around, the clicked block itself.
 */
function pickAt(target, within = null) {
  const slide = slideOf(target);
  const deepest = promote(target);
  const stop = within || slide || document.body;
  const s = (slide || document.body).getBoundingClientRect();
  let pick = null;
  for (let e = deepest; e && e !== stop && e !== document.body; e = e.parentElement) {
    const r = e.getBoundingClientRect();
    if (r.width * r.height > s.width * s.height * 0.5) break; // big wrappers are not what people mean
    if (boxy(e)) pick = e;
  }
  return pick || deepest;
}

export function select(el) {
  if (!el || !el.isConnected) {
    deselect();
    return;
  }
  sel = { el };
  setHover(null); // the selection draws its own outline and label
  buildBar();
  scheduleRender();
}

export function deselect() {
  if (!sel) return;
  sel = null;
  N.bar.style.display = 'none';
  scheduleRender();
}

/** Rebuild the bar after items change (its summary and buttons depend on the mark). */
export function refresh() {
  if (sel) buildBar();
}

const place = (el, x, y) => {
  el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
};
const size = (el, r) => {
  place(el, r.left, r.top);
  el.style.width = `${Math.max(0, r.width)}px`;
  el.style.height = `${Math.max(0, r.height)}px`;
};

function button(label, ico, onClick, { tip, disabled = false, cls = '' } = {}) {
  return h('button', { class: `lb ${cls}`, 'data-tip': tip, disabled, onClick }, ico && icon(ico, 14), label && h('span', null, label));
}

function stepper(label, step, { tip, disabled = false } = {}) {
  return h('div', { class: `lstep${disabled ? ' off' : ''}`, 'data-tip': tip },
    h('span', { class: 'lst-l' }, label),
    h('button', { class: 'lb sq', disabled, onClick: () => step(-1) }, '−'),
    h('button', { class: 'lb sq', disabled, onClick: () => step(1) }, '+'));
}

function buildBar() {
  const el = sel.el;
  const head = (title, sub) => h('div', { class: 'lb-head' }, icon('layout', 14), h('b', null, title), h('span', { class: 'lb-sum' }, sub),
    h('button', { class: 'iconbtn', title: '선택 해제 (Esc)', onClick: () => deselect() }, icon('x', 14)));
  if (isSlideEl(el)) {
    const i = getSlides().els.indexOf(el);
    N.bar.replaceChildren(
      head(`슬라이드 ${i + 1} 전체`, '슬라이드 단위로 지시'),
      h('div', { class: 'lb-row' },
        button('코멘트', 'comment', () => A.slideComment(el, el.getBoundingClientRect()), { tip: '이 슬라이드 전체에 코멘트 (C)' }),
        button('새 배치 스케치', 'sketch', () => A.hooks.openSketch?.(el), { tip: '칸을 그려 새 레이아웃을 지시' }),
        button('순서 옮기기', 'updown', () => A.openSlideMove(el, N.bar.getBoundingClientRect()), { tip: '이 슬라이드를 다른 위치로' }),
        button('삭제 표시', 'trash', () => { A.toggleSlideDelete(el); deselect(); }, { tip: '슬라이드 통째로 삭제 (D)', cls: 'danger' })),
    );
  } else {
    const it = findItem(el);
    const cs = getComputedStyle(el);
    const flex = isFlex(cs);
    const grid = isGrid(cs);
    const dir = it?.layout.direction?.to ?? cs.flexDirection;
    const parent = el.parentElement;
    const canUp = !!parent && parent !== document.body && parent !== document.documentElement;
    N.bar.replaceChildren(
      head(tagName(el), layoutSummary(it?.layout) || '끌어서 이동 · 다른 칸 위에 놓으면 순서 바꾸기 · 모서리로 크기'),
      h('div', { class: 'lb-row' },
        stepper('글자', fontStep, { tip: '글자 크기 (+ / −)' }),
        stepper('간격', gapStep, { tip: flex || grid ? '안쪽 요소 사이 간격' : '가로·세로로 늘어선 상자(flex/grid)에서만', disabled: !(flex || grid) }),
        stepper('여백', padStep, { tip: '안쪽 여백' }),
        flex && button(dir.startsWith('row') ? '세로로' : '가로로', 'updown', toggleDirection, { tip: '안쪽 요소를 세로/가로로 늘어놓기' }),
        grid && stepper('열', colStep, { tip: '격자 열 수' }),
        button('가운데로', 'center', centerX, { tip: '슬라이드 가로 가운데로' })),
      h('div', { class: 'lb-row' },
        button('상위 요소', 'up', () => canUp && select(parent), { tip: '감싸는 상자 선택 (Alt+↑)', disabled: !canUp }),
        button('코멘트', 'comment', commentSelected, { tip: '이 요소에 코멘트 (C)' }),
        button('삭제 표시', 'trash', deleteSelected, { tip: '이 요소 삭제 (D)', cls: 'danger' }),
        button('원래대로', 'undo', resetSelected, { tip: '이 요소의 레이아웃 변경 취소', disabled: !it })),
    );
  }
  N.bar.style.display = '';
}

function hideBar() {
  clearTimeout(barTimer);
  N.bar.style.display = 'none';
}

// ---- snapping -----------------------------------------------------------------------

/** Lines an edge can snap to. Only like edges pair up (left↔left, center↔center…), so a snap means "aligned". */
function snapTargets(slideEl, el, home = null) {
  const s = slideEl.getBoundingClientRect();
  const xs = [];
  const ys = [];
  const add = (list, kind, v, label, span, box = null) => list.push({ kind, v, label, span, box, prio: !!box });
  // purple areas drawn on the slide: an element's original spot, another's target box, sketch boxes
  const addBox = (r, name) => {
    add(xs, 'l', r.left, `${name} 왼쪽 선`, [r.top, r.bottom], r);
    add(xs, 'c', r.left + r.width / 2, `${name} 가로 가운데`, [r.top, r.bottom], r);
    add(xs, 'r', r.right, `${name} 오른쪽 선`, [r.top, r.bottom], r);
    add(ys, 't', r.top, `${name} 위쪽 선`, [r.left, r.right], r);
    add(ys, 'm', r.top + r.height / 2, `${name} 세로 가운데`, [r.left, r.right], r);
    add(ys, 'b', r.bottom, `${name} 아래쪽 선`, [r.left, r.right], r);
  };
  if (home) addBox(home, '원래 위치');
  for (const it of S.items) {
    if (it.type !== 'layout') continue;
    if (it.target === 'sketch' && it._slide === slideEl) {
      (it.sketch?.boxes || []).forEach((b, i) => addBox(rectOf(b, s), `스케치 칸 ${i + 1}${b.label ? `「${trunc(b.label, 12)}」` : ''}`));
    } else if (it.target === 'element' && it.layout && it._el?.isConnected && it._el !== el && slideFor(it._el) === slideEl) {
      const L = it.layout;
      if (L.to || L.reorder) addBox(rectOf(L.from, s), `${shortName(it._el)}의 원래 위치`);
      if (L.to && L.fit === 'box') addBox(rectOf(L.to, s), `${shortName(it._el)}의 목표 상자`);
    }
  }
  add(xs, 'l', s.left, '슬라이드 왼쪽 끝');
  add(xs, 'c', s.left + s.width / 2, '슬라이드 가로 가운데');
  add(xs, 'r', s.right, '슬라이드 오른쪽 끝');
  add(ys, 't', s.top, '슬라이드 위쪽 끝');
  add(ys, 'm', s.top + s.height / 2, '슬라이드 세로 가운데');
  add(ys, 'b', s.bottom, '슬라이드 아래쪽 끝');
  if (slideEl !== document.body && slideEl.offsetWidth) {
    const k = s.width / slideEl.offsetWidth;
    const cs = getComputedStyle(slideEl);
    const pl = parseFloat(cs.paddingLeft) * k;
    const pr = parseFloat(cs.paddingRight) * k;
    const pt = parseFloat(cs.paddingTop) * k;
    const pb = parseFloat(cs.paddingBottom) * k;
    if (pl > 4) add(xs, 'l', s.left + pl, '슬라이드 왼쪽 여백선');
    if (pr > 4) add(xs, 'r', s.right - pr, '슬라이드 오른쪽 여백선');
    if (pt > 4) add(ys, 't', s.top + pt, '슬라이드 위쪽 여백선');
    if (pb > 4) add(ys, 'b', s.bottom - pb, '슬라이드 아래쪽 여백선');
  }
  const area = s.width * s.height;
  let n = 0;
  for (const o of slideEl.querySelectorAll('*')) {
    if (n > 150) break;
    if (o === el || o.contains(el) || el.contains(o) || (o.closest('svg') && o.localName !== 'svg')) continue;
    const r = o.getBoundingClientRect();
    if (r.width * r.height < area * 0.004 || r.width < 2) continue;
    n++;
    const name = shortName(o);
    add(xs, 'l', r.left, `${name} 왼쪽 선`, [r.top, r.bottom]);
    add(xs, 'c', r.left + r.width / 2, `${name} 가로 가운데`, [r.top, r.bottom]);
    add(xs, 'r', r.right, `${name} 오른쪽 선`, [r.top, r.bottom]);
    add(ys, 't', r.top, `${name} 위쪽 선`, [r.left, r.right]);
    add(ys, 'm', r.top + r.height / 2, `${name} 세로 가운데`, [r.left, r.right]);
    add(ys, 'b', r.bottom, `${name} 아래쪽 선`, [r.left, r.right]);
  }
  return { xs, ys, slide: s };
}

function snapRect(R, targets, xEdges, yEdges) {
  const pick = (edges, list, val) => {
    let best = null;
    for (const edge of edges) {
      const v = val(edge);
      for (const t of list) {
        if (t.kind !== edge) continue;
        const d = t.v - v;
        const dist = Math.abs(d) - (t.prio ? 0.75 : 0); // purple areas win ties
        if (Math.abs(d) <= SNAP_PX && (!best || dist < best.dist)) best = { d, t, edge, dist };
      }
    }
    return best;
  };
  const x = pick(xEdges, targets.xs, (e) => (e === 'l' ? R.left : e === 'c' ? R.left + R.width / 2 : R.right));
  const y = pick(yEdges, targets.ys, (e) => (e === 't' ? R.top : e === 'm' ? R.top + R.height / 2 : R.bottom));
  return { dx: x?.d || 0, dy: y?.d || 0, x, y };
}

const snapNotes = (snap) => [snap?.x, snap?.y].filter(Boolean).map((s) => `${s.t.label}에 맞춤`);

function showGuides(snap, s) {
  const line = (node, hit, vertical) => {
    if (!hit) {
      node.style.display = 'none';
      return;
    }
    node.style.display = '';
    const span = hit.t.span || (vertical ? [s.top, s.bottom] : [s.left, s.right]);
    if (vertical) size(node, new DOMRect(hit.t.v, Math.min(span[0], s.top), 1, Math.max(span[1], s.bottom) - Math.min(span[0], s.top)));
    else size(node, new DOMRect(Math.min(span[0], s.left), hit.t.v, Math.max(span[1], s.right) - Math.min(span[0], s.left), 1));
  };
  line(N.gx, snap?.x, true);
  line(N.gy, snap?.y, false);
}

function hideGuides() {
  N.gx.style.display = 'none';
  N.gy.style.display = 'none';
  N.ins.style.display = 'none';
  N.out.style.display = 'none';
  N.tbox.style.display = 'none';
  N.dghost.style.display = 'none';
}

/** Light up the purple area the element just snapped to. */
function showSnapBox(snap) {
  const box = snap?.home || snap?.x?.t.box || snap?.y?.t.box;
  N.tbox.style.display = box ? '' : 'none';
  if (box) size(N.tbox, box);
}

/** Where the element sat originally (before any layout change), in screen pixels. */
function homeRect(el, slideRect) {
  const L = findItem(el)?.layout;
  return L?.from ? rectOf(L.from, slideRect) : el.getBoundingClientRect();
}

// ---- move / reorder -------------------------------------------------------------------

function currentTranslate(el) {
  const m = /(-?[\d.]+)px\s+(-?[\d.]+)px/.exec(el.style.getPropertyValue('translate'));
  return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : { x: 0, y: 0 };
}

/** pointerdown on the deck in element mode. */
export function press(e, target) {
  if (!target) {
    deselect();
    return;
  }
  const inSel = !!sel && sel.el.contains(target);
  // dragging inside the selection moves it; a plain click there drills one level down
  const subject = inSel ? sel.el : pickAt(target);
  const picked = inSel ? pickAt(target, sel.el) : subject;
  drag = { kind: 'move', el: subject, picked, inSel, x0: e.clientX, y0: e.clientY, started: false, fixed: isSlideEl(subject) };
  try {
    e.target.setPointerCapture?.(e.pointerId);
  } catch {
    /* not capturable */
  }
}

export function move(e) {
  const d = drag;
  if (!d || d.kind !== 'move') return;
  if (!d.started) {
    if (d.fixed || Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 4) return;
    beginMove(d);
  }
  updateMove(d, e);
}

export function release() {
  const d = drag;
  drag = null;
  if (!d || d.kind !== 'move') return;
  if (!d.started) {
    // a click: select it — or, inside the current selection, drill down to what was clicked
    select(d.inSel && sel && d.picked !== sel.el && sel.el.contains(d.picked) ? d.picked : d.el);
    return;
  }
  endMove(d);
}

function beginMove(d) {
  d.started = true;
  if (sel?.el !== d.el) select(d.el);
  hideBar();
  const el = d.el;
  d.slideEl = slideFor(el);
  d.slideRect = d.slideEl.getBoundingClientRect();
  d.k = ancestorScale(el);
  d.t0 = currentTranslate(el);
  d.rect0 = el.getBoundingClientRect();
  d.home = homeRect(el, d.slideRect);
  d.targets = snapTargets(d.slideEl, el, d.home);
  d.kids = inFlowKids(el.parentElement);
  d.canReorder = d.kids.length >= 2 && d.kids.includes(el) && !isSlideEl(el.parentElement);
  d.axis = d.canReorder ? axisOf(d.kids.map((k) => k.getBoundingClientRect())) : 'y';
  d.dx = 0;
  d.dy = 0;
  // see-through and on top while dragging, so the drop spot stays visible (restored by recompute)
  put(el, 'opacity', '0.72');
  if (getComputedStyle(el).position === 'static') put(el, 'position', 'relative');
  put(el, 'z-index', '2147483000');
}

function reorderTarget(d, x, y) {
  for (let i = 0; i < d.kids.length; i++) {
    const k = d.kids[i];
    if (k === d.el) continue;
    const r = k.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
    const horizontal = d.axis !== 'y';
    return { index: i, before: horizontal ? x < r.left + r.width / 2 : y < r.top + r.height / 2, rect: r, horizontal };
  }
  return null;
}

/** Index the element would get if dropped at this sibling slot (null when the order would not change). */
function reorderIndex(d, target) {
  if (!target) return null;
  const from = d.kids.indexOf(d.el);
  let to = target.before ? target.index : target.index + 1;
  if (to > from) to -= 1;
  return to === from ? null : to;
}

function updateMove(d, e) {
  let dx = e.clientX - d.x0;
  let dy = e.clientY - d.y0;
  const hit = d.canReorder && !e.altKey ? reorderTarget(d, e.clientX, e.clientY) : null;
  const to = reorderIndex(d, hit);
  d.reorder = to === null ? null : { ...hit, to }; // same slot → it is a free move, not a reorder
  d.snap = null;
  if (!d.reorder && !e.altKey) {
    const R = new DOMRect(d.rect0.left + dx, d.rect0.top + dy, d.rect0.width, d.rect0.height);
    const hx = d.home.left - R.left;
    const hy = d.home.top - R.top;
    if (Math.abs(hx) <= HOME_PX && Math.abs(hy) <= HOME_PX) {
      // back over its original spot: lock exactly onto it
      dx += hx;
      dy += hy;
      d.snap = { dx: hx, dy: hy, home: d.home };
    } else {
      d.snap = snapRect(R, d.targets, ['l', 'c', 'r'], ['t', 'm', 'b']);
      dx += d.snap.dx;
      dy += d.snap.dy;
    }
  }
  d.dx = dx;
  d.dy = dy;
  put(d.el, 'translate', `${r2(d.t0.x + dx / d.k)}px ${r2(d.t0.y + dy / d.k)}px`);
  showGuides(d.snap?.home ? null : d.snap, d.slideRect);
  showSnapBox(d.snap);
  N.dghost.style.display = '';
  size(N.dghost, d.home);
  if (d.reorder) {
    const r = d.reorder.rect;
    N.ins.style.display = '';
    if (d.reorder.horizontal) size(N.ins, new DOMRect((d.reorder.before ? r.left : r.right) - 2, r.top, 4, r.height));
    else size(N.ins, new DOMRect(r.left, (d.reorder.before ? r.top : r.bottom) - 2, r.width, 4));
  } else N.ins.style.display = 'none';
  scheduleRender();
}

function endMove(d) {
  hideGuides();
  const el = d.el;
  if (d.reorder) {
    const from = d.kids.indexOf(el);
    const { to } = d.reorder;
    const order = d.kids.filter((k) => k !== el);
    order.splice(to, 0, el);
    const after = order[to - 1];
    const before = order[to + 1];
    commit(el, (L) => {
      L.reorder = { from, to, count: d.kids.length, after: after ? shortName(after) : null, before: before ? shortName(before) : null };
      L.to = null; // a new order replaces a free move
      L.snaps = [];
    });
    select(el);
    return;
  }
  if (Math.abs(d.dx) < 1 && Math.abs(d.dy) < 1) {
    recompute();
    select(el);
    return;
  }
  const T = el.getBoundingClientRect();
  const prev = findItem(el)?.layout;
  const to = prev?.to && prev.fit === 'box' ? { ...frac(T, d.slideRect), w: prev.to.w, h: prev.to.h } : frac(T, d.slideRect);
  const home = !!d.snap?.home;
  const snaps = home ? [] : snapNotes(d.snap);
  commit(el, (L) => {
    if (home) L.to = L.to && L.fit === 'box' ? { ...L.to, x: L.from.x, y: L.from.y } : { ...to, x: L.from.x, y: L.from.y };
    else L.to = to;
    L.fit = prev?.fit || 'scale';
    L.snaps = snaps;
    L.reorder = null;
  });
  if (home) toast('원래 위치로 되돌렸어요', { ms: 1600 });
  select(el);
}

// ---- resize ---------------------------------------------------------------------------

function startResize(e, handle) {
  if (!sel || e.button !== 0 || isSlideEl(sel.el)) return;
  e.preventDefault();
  e.stopPropagation();
  const el = sel.el;
  const prev = findItem(el)?.layout;
  const d = {
    kind: 'resize',
    started: true,
    handle,
    el,
    x0: e.clientX,
    y0: e.clientY,
    proportional: handle.length === 2 || isMedia(el),
    slideEl: slideFor(el),
    k: ancestorScale(el),
    rect0: el.getBoundingClientRect(),
    scale0: parseFloat(el.style.getPropertyValue('scale')) || 1,
  };
  d.slideRect = d.slideEl.getBoundingClientRect();
  d.box0 = prev?.to && prev.fit === 'box' ? rectOf(prev.to, d.slideRect) : d.rect0;
  d.targets = snapTargets(d.slideEl, el, prev?.from ? rectOf(prev.from, d.slideRect) : null);
  drag = d;
  hideBar();
  const target = e.currentTarget;
  target.setPointerCapture(e.pointerId);
  const onMove = (ev) => updateResize(d, ev);
  const onUp = () => {
    target.removeEventListener('pointermove', onMove);
    target.removeEventListener('pointerup', onUp);
    target.removeEventListener('pointercancel', onUp);
    drag = null;
    endResize(d);
  };
  target.addEventListener('pointermove', onMove);
  target.addEventListener('pointerup', onUp);
  target.addEventListener('pointercancel', onUp);
}

function updateResize(d, e) {
  const hd = d.handle;
  const B = d.proportional ? d.rect0 : d.box0;
  let { left, top, right, bottom } = B;
  const dx = e.clientX - d.x0;
  const dy = e.clientY - d.y0;
  if (hd.includes('e')) right += dx;
  if (hd.includes('w')) left += dx;
  if (hd.includes('s')) bottom += dy;
  if (hd.includes('n')) top += dy;
  d.snap = null;
  if (!e.altKey) {
    const xs = hd.includes('e') ? ['r'] : hd.includes('w') ? ['l'] : [];
    const ys = hd.includes('s') ? ['b'] : hd.includes('n') ? ['t'] : [];
    d.snap = snapRect(new DOMRect(left, top, right - left, bottom - top), d.targets, xs, ys);
    if (hd.includes('e')) right += d.snap.dx;
    if (hd.includes('w')) left += d.snap.dx;
    if (hd.includes('s')) bottom += d.snap.dy;
    if (hd.includes('n')) top += d.snap.dy;
    showGuides(d.snap, d.slideRect);
    showSnapBox(d.snap);
  }
  if (right - left < 12) {
    if (hd.includes('w')) left = right - 12;
    else right = left + 12;
  }
  if (bottom - top < 12) {
    if (hd.includes('n')) top = bottom - 12;
    else bottom = top + 12;
  }
  if (d.proportional) {
    const w0 = d.rect0.width;
    const h0 = d.rect0.height;
    const sx = (right - left) / w0;
    const sy = (bottom - top) / h0;
    const s = hd.length === 2 ? Math.max(sx, sy) : hd === 'e' || hd === 'w' ? sx : sy;
    const W = w0 * s;
    const H = h0 * s;
    const ax = hd.includes('w') ? d.rect0.right - W : hd.includes('e') ? d.rect0.left : d.rect0.left + (w0 - W) / 2;
    const ay = hd.includes('n') ? d.rect0.bottom - H : hd.includes('s') ? d.rect0.top : d.rect0.top + (h0 - H) / 2;
    d.T = new DOMRect(ax, ay, W, H);
    // preview: scale the element, then translate its scaled box onto the target
    put(d.el, 'scale', String(Math.round(d.scale0 * s * 1000) / 1000));
    put(d.el, 'translate', '0px 0px');
    const r = d.el.getBoundingClientRect();
    put(d.el, 'translate', `${r2((d.T.left - r.left) / d.k)}px ${r2((d.T.top - r.top) / d.k)}px`);
  } else {
    d.T = new DOMRect(left, top, right - left, bottom - top);
    N.out.style.display = '';
    size(N.out, d.T);
  }
  scheduleRender();
}

function endResize(d) {
  hideGuides();
  if (!d.T) {
    select(d.el);
    return;
  }
  const to = frac(d.T, d.slideRect);
  const fit = d.proportional ? 'scale' : 'box';
  const snaps = snapNotes(d.snap);
  commit(d.el, (L) => {
    L.to = to;
    L.fit = fit;
    if (snaps.length) L.snaps = snaps;
    // resizing keeps a new order: the element is resized in its new slot
  });
  select(d.el);
}

// ---- quick actions --------------------------------------------------------------------

function fontStep(dir) {
  const el = sel.el;
  const it = findItem(el);
  const base = it?.layout.font?.from ?? original(() => parseFloat(getComputedStyle(el).fontSize));
  const cur = it?.layout.font?.to ?? base;
  let next = Math.round(cur * (dir > 0 ? 1.1 : 1 / 1.1) * 2) / 2;
  if (next === cur) next = cur + dir;
  next = clamp(next, Math.max(6, Math.round(base * 0.4)), Math.round(base * 4));
  commit(el, (L) => {
    L.font = Math.abs(next - base) < 0.25 ? null : { from: base, to: next };
  });
}

function gapStep(dir) {
  const el = sel.el;
  const it = findItem(el);
  const base = it?.layout.gap?.from ?? original(() => {
    const cs = getComputedStyle(el);
    return Math.round(Math.max(parseFloat(cs.columnGap) || 0, parseFloat(cs.rowGap) || 0));
  });
  const cur = it?.layout.gap?.to ?? base;
  const next = Math.max(0, cur + dir * Math.max(4, Math.round(Math.max(cur, 16) * 0.25)));
  commit(el, (L) => {
    L.gap = next === base ? null : { from: base, to: next };
  });
}

function padStep(dir) {
  const el = sel.el;
  const it = findItem(el);
  const base = it?.layout.padding?.from ?? original(() => {
    const cs = getComputedStyle(el);
    return ['Top', 'Right', 'Bottom', 'Left'].map((k) => Math.round(parseFloat(cs[`padding${k}`]) || 0));
  });
  const cur = it?.layout.padding?.to ?? base;
  const avg = cur.reduce((a, b) => a + b, 0) / 4;
  const step = Math.max(4, Math.round(Math.max(avg, 16) * 0.25));
  const next = cur.map((v) => Math.max(0, v + dir * step));
  commit(el, (L) => {
    L.padding = next.every((v, i) => v === base[i]) ? null : { from: base, to: next };
  });
}

function toggleDirection() {
  const el = sel.el;
  const it = findItem(el);
  const base = it?.layout.direction?.from ?? original(() => getComputedStyle(el).flexDirection);
  const cur = it?.layout.direction?.to ?? base;
  const next = cur.startsWith('row') ? cur.replace('row', 'column') : cur.replace('column', 'row');
  commit(el, (L) => {
    L.direction = next === base ? null : { from: base, to: next };
  });
}

function colStep(dir) {
  const el = sel.el;
  const it = findItem(el);
  const base = it?.layout.columns?.from ?? original(() => gridColumns(getComputedStyle(el)) || 1);
  const cur = it?.layout.columns?.to ?? base;
  const next = clamp(cur + dir, 1, 8);
  commit(el, (L) => {
    L.columns = next === base ? null : { from: base, to: next };
  });
}

function centerX() {
  const el = sel.el;
  const s = slideFor(el).getBoundingClientRect();
  const prev = findItem(el)?.layout;
  const r = prev?.to ? rectOf(prev.to, s) : el.getBoundingClientRect();
  const T = new DOMRect(s.left + (s.width - r.width) / 2, r.top, r.width, r.height);
  commit(el, (L) => {
    L.to = frac(T, s);
    L.fit = prev?.fit || 'scale';
    L.snaps = ['슬라이드 가로 가운데에 맞춤'];
    L.reorder = null;
  });
}

function nudge(dx, dy, big) {
  const el = sel.el;
  const s = slideFor(el).getBoundingClientRect();
  const prev = findItem(el)?.layout;
  const r = prev?.to ? rectOf(prev.to, s) : el.getBoundingClientRect();
  const step = big ? 0.025 : 0.005;
  const T = new DOMRect(r.left + dx * step * s.width, r.top + dy * step * s.height, r.width, r.height);
  commit(el, (L) => {
    L.to = frac(T, s);
    L.fit = prev?.fit || 'scale';
    L.snaps = [];
    L.reorder = null;
  });
}

function resetSelected() {
  const it = findItem(sel.el);
  if (it) mutate(() => { S.items = S.items.filter((x) => x !== it); });
}

function deleteSelected() {
  const el = sel.el;
  const it = findItem(el);
  deselect();
  if (it) mutate(() => { S.items = S.items.filter((x) => x !== it); });
  A.deleteElement(el);
}

function commentSelected() {
  const el = sel.el;
  hideBar();
  A.commentElement(el, () => {
    if (sel?.el === el) buildBar();
  });
}

/** Keyboard while an element is selected in element mode. Returns true if handled. */
export function onKey(e) {
  if (!sel || popoverOpen()) return false;
  if (e.key === 'Escape') {
    deselect();
    return true;
  }
  if (e.metaKey || e.ctrlKey) return false;
  const del = e.code === 'KeyD' || e.key === 'Delete' || e.key === 'Backspace';
  if (isSlideEl(sel.el)) {
    if (del) {
      A.toggleSlideDelete(sel.el);
      deselect();
      return true;
    }
    if (e.code === 'KeyC') {
      A.slideComment(sel.el, sel.el.getBoundingClientRect());
      return true;
    }
    return false;
  }
  if (del) {
    deleteSelected();
    return true;
  }
  if (e.code === 'KeyC' || e.code === 'KeyM') {
    commentSelected();
    return true;
  }
  const arrow = ARROWS[e.key];
  if (arrow && e.shiftKey) {
    nudge(...arrow, e.altKey);
    return true;
  }
  if (e.altKey && e.key === 'ArrowUp') {
    const p = sel.el.parentElement;
    if (p && p !== document.body) select(p);
    return true;
  }
  if (e.altKey && e.key === 'ArrowDown') {
    const c = [...sel.el.children].find((k) => k.getClientRects().length);
    if (c) select(c);
    return true;
  }
  if (arrow) {
    // plain arrows belong to the deck: they turn the page even with something selected
    if (!localStorage.getItem(NUDGE_TIP_KEY)) {
      localStorage.setItem(NUDGE_TIP_KEY, '1');
      toast('선택한 요소를 조금씩 옮기려면 Shift+방향키', { ms: 2600 });
    }
    return false;
  }
  if (e.key === '+' || e.key === '=') {
    fontStep(1);
    return true;
  }
  if (e.key === '-' || e.key === '_') {
    fontStep(-1);
    return true;
  }
  return false;
}

/** Clicking a layout mark (pin or list row): select its element to keep adjusting it. */
export function openItem(it) {
  if (it.target !== 'element' || !it._el?.isConnected) return false;
  if (S.mode !== 'element') A.setMode('element');
  select(it._el);
  return true;
}

// ---- drawing ----------------------------------------------------------------------------

const SVGNS = 'http://www.w3.org/2000/svg';

function markNodes(id) {
  let n = marks.get(id);
  if (!n) {
    const line = document.createElementNS(SVGNS, 'line');
    line.setAttribute('marker-end', 'url(#rp-arrow)');
    N.svg.append(line);
    n = { ghost: h('div', { class: 'lghost' }), out: h('div', { class: 'lout fixed' }, h('span', { class: 'lout-l' })), line };
    ui.layer.insertBefore(n.out, ui.layer.firstChild);
    ui.layer.insertBefore(n.ghost, ui.layer.firstChild);
    marks.set(id, n);
  }
  return n;
}

function hideMark(n) {
  n.ghost.style.display = 'none';
  n.out.style.display = 'none';
  n.line.style.display = 'none';
}

function renderMarks() {
  const seen = new Set();
  if (!S.paused) {
    for (const it of S.items) {
      if (it.type !== 'layout' || it.target !== 'element' || !it.layout) continue;
      seen.add(it.id);
      const n = markNodes(it.id);
      const el = it._el;
      const slideEl = it._slide || (el && slideOf(el));
      const op = slideEl && slideEl !== document.body ? slideOpacity(slideEl) : 1;
      if (!el?.isConnected || op <= 0) {
        hideMark(n);
        continue;
      }
      const o = op < 0.995 ? String(Math.round(op * 100) / 100) : '';
      n.ghost.style.opacity = o;
      n.out.style.opacity = o;
      n.line.style.opacity = o;
      const s = (slideEl || document.body).getBoundingClientRect();
      const L = it.layout;
      const shifted = !!(L.to || L.reorder);
      const g = rectOf(L.from, s);
      const cur = el.getBoundingClientRect();
      const dragged = drag?.started && drag.el === el;
      n.ghost.style.display = shifted && !dragged ? '' : 'none';
      if (shifted) size(n.ghost, g);
      const c1 = [g.left + g.width / 2, g.top + g.height / 2];
      const c2 = [cur.left + cur.width / 2, cur.top + cur.height / 2];
      const far = Math.hypot(c2[0] - c1[0], c2[1] - c1[1]) > 14;
      n.line.style.display = shifted && far ? '' : 'none';
      if (shifted && far) {
        n.line.setAttribute('x1', c1[0]);
        n.line.setAttribute('y1', c1[1]);
        n.line.setAttribute('x2', c2[0]);
        n.line.setAttribute('y2', c2[1]);
      }
      const boxed = L.to && L.fit === 'box';
      n.out.style.display = boxed ? '' : 'none';
      if (boxed) {
        size(n.out, rectOf(L.to, s));
        n.out.firstChild.textContent = `너비 ${pct(L.to.w)}% × 높이 ${pct(L.to.h)}%`;
      }
    }
  }
  for (const [id, n] of marks) {
    if (seen.has(id)) continue;
    n.ghost.remove();
    n.out.remove();
    n.line.remove();
    marks.delete(id);
  }
}

const TIP_KEY = 'redpen:layout-tip';

/** First time in layout mode: a short how-to card above the toolbar. */
function coach() {
  if (N.coach || localStorage.getItem(TIP_KEY)) return;
  N.coach = h('div', { class: 'onboard lcoach' },
    h('h4', null, '📐 레이아웃 모드'),
    h('ul', null,
      h('li', null, '바꿀 요소(카드·이미지·글 상자)를 ', h('b', null, '클릭'), ' → 끌어서 옮기기'),
      h('li', null, '다른 칸 위에 놓으면 ', h('b', null, '순서 바꾸기')),
      h('li', null, '모서리 손잡이로 ', h('b', null, '크기'), ', 막대에서 글자·간격·여백'),
      h('li', null, h('kbd', null, 'Shift'), '+방향키 조금씩 옮기기 · 방향키만 누르면 슬라이드 넘기기'),
      h('li', null, h('kbd', null, 'D'), ' 삭제 · ', h('kbd', null, 'C'), ' 코멘트 · ', h('kbd', null, 'Esc'), ' 선택 해제')),
    h('button', {
      class: 'btn',
      onClick: () => {
        localStorage.setItem(TIP_KEY, '1');
        N.coach.remove();
        N.coach = null;
      },
    }, '알겠어요'));
  ui.app.append(N.coach);
}

/** Keep the hint pill / coach card just above the toolbar (it can be dragged anywhere). */
function placeAboveBar(el) {
  const bar = ui.shadow.querySelector('.bar');
  if (!bar) return;
  const r = bar.getBoundingClientRect();
  const w = el.offsetWidth;
  const hh = el.offsetHeight;
  const top = r.top - hh - 10 >= 8 ? r.top - hh - 10 : r.bottom + 10;
  el.style.left = `${clamp(r.left + r.width / 2 - w / 2, 8, innerWidth - w - 8)}px`;
  el.style.top = `${top}px`;
}

function renderHint() {
  const on = S.mode === 'element' && !S.paused;
  if (on) coach();
  if (!on && N.coach) N.coach.style.display = 'none';
  else if (N.coach) {
    N.coach.style.display = '';
    placeAboveBar(N.coach);
  }
  const show = on && !sel && !drag && !N.coach && !popoverOpen();
  N.hint.style.display = show ? '' : 'none';
  if (show) placeAboveBar(N.hint);
}

function render() {
  renderHint();
  if (sel) {
    const slide = slideOf(sel.el);
    if (!sel.el.isConnected || S.mode !== 'element' || S.paused || (slide && slide !== document.body && !slideVisible(slide))) deselect();
  }
  renderMarks();
  if (!sel) {
    N.box.style.display = 'none';
    N.size.style.display = 'none';
    for (const hd of N.handles) hd.style.display = 'none';
    return;
  }
  const r = sel.el.getBoundingClientRect();
  const slideSel = isSlideEl(sel.el);
  N.box.style.display = '';
  N.box.classList.toggle('slide', slideSel);
  size(N.box, r);
  const pos = { nw: [r.left, r.top], n: [r.left + r.width / 2, r.top], ne: [r.right, r.top], e: [r.right, r.top + r.height / 2], se: [r.right, r.bottom], s: [r.left + r.width / 2, r.bottom], sw: [r.left, r.bottom], w: [r.left, r.top + r.height / 2] };
  N.handles.forEach((hd) => {
    const [x, y] = pos[hd.dataset.h];
    hd.style.display = slideSel ? 'none' : '';
    place(hd, x - 5, y - 5);
  });
  const s = slideFor(sel.el).getBoundingClientRect();
  const box = drag?.kind === 'resize' && drag.T ? drag.T : r;
  N.size.textContent = drag?.kind === 'move' && drag.started
    ? `x ${pct((r.left - s.left) / s.width)}% · y ${pct((r.top - s.top) / s.height)}%`
    : `${pct(box.width / s.width)}% × ${pct(box.height / s.height)}%`;
  N.size.style.display = slideSel ? 'none' : '';
  place(N.size, r.left, r.top - 22 >= 4 ? r.top - 22 : r.bottom + 6);
  if (!drag && N.bar.style.display !== 'none') {
    const bw = N.bar.offsetWidth;
    const bh = N.bar.offsetHeight;
    let y = r.bottom + 14;
    if (y + bh > innerHeight - 70) y = r.top - bh - 30;
    if (y < 8) y = Math.min(innerHeight - bh - 70, Math.max(8, r.top + 8));
    N.bar.style.left = `${clamp(r.left + r.width / 2 - bw / 2, 8, innerWidth - bw - 8)}px`;
    N.bar.style.top = `${y}px`;
  }
}

export function initLayout() {
  N.box = h('div', { class: 'lsel', style: { display: 'none' } });
  N.size = h('div', { class: 'lsize', style: { display: 'none' } });
  N.handles = HANDLES.map((k) => {
    const hd = h('div', { class: 'lh', dataset: { h: k } });
    hd.style.cursor = CURSOR[k];
    hd.addEventListener('pointerdown', (e) => startResize(e, k));
    return hd;
  });
  N.gx = h('div', { class: 'lguide', style: { display: 'none' } });
  N.gy = h('div', { class: 'lguide', style: { display: 'none' } });
  N.ins = h('div', { class: 'lins', style: { display: 'none' } });
  N.out = h('div', { class: 'lout', style: { display: 'none' } });
  N.tbox = h('div', { class: 'ltarget', style: { display: 'none' } });
  N.dghost = h('div', { class: 'lghost', style: { display: 'none' } });
  N.svg = document.createElementNS(SVGNS, 'svg');
  N.svg.setAttribute('class', 'larrows');
  N.svg.innerHTML = '<defs><marker id="rp-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#8e4ec6"/></marker></defs>';
  N.bar = h('div', { class: 'lbar', style: { display: 'none' } });
  N.hint = h('div', { class: 'lhint', style: { display: 'none' } }, icon('layout', 14), '바꿀 요소를 클릭하세요 · 끌어서 이동 · 모서리로 크기');
  ui.layer.append(N.svg, N.dghost, N.tbox, N.box, N.out, N.gx, N.gy, N.ins, ...N.handles, N.size);
  ui.app.append(N.bar, N.hint);
  registerRenderer(render);
  let t = 0;
  addEventListener('resize', () => {
    clearTimeout(t);
    t = setTimeout(recompute, 150);
  });
}
