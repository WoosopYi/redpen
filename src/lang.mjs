import { execFileSync } from 'node:child_process';
import { LANGS } from './client/i18n/index.js';

/** 'ko' | 'en' for values like "en", "en-US", "ko_KR.UTF-8", "korean"; null when it is neither. */
export function normLang(value) {
  const s = String(value || '').trim().toLowerCase();
  if (/^(ko|kr|kor|korean|한국어)([-_.@]|$)/.test(s)) return 'ko';
  if (/^(en|eng|english|영어)([-_.@]|$)/.test(s)) return 'en';
  return null;
}

/** The language asked for on purpose: --lang, else $REDPEN_LANG. Throws on a value we don't support. */
export function explicitLang(flag) {
  for (const [value, from] of [[flag, '--lang'], [process.env.REDPEN_LANG, 'REDPEN_LANG']]) {
    if (value === undefined || value === null || value === '' || value === true) continue;
    const l = normLang(value);
    if (!l) throw new Error(`${from}: "${value}" — ${LANGS.join(' | ')}`);
    return l;
  }
  return null;
}

let detected = null;

/**
 * The user's own language. On macOS the shell's LANG is often en_US even when the Mac itself is in
 * Korean, so the system UI language (AppleLanguages) goes first. Anything other than Korean → English.
 */
export function systemLang() {
  if (detected) return detected;
  if (process.platform === 'darwin') {
    try {
      const out = execFileSync('defaults', ['read', '-g', 'AppleLanguages'], { encoding: 'utf8', timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'] });
      const first = /\(\s*"?([A-Za-z]{2,3})/.exec(out)?.[1];
      if (first) return (detected = normLang(first) || 'en');
    } catch {
      /* no `defaults`: fall back to the locale */
    }
  }
  const { LC_ALL, LC_MESSAGES, LANG } = process.env;
  for (const v of [LC_ALL, LC_MESSAGES, LANG, Intl.DateTimeFormat().resolvedOptions().locale]) {
    if (v && !/^(C|POSIX)([.@]|$)/i.test(v)) return (detected = normLang(v) || 'en');
  }
  return (detected = 'en');
}
