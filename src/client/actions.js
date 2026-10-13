import config from './config.js';
import * as api from './api.js';
import {
  S, emit, mutate, saveSoon, settleSaves, pauseSaving, discardPendingSave, nextSeq, clearHistory, ordered, numbering, plain, clientId,
  undo as undoItems, redo as redoItems, TYPE_LABEL, TYPE_ICON,
} from './state.js';
import { describeText, describeElement, describeRegion, anchorText, anchorElement, slideMeta } from './anchor.js';
import { getSlides, slideOf, slideVisible, slideTitle, currentSlideIndex, goToSlide as navigate } from './slides.js';
import { openPopover, closePopover, popoverOpen, popoverDirty, shakePopover } from './ui/popover.js';
import { toast, modal, confirmDialog } from './ui/feedback.js';
import { setPicked, setRegionDraft, scheduleRender, refreshHighlights, hideSelBar } from './ui/overlay.js';
import { ui, setModeStyle } from './ui/root.js';
import { h, uid, trunc, sleep, clamp, MOD, rich } from './util.js';
import { tr } from './i18n/index.js';
import { itemSummary } from './summary.js';
import { icon } from './icons.js';

// ---- modes ----------------------------------------------------------------------

export function setMode(mode) {
  if (editorBusy()) return;
  hooks.deselect();
  S.paused = false;
  S.mode = mode;
  closePopover();
  hideSelBar();
  setPicked(null);
  if (mode !== 'text') getSelection()?.removeAllRanges();
  setModeStyle(S.mode, S.paused);
  refreshHighlights();
  emit('mode');
}

export function togglePause() {
  if (editorBusy()) return;
  hooks.deselect();
  S.paused = !S.paused;
  closePopover();
  hideSelBar();
  setPicked(null);
  setModeStyle(S.mode, S.paused);
  refreshHighlights();
  emit('mode');
  toast(tr(S.paused ? '일시정지 — 표시를 숨기고 덱을 원래대로 조작해요' : '다시 표시하는 중'), { ms: 1800 });
}

export function togglePanel(force) {
  S.panelOpen = typeof force === 'boolean' ? force : !S.panelOpen;
  emit('panel');
}

export function onFocusChange() {
  refreshHighlights();
  emit('focus');
}

export const notify = (msg, kind = 'info') => toast(msg, { kind, ms: 2200 });

/** Wired up by main.js (layout.js and sketch.js import this module, so they register here instead). */
export const hooks = { openLayout: null, openSketch: null, sketchOpen: () => false, deselect: () => {} };

/** An open editor holds unsaved text: nudge the user instead of throwing it away. */
export function editorBusy() {
  if (hooks.sketchOpen()) {
    notify(tr('스케치를 먼저 완료하거나 취소해 주세요'), 'warn');
    return true;
  }
  if (!popoverDirty()) return false;
  shakePopover();
  notify(tr('작성 중인 내용을 먼저 저장(Enter)하거나 취소(Esc)해 주세요'), 'warn');
  return true;
}

// ---- anchoring ------------------------------------------------------------------

export function anchorItem(it, cache = new Map()) {
  if (it.target === 'text') {
    const live = it._range && !it._range.collapsed && it._range.toString() === it.text?.exact;
    if (!live) it._range = anchorText(it, cache);
    it._slide = it._range ? slideOf(it._range.commonAncestorContainer) : null;
  } else if (it.target === 'element') {
    if (!it._el?.isConnected) it._el = anchorElement(it);
    it._slide = it._el ? slideOf(it._el) : null;
  } else {
    const { els, single } = getSlides();
    it._slide = single ? document.body : els[it.slide?.index] || null;
  }
  it._orphan = !(it._range || it._el || it._slide);
  const { els } = getSlides();
  const idx = it._slide ? els.indexOf(it._slide) : -1;
  if (idx >= 0 && idx !== it.slide?.index) it.slide = slideMeta(it._slide);
}

export function anchorAll() {
  const cache = new Map();
  for (const it of S.items) anchorItem(it, cache);
}

