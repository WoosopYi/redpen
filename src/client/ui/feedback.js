import { ui } from './root.js';
import { h } from '../util.js';
import { icon } from '../icons.js';
import { tr } from '../i18n/index.js';

// ---- toasts -------------------------------------------------------------------

let toastBox = null;

export function toast(message, { kind = 'info', ms = 2600, action = null, ico = null } = {}) {
  if (!toastBox) {
    toastBox = h('div', { class: 'toasts' });
    ui.app.append(toastBox);
  }
  let timer = 0;
  const dismiss = () => {
    clearTimeout(timer);
    el.remove();
  };
  const el = h('div', { class: `toast k-${kind}` },
    ico && icon(ico, 16),
    h('span', { class: 'msg' }, message),
    action && h('button', { class: 'act', onClick: () => { dismiss(); action.run(); } }, action.label));
  toastBox.append(el);
  while (toastBox.children.length > 4) toastBox.firstChild.remove();
  if (ms) timer = setTimeout(dismiss, ms);
  return dismiss;
}

// ---- modal ----------------------------------------------------------------------

const modals = [];

/** actions: [{ label, primary?, red?, icon?, run?: () => (true to keep open) }] */
export function modal({ title, body, actions = [{ label: tr('닫기'), primary: true }], width = 480, ico = null }) {
  const close = () => {
    back.remove();
    const i = modals.indexOf(close);
    if (i >= 0) modals.splice(i, 1);
  };
  const card = h('div', { class: 'modal' },
    h('h3', null, ico && icon(ico, 18), title),
    body,
    h('div', { class: 'modal-actions' }, actions.map((a) => h('button', {
      class: `btn ${a.primary ? 'primary' : ''} ${a.red ? 'red' : ''}`,
      onClick: async () => {
        const keep = await a.run?.();
        if (!keep) close();
      },
    }, a.icon && icon(a.icon, 14), a.label))));
  card.style.setProperty('--w', `${width}px`);
  const back = h('div', { class: 'backdrop', onClick: (e) => { if (e.target === back) close(); } }, card);
  ui.app.append(back);
  modals.push(close);
  card.querySelector('.btn.primary, .btn')?.focus();
  return close;
}

export const modalOpen = () => modals.length > 0;
export const closeTopModal = () => modals.at(-1)?.();

export function confirmDialog(title, message, okLabel = tr('확인')) {
  return new Promise((resolve) => {
    modal({
      title,
      body: h('p', null, message),
      actions: [
        { label: tr('취소'), run: () => resolve(false) },
        { label: okLabel, red: true, run: () => resolve(true) },
      ],
      width: 400,
    });
  });
}

// ---- banner (e.g. "HTML changed — reload") -----------------------------------------

let bannerEl = null;

export function banner(message, actions = []) {
  hideBanner();
  bannerEl = h('div', { class: 'banner' }, h('span', null, message),
    actions.map((a) => h('button', { class: `btn ${a.primary ? 'primary' : ''}`, onClick: a.run }, a.label)));
  ui.app.append(bannerEl);
}

export function hideBanner() {
  bannerEl?.remove();
  bannerEl = null;
}

// ---- connection status (separate from the reload banner) --------------------------

let statusEl = null;

export function statusBanner(message) {
  if (!message) {
    statusEl?.remove();
    statusEl = null;
    return;
  }
  if (!statusEl) {
    statusEl = h('div', { class: 'banner status' });
    ui.app.append(statusEl);
  }
  statusEl.textContent = message;
}
