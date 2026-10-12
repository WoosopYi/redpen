import { S, mutate } from './state.js';
import { ui } from './ui/root.js';
import { slideOpacity } from './slides.js';
import { slideMeta, whereLabel, elementsIn } from './anchor.js';
import { h, clamp, uid } from './util.js';
import { icon } from './icons.js';
import { toast } from './ui/feedback.js';
import { registerRenderer, scheduleRender } from './ui/overlay.js';
import { withoutPreviews } from './layout.js';

/*
 * "새 배치 스케치": draw labelled boxes over a slide — a wireframe of how it should be laid out
 * ("큰 사진 왼쪽, 설명 오른쪽"). Saved as one layout mark per slide and sent to the AI with each box's
 * position, its label and what currently sits there.
 */

let sk = null; // open editor: { slideEl, item, boxes, root, area, bar, memo, raf }
const views = new Map(); // item id → rendered wireframe of a saved sketch

const pct = (v) => `${(v * 100).toFixed(2)}%`;
export const sketchOpen = () => !!sk;
const sketchItemFor = (slideEl) => S.items.find((it) => it.type === 'layout' && it.target === 'sketch' && it._slide === slideEl);

export function openSketch(slideEl, item = sketchItemFor(slideEl)) {
  if (!slideEl) return;
  if (sk) closeSketch();
  const meta = slideMeta(slideEl);
  sk = { slideEl, item: item || null, boxes: (item?.sketch?.boxes || []).map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h, label: b.label || '' })) };
  sk.area = h('div', { class: 'sk-area' });
  sk.root = h('div', { class: 'sketch' }, h('div', { class: 'sk-veil' }), sk.area);
  sk.memo = h('input', { class: 'sk-memo', placeholder: '전체 설명 (선택) — 예: 사진을 크게, 설명은 3줄 이내', value: item?.comment || '' });
  sk.memo.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) save();
  });
  const veilBtn = h('button', { class: 'btn ghost', onClick: () => { sk.root.classList.toggle('see'); veilBtn.textContent = sk.root.classList.contains('see') ? '흐리게' : '내용 보기'; } }, '내용 보기');
  sk.bar = h('div', { class: 'skbar' },
    icon('sketch', 16),
    h('b', null, meta.single ? '새 배치 스케치' : `슬라이드 ${meta.index + 1} 새 배치 스케치`),
    h('span', { class: 'hint' }, '빈 곳을 드래그해 칸을 그리고, 칸마다 들어갈 내용을 적으세요'),
    sk.memo, veilBtn,
    h('button', { class: 'btn ghost', onClick: () => closeSketch() }, '취소'),
    h('button', { class: 'btn primary', onClick: save }, '완료'));
  sk.area.addEventListener('pointerdown', drawBox);
  ui.app.append(sk.root, sk.bar);
  renderBoxes();
  const follow = () => {
    if (!sk) return;
    placeOverlay();
    sk.raf = requestAnimationFrame(follow);
  };
  follow();
  scheduleRender();
}

export function closeSketch() {
  if (!sk) return;
  cancelAnimationFrame(sk.raf);
  sk.root.remove();
  sk.bar.remove();
  sk = null;
  scheduleRender();
}

function placeOverlay() {
  const r = sk.slideEl.getBoundingClientRect();
  Object.assign(sk.root.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  const bh = sk.bar.offsetHeight;
  sk.bar.style.top = `${r.top - bh - 10 >= 8 ? r.top - bh - 10 : 8}px`;
}

function renderBoxes(focusIndex = -1) {
  sk.area.replaceChildren(...sk.boxes.map((b, i) => boxEl(b, i)));
  if (focusIndex >= 0) sk.area.children[focusIndex]?.querySelector('input')?.focus();
}

function toFrac(e) {
  const r = sk.area.getBoundingClientRect();
  return { x: clamp((e.clientX - r.left) / r.width, 0, 1), y: clamp((e.clientY - r.top) / r.height, 0, 1) };
}

function setBox(el, b) {
  Object.assign(el.style, { left: pct(b.x), top: pct(b.y), width: pct(b.w), height: pct(b.h) });
}

/** Drag on empty space: draw a new box. */
function drawBox(e) {
  if (e.target !== sk.area || e.button !== 0) return;
  e.preventDefault();
  const p0 = toFrac(e);
  const b = { x: p0.x, y: p0.y, w: 0, h: 0, label: '' };
  const el = h('div', { class: 'skbox drawing' });
  setBox(el, b);
  sk.area.append(el);
  sk.area.setPointerCapture(e.pointerId);
  const onMove = (ev) => {
    const p = toFrac(ev);
    Object.assign(b, { x: Math.min(p0.x, p.x), y: Math.min(p0.y, p.y), w: Math.abs(p.x - p0.x), h: Math.abs(p.y - p0.y) });
    setBox(el, b);
  };
  const onUp = () => {
    sk.area.removeEventListener('pointermove', onMove);
    sk.area.removeEventListener('pointerup', onUp);
    el.remove();
    if (b.w < 0.03 || b.h < 0.03) return;
    sk.boxes.push(b);
    renderBoxes(sk.boxes.length - 1);
  };
  sk.area.addEventListener('pointermove', onMove);
  sk.area.addEventListener('pointerup', onUp);
}

function boxEl(b, i) {
  const input = h('input', { class: 'sk-label', placeholder: '이 칸에 들어갈 내용', value: b.label });
  input.addEventListener('input', () => { b.label = input.value; });
  input.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' || e.key === 'Escape') input.blur();
  });
  const handle = h('span', { class: 'sk-h', title: '크기 조절' });
  const el = h('div', { class: 'skbox' },
    h('span', { class: 'sk-n' }, String(i + 1)),
    input,
    h('button', { class: 'sk-x', title: '칸 지우기', onClick: () => { sk.boxes.splice(i, 1); renderBoxes(); } }, icon('x', 12)),
    handle);
  setBox(el, b);
  // drag the box body to move it, the corner to resize it
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('input, button')) return;
    e.preventDefault();
    e.stopPropagation();
    const resizing = e.target === handle;
    const p0 = toFrac(e);
    const start = { ...b };
    el.setPointerCapture(e.pointerId);
    const onMove = (ev) => {
      const p = toFrac(ev);
      if (resizing) {
        b.w = clamp(start.w + p.x - p0.x, 0.03, 1 - start.x);
        b.h = clamp(start.h + p.y - p0.y, 0.03, 1 - start.y);
      } else {
        b.x = clamp(start.x + p.x - p0.x, 0, 1 - start.w);
        b.y = clamp(start.y + p.y - p0.y, 0, 1 - start.h);
      }
      setBox(el, b);
    };
    const onUp = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
  });
  return el;
}