/** Text mark under a point (for clicking an existing highlight). */
export function hitTest(x, y) {
  for (let i = S.items.length - 1; i >= 0; i--) {
    const it = S.items[i];
    if (it.target !== 'text' || !it._range || (it._slide && !slideVisible(it._slide))) continue;
    for (const r of it._range.getClientRects()) {
      if (x >= r.left - 2 && x <= r.right + 2 && y >= r.top - 2 && y <= r.bottom + 2) return it;
    }
  }
  return null;
}

// ---- creating marks -----------------------------------------------------------------

function addItem(data, runtime) {
  const it = Object.assign({ id: uid(), createdAt: Date.now(), ...data }, runtime);
  mutate(() => S.items.push(it));
  return it;
}

function placeholderFor(type) {
  return tr(type === 'replace' ? '바꿀 내용을 입력하세요'
    : 'AI에게 전할 지시를 입력하세요\n예: 이 문장을 더 쉽게 풀어서 써줘');
}

/**
 * Small editor popover. Enter saves, Shift+Enter adds a line, Esc cancels.
 * Korean IME: Enter that confirms a composition is ignored.
 */
function openEditor({ type, title, sub, quote, initial = '', placeholder, anchor, onSave, onClose, allowEmpty = false }) {
  let saved = false;
  const ta = h('textarea', { class: 'ta', rows: type === 'replace' ? 2 : 3, placeholder: placeholder || placeholderFor(type) });
  ta.value = initial;
  const save = () => {
    const value = ta.value.trim();
    if (!value && !allowEmpty) {
      shakePopover();
      return;
    }
    saved = true;
    closePopover();
    onSave(value);
  };
  ta.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      save();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closePopover();
    }
  });
  const body = h('div', { class: `t-${type}` },
    h('div', { class: 'pop-head' }, icon(TYPE_ICON[type], 15), title, sub && h('span', { class: 'sub' }, sub),
      h('button', { class: 'iconbtn', title: tr('닫기 (Esc)'), onClick: () => closePopover() }, icon('x', 14))),
    quote && h('div', { class: `quote${type === 'replace' ? ' strike' : ''}` }, trunc(quote, 500)),
    ta,
    h('div', { class: 'pop-foot' },
      h('span', { class: 'hint' }, tr('Enter 저장 · Shift+Enter 줄바꿈')),
      h('button', { class: 'btn ghost', onClick: () => closePopover() }, tr('취소')),
      h('button', { class: 'btn primary', onClick: save }, tr('저장'))));
  openPopover(body, anchor, {
    width: 340,
    dirty: () => !saved && ta.value.trim() !== initial.trim(),
    onClose: () => {
      S.pendingRange = null;
      refreshHighlights();
      onClose?.();
    },
  });
  requestAnimationFrame(() => {
    ta.focus();
    if (initial) ta.select();
  });
}

/** Mark selected text. Delete is instant; replace/comment ask for text first. */
export function markText(type, range) {
  if (type !== 'delete' && editorBusy()) return;
  const d = describeText(range);
  if (!d) {
    notify(tr('선택한 내용이 비어 있어요'), 'warn');
    return;
  }
  const runtime = { _range: d.range, _slide: d.slideEl };
  if (type === 'delete') {
    addItem({ type: 'delete', ...d.data }, runtime);
    toast(tr('삭제 표시했어요 · {key} 되돌리기', { key: `${MOD}+Z` }), { ms: 1800 });
    return;
  }
  S.pendingRange = d.range;
  refreshHighlights();
  const where = d.data.slide.single ? '' : tr('슬라이드 {n}', { n: d.data.slide.index + 1 });
  openEditor({
    type,
    title: tr(type === 'replace' ? '텍스트 수정' : '코멘트'),
    sub: where,
    quote: d.data.text.exact,
    initial: type === 'replace' ? d.data.text.exact : '',
    anchor: d.range.getBoundingClientRect(),
    allowEmpty: type === 'replace',
    onSave: (value) => {
      if (type === 'comment') {
        addItem({ type: 'comment', ...d.data, comment: value }, runtime);
      } else if (!value) {
        addItem({ type: 'delete', ...d.data }, runtime);
        notify(tr('빈칸으로 바꾸면 삭제로 표시해요'));
      } else if (value !== d.data.text.exact) {
        addItem({ type: 'replace', ...d.data, replacement: value }, runtime);
      }
    },
  });
}

