import { ui } from './root.js';
import { S, ordered, numbering, TYPE_LABEL, TARGET_LABEL } from '../state.js';
import { slideOf, slideVisible, slideOpacity } from '../slides.js';
import { h, clamp, trunc } from '../util.js';
import { icon } from '../icons.js';
import { itemSummary } from '../summary.js';
import { tr } from '../i18n/index.js';

/*
 * Everything drawn over the deck: numbered pins, element/region/slide boxes, the floating selection
 * toolbar, the element-picker outline and the region being drawn. Positions are recomputed from live
 * DOM geometry every frame something might have moved (scroll, resize, slide change…).
 */

const supportsHighlight = typeof CSS !== 'undefined' && !!CSS.highlights && typeof Highlight !== 'undefined';
const nodes = new Map(); // item id → { pin, box, chip, marks[] }
let handlers = { onPinClick: () => {} };
let raf = 0;
let hoverEl = null;
let pickedEl = null;
let regionRect = null;
let cardFor = null;
let hoverBox;
let hoverLabel;
let regionBox;
let card;
let selBar;
let sel = null; // { range, onAction }

export function initOverlay(opts) {
  handlers = { ...handlers, ...opts };
  hoverBox = h('div', { class: 'hover-box', style: { display: 'none' } });
  hoverLabel = h('div', { class: 'hover-label', style: { display: 'none' } });
  regionBox = h('div', { class: 'region-draft', style: { display: 'none' } });
  card = h('div', { class: 'card', style: { display: 'none' } });
  ui.layer.append(hoverBox, hoverLabel, regionBox, card);
  setInterval(scheduleRender, 400);
}

export function scheduleRender() {
  if (!raf) raf = requestAnimationFrame(renderFrame);
}

let burstUntil = 0;
/** Redraw every frame for a while — slides are switching or animating, marks must follow without lag. */
export function renderBurst(ms = 700) {
  burstUntil = Math.max(burstUntil, performance.now() + ms);
  scheduleRender();
}

/** Opacity for a mark on a slide that is `op` visible ('' = fully, to keep the style clean). */
const fade = (el, op) => {
  el.style.opacity = op < 0.995 ? String(Math.round(op * 100) / 100) : '';
};

const renderers = [];
/** Extra drawing passes (layout selection, sketches) that run every frame after the marks. */
export function registerRenderer(fn) {
  renderers.push(fn);
}

export function setHover(el) {
  if (hoverEl === el) return;
  hoverEl = el;
  scheduleRender();
}

export function setPicked(el) {
  pickedEl = el;
  scheduleRender();
}

export function setRegionDraft(rect) {
  regionRect = rect;
  scheduleRender();
}

// ---- text highlights (CSS Custom Highlight API; falls back to drawn marks) ---------

export function refreshHighlights() {
  if (!supportsHighlight) return scheduleRender();
  const groups = { delete: [], replace: [], comment: [] };
  if (!S.paused) {
    for (const it of S.items) if (it.target === 'text' && it._range && !it._orphan) groups[it.type]?.push(it._range);
  }
  for (const [type, ranges] of Object.entries(groups)) CSS.highlights.set(`redpen-${type}`, new Highlight(...ranges));
  const focus = !S.paused && S.items.find((it) => it.id === S.focusId && it._range);
  const focusRanges = [focus?._range, S.pendingRange].filter(Boolean);
  const fh = new Highlight(...focusRanges);
  fh.priority = 10;
  CSS.highlights.set('redpen-focus', fh);
  return scheduleRender();
}

// ---- selection toolbar ------------------------------------------------------------

function selButton(kind, ico, label, key) {
  return h('button', {
    class: kind[0],
    onPointerdown: (e) => e.preventDefault(),
    onMousedown: (e) => e.preventDefault(),
    onClick: () => sel?.onAction(kind),
  }, icon(ico, 15), label, h('kbd', null, key));
}

export function showSelBar(range, onAction) {
  if (!selBar) {
    selBar = h('div', { class: 'selbar' },
      selButton('delete', 'trash', tr('삭제'), 'D'),
      selButton('replace', 'edit', tr('수정'), 'R'),
      selButton('comment', 'comment', tr('코멘트'), 'C'));
    ui.app.append(selBar);
  }
  sel = { range, onAction };
  selBar.style.display = 'flex';
  positionSelBar();
}

export function hideSelBar() {
  sel = null;
  if (selBar) selBar.style.display = 'none';
}

export const selBarRange = () => sel?.range || null;

/** Selection bar is shown for text that is still on screen (re-checked now, not at the next frame). */
export function selBarLive() {
  positionSelBar();
  return !!sel && selBar?.style.visibility !== 'hidden';
}

