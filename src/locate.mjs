import fs from 'node:fs';
import path from 'node:path';
import { positionalSlideId } from './client/slide-identity.js';

/*
 * Source-line hints: given text the reviewer saw in the rendered page, find where it lives in the
 * deck's source files (the HTML itself and any local scripts that build slides, e.g. slides.js).
 * Rendered text loses tags, entities and whitespace, so matching is done with a forgiving pattern.
 */

const MAX_FILE_BYTES = 3 * 1024 * 1024;
const MAX_HITS = 50;

const ENTITIES = {
  '&': ['&amp;', '&#38;'],
  '<': ['&lt;', '&#60;'],
  '>': ['&gt;', '&#62;'],
  '"': ['&quot;', '&#34;', '\\"'],
  "'": ['&#39;', '&#x27;', '&apos;', "\\'"],
  ' ': ['&nbsp;', '&#160;', ' '],
  '·': ['&middot;', '&#183;', '\\u00b7'],
  '—': ['&mdash;', '&#8212;'],
  '–': ['&ndash;', '&#8211;'],
  '…': ['&hellip;', '&#8230;'],
  '‘': ['&lsquo;', '&#8216;'],
  '’': ['&rsquo;', '&#8217;'],
  '“': ['&ldquo;', '&#8220;'],
  '”': ['&rdquo;', '&#8221;'],
  '→': ['&rarr;', '&#8594;'],
  '←': ['&larr;', '&#8592;'],
  '×': ['&times;', '&#215;'],
  '©': ['&copy;', '&#169;'],
  '•': ['&bull;', '&#8226;'],
  '°': ['&deg;', '&#176;'],
};

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const TAGS = '(?:<[^<>]*>)*';
const GAP = '(?:\\s|&nbsp;|&#160;|\\\\n|<[^<>]*>)+';