/** Mark an element (or a whole slide) for deletion. A pending layout change on it no longer matters. */
export function deleteElement(el) {
  const d = describeElement(el);
  if (d.isSlide) {
    toggleSlideDelete(el);
    return;
  }
  mutate(() => {
    S.items = S.items.filter((it) => !(it.type === 'layout' && it._el === el));
    S.items.push(Object.assign({ id: uid(), createdAt: Date.now(), type: 'delete', ...d.data }, { _el: el, _slide: d.slideEl }));
  });
  toast(tr('요소 삭제 표시했어요 · {key} 되돌리기', { key: `${MOD}+Z` }), { ms: 1800 });
}

export function commentElement(el, onDone) {
  if (editorBusy()) return;
  const d = describeElement(el);
  if (d.isSlide) {
    slideComment(el, el.getBoundingClientRect(), onDone);
    return;
  }
  openEditor({
    type: 'comment',
    title: tr('요소 코멘트'),
    sub: `<${el.localName}>`,
    placeholder: tr('이 요소를 어떻게 바꿀지 적어 주세요\n예: 아이콘을 넣고 테두리는 없애줘'),
    anchor: el.getBoundingClientRect(),
    onSave: (value) => addItem({ type: 'comment', ...d.data, comment: value }, { _el: el, _slide: d.slideEl }),
    onClose: () => onDone?.(),
  });
}

export function openRegionComment(slideEl, rect) {
  if (editorBusy()) {
    setRegionDraft(null);
    return;
  }
  const data = describeRegion(slideEl, rect);
  setRegionDraft(rect);
  openEditor({
    type: 'comment',
    title: tr('영역 코멘트'),
    sub: `${data.slide.single ? '' : `${tr('슬라이드 {n}', { n: data.slide.index + 1 })} · `}${data.region.where}`,
    placeholder: tr('이 영역에 무엇을 할지 적어 주세요\n예: 여기에 처리 과정을 보여주는 다이어그램 추가'),
    anchor: rect,
    onSave: (value) => addItem({ type: 'comment', ...data, comment: value }, { _slide: slideEl }),
    onClose: () => setRegionDraft(null),
  });
}

const slideData = (slideEl) => ({ target: 'slide', slide: slideMeta(slideEl), pos: { x: 0, y: 0 } });

export function slideComment(slideEl, anchor, onDone) {
  if (editorBusy()) return;
  const meta = slideMeta(slideEl);
  openEditor({
    type: 'comment',
    title: tr(meta.single ? '페이지 코멘트' : '슬라이드 코멘트'),
    sub: meta.single ? '' : tr('슬라이드 {n}', { n: meta.index + 1 }),
    placeholder: tr('이 슬라이드 전체에 대한 지시를 적어 주세요\n예: 내용이 많으니 두 장으로 나눠줘'),
    anchor,
    onSave: (value) => addItem({ type: 'comment', ...slideData(slideEl), comment: value }, { _slide: slideEl }),
    onClose: () => onDone?.(),
  });
}

export function toggleSlideDelete(slideEl) {
  const meta = slideMeta(slideEl);
  if (meta.single) return;
  const marked = S.items.find((it) => it.target === 'slide' && it.type === 'delete' && it.slide?.index === meta.index);
  if (marked) {
    removeItem(marked.id);
    return;
  }
  addItem({ type: 'delete', ...slideData(slideEl) }, { _slide: slideEl });
  toast(tr('슬라이드 {n} 삭제 표시했어요 · {key} 되돌리기', { n: meta.index + 1, key: `${MOD}+Z` }), { ms: 1800 });
}