function positionSelBar() {
  if (!sel || !selBar) return;
  const slide = slideOf(sel.range.commonAncestorContainer);
  if (slide && slide !== document.body && !slideVisible(slide)) {
    hideSelBar(); // the deck moved on: drop the selection instead of floating over the next slide
    return;
  }
  const r = sel.range.getBoundingClientRect();
  if ((!r.width && !r.height) || r.bottom < 0 || r.top > innerHeight) {
    selBar.style.visibility = 'hidden';
    return;
  }
  selBar.style.visibility = '';
  const w = selBar.offsetWidth;
  const hh = selBar.offsetHeight;
  let y = r.top - hh - 10;
  if (y < 8) y = r.bottom + 10;
  selBar.style.left = `${clamp(r.left + r.width / 2 - w / 2, 8, innerWidth - w - 8)}px`;
  selBar.style.top = `${clamp(y, 8, innerHeight - hh - 8)}px`;
}

// ---- per-item drawing --------------------------------------------------------------

function geometry(it) {
  if (it._orphan) return null;
  if (it.target === 'text') {
    if (!it._range) return null;
    const rects = [...it._range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
    return rects.length ? { rects, last: rects[rects.length - 1] } : null;
  }
  if (it.target === 'element') {
    if (!it._el?.isConnected) return null;
    const r = it._el.getBoundingClientRect();
    return r.width || r.height ? { box: r } : null;
  }
  const s = it._slide?.getBoundingClientRect();
  if (!s || !s.width) return null;
  if (it.target === 'region') {
    const g = it.region;
    return { box: new DOMRect(s.left + g.x * s.width, s.top + g.y * s.height, g.w * s.width, g.h * s.height) };
  }
  return { box: s };
}

function nodeFor(it) {
  let n = nodes.get(it.id);
  if (!n) {
    const pin = h('button', {
      class: 'pin',
      onClick: (e) => handlers.onPinClick(it.id, e.currentTarget.getBoundingClientRect()),
      onMouseenter: () => { cardFor = it.id; S.focusId = it.id; handlers.onFocus?.(); },
      onMouseleave: () => { cardFor = null; if (S.focusId === it.id) S.focusId = null; handlers.onFocus?.(); },
    });
    n = { pin, box: null, chip: null, marks: [] };
    ui.layer.append(pin);
    nodes.set(it.id, n);
  }
  return n;
}

function removeNode(id) {
  const n = nodes.get(id);
  if (!n) return;
  n.pin.remove();
  n.box?.remove();
  n.chip?.remove();
  n.marks.forEach((m) => m.remove());
  nodes.delete(id);
}

const place = (el, x, y) => {
  el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
};
const size = (el, r) => {
  place(el, r.left, r.top);
  el.style.width = `${Math.max(0, r.width)}px`;
  el.style.height = `${Math.max(0, r.height)}px`;
};

function cardText(it) {
  const k = `${tr(TYPE_LABEL[it.type])}${it.target === 'text' ? '' : ` · ${tr(TARGET_LABEL[it.target])}`}`;
  const parts = [h('span', { class: 'k' }, k)];
  if (it.type === 'layout') {
    parts.push(itemSummary(it));
    if (it.comment) parts.push(h('div', { style: { marginTop: '4px' } }, it.comment));
    return parts;
  }
  if (it.target === 'text') {
    if (it.type === 'replace') parts.push(h('s', null, trunc(it.text.exact, 80)), ` → ${trunc(it.replacement, 120)}`);
    else if (it.type === 'delete') parts.push(h('s', null, trunc(it.text.exact, 160)));
    else parts.push(trunc(it.text.exact, 60));
  } else if (it.target === 'element') parts.push(`<${it.element?.tag}> ${trunc(it.element?.text || '', 60)}`);
  if (it.comment) parts.push(h('div', { style: { marginTop: '4px' } }, it.comment));
  return parts;
}

function renderFrame() {
  raf = 0;
  if (!ui.layer) return;
  if (performance.now() < burstUntil) scheduleRender();
  positionSelBar();
  if (S.paused) {
    ui.layer.style.display = 'none';
    return;
  }
  ui.layer.style.display = '';

  const nums = numbering();
  const opCache = new Map();
  const slideOp = (s) => {
    if (!opCache.has(s)) opCache.set(s, slideOpacity(s));
    return opCache.get(s);
  };
  const placed = [];
  const seen = new Set();

  for (const it of ordered()) {
    seen.add(it.id);
    const n = nodeFor(it);
    const op = it._slide ? slideOp(it._slide) : 1;
    const g = op > 0 ? geometry(it) : null;
    const t = `t-${it.type}`;
    const focus = S.focusId === it.id;
    n.pin.className = `pin ${t}${focus ? ' focus' : ''}`;
    n.pin.textContent = String(nums.get(it.id));

    if (!g) {
      n.pin.style.display = 'none';
      if (n.box) n.box.style.display = 'none';
      if (n.chip) n.chip.style.display = 'none';
      n.marks.forEach((m) => { m.style.display = 'none'; });
      continue;
    }

    // anchor point for the pin (its pointy bottom-left corner)
    let ax;
    let ay;
    if (g.rects) {
      ax = g.last.right + 1;
      ay = g.last.top + 3;
    } else if (it.target === 'slide' || it.target === 'sketch') {
      ax = g.box.left + 12;
      ay = g.box.top + 34;
    } else {
      ax = g.box.right - 8;
      ay = g.box.top + 6;
    }
    if (ax < -4 || ax > innerWidth + 4 || ay < -4 || ay > innerHeight + 24) {
      // the mark is scrolled away: no pin pinned to the window edge (its box may still be partly visible)
      n.pin.style.display = 'none';
      if (n.chip) n.chip.style.display = 'none';
      if (n.box && g.box && g.box.bottom > 0 && g.box.top < innerHeight) {
        n.box.style.display = '';
        size(n.box, g.box);
      } else if (n.box) n.box.style.display = 'none';
      continue;
    }
    let px = clamp(ax, 4, innerWidth - 28);
    let py = clamp(ay - 20, 4, innerHeight - 24);
    for (let guard = 0; guard < 12 && placed.some((p) => Math.abs(p[0] - px) < 18 && Math.abs(p[1] - py) < 18); guard++) px += 20;
    placed.push([px, py]);
    n.pin.style.display = '';
    fade(n.pin, op);
    place(n.pin, px, py);

    // box for element / region / slide marks
    const wantsBox = it.target === 'element' || it.target === 'region' || (it.target === 'slide' && it.type === 'delete');
    if (wantsBox) {
      if (!n.box) {
        n.box = h('div');
        ui.layer.insertBefore(n.box, ui.layer.firstChild);
      }
      n.box.className = `box ${it.target} ${t}${focus ? ' focus' : ''}`;
      if (it.target === 'slide' && !n.box.firstChild) n.box.append(h('span', { class: 'tag' }, tr('슬라이드 삭제')));
      n.box.style.display = '';
      fade(n.box, op);
      size(n.box, g.box);
    } else if (n.box) n.box.style.display = 'none';

    // chip: replacement preview, or the slide comment
    const chipText = it.type === 'replace' ? it.replacement
      : it.target === 'slide' && it.type === 'comment' ? it.comment
        : it.target === 'slide' && it.move ? tr('{n}번째로 옮기기', { n: it.move.to + 1 }) : null;
    const roomy = !it._slide || it._slide === document.body || it._slide.getBoundingClientRect().width > 480;
    if (chipText != null && roomy) {
      if (!n.chip) {
        n.chip = h('div');
        ui.layer.append(n.chip);
      }
      n.chip.className = `chip ${t}`;
      n.chip.replaceChildren(h('span', { class: 'arrow' }, it.type === 'replace' || it.move ? '→' : '💬'), trunc(chipText, 60) || tr('(빈칸)'));
      n.chip.style.display = '';
      fade(n.chip, op);
      place(n.chip, Math.min(px + 24, innerWidth - 120), py);
    } else if (n.chip) n.chip.style.display = 'none';

    // fallback text marks where the Highlight API is missing
    if (!supportsHighlight && g.rects) {
      while (n.marks.length < Math.min(g.rects.length, 30)) {
        const m = h('div');
        ui.layer.insertBefore(m, ui.layer.firstChild);
        n.marks.push(m);
      }
      n.marks.forEach((m, i) => {
        const r = g.rects[i];
        m.style.display = r ? '' : 'none';
        if (r) {
          m.className = `mark ${t}`;
          fade(m, op);
          size(m, r);
        }
      });
    }

    if (cardFor === it.id) {
      card.replaceChildren(...cardText(it));
      card.style.display = '';
      const cw = card.offsetWidth;
      const ch = card.offsetHeight;
      const cx = clamp(px, 8, innerWidth - cw - 8);
      const cy = py - ch - 8 >= 8 ? py - ch - 8 : py + 28;
      place(card, cx, clamp(cy, 8, innerHeight - ch - 8));
    }
  }
  for (const id of [...nodes.keys()]) if (!seen.has(id)) removeNode(id);
  if (!cardFor || !seen.has(cardFor)) card.style.display = 'none';

  // element picker
  const target = pickedEl || hoverEl;
  const targetSlide = target && slideOf(target);
  if (target?.isConnected && (!targetSlide || slideVisible(targetSlide))) { // not once the deck has turned the page
    const r = target.getBoundingClientRect();
    hoverBox.className = `hover-box${pickedEl ? ' picked' : ''}`;
    hoverBox.style.display = '';
    size(hoverBox, r);
    const cls = [...target.classList].filter((c) => !/^(is-|has-)/.test(c)).slice(0, 2).join('.');
    const isSlide = handlers.isSlide?.(target);
    hoverLabel.textContent = isSlide ? `${tr('슬라이드 전체')} · ${Math.round(r.width)}×${Math.round(r.height)}`
      : `${target.localName}${target.id ? `#${target.id}` : ''}${cls ? `.${cls}` : ''} · ${Math.round(r.width)}×${Math.round(r.height)}`;
    hoverLabel.style.display = '';
    place(hoverLabel, clamp(r.left, 4, innerWidth - hoverLabel.offsetWidth - 4), r.top - 22 >= 4 ? r.top - 22 : r.bottom + 4);
  } else {
    hoverBox.style.display = 'none';
    hoverLabel.style.display = 'none';
  }

  // region being drawn
  if (regionRect) {
    regionBox.style.display = '';
    size(regionBox, regionRect);
  } else regionBox.style.display = 'none';

  for (const fn of renderers) {
    try {
      fn();
    } catch (err) {
      console.error('[redpen]', err);
    }
  }
}
