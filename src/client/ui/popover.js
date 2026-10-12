import { ui } from './root.js';
import { h, clamp } from '../util.js';

let current = null;

/**
 * Open a floating card next to `anchor` (DOMRect-like or element). One popover at a time.
 * `dirty()` tells whether closing would lose typed input; `onClose` always runs when it goes away.
 */
export function openPopover(content, anchor, { width = 320, className = '', dirty = () => false, onClose } = {}) {
  if (current?.dirty?.()) {
    shakePopover(); // never replace an editor that still holds unsaved text
    return null;
  }
  closePopover();
  const el = h('div', { class: `pop ${className}` }, content);
  el.style.width = `${width}px`;
  el.style.visibility = 'hidden';
  ui.app.append(el);
  current = { el, anchor, dirty, onClose };
  place(el, anchor);
  el.style.visibility = '';
  return el;
}

export function closePopover() {
  if (!current) return;
  const c = current;
  current = null;
  c.el.remove();
  c.onClose?.();
}

export const popoverOpen = () => !!current;
export const popoverDirty = () => !!current?.dirty?.();
export const popoverEl = () => current?.el || null;

export function shakePopover() {
  if (!current) return;
  const { el } = current;
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
  el.querySelector('textarea')?.focus();
}

export function repositionPopover() {
  if (current) place(current.el, current.anchor);
}

function rectOf(anchor) {
  if (!anchor) return { left: innerWidth / 2, right: innerWidth / 2, top: innerHeight / 3, bottom: innerHeight / 3, width: 0, height: 0 };
  return typeof anchor.getBoundingClientRect === 'function' ? anchor.getBoundingClientRect() : anchor;
}

function place(el, anchor) {
  const m = 10;
  const r = rectOf(anchor);
  const w = el.offsetWidth;
  const hh = el.offsetHeight;
  const cx = clamp(r.left + r.width / 2 - w / 2, m, innerWidth - w - m);
  const cy = clamp(r.top + r.height / 2 - hh / 2, m, Math.max(m, innerHeight - hh - m));
  const options = [
    [cx, r.bottom + m, r.bottom + m + hh <= innerHeight - m],
    [cx, r.top - hh - m, r.top - hh - m >= m],
    [r.right + m, cy, r.right + m + w <= innerWidth - m],
    [r.left - w - m, cy, r.left - w - m >= m],
  ];
  const [x, y] = options.find((o) => o[2]) || [innerWidth / 2 - w / 2, innerHeight / 2 - hh / 2];
  el.style.left = `${clamp(x, m, innerWidth - w - m)}px`;
  el.style.top = `${clamp(y, m, Math.max(m, innerHeight - hh - m))}px`;
}