function saveSlideMove(slideEl, meta, to, existing) {
  if (!Number.isFinite(to)) return;
  to = clamp(Math.round(to), 0, meta.total - 1);
  if (to === meta.index) {
    if (existing) removeItem(existing.id);
    return;
  }
  const others = getSlides().els.filter((e) => e !== slideEl);
  const move = {
    from: meta.index,
    to,
    total: meta.total,
    before: others[to] ? slideTitle(others[to]) : null, // the slide that will follow it
    after: others[to - 1] ? slideTitle(others[to - 1]) : null,
  };
  mutate(() => {
    const data = { type: 'layout', target: 'slide', slide: meta, move, pos: { x: 0, y: 0 } };
    if (existing && S.items.includes(existing)) Object.assign(existing, data);
    else S.items.push(Object.assign({ id: uid(), createdAt: Date.now(), ...data }, { _slide: slideEl }));
  });
  toast(tr('슬라이드 {n}을(를) {to}번째로 옮기도록 표시했어요', { n: meta.index + 1, to: to + 1 }), { ms: 2000 });
}

export function openSlideMove(slideEl, anchor) {
  if (editorBusy()) return;
  const meta = slideMeta(slideEl);
  if (meta.single) return;
  const n = meta.total;
  const existing = S.items.find((it) => it.type === 'layout' && it.target === 'slide' && it.slide?.index === meta.index);
  const input = h('input', { class: 'ta small num', type: 'number', min: '1', max: String(n), value: String((existing?.move?.to ?? meta.index) + 1) });
  const go = (to) => {
    closePopover();
    saveSlideMove(slideEl, meta, to, existing);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) go(Number(input.value) - 1);
  });
  const quick = (label, to, off) => h('button', { class: 'btn', disabled: off, onClick: () => go(to) }, label);
  const body = h('div', { class: 't-layout' },
    h('div', { class: 'pop-head' }, icon('updown', 15), tr('슬라이드 {n} 옮기기', { n: meta.index + 1 }), meta.title && h('span', { class: 'sub' }, trunc(meta.title, 22)),
      h('button', { class: 'iconbtn', title: tr('닫기 (Esc)'), onClick: () => closePopover() }, icon('x', 14))),
    h('div', { class: 'move-quick' },
      quick(tr('맨 앞으로'), 0, meta.index === 0),
      quick(tr('한 칸 앞으로'), meta.index - 1, meta.index === 0),
      quick(tr('한 칸 뒤로'), meta.index + 1, meta.index === n - 1),
      quick(tr('맨 뒤로'), n - 1, meta.index === n - 1)),
    h('div', { class: 'label' }, tr('몇 번째로 옮길까요? (1–{n})', { n })),
    h('div', { class: 'move-row' }, input, h('button', { class: 'btn primary', onClick: () => go(Number(input.value) - 1) }, tr('옮기기'))),
    existing && h('button', { class: 'btn ghost danger', style: { marginTop: '8px' }, onClick: () => { closePopover(); removeItem(existing.id); } }, tr('옮기기 취소')));
  openPopover(body, anchor, { width: 310 });
  requestAnimationFrame(() => input.select());
}

export function openSlideMenu(anchorEl) {
  if (editorBusy()) return;
  const { els, single } = getSlides();
  const i = single ? 0 : currentSlideIndex();
  const slideEl = single ? document.body : els[i];
  if (!slideEl) {
    notify(tr('지금 보이는 슬라이드를 찾지 못했어요'), 'warn');
    return;
  }
  const meta = slideMeta(slideEl);
  const marked = S.items.find((it) => it.target === 'slide' && it.type === 'delete' && it.slide?.index === meta.index);
  const anchor = anchorEl.getBoundingClientRect();
  const entry = (cls, ico, label, run) => h('button', { class: cls, onClick: run }, icon(ico, 15), label);
  const body = h('div', null,
    h('div', { class: 'pop-head' }, icon('slide', 15), single ? tr('이 페이지') : tr('슬라이드 {n}', { n: i + 1 }),
      meta.title && h('span', { class: 'sub' }, trunc(meta.title, 26))),
    h('div', { class: 'menu' },
      entry('t-comment', 'comment', tr(single ? '페이지 전체에 코멘트' : '이 슬라이드에 코멘트'), () => slideComment(slideEl, anchor)),
      entry('t-layout', 'sketch', tr('새 배치 스케치 그리기'), () => {
        closePopover();
        hooks.openSketch?.(slideEl);
      }),
      !single && entry('t-layout', 'updown', tr('이 슬라이드 순서 옮기기'), () => openSlideMove(slideEl, anchor)),
      !single && entry('t-delete', 'trash', tr(marked ? '삭제 표시 취소' : '이 슬라이드 삭제 표시'), () => {
        closePopover();
        toggleSlideDelete(slideEl);
      })));
  openPopover(body, anchor, { width: 270 });
}