/** Collect the files that can contain slide text: the deck HTML, its local scripts, and data JSON. */
export function loadSources(deckPath) {
  const dir = path.dirname(deckPath);
  const files = [];
  const seen = new Set();
  const add = (abs) => {
    abs = path.resolve(abs);
    if (seen.has(abs)) return null;
    seen.add(abs);
    let st;
    try {
      st = fs.statSync(abs);
    } catch {
      return null;
    }
    if (!st.isFile() || st.size > MAX_FILE_BYTES) return null;
    const file = { abs, rel: path.relative(dir, abs) || path.basename(abs), text: fs.readFileSync(abs, 'utf8'), lines: null };
    files.push(file);
    return file;
  };

  const deck = add(deckPath);
  if (!deck) return files;

  for (const src of localRefs(deck.text, /<script\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi)) {
    if (/\.min\.js$/i.test(src)) continue;
    const f = add(path.resolve(dir, src));
    if (!f || !/\.m?js$/i.test(f.abs)) continue;
    // one level of static imports and fetched data files
    for (const imp of localRefs(f.text, /\bimport\s*(?:[^'"]*?\bfrom\s*)?["'](\.{1,2}\/[^"']+)["']/g)) {
      add(path.resolve(path.dirname(f.abs), imp));
    }
    for (const data of localRefs(f.text, /\bfetch\(\s*["'`]([^"'`$]+\.(?:json|md|txt|html?))["'`]/g)) {
      add(path.resolve(dir, data));
    }
  }
  try {
    for (const name of fs.readdirSync(dir)) {
      if (/\.json$/i.test(name) && !/^(package(-lock)?|tsconfig|jsconfig|composer|manifest)\.json$/i.test(name)) {
        add(path.join(dir, name));
      }
    }
  } catch {
    /* unreadable dir: hints are best-effort */
  }
  return files;
}

function localRefs(text, re) {
  const out = [];
  for (const m of text.matchAll(re)) {
    let ref = m[1].trim();
    if (!ref || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(ref)) continue;
    ref = ref.split(/[?#]/)[0];
    try {
      ref = decodeURIComponent(ref);
    } catch {
      /* keep raw */
    }
    out.push(ref.replace(/^\/+/, ''));
  }
  return out;
}

function lineAt(file, index) {
  if (!file.lines) {
    file.lines = [0];
    for (let i = 0; i < file.text.length; i++) if (file.text.charCodeAt(i) === 10) file.lines.push(i + 1);
  }
  let lo = 0;
  let hi = file.lines.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (file.lines[mid] <= index) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** Regex that matches rendered text in source: tags may sit between characters, whitespace may be any run. */
export function textPattern(text, maxChars = 120) {
  const chars = [...text.replace(/\s+/g, ' ').trim()].slice(0, maxChars);
  if (!chars.length) return null;
  let src = '';
  chars.forEach((ch, i) => {
    if (ch === ' ') {
      src += GAP;
      return;
    }
    const alts = ENTITIES[ch];
    src += alts ? `(?:${[ch, ...alts].map(esc).join('|')})` : esc(ch);
    if (i < chars.length - 1 && chars[i + 1] !== ' ') src += TAGS;
  });
  return new RegExp(src, 'g');
}

function search(files, re) {
  const hits = [];
  for (const f of files) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(f.text)) && hits.length < MAX_HITS) {
      hits.push({ f, index: m.index, end: m.index + m[0].length });
      if (!m[0].length) re.lastIndex++;
    }
  }
  return hits;
}

function finish(hits, { occurrence = 0, domCount = 0 } = {}) {
  if (!hits.length) return { status: 'notfound', total: 0, hits: [] };
  const out = hits.slice(0, 8).map((h) => ({ file: h.f.rel, line: lineAt(h.f, h.index), endLine: lineAt(h.f, Math.max(h.index, h.end - 1)) }));
  const result = { status: hits.length === 1 ? 'exact' : 'ambiguous', total: hits.length, hits: out };
  // Same number of matches in the page and in the source → assume the same order.
  if (hits.length > 1 && domCount === hits.length && occurrence < out.length) {
    result.status = 'guess';
    result.pick = occurrence;
  }
  return result;
}

/** Locate rendered text in the sources. */
export function findText(files, text, opts = {}) {
  const norm = String(text || '').replace(/\s+/g, ' ').trim();
  if (!norm) return null;
  const re = textPattern(norm, 120);
  const hits = search(files, re);
  // For long selections the pattern only covers the head; find where the tail ends.
  if (hits.length && [...norm].length > 120) {
    const tail = textPattern([...norm].slice(-48).join(''), 48);
    for (const h of hits) {
      tail.lastIndex = h.index;
      const m = tail.exec(h.f.text);
      if (m && m.index - h.index < norm.length * 4 + 2000) h.end = m.index + m[0].length;
    }
  }
  return finish(hits, opts);
}

function pathSuffixes(url) {
  const clean = url.split(/[?#]/)[0].replace(/^\.?\//, '');
  const parts = clean.split('/').filter(Boolean);
  const out = [];
  for (let i = 0; i < parts.length; i++) out.push(parts.slice(i).join('/'));
  return out;
}

/** Locate an element (image, box, …) by its most distinctive attribute, falling back to its text. */
export function findElement(files, el) {
  if (!el) return null;
  const attrs = el.attrs || {};
  if (attrs.id) {
    const hits = search(files, new RegExp(`\\bid\\s*=\\s*\\\\?["']${esc(attrs.id)}\\\\?["']`, 'g'));
    if (hits.length) return finish(hits);
  }
  for (const key of ['src', 'data-src', 'data-lazy-src', 'poster', 'href']) {
    const value = attrs[key];
    if (!value || value.startsWith('data:') || value.startsWith('#')) continue;
    for (const suffix of pathSuffixes(value)) {
      const hits = search(files, new RegExp(esc(suffix), 'g'));
      if (hits.length) return finish(hits);
    }
  }
  if (el.text && el.text.length >= 2) {
    const r = findText(files, el.text.slice(0, 80));
    if (r && r.total) return r;
  }
  if (attrs.alt) {
    const hits = search(files, new RegExp(esc(attrs.alt), 'g'));
    if (hits.length) return finish(hits);
  }
  return { status: 'notfound', total: 0, hits: [] };
}

/** Where a slide starts, judged by its id or title. */
export function findSlide(files, slide) {
  if (!slide) return null;
  if (slide.id && !(slide.anchor?.positionalId ?? positionalSlideId(slide.id, slide.index))) {
    const r = findElement(files, { attrs: { id: slide.id } });
    if (r?.total) return r;
  }
  if (slide.anchor?.body && slide.anchor.contentUnique) {
    const r = findText(files, slide.anchor.body);
    if (r?.status === 'exact') return r;
  }
  if (slide.title && slide.title.length >= 2 && slide.anchor?.titleUnique !== false) {
    const r = findText(files, slide.title);
    if (r?.total && r.total <= 3) return r;
  }
  return null;
}

/** Attach source hints to every item of a submitted batch. Returns per-slide hints. */
export function annotate(items, files) {
  const slideSources = {};
  for (const it of items) {
    try {
      if (it.slideMissing) continue;
      if (it.target === 'text' && it.text?.exact) {
        it.source = findText(files, it.text.exact, { occurrence: it.text.occurrence, domCount: it.slide?.anchor ? 0 : it.text.domCount });
      } else if (it.target === 'element' && it.element) {
        it.source = findElement(files, it.element);
      }
      const s = it.slide;
      if (s && !s.single && Number.isInteger(s.index) && !(s.index in slideSources)) {
        slideSources[s.index] = findSlide(files, s);
      }
    } catch {
      /* hints are optional */
    }
  }
  return slideSources;
}
