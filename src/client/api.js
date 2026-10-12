const BASE = '/__redpen/api';

async function json(res) {
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      msg = (await res.json()).error || msg;
    } catch {
      /* not json */
    }
    throw new Error(msg);
  }
  return res.json();
}

export const getState = () => fetch(`${BASE}/state`).then(json);

export const saveDraft = (draft) => fetch(`${BASE}/draft`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(draft),
}).then(json);

/** Last-chance save when the tab closes or reloads. */
export function beaconDraft(draft) {
  const body = JSON.stringify(draft);
  if (navigator.sendBeacon?.(`${BASE}/draft`, new Blob([body], { type: 'text/plain' }))) return;
  fetch(`${BASE}/draft`, { method: 'POST', body, keepalive: body.length < 60000 }).catch(() => {});
}

export const submit = (payload) => fetch(`${BASE}/submit`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
}).then(json);

export const roundMarkdown = (n, channel = 'clipboard') => fetch(`${BASE}/round/${n}/markdown?channel=${channel}`).then((r) => {
  if (!r.ok) throw new Error(String(r.status));
  return r.text();
});

/** Server-sent events: state (rounds, AI status), draft (another tab), reload (files changed). */
export function connect(handlers) {
  const es = new EventSource(`${BASE}/events`);
  for (const [name, fn] of Object.entries(handlers)) {
    if (name === 'open' || name === 'error') continue;
    es.addEventListener(name, (e) => {
      try {
        fn(JSON.parse(e.data));
      } catch (err) {
        console.error('[redpen]', err);
      }
    });
  }
  es.onopen = () => handlers.open?.();
  es.onerror = () => handlers.error?.();
  return es;
}