// ---- editing existing marks -----------------------------------------------------------

function anchorRectOf(it) {
  if (it._range) return it._range.getBoundingClientRect();
  if (it._el) return it._el.getBoundingClientRect();
  if (it._slide) {
    const s = it._slide.getBoundingClientRect();
    if (it.target === 'region') return new DOMRect(s.left + it.region.x * s.width, s.top + it.region.y * s.height, it.region.w * s.width, it.region.h * s.height);
    return new DOMRect(s.left + 20, s.top + 20, 0, 0);
  }
  return null;
}

/** Popover for an existing mark: switch type, edit text, or remove it. */
export function openItem(id, anchor) {
  if (editorBusy()) return;
  const it = S.items.find((x) => x.id === id);
  if (!it) return;
  if (it.type === 'layout' && it.target === 'element' && hooks.openLayout?.(it)) return;
  if (it.type === 'layout' && it.target === 'sketch' && it._slide && hooks.openSketch) {
    hooks.openSketch(it._slide, it);
    return;
  }
  const allowed = it.type === 'layout' ? ['layout']
    : it.target === 'text' ? ['delete', 'replace', 'comment'] : it.target === 'region' ? ['comment'] : ['delete', 'comment'];
  const draft = { replacement: it.replacement ?? it.text?.exact ?? '', comment: it.comment || '' };
  let type = it.type;
  const label = h('div', { class: 'label' });
  const ta = h('textarea', { class: 'ta' });
  const wrap = h('div');
  const typeButtons = allowed.map((t) => h('button', { onClick: () => setType(t) }, icon(TYPE_ICON[t], 14), tr(TYPE_LABEL[t])));
  let shown = false;
  const stash = () => {
    if (!shown) return;
    if (type === 'replace') draft.replacement = ta.value;
    else draft.comment = ta.value;
  };
  function setType(t) {
    stash();
    shown = true;
    type = t;
    wrap.className = `t-${t}`;
    typeButtons.forEach((b, i) => {
      b.className = `t-${allowed[i]}${allowed[i] === t ? ' on' : ''}`;
    });
    if (t === 'replace') {
      label.textContent = tr('바꿀 내용');
      ta.value = draft.replacement;
      ta.placeholder = placeholderFor('replace');
    } else if (t === 'comment') {
      label.textContent = tr('지시사항');
      ta.value = draft.comment;
      ta.placeholder = placeholderFor('comment');
    } else {
      label.textContent = tr('메모 (선택)');
      ta.value = draft.comment;
      ta.placeholder = tr('삭제 이유나 덧붙일 말 (선택)');
    }
    quoteEl.classList.toggle('strike', t !== 'comment');
  }
  const save = () => {
    stash();
    const patch = { type };
    if (type === 'replace') {
      const v = draft.replacement.trim();
      if (!v || v === it.text?.exact) {
        shakePopover();
        return;
      }
      patch.replacement = v;
    }
    if (type === 'comment' && !draft.comment.trim()) {
      shakePopover();
      return;
    }
    patch.comment = draft.comment.trim();
    mutate(() => {
      Object.assign(it, patch);
      if (type !== 'replace') delete it.replacement;
      if (!it.comment) delete it.comment;
    });
    closePopover();
  };
  ta.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      save();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closePopover();
    }
  });
  const quoteText = it.type === 'layout' ? itemSummary(it)
    : it.target === 'text' ? it.text.exact
    : it.target === 'element' ? it.element?.startTag
      : it.target === 'region' ? `${tr('영역')} · ${it.region?.where || ''}`
        : `${tr('슬라이드 {n}', { n: (it.slide?.index ?? 0) + 1 })}${it.slide?.title ? ` · ${it.slide.title}` : ''}`;
  const quoteEl = h('div', { class: 'quote' }, trunc(quoteText || '', 400));
  const where = it.slide && !it.slide.single ? tr('슬라이드 {n}', { n: it.slide.index + 1 }) : '';
  wrap.append(...[
    h('div', { class: 'pop-head' }, icon(TYPE_ICON[type], 15), `#${numbering().get(it.id)}`, h('span', { class: 'sub' }, where),
      h('button', { class: 'iconbtn', title: tr('닫기 (Esc)'), onClick: () => closePopover() }, icon('x', 14))),
    allowed.length > 1 && h('div', { class: 'types' }, typeButtons),
    quoteEl, label, ta,
    it._orphan && h('div', { class: 'label', style: { color: '#ce2c31' } }, tr('⚠️ 현재 화면에서 위치를 찾지 못했어요 (원문으로 전달돼요)')),
    h('div', { class: 'pop-foot' },
      h('button', { class: 'btn ghost danger', onClick: () => { closePopover(); removeItem(it.id); } }, icon('trash', 13), tr('표시 지우기')),
      h('span', { style: { flex: '1' } }),
      h('button', { class: 'btn ghost', onClick: () => closePopover() }, tr('취소')),
      h('button', { class: 'btn primary', onClick: save }, tr('저장'))),
  ].filter(Boolean));
  setType(type);
  S.focusId = it.id;
  onFocusChange();
  openPopover(wrap, anchor || anchorRectOf(it), {
    width: 340,
    dirty: () => {
      stash();
      return type !== it.type || draft.comment.trim() !== (it.comment || '') || (type === 'replace' && draft.replacement.trim() !== (it.replacement || ''));
    },
    onClose: () => {
      if (S.focusId === it.id) S.focusId = null;
      onFocusChange();
    },
  });
  requestAnimationFrame(() => {
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  });
}

