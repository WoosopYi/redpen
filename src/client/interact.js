import { S } from './state.js';
import * as A from './actions.js';
import { ui, isOurs, typingIn } from './ui/root.js';
import { getSlides, slideOf, slideVisible } from './slides.js';
import { showSelBar, hideSelBar, selBarRange, selBarLive, setHover, setRegionDraft, scheduleRender, renderBurst } from './ui/overlay.js';
import { popoverOpen, popoverDirty, closePopover, shakePopover } from './ui/popover.js';
import { modalOpen, closeTopModal } from './ui/feedback.js';
import { isEditable, clamp } from './util.js';
import * as L from './layout.js';
import { sketchOpen, sketchKey } from './sketch.js';
import { tr } from './i18n/index.js';

/*
 * Window-level (capture phase) input handling. Registered before the deck's own scripts run, so we
 * can keep the deck from reacting to review gestures: a drag-selection must not "click to advance",
 * picking an element must not follow its link, D/R/C on a selection must not trigger deck shortcuts.
 * Outside review gestures the deck keeps working (arrow keys, buttons, videos…).
 */

let ready = false;
let pointerDown = false;
let passPress = false; // this press belongs to one of the deck's own controls
let swallowClick = false;
let region = null;
let selTimer = 0;

export const setReady = () => {
  ready = true;
};

// Real controls only — a container with onclick (click-to-advance) is not one.
const CONTROL = 'a[href], button, input, select, textarea, label, summary, video[controls], audio[controls], [role="button"], [role="link"], [role="tab"]';

const active = () => ready && !S.paused;
const picking = () => active() && (S.mode === 'element' || S.mode === 'region');

const swallowedKeys = new Set(); // keydowns we consumed: their keyup must not reach the deck either
const PAGE_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);

function block(e) {
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e.type === 'keydown') swallowedKeys.add(e.code);
}

/** The element the event really started on (inside the deck's own shadow roots, too). */
const origin = (e) => e.composedPath?.()[0] || e.target;

/** Is there a character of visible text right under the pointer? */
function textUnderPoint(x, y) {
  let node = null;
  let offset = 0;
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    node = p?.offsetNode;
    offset = p?.offset ?? 0;
  } else if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    node = r?.startContainer;
    offset = r?.startOffset ?? 0;
  }
  if (!node || node.nodeType !== 3 || !node.data.trim() || !inDeck(node)) return false;
  const r = document.createRange();
  for (const o of [offset, offset - 1]) {
    if (o < 0 || o >= node.data.length) continue;
    r.setStart(node, o);
    r.setEnd(node, o + 1);
    for (const b of r.getClientRects()) if (x >= b.left - 1 && x <= b.right + 1 && y >= b.top - 1 && y <= b.bottom + 1) return true;
  }
  return false;
}

const inDeck = (node) => {
  const el = node && (node.nodeType === 1 ? node : node.parentElement);
  return !!el && !!document.body?.contains(el);
};

/** One of the deck's own controls outside every slide (its ← → buttons, page dots…): it keeps working in every mode. */
function deckControl(e) {
  const el = e.target?.nodeType === 1 ? e.target : e.target?.parentElement;
  const control = el?.closest?.(CONTROL);
  return !!control && !getSlides().single && inDeck(control) && !slideOf(control);
}

function pickable(target) {
  let el = target && (target.nodeType === 1 ? target : target.parentElement);
  if (!el || el === ui.host || !inDeck(el) || el === document.body) return null;
  const svg = el.closest('svg');
  if (svg && svg !== el) {
    let top = svg;
    for (let p = svg.parentElement?.closest('svg'); p; p = p.parentElement?.closest('svg')) top = p;
    el = top;
  }
  return el;
}

function slideAt(x, y) {
  const { els, single } = getSlides();
  if (single) return document.body;
  const hit = document.elementFromPoint(x, y);
  const s = hit && slideOf(hit);
  if (s && slideVisible(s)) return s;
  return els.find((el) => {
    const r = el.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom && slideVisible(el);
  }) || null;
}

function regionRect() {
  const s = region.slideEl.getBoundingClientRect();
  const x0 = clamp(Math.min(region.x0, region.x1), s.left, s.right);
  const x1 = clamp(Math.max(region.x0, region.x1), s.left, s.right);
  const y0 = clamp(Math.min(region.y0, region.y1), s.top, s.bottom);
  const y1 = clamp(Math.max(region.y0, region.y1), s.top, s.bottom);
  return new DOMRect(x0, y0, x1 - x0, y1 - y0);
}

