import { SHADOW_CSS, DOC_CSS, TEXT_MODE_CSS, PICK_MODE_CSS } from '../styles.js';

/** Shadow-DOM host for all review UI, so the deck's CSS and ours never mix. */
export const ui = { host: null, shadow: null, app: null, layer: null };

let modeStyle = null;

// Events from our UI stop at the host so the deck's handlers (arrow-key navigation, click-to-advance…) never see them.
const SHIELD = ['keydown', 'keyup', 'keypress', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu',
  'pointerdown', 'pointerup', 'touchstart', 'touchend', 'wheel', 'input', 'beforeinput', 'paste', 'copy', 'cut',
  'focusin', 'focusout', 'selectstart', 'dragstart'];

const NAV_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End']);

/** Is the event's real target (inside the shadow root) a text field of ours? */
export function typingIn(e) {
  const t = e.composedPath?.()[0];
  return !!t && t.nodeType === 1 && (t.localName === 'textarea' || t.localName === 'input' || t.localName === 'select' || t.isContentEditable);
}

export function mountRoot() {
  const host = document.createElement('redpen-root');
  host.id = '__redpen-host';
  host.setAttribute('style', 'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important;display:block!important;');
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = SHADOW_CSS;
  const layer = document.createElement('div');
  layer.className = 'layer';
  const app = document.createElement('div');
  app.className = 'rp';
  shadow.append(style, layer, app);
  for (const type of SHIELD) {
    host.addEventListener(type, (e) => {
      // Slide navigation keys still reach the deck unless the user is typing in one of our fields.
      if ((type === 'keydown' || type === 'keyup') && NAV_KEYS.has(e.key) && !typingIn(e)) return;
      e.stopPropagation();
    });
  }
  // Clicking our buttons must not move keyboard focus away from the deck (arrow keys, D/R/C shortcuts).
  shadow.addEventListener('mousedown', (e) => {
    const t = e.composedPath()[0];
    if (t instanceof Element && t.closest('button, .row, .g-head') && !t.closest('textarea, input, select')) e.preventDefault();
  });
  document.documentElement.appendChild(host);
  new MutationObserver(() => {
    if (!host.isConnected) document.documentElement.appendChild(host);
  }).observe(document.documentElement, { childList: true });

  const docStyle = document.createElement('style');
  docStyle.id = '__redpen-doc-style';
  docStyle.textContent = DOC_CSS;
  modeStyle = document.createElement('style');
  modeStyle.id = '__redpen-mode-style';
  (document.head || document.documentElement).append(docStyle, modeStyle);

  Object.assign(ui, { host, shadow, app, layer });
  return ui;
}

/** Did this event originate inside our UI? (At window level, shadow events are retargeted to the host.) */
export const isOurs = (e) => !!ui.host && (e.target === ui.host || e.composedPath?.().includes(ui.host));

export function setModeStyle(mode, paused) {
  if (!modeStyle) return;
  if (paused) modeStyle.textContent = '';
  else if (mode === 'text') modeStyle.textContent = TEXT_MODE_CSS;
  else modeStyle.textContent = PICK_MODE_CSS(mode === 'region' ? 'crosshair' : 'pointer');
}

/** Element focused inside our shadow root (document.activeElement only shows the host). */
export const activeInUI = () => ui.shadow?.activeElement || null;
