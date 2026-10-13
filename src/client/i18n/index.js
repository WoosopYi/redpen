import en from './en.js';

/*
 * One translation layer for the browser overlay, the CLI and the prompt renderer (no DOM in here).
 * Korean is the source language: tr('한국어 문구') returns the text itself for 'ko' and its entry in
 * en.js for 'en'. `{name}` placeholders are filled from `vars` in a single pass, so filled-in values
 * (slide titles, user text) are never scanned again. An entry may be a function of `vars` when the
 * other language needs different word order or plurals.
 */

const DICTS = { en };
export const LANGS = ['ko', 'en'];
let current = 'ko';

export const lang = () => current;

export function setLang(l) {
  current = LANGS.includes(l) ? l : 'ko';
}

export function tr(text, vars) {
  const entry = DICTS[current]?.[text];
  if (typeof entry === 'function') return entry(vars || {});
  const s = entry ?? text;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}

/** Run `fn` in another language, e.g. to render a round that was sent from a tab in that language. */
export function withLang(l, fn) {
  const prev = current;
  setLang(l);
  try {
    return fn();
  } finally {
    current = prev;
  }
}

/** Long blocks (help text, prompt rules) are written out per language: pick the current one. */
export const pick = (versions) => versions[current] ?? versions.ko;