export function removeItem(id) {
  if (!S.items.some((it) => it.id === id)) return;
  mutate(() => {
    S.items = S.items.filter((it) => it.id !== id);
  });
  if (S.focusId === id) S.focusId = null;
  toast(tr('표시를 지웠어요 · {key} 되돌리기', { key: `${MOD}+Z` }), { ms: 1600 });
}

export async function clearAll() {
  if (editorBusy()) return;
  if (!S.items.length && !S.deckComment.trim()) return;
  const vars = { n: S.items.length, key: `${MOD}+Z` };
  const message = S.deckComment.trim()
    ? tr('작성 중인 표시 {n}개와 전체 지시사항을 지웁니다. ({key}로 표시는 되돌릴 수 있어요)', vars)
    : tr('작성 중인 표시 {n}개를 지웁니다. ({key}로 표시는 되돌릴 수 있어요)', vars);
  const ok = await confirmDialog(tr('모두 지울까요?'), message, tr('모두 지우기'));
  if (!ok) return;
  S.deckComment = '';
  mutate(() => {
    S.items = [];
  });
}

export function undo() {
  if (!undoItems()) return false;
  toast(tr('되돌렸어요'), { ms: 1200 });
  return true;
}

export function redo() {
  if (!redoItems()) return false;
  toast(tr('다시 실행했어요'), { ms: 1200 });
  return true;
}

export async function goToSlide(index) {
  const ok = await navigate(index);
  if (!ok) notify(tr('슬라이드 {n}(으)로 직접 이동해 주세요', { n: index + 1 }), 'warn');
  scheduleRender();
  return ok;
}

/** Jump to a mark from the list: bring its slide on screen, then open it. */
export async function focusItem(id) {
  if (editorBusy()) return;
  const it = S.items.find((x) => x.id === id);
  if (!it) return;
  S.focusId = id;
  onFocusChange();
  if (it._slide && it._slide !== document.body && !slideVisible(it._slide)) {
    const ok = await goToSlide(getSlides().els.indexOf(it._slide));
    if (!ok) return;
    await sleep(120);
  }
  const target = it._range || it._el;
  const r = target?.getBoundingClientRect();
  if (r && (r.top < 0 || r.bottom > innerHeight)) {
    (it._el || it._range.startContainer.parentElement)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    await sleep(350);
  }
  scheduleRender();
  openItem(id);
}

