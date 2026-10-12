import config from './config.js';
import { norm, sleep } from './util.js';

/*
 * Slide detection. Decks differ (reveal.js, `.slide` sections stacked with opacity, scroll decks…),
 * so we try common structures in order and take the first that yields ≥ 2 slides.
 * `redpen open --slide <selector>` overrides detection.
 */
const CANDIDATES = [
  { sel: '.reveal .slides section:not(:has(> section))' }, // reveal.js: innermost sections (vertical stacks)
  { sel: '.slide' },
  { sel: '[data-slide]' },
  { sel: '.swiper-slide' },
  { sel: '.remark-slide-container' },
  { sel: '.slides > section' },
  { sel: '.slides > div' },
  { sel: '.deck > section' },
  { sel: '.deck > div' },
  { sel: '.page' },
  { sel: 'body > section' },
  { sel: 'main > section' },
  { sel: 'section' },
];

let cache = null;
let dirty = true;

export function invalidateSlides() {
  dirty = true;
}

const qsa = (sel) => {
  try {
    return [...document.querySelectorAll(sel)];
  } catch {
    return [];
  }
};

function outermost(els) {
  const set = new Set(els);
  return els.filter((el) => {
    for (let p = el.parentElement; p; p = p.parentElement) if (set.has(p)) return false;
    return true;
  });
}

function detect() {
  const notOurs = (el) => !el.closest('#__redpen-host');
  if (config.slideSelector) {
    const els = outermost(qsa(config.slideSelector).filter(notOurs));
    if (els.length) return { selector: config.slideSelector, els, single: false };
  }
  for (const c of CANDIDATES) {
    const els = outermost(qsa(c.sel).filter(notOurs));
    if (els.length >= 2) return { selector: c.sel, els, single: false };
  }
  return { selector: null, els: document.body ? [document.body] : [], single: true };
}

/** @returns {{selector: string|null, els: Element[], single: boolean, set: Set<Element>}} */
export function getSlides() {
  if (dirty || !cache) {
    dirty = false;
    const d = detect();
    cache = { ...d, set: new Set(d.els) };
  }
  return cache;
}

export function slideOf(node) {
  const { set, single } = getSlides();
  if (single) return document.body;
  for (let el = node && (node.nodeType === 1 ? node : node.parentElement); el; el = el.parentElement) {
    if (set.has(el)) return el;
  }
  return null;
}

export function slideIndexOf(el) {
  return getSlides().els.indexOf(el);
}

export function slideTitle(el) {
  if (!el) return '';
  if (el === document.body) return norm(document.title);
  const attr = el.getAttribute('data-title') || el.getAttribute('aria-label') || el.getAttribute('title');
  if (attr && norm(attr)) return norm(attr).slice(0, 80);
  const heading = el.querySelector('h1, h2, h3, [class*="title" i]');
  if (heading && norm(heading.textContent)) return norm(heading.textContent).slice(0, 80);
  return norm(el.textContent).slice(0, 40);
}

/**
 * How visible a slide is right now: 0 when display:none / visibility:hidden / faded out / off-screen,
 * otherwise its effective opacity (mid-transition values included), so marks can fade along with it.
 */
export function slideOpacity(el) {
  if (!el) return 0;
  if (el === document.body) return 1;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return 0;
  if (r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) return 0;
  let opacity = 1;
  for (let e = el, depth = 0; e && e !== document.documentElement && depth < 8; e = e.parentElement, depth++) {
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden') return 0;
    opacity *= Number(cs.opacity);
    if (opacity < 0.05) return 0;
  }
  return opacity;
}

/** Is the slide actually on screen (not display:none / visibility:hidden / opacity 0 / off-screen)? */
export function slideVisible(el) {
  return slideOpacity(el) > 0;
}

function visibleArea(el) {
  if (!slideVisible(el)) return 0;
  const r = el.getBoundingClientRect();
  const w = Math.min(r.right, innerWidth) - Math.max(r.left, 0);
  const h = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
  return w > 0 && h > 0 ? w * h : 0;
}

export function currentSlideIndex() {
  const { els, single } = getSlides();
  if (single) return 0;
  const hit = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
  const s = hit && slideOf(hit);
  if (s && slideVisible(s)) return els.indexOf(s);
  let best = -1;
  let bestArea = 0;
  els.forEach((el, i) => {
    const a = visibleArea(el);
    if (a > bestArea) {
      bestArea = a;
      best = i;
    }
  });
  return best;
}

function pressKey(key) {
  const codes = { ArrowRight: 39, ArrowLeft: 37, PageDown: 34, PageUp: 33 };
  const init = { key, code: key, keyCode: codes[key], which: codes[key], bubbles: true, cancelable: true };
  const target = document.activeElement && document.activeElement !== document.body && !document.activeElement.closest?.('#__redpen-host')
    ? document.activeElement : document.body;
  target.dispatchEvent(new KeyboardEvent('keydown', init));
  target.dispatchEvent(new KeyboardEvent('keyup', init));
}

/** Bring slide `i` on screen using whatever navigation the deck supports. Best effort. */
export async function goToSlide(i) {
  const { els, single } = getSlides();
  const target = els[i];
  if (!target || single) return true;
  if (slideVisible(target)) {
    const r = target.getBoundingClientRect();
    if (r.top < 0 || r.bottom > innerHeight) target.scrollIntoView({ block: r.height > innerHeight ? 'start' : 'center', behavior: 'smooth' });
    return true;
  }

  const Reveal = /** @type {any} */ (window).Reveal;
  if (Reveal?.slide && Reveal.getIndices) {
    const { h, v } = Reveal.getIndices(target);
    Reveal.slide(h, v);
    await sleep(450);
    if (slideVisible(target)) return true;
  }

  // Scroll decks: the slide is laid out, just not in view.
  const r = target.getBoundingClientRect();
  if (r.width > 2 && r.height > 2 && getComputedStyle(target).visibility !== 'hidden' && Number(getComputedStyle(target).opacity) > 0.05) {
    target.scrollIntoView({ block: 'center' });
    await sleep(80);
    if (slideVisible(target)) return true;
  }

  // Hash navigation (#5, #/4, #slide-5, #id).
  const before = location.hash;
  const hashes = [];
  if (/^#\/\d+/.test(before)) hashes.push(`#/${i}`);
  hashes.push(`#${i + 1}`);
  if (target.id) hashes.push(`#${target.id}`);
  const setHash = (hash) => {
    const oldURL = location.href;
    history.replaceState(history.state, '', hash || `${location.pathname}${location.search}`);
    window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL, newURL: location.href }));
  };
  for (const hash of hashes) {
    if (location.hash === hash) continue;
    setHash(hash);
    await sleep(380);
    if (slideVisible(target)) return true;
  }
  if (location.hash !== before) history.replaceState(history.state, '', before || `${location.pathname}${location.search}`);

  // Keyboard: press arrows the right number of times, then correct.
  for (let attempt = 0; attempt < 4; attempt++) {
    const cur = currentSlideIndex();
    if (cur === i) return true;
    if (cur < 0) break;
    const key = cur < i ? 'ArrowRight' : 'ArrowLeft';
    for (let k = 0; k < Math.abs(i - cur); k++) pressKey(key);
    await sleep(420);
    if (currentSlideIndex() === cur) {
      pressKey(cur < i ? 'PageDown' : 'PageUp');
      await sleep(420);
      if (currentSlideIndex() === cur) break;
    }
  }
  return slideVisible(target);
}
