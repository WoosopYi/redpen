/** Tiny DOM builder: h('div', { class: 'x', onClick }, 'text', child) */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
export const trunc = (s, n) => {
  s = norm(s);
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const uid = () => `it${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const isMac = /Mac|iPhone|iPad/.test(navigator.userAgentData?.platform || navigator.userAgent);
export const MOD = isMac ? '⌘' : 'Ctrl';

export function isEditable(node) {
  for (let e = node && (node.nodeType === 1 ? node : node.parentElement); e; e = e.parentElement) {
    if (e.isContentEditable) return true;
    const t = e.localName;
    if (t === 'input' || t === 'textarea' || t === 'select') return true;
  }
  return false;
}

export function rectsIntersect(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

export function viewportRect() {
  return { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
}

export function timeLabel(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