// ---- sending ----------------------------------------------------------------------

/** Copy text (or a promise of text) to the clipboard, keeping the user-gesture where browsers need it. */
export async function copyText(source) {
  try {
    if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
      const blob = Promise.resolve(source).then((t) => new Blob([t], { type: 'text/plain' }));
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
      return true;
    }
  } catch {
    /* fall through */
  }
  let text;
  try {
    text = await source;
  } catch {
    return false;
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* fall through */
  }
  try {
    const ta = h('textarea', { style: { position: 'fixed', top: '0', left: '0', opacity: '0' } });
    ta.value = text;
    ui.app.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (ok) return true;
  } catch {
    /* fall through */
  }
  modal({ title: tr('아래 내용을 복사해 주세요'), body: h('pre', null, text), width: 720 });
  return false;
}

let sending = false;

export async function send(channel = 'agent') {
  if (sending || editorBusy()) return;
  if (popoverOpen()) closePopover();
  if (!S.items.length && !S.deckComment.trim()) {
    notify(tr('보낼 표시가 없어요. 먼저 고칠 곳을 표시해 주세요.'), 'warn');
    return;
  }
  sending = true;
  pauseSaving(true);
  anchorAll();
  const nums = numbering();
  const { selector, els, single } = getSlides();
  const items = ordered().map((it) => {
    const o = plain(it);
    o.n = nums.get(it.id);
    if (it._orphan) o.orphan = true;
    if (it._slide && it._slide !== document.body) o.slide = slideMeta(it._slide);
    return o;
  });
  const sentIds = new Set(items.map((it) => it.id));
  const sentComment = S.deckComment;
  const payload = {
    items,
    deckComment: sentComment,
    channel,
    clientId,
    meta: { slideSelector: single ? null : selector, slideCount: single ? 1 : els.length, title: document.title },
  };
  // Started synchronously so the clipboard write below still counts as part of the click.
  const submitted = (async () => {
    await settleSaves(); // an autosave already on the wire lands first…
    payload.seq = nextSeq(); // …and any older one that straggles in later is ignored by the server
    return api.submit(payload);
  })();
  try {
    const copied = channel === 'clipboard' ? await copyText(submitted.then((r) => r.markdown)) : false;
    const result = await submitted;
    // Only what was sent leaves the draft; marks made while sending stay.
    S.items = S.items.filter((it) => !sentIds.has(it.id));
    if (S.deckComment === sentComment) S.deckComment = '';
    discardPendingSave();
    if (S.items.length || S.deckComment.trim()) saveSoon();
    S.focusId = null;
    clearHistory();
    emit('all');
    if (channel === 'clipboard') {
      toast(copied ? `📋 ${tr('{n}차 수정 요청을 복사했어요 — AI 채팅에 붙여넣으세요', { n: result.round })}` : tr('복사하지 못했어요. 보낸 기록에서 다시 복사해 주세요'), { kind: copied ? 'info' : 'error', ms: 4000 });
    } else {
      afterSend(result);
    }
  } catch (err) {
    saveSoon();
    toast(tr('보내지 못했어요: {error}', { error: err.message }), { kind: 'error', ms: 5000 });
  } finally {
    sending = false;
    pauseSaving(false);
  }
}