function currentDeckSelection() {
  const s = getSelection();
  if (!s || s.isCollapsed || !s.rangeCount) return null;
  const r = s.getRangeAt(0);
  if (!inDeck(r.commonAncestorContainer) || isEditable(r.startContainer) || !r.toString().trim()) return null;
  return r;
}

function checkSelection() {
  if (!active() || S.mode !== 'text') return hideSelBar();
  const r = currentDeckSelection();
  if (!r) return hideSelBar();
  return showSelBar(r.cloneRange(), act);
}

function act(kind) {
  const r = selBarRange();
  if (!r) return;
  hideSelBar();
  getSelection()?.removeAllRanges();
  A.markText(kind, r);
}

// ---- handlers --------------------------------------------------------------------

function onKeyDown(e) {
  if (!ready || !e.isTrusted) return;
  if (isOurs(e) && typingIn(e)) return; // our text fields handle their own keys
  if (modalOpen()) {
    if (e.key === 'Escape') {
      block(e);
      closeTopModal();
    }
    return;
  }
  if (sketchOpen()) {
    if (sketchKey(e)) block(e);
    return;
  }
  if (!isOurs(e) && isEditable(origin(e))) return; // the deck's own inputs (also inside its web components)
  const mod = e.metaKey || e.ctrlKey;

  if (e.key === 'Escape') {
    if (popoverOpen()) {
      block(e);
      if (popoverDirty()) shakePopover();
      else closePopover();
    } else if (region) {
      block(e);
      region = null;
      setRegionDraft(null);
    } else if (selBarRange()) {
      block(e);
      getSelection()?.removeAllRanges();
      hideSelBar();
    } else if (S.mode === 'element' && L.selected()) {
      block(e);
      L.deselect();
    } else if (!S.paused && S.mode !== 'text') {
      block(e);
      A.setMode('text');
    } else if (S.panelOpen) {
      block(e);
      A.togglePanel(false);
    }
    return;
  }
  if (S.paused) return;

  if (S.mode === 'text' && selBarLive() && !mod && !e.altKey) {
    const kind = e.code === 'KeyD' || e.key === 'Delete' || e.key === 'Backspace' ? 'delete'
      : e.code === 'KeyR' || e.code === 'KeyE' ? 'replace'
        : e.code === 'KeyC' || e.code === 'KeyM' ? 'comment' : null;
    if (kind) {
      block(e);
      act(kind);
      return;
    }
  }
  if (S.mode === 'element' && L.onKey(e)) {
    block(e);
    return;
  }
  if (S.mode === 'element' && PAGE_KEYS.has(e.key)) setHover(null); // the deck may turn the page under the pointer
  if (mod && e.code === 'KeyZ') {
    if (e.shiftKey ? A.redo() : A.undo()) block(e);
    return;
  }
  if (mod && e.code === 'KeyY' && A.redo()) {
    block(e);
    return;
  }
  if (mod && e.key === 'Enter') {
    block(e);
    A.send('agent');
    return;
  }
  if (e.altKey && !mod) {
    const mode = { Digit1: 'text', Digit2: 'element', Digit3: 'region' }[e.code];
    if (mode) {
      block(e);
      A.setMode(mode);
    }
  }
}

function onPointerDown(e) {
  if (!active() || isOurs(e)) return;
  if (sketchOpen()) {
    block(e); // sketching a slide: the deck underneath stays still
    return;
  }
  pointerDown = true;
  swallowClick = false;
  if (popoverOpen()) {
    if (popoverDirty()) {
      block(e);
      swallowClick = true;
      shakePopover();
      return;
    }
    closePopover();
    if (S.mode === 'text') {
      // first click only dismisses; a drag may still start a new selection
      e.stopImmediatePropagation();
      swallowClick = true;
      return;
    }
  }
  if (picking() && deckControl(e)) {
    passPress = true; // e.g. the deck's → button: turn the page instead of picking the button
    return;
  }
  if (S.mode === 'element') {
    block(e);
    if (e.button === 0) L.press(e, pickable(e.target));
    return;
  }
  if (S.mode === 'region') {
    block(e);
    if (e.button !== 0) return;
    const slideEl = slideAt(e.clientX, e.clientY);
    if (!slideEl) {
      A.notify(tr('슬라이드 위에서 드래그해 주세요'), 'warn');
      return;
    }
    region = { slideEl, x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY };
    try {
      e.target.setPointerCapture?.(e.pointerId); // keep receiving the drag even outside the window
    } catch {
      /* not capturable */
    }
    setRegionDraft(regionRect());
  }
}