function save() {
  const { slideEl } = sk;
  // reading order: top to bottom, then left to right (rows within ~6% of height);
  // "what sits there now" is read from the deck as it really is, without layout previews
  const boxes = withoutPreviews(() => {
    const s = slideEl.getBoundingClientRect();
    return sk.boxes
      .filter((b) => b.w >= 0.03 && b.h >= 0.03)
      .sort((a, b) => (Math.abs(a.y - b.y) < 0.06 ? a.x - b.x : a.y - b.y))
      .map((b) => {
        const rect = new DOMRect(s.left + b.x * s.width, s.top + b.y * s.height, b.w * s.width, b.h * s.height);
        const box = { x: b.x, y: b.y, w: b.w, h: b.h };
        return { ...box, label: b.label.trim(), where: whereLabel(box), inside: elementsIn(slideEl, rect, 3) };
      });
  });
  const memo = sk.memo.value.trim();
  const existing = sk.item && S.items.includes(sk.item) ? sk.item : null;
  closeSketch();
  if (!boxes.length) {
    if (existing) mutate(() => { S.items = S.items.filter((x) => x !== existing); });
    return;
  }
  mutate(() => {
    const data = { type: 'layout', target: 'sketch', slide: slideMeta(slideEl), sketch: { boxes }, pos: { x: 0, y: 0 } };
    if (existing) {
      Object.assign(existing, data);
      if (memo) existing.comment = memo;
      else delete existing.comment;
    } else {
      S.items.push(Object.assign({ id: uid(), createdAt: Date.now(), ...data, ...(memo ? { comment: memo } : {}) }, { _slide: slideEl }));
    }
  });
  toast(`새 배치 스케치를 저장했어요 (칸 ${boxes.length}개)`, { ms: 2200 });
}

/** Keys while the sketch editor is open. Keeps the deck from changing slides underneath. */
export function sketchKey(e) {
  if (!sk) return false;
  if (e.key === 'Escape') {
    closeSketch();
    return true;
  }
  return ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key);
}

/** Saved sketches show as faint wireframes on their slide. */
function renderViews() {
  const seen = new Set();
  if (!S.paused && !sk) {
    for (const it of S.items) {
      if (it.type !== 'layout' || it.target !== 'sketch' || !it.sketch) continue;
      const slideEl = it._slide;
      const op = slideEl === document.body ? 1 : slideOpacity(slideEl);
      if (!slideEl || op <= 0) continue;
      seen.add(it.id);
      let v = views.get(it.id);
      const key = JSON.stringify(it.sketch.boxes);
      if (!v || v.key !== key) {
        v?.el.remove();
        const el = h('div', { class: 'skview' }, it.sketch.boxes.map((b, i) => {
          const box = h('div', { class: 'skvbox' }, h('span', null, `${i + 1}${b.label ? ` · ${b.label}` : ''}`));
          setBox(box, b);
          return box;
        }));
        ui.layer.insertBefore(el, ui.layer.firstChild);
        v = { el, key };
        views.set(it.id, v);
      }
      const r = slideEl.getBoundingClientRect();
      Object.assign(v.el.style, {
        display: '',
        opacity: op < 0.995 ? String(Math.round(op * 100) / 100) : '',
        transform: `translate(${r.left}px, ${r.top}px)`,
        width: `${r.width}px`,
        height: `${r.height}px`,
      });
    }
  }
  for (const [id, v] of views) {
    if (seen.has(id)) continue;
    v.el.style.display = 'none';
    if (!S.items.some((it) => it.id === id)) {
      v.el.remove();
      views.delete(id);
    }
  }
}

export function initSketch() {
  registerRenderer(renderViews);
}