function afterSend(result) {
  const status = result.agent?.status;
  if (status === 'waiting') {
    toast(`🚀 ${tr('{n}차 수정 요청을 보냈어요 — AI가 바로 반영을 시작해요', { n: result.round })}`, { ms: 4000 });
  } else if (status === 'working') {
    toast(`📨 ${tr('{n}차 수정 요청을 보냈어요 — AI가 하던 작업을 마치면 이어서 받아요', { n: result.round })}`, { ms: 5000 });
  } else {
    modal({
      title: tr('{n}차 수정 요청을 저장했어요', { n: result.round }),
      ico: 'check',
      body: h('div', null,
        h('p', null, tr('지금은 기다리는 AI 세션이 없어요. HTML을 만들던 AI 세션으로 돌아가 이렇게 말하면 이어서 반영해요.')),
        h('ul', null,
          h('li', null, rich(tr('**Claude Code** — `/redpen` 또는 "리뷰 반영해줘"'))),
          h('li', null, rich(tr('**Codex** — `$redpen` 또는 "리뷰 반영해줘"'))),
          h('li', null, rich(tr('스킬 없이 — {cmd} 결과를 반영해 달라고 하기', { cmd: `\`redpen pending ${JSON.stringify(config.deckPath)}\`` })))),
        h('p', null, tr('아무 AI 채팅에나 붙여넣으려면 프롬프트를 복사하세요.'))),
      actions: [
        { label: tr('프롬프트 복사'), icon: 'copy', run: async () => { await copyRound(result.round); return true; } },
        { label: tr('확인'), primary: true },
      ],
      width: 500,
    });
  }
}

export async function copyRound(n) {
  const ok = await copyText(api.roundMarkdown(n, 'clipboard'));
  toast(ok ? `📋 ${tr('{n}차 프롬프트를 복사했어요', { n })}` : tr('복사하지 못했어요'), { kind: ok ? 'info' : 'error' });
}

export async function viewRound(n) {
  try {
    const md = await api.roundMarkdown(n, 'file');
    modal({
      title: tr('{n}차 수정 요청 — AI가 받는 내용', { n }),
      body: h('pre', null, md),
      width: 760,
      actions: [
        { label: tr('복사'), icon: 'copy', run: async () => { if (await copyText(md)) toast(tr('복사했어요')); return true; } },
        { label: tr('닫기'), primary: true },
      ],
    });
  } catch (err) {
    toast(tr('불러오지 못했어요: {error}', { error: err.message }), { kind: 'error' });
  }
}

// ---- server events ------------------------------------------------------------------

const REPLIES_KEY = `redpen:replies:${config.deckPath}`;
let seenReplies = null;

function loadSeen() {
  if (seenReplies) return seenReplies;
  try {
    seenReplies = new Set(JSON.parse(localStorage.getItem(REPLIES_KEY) || '[]'));
  } catch {
    seenReplies = new Set();
  }
  return seenReplies;
}

function saveSeen() {
  localStorage.setItem(REPLIES_KEY, JSON.stringify([...seenReplies].slice(-300)));
}

/** On first load, old replies are history — only replies from the last minute still pop up. */
export function markRepliesSeen(rounds) {
  const seen = loadSeen();
  for (const r of rounds) for (const rep of r.replies || []) if (Date.now() - rep.at > 60000) seen.add(`${r.round}:${rep.at}`);
  saveSeen();
}

export function onState(state) {
  S.rounds = state.rounds || [];
  S.agent = state.agent || { status: 'offline' };
  const seen = loadSeen();
  let changed = false;
  for (const r of S.rounds) {
    (r.replies || []).forEach((rep, i) => {
      const key = `${r.round}:${rep.at}`;
      if (seen.has(key)) return;
      seen.add(key);
      changed = true;
      toast(`AI · ${tr(i === 0 ? '{n}차 반영 완료' : '{n}차 메시지', { n: r.round })}\n${rep.message}`, {
        kind: 'ai',
        ico: 'bot',
        ms: 12000,
        action: { label: tr('기록'), run: () => { S.panelOpen = true; S.panelTab = 'sent'; emit('all'); } },
      });
    });
  }
  if (changed) saveSeen();
  emit('rounds');
}

export function onRemoteDraft(draft) {
  const old = new Map(S.items.map((it) => [it.id, it]));
  S.items = (draft.items || []).map((d) => {
    const prev = old.get(d.id);
    if (!prev) return d;
    for (const k of Object.keys(prev)) if (k[0] !== '_') delete prev[k];
    return Object.assign(prev, d);
  });
  S.deckComment = draft.deckComment || '';
  anchorAll();
  emit('all');
}
