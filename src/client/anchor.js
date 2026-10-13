import { getSlides, slideOf, slideTitle } from './slides.js';
import { norm, clamp } from './util.js';
import { where } from './summary.js';

/*
 * Anchoring: turn a live DOM selection into data that survives reloads (exact text + context +
 * offsets + DOM paths), and turn that data back into a live Range/element after the page reloads.
 */

const SKIP = new Set(['script', 'style', 'noscript', 'template', 'textarea', 'iframe', 'object']);
const STATE_CLASS = /^(is-|has-|js-)|^(active|current|present|past|future|visible|hidden|show|shown|open|on|off|selected|enter|leave|in|out|fade|animated)$/;

/** Concatenated text of all visible-text nodes under `root`, with node → offset bookkeeping. */
export function textIndex(root) {
  const nodes = [];
  const starts = new Map();
  let text = '';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (n.nodeType === 1) return SKIP.has(n.localName) || n.id === '__redpen-host' ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    starts.set(n, text.length);
    nodes.push(n);
    text += n.data;
  }
  return { root, text, nodes, starts };
}

/** Offset in `idx.text` of a DOM boundary point. */
export function pointToOffset(idx, node, offset) {
  if (node.nodeType === 3 && idx.starts.has(node)) return idx.starts.get(node) + Math.min(offset, node.data.length);
  const probe = document.createRange();
  try {
    probe.setStart(node, offset);
  } catch {
    return 0;
  }
  probe.collapse(true);
  let lo = 0;
  let hi = idx.nodes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    let cmp;
    try {
      cmp = probe.comparePoint(idx.nodes[mid], 0);
    } catch {
      cmp = 1;
    }
    if (cmp < 0) lo = mid + 1;
    else hi = mid;
  }
  return lo < idx.nodes.length ? idx.starts.get(idx.nodes[lo]) : idx.text.length;
}