function onPointerMove(e) {
  if (!active()) return;
  if (region) {
    region.x1 = e.clientX;
    region.y1 = e.clientY;
    setRegionDraft(regionRect());
    return;
  }
  if (S.mode === 'element') {
    L.move(e);
    const over = !L.dragging() && !popoverOpen() && !isOurs(e) && !deckControl(e) ? pickable(e.target) : null;
    setHover(over && over !== L.selected() ? over : null); // the selection draws its own outline
  }
}

function onPointerUp(e) {
  pointerDown = false;
  if (passPress) {
    passPress = false;
    return;
  }
  if (!active()) return;
  if (region) {
    block(e);
    const r = regionRect();
    const { slideEl } = region;
    region = null;
    if (r.width < 8 || r.height < 8) {
      setRegionDraft(null);
      return;
    }
    A.openRegionComment(slideEl, r);
    return;
  }
  if (isOurs(e)) return;
  if (S.mode === 'element') {
    block(e);
    L.release();
    return;
  }
  if (picking()) {
    block(e);
    return;
  }
  setTimeout(checkSelection, 0);
}

function onPressGuard(e) {
  if (picking() && !isOurs(e) && !deckControl(e)) block(e);
}

function onClick(e) {
  if (!active() || isOurs(e)) return;
  if (swallowClick) {
    swallowClick = false;
    block(e);
    return;
  }
  if (picking()) {
    if (!deckControl(e)) block(e); // element mode selects on pointerup (see layout.js)
    return;
  }
  // text mode: the deck's real controls keep working…
  const target = origin(e);
  const control = target.closest?.(CONTROL);
  const selection = currentDeckSelection();
  if (control && !(selection && control.contains(selection.commonAncestorContainer))) return;
  // …but a click that ends a selection, or lands on text (1st click of a double-click), is ours.
  if (selection) {
    block(e);
    return;
  }
  const hit = A.hitTest(e.clientX, e.clientY);
  if (hit) {
    block(e);
    A.openItem(hit.id, new DOMRect(e.clientX - 4, e.clientY - 10, 8, 20));
    return;
  }
  if (getComputedStyle(target.nodeType === 1 ? target : target.parentElement).cursor !== 'pointer' && textUnderPoint(e.clientX, e.clientY)) block(e);
}

function onDblClick(e) {
  if (!active() || isOurs(e)) return;
  if (picking() || currentDeckSelection()) block(e);
}

function onSelectionChange() {
  if (!active() || S.mode !== 'text') return;
  clearTimeout(selTimer);
  selTimer = setTimeout(() => {
    if (!currentDeckSelection()) hideSelBar();
    else if (!pointerDown) checkSelection();
  }, 120);
}

function onKeyUp(e) {
  if (swallowedKeys.delete(e.code)) e.stopImmediatePropagation();
}

export function install() {
  const cap = { capture: true };
  addEventListener('keydown', onKeyDown, cap);
  addEventListener('keyup', onKeyUp, cap);
  addEventListener('pointerdown', onPointerDown, cap);
  addEventListener('pointermove', onPointerMove, cap);
  addEventListener('pointerup', onPointerUp, cap);
  addEventListener('pointercancel', () => {
    pointerDown = false;
    if (region) {
      region = null;
      setRegionDraft(null);
    }
  }, cap);
  for (const t of ['mousedown', 'mouseup', 'touchstart', 'touchend', 'auxclick']) addEventListener(t, onPressGuard, { capture: true, passive: false });
  addEventListener('click', onClick, cap);
  addEventListener('dblclick', onDblClick, cap);
  addEventListener('selectstart', (e) => { if (picking() && !isOurs(e)) e.preventDefault(); }, cap);
  addEventListener('dragstart', (e) => { if (picking() && !isOurs(e)) block(e); }, cap);
  document.addEventListener('selectionchange', onSelectionChange);
  addEventListener('scroll', scheduleRender, { capture: true, passive: true });
  addEventListener('resize', scheduleRender);
  for (const t of ['transitionend', 'animationend', 'load', 'keyup', 'wheel']) {
    addEventListener(t, scheduleRender, { capture: true, passive: true });
  }
  // Any key, click or hash change may switch slides. The deck reacts during this same event, so a redraw
  // on the next frame already sees the new slide — marks of the old one never linger over it.
  for (const t of ['keydown', 'pointerup', 'click', 'hashchange', 'popstate']) {
    addEventListener(t, () => renderBurst(), { capture: true, passive: true });
  }
}