/** Index of the text node holding character `pos`. */
function nodeAt(idx, pos) {
  let lo = 0;
  let hi = idx.nodes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (idx.starts.get(idx.nodes[mid]) <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function offsetsToRange(idx, start, end) {
  if (!idx.nodes.length || end <= start) return null;
  const a = idx.nodes[nodeAt(idx, start)];
  const b = idx.nodes[nodeAt(idx, end - 1)];
  const r = document.createRange();
  r.setStart(a, clamp(start - idx.starts.get(a), 0, a.data.length));
  r.setEnd(b, clamp(end - idx.starts.get(b), 0, b.data.length));
  return r;
}

function occurrences(text, needle, at) {
  let count = 0;
  let index = 0;
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) {
    if (i === at) index = count;
    count++;
  }
  return { index, count };
}

const elOf = (node) => (node && node.nodeType === 1 ? node : node?.parentElement) || null;

/** Element text with a space between separate text pieces ("잘하는 일" + "초안 작성" → "잘하는 일 초안 작성"). */
export function textOf(el, max = 160) {
  const parts = [];
  let len = 0;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeType === 1 ? (SKIP.has(n.localName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP) : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode(); n && len < max * 2; n = walker.nextNode()) {
    const t = n.data.trim();
    if (!t) continue;
    parts.push(t);
    len += t.length + 1;
  }
  return norm(parts.join(' ')).slice(0, max);
}

/** Human/AI-readable CSS path, e.g. `div#deck > section.slide:nth-of-type(5) > ul > li:nth-of-type(2)`. */
export function cssPath(el) {
  const parts = [];
  for (let e = el; e && e.nodeType === 1 && e !== document.documentElement; e = e.parentElement) {
    if (e === document.body) {
      parts.unshift('body');
      break;
    }
    let p = e.localName;
    if (e.id && /^[A-Za-z][\w-]*$/.test(e.id)) {
      parts.unshift(`${p}#${e.id}`);
      break;
    }
    const cls = [...e.classList].filter((c) => /^[A-Za-z_][\w-]*$/.test(c) && !STATE_CLASS.test(c)).slice(0, 2);
    if (cls.length) p += `.${cls.join('.')}`;
    const parent = e.parentElement;
    if (parent) {
      const same = [...parent.children].filter((c) => c.localName === e.localName);
      if (same.length > 1) p += `:nth-of-type(${same.indexOf(e) + 1})`;
    }
    parts.unshift(p);
  }
  return parts.join(' > ');
}

/** Child-index path from `scope` to `el`, used to find the element again. */
function structPath(el, scope) {
  const path = [];
  for (let e = el; e && e !== scope; e = e.parentElement) {
    const parent = e.parentElement;
    if (!parent) return null;
    path.unshift([Array.prototype.indexOf.call(parent.children, e), e.localName]);
  }
  return path;
}

function resolvePath(scope, path) {
  let e = scope;
  for (const [i, tag] of path || []) {
    e = e?.children[i];
    if (!e || e.localName !== tag) return null;
  }
  return e === scope ? null : e;
}

/** `<tag attr="…">` with long values shortened and state classes dropped. */
export function startTag(el) {
  const attrs = [...el.attributes].map((a) => {
    let v = a.value;
    if (a.name === 'class') v = v.split(/\s+/).filter((c) => c && !STATE_CLASS.test(c)).join(' ');
    if (a.name === 'style' && v.length > 60) v = `${v.slice(0, 57)}…`;
    if (v.length > 90) v = `${v.slice(0, 87)}…`;
    if (a.name === 'class' && !v) return null;
    return v === '' ? a.name : `${a.name}="${v.replace(/"/g, '&quot;')}"`;
  }).filter(Boolean);
  const s = `<${el.localName}${attrs.length ? ` ${attrs.join(' ')}` : ''}>`;
  return s.length > 260 ? `${s.slice(0, 258)}…>` : s;
}

export function slideMeta(slideEl) {
  const { els, single } = getSlides();
  if (!slideEl || single || slideEl === document.body) return { index: 0, total: 1, title: norm(document.title), single: true };
  return {
    index: els.indexOf(slideEl),
    total: els.length,
    title: slideTitle(slideEl),
    id: slideEl.id || '',
    startTag: startTag(slideEl),
  };
}

/** Position of a rect relative to its slide, as fractions (0–1). */
export function relBox(rect, slideEl) {
  const s = (slideEl || document.body).getBoundingClientRect();
  if (!s.width || !s.height) return { x: 0, y: 0, w: 0, h: 0 };
  const fx = (x) => clamp((x - s.left) / s.width, 0, 1);
  const fy = (y) => clamp((y - s.top) / s.height, 0, 1);
  const x = fx(rect.left);
  const y = fy(rect.top);
  return { x, y, w: fx(rect.right) - x, h: fy(rect.bottom) - y };
}

// ---- text ----------------------------------------------------------------------

/** Describe a selection. Whitespace at the edges is trimmed. Returns null for empty selections. */
export function describeText(range) {
  const slideEl = slideOf(range.commonAncestorContainer);
  const scope = slideEl || document.body;
  const idx = textIndex(scope);
  let s = pointToOffset(idx, range.startContainer, range.startOffset);
  let e = pointToOffset(idx, range.endContainer, range.endOffset);
  if (e < s) [s, e] = [e, s];
  while (s < e && /\s/.test(idx.text[s])) s++;
  while (e > s && /\s/.test(idx.text[e - 1])) e--;
  if (e <= s) return null;

  const exact = idx.text.slice(s, e);
  const trimmed = offsetsToRange(idx, s, e);
  const docIdx = scope === document.body ? idx : textIndex(document.body);
  const docStart = scope === document.body ? s : pointToOffset(docIdx, trimmed.startContainer, trimmed.startOffset);
  const occ = occurrences(docIdx.text, exact, docStart);
  const container = elOf(trimmed.commonAncestorContainer);
  const rect = trimmed.getBoundingClientRect();

  return {
    range: trimmed,
    slideEl,
    data: {
      target: 'text',
      slide: slideMeta(slideEl),
      text: {
        exact,
        prefix: idx.text.slice(Math.max(0, s - 64), s),
        suffix: idx.text.slice(e, e + 64),
        offset: s,
        occurrence: occ.index,
        domCount: occ.count,
        spans: elOf(trimmed.startContainer) !== elOf(trimmed.endContainer),
      },
      selector: container ? cssPath(container) : '',
      pos: relBox(rect, slideEl),
    },
  };
}

const commonSuffix = (a, b) => {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
};
const commonPrefix = (a, b) => {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
};

const squash = (str) => str.replace(/\s+/g, ' ');

function cachedIndex(scope, cache) {
  let idx = cache.get(scope);
  if (!idx) {
    idx = textIndex(scope);
    cache.set(scope, idx);
  }
  return idx;
}

/**
 * Find a text mark again after the page changed. On its own slide a unique occurrence is trusted;
 * anywhere else (slides added, removed or re-rendered) the surrounding text must clearly agree.
 * Otherwise the mark is reported as lost instead of silently landing on the same words elsewhere.
 */
export function anchorText(item, cache = new Map()) {
  const t = item.text;
  if (!t?.exact) return null;
  const pre = squash(t.prefix || '');
  const suf = squash(t.suffix || '');
  const { els } = getSlides();
  const hadSlide = !!item.slide && !item.slide.single && Number.isInteger(item.slide.index);
  const home = hadSlide && els[item.slide.index] && els[item.slide.index] !== document.body ? els[item.slide.index] : null;
  for (const scope of home ? [home, document.body] : [document.body]) {
    const idx = cachedIndex(scope, cache);
    const found = [];
    for (let i = idx.text.indexOf(t.exact); i !== -1; i = idx.text.indexOf(t.exact, i + 1)) {
      const score = commonSuffix(squash(idx.text.slice(Math.max(0, i - 96), i)), pre)
        + commonPrefix(squash(idx.text.slice(i + t.exact.length, i + t.exact.length + 96)), suf);
      found.push({ i, score: score - (scope === home ? Math.abs(i - t.offset) / 1e5 : 0) });
    }
    if (!found.length) continue;
    found.sort((a, b) => b.score - a.score);
    const [best, next] = found;
    const clear = !next || best.score - next.score >= 1;
    const strong = best.score >= Math.min(24, Math.ceil((pre.length + suf.length) * 0.4));
    const atHome = scope === home || !hadSlide;
    const ok = atHome ? found.length === 1 || (clear && (strong || best.score >= 6)) : clear && strong;
    return ok ? offsetsToRange(idx, best.i, best.i + t.exact.length) : null;
  }
  return null;
}

// ---- elements --------------------------------------------------------------------

export function describeElement(el) {
  const slideEl = slideOf(el);
  const isSlide = el === slideEl && slideEl !== document.body;
  const attrs = {};
  for (const k of ['id', 'src', 'data-src', 'data-lazy-src', 'href', 'alt', 'title', 'poster', 'aria-label', 'role', 'type']) {
    const v = el.getAttribute(k);
    if (v) attrs[k] = v.slice(0, 400);
  }
  const rect = el.getBoundingClientRect();
  return {
    slideEl,
    isSlide,
    data: {
      target: isSlide ? 'slide' : 'element',
      slide: slideMeta(slideEl),
      element: isSlide ? undefined : {
        tag: el.localName,
        classes: [...el.classList].filter((c) => !STATE_CLASS.test(c)).slice(0, 6),
        attrs,
        startTag: startTag(el),
        text: textOf(el),
        path: structPath(el, slideEl || document.body),
        selector: cssPath(el),
        box: relBox(rect, slideEl),
      },
      pos: relBox(rect, slideEl),
    },
  };
}

function elementScore(c, E) {
  let s = 0;
  const a = E.attrs || {};
  if (a.id && c.id === a.id) s += 5;
  for (const k of ['src', 'data-src', 'data-lazy-src', 'href', 'poster', 'alt']) {
    if (!a[k]) continue;
    const v = c.getAttribute(k) || (k === 'src' ? c.getAttribute('data-lazy-src') || c.getAttribute('data-src') : null);
    if (v === a[k]) s += 4;
  }
  const t = textOf(c);
  if (E.text && (t === E.text || norm(c.textContent).slice(0, 160) === E.text)) s += 3;
  else if (E.text && t && t.startsWith(E.text.slice(0, 24))) s += 1;
  s += Math.min(2, (E.classes || []).filter((x) => c.classList.contains(x)).length) * 0.5;
  return s;
}

export function anchorElement(item) {
  const E = item.element;
  if (!E) return null;
  const { els } = getSlides();
  const slideEl = Number.isInteger(item.slide?.index) && !item.slide.single ? els[item.slide.index] || null : null;
  const byPath = resolvePath(slideEl || document.body, E.path);
  if (byPath && elementScore(byPath, E) >= (E.text ? 3 : 0.5)) return byPath;
  // Best unique match by id / src / text; outside its own slide it needs id- or src-level evidence.
  const pick = (root, min) => {
    let best = null;
    let bestScore = 0;
    let second = 0;
    for (const c of root.getElementsByTagName(E.tag)) {
      const sc = elementScore(c, E);
      if (sc > bestScore) {
        second = bestScore;
        bestScore = sc;
        best = c;
      } else if (sc > second) second = sc;
    }
    return bestScore >= min && bestScore > second ? best : null;
  };
  return (slideEl && pick(slideEl, 3)) || pick(document.body, 4);
}

// ---- regions ---------------------------------------------------------------------

export const whereLabel = where;

const MEDIA = /^(img|video|svg|canvas|table|picture|iframe)$/;

/** Elements (text or media) lying mostly inside `rect` on a slide — what currently occupies that area. */
export function elementsIn(slideEl, rect, limit = 5) {
  const found = [];
  for (const el of slideEl.querySelectorAll('*')) {
    if (el.closest('svg') && el.localName !== 'svg') continue;
    const b = el.getBoundingClientRect();
    if (b.width < 4 || b.height < 4) continue;
    const iw = Math.min(b.right, rect.right) - Math.max(b.left, rect.left);
    const ih = Math.min(b.bottom, rect.bottom) - Math.max(b.top, rect.top);
    if (iw <= 0 || ih <= 0 || (iw * ih) / (b.width * b.height) < 0.6) continue;
    const media = MEDIA.test(el.localName);
    const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.data.trim());
    if (!media && !ownText) continue;
    found.push({ el, area: b.width * b.height });
  }
  const kept = found.filter((f) => !found.some((g) => g !== f && g.el.contains(f.el) && MEDIA.test(g.el.localName)));
  kept.sort((a, b) => b.area - a.area);
  return kept.slice(0, limit).map(({ el }) => ({ tag: el.localName, text: textOf(el, 60), selector: cssPath(el) }));
}

export function describeRegion(slideEl, rect) {
  const box = relBox(rect, slideEl);
  return {
    target: 'region',
    slide: slideMeta(slideEl),
    region: { ...box, where: whereLabel(box), overlaps: elementsIn(slideEl, rect) },
    pos: box,
  };
}
