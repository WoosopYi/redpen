import config from './config.js';
import * as api from './api.js';
import * as A from './actions.js';
import { S, subscribe, emit, setReanchor, saveNow, saveOnExit, onSaveState, hasUnsaved, clientId } from './state.js';
import { install, setReady } from './interact.js';
import { mountRoot, setModeStyle, ui } from './ui/root.js';
import { mountToolbar } from './ui/toolbar.js';
import { mountPanel } from './ui/panel.js';
import { initOverlay, scheduleRender, renderBurst, refreshHighlights } from './ui/overlay.js';
import { popoverDirty } from './ui/popover.js';
import { toast, banner, hideBanner, statusBanner, modalOpen } from './ui/feedback.js';
import { getSlides, invalidateSlides, slideOf, slideVisible, currentSlideIndex, goToSlide, slideTitle } from './slides.js';
import { h } from './util.js';
import * as L from './layout.js';
import { initSketch, openSketch, sketchOpen } from './sketch.js';

// Capture-phase listeners go in first, before the deck's deferred scripts register theirs.
install();

const POS_KEY = `redpen:pos:${config.deckPath}`;

function savePosition(reloaded) {
  try {
    sessionStorage.setItem(POS_KEY, JSON.stringify({
      t: Date.now(),
      slide: currentSlideIndex(),
      x: scrollX,
      y: scrollY,
      panel: S.panelOpen,
      tab: S.panelTab,
      mode: S.mode,
      reloaded,
    }));
  } catch {
    /* storage unavailable */
  }
}

function restorePosition() {
  let pos = null;
  try {
    pos = JSON.parse(sessionStorage.getItem(POS_KEY) || 'null');
    sessionStorage.removeItem(POS_KEY);
  } catch {
    pos = null;
  }
  if (!pos || Date.now() - pos.t > 5 * 60 * 1000) return;
  S.panelOpen = !!pos.panel;
  S.panelTab = pos.tab || 'draft';
  if (pos.mode) S.mode = pos.mode;
  setModeStyle(S.mode, S.paused);
  setTimeout(async () => {
    if (pos.slide >= 0 && currentSlideIndex() !== pos.slide) await goToSlide(pos.slide);
    if (pos.x || pos.y) scrollTo(pos.x, pos.y);
    scheduleRender();
  }, 120);
  if (pos.reloaded) toast('🔄 HTML이 바뀌어서 새로고침했어요', { ms: 2200 });
}

let reloadPending = false;
let reloading = false;

async function reloadNow() {
  reloading = true;
  hideBanner();
  await saveNow();
  savePosition(true);
  location.reload();
}

function onFilesChanged() {
  if (popoverDirty() || modalOpen()) {
    if (!reloadPending) {
      reloadPending = true;
      banner('HTML이 바뀌었어요', [{ label: '새로고침', primary: true, run: reloadNow }]);
    }
    return;
  }
  reloadNow();
}

function onboard() {
  if (localStorage.getItem('redpen:onboarded')) return;
  const card = h('div', { class: 'onboard', style: { left: '50%', bottom: '74px', transform: 'translateX(-50%)' } },
    h('h4', null, '✒️ 화면에 바로 표시하세요'),
    h('ul', null,
      h('li', null, '텍스트를 드래그 → ', h('kbd', null, 'D'), ' 삭제 · ', h('kbd', null, 'R'), ' 수정 · ', h('kbd', null, 'C'), ' 코멘트'),
      h('li', null, h('b', null, '요소·배치'), ' — 클릭해서 끌면 이동, 모서리로 크기, 글자·간격 조절'),
      h('li', null, '영역 모드로 빈 공간에 지시, 슬라이드 메뉴로 새 배치 스케치'),
      h('li', null, '다 했으면 ', h('b', null, 'AI에게 보내기'), ' → AI 세션이 이어서 반영')),
    h('button', {
      class: 'btn',
      onClick: () => {
        localStorage.setItem('redpen:onboarded', '1');
        card.remove();
      },
    }, '시작하기'));
  ui.app.append(card);
}

async function init() {
  if (window.__redpenStarted) return;
  window.__redpenStarted = true;

  mountRoot();
  const toolbar = mountToolbar(A);
  const panel = mountPanel(A);
  panel.setFile(config.deckName);
  initOverlay({
    onPinClick: (id, rect) => A.openItem(id, rect),
    onFocus: () => A.onFocusChange(),
    isSlide: (el) => getSlides().set.has(el),
  });
  L.initLayout();
  initSketch();
  Object.assign(A.hooks, { openLayout: L.openItem, openSketch, sketchOpen, deselect: L.deselect });
  setReanchor(() => A.anchorAll());
  setModeStyle(S.mode, S.paused);

  subscribe((kind) => {
    toolbar.update();
    panel.update(kind);
    if (kind === 'items' || kind === 'all' || kind === 'mode') {
      L.recompute(); // layout previews follow the marks (and disappear while paused)
      L.refresh();
    }
    if (kind === 'focus' || kind === 'deck') scheduleRender();
    else refreshHighlights();
  });

  let state;
  try {
    state = await api.getState();
  } catch {
    toast('리뷰 서버에 연결하지 못했어요. 터미널에서 redpen open 을 다시 실행해 주세요.', { kind: 'error', ms: 0 });
    return;
  }
  S.items = state.draft?.items || [];
  S.deckComment = state.draft?.deckComment || '';
  S.rounds = state.rounds || [];
  S.agent = state.agent || { status: 'offline' };
  A.markRepliesSeen(S.rounds);
  invalidateSlides();
  A.anchorAll();
  restorePosition();
  setReady();
  emit('all');

  // Slides and text can appear late (decks that render from JS, lazy content): re-anchor marks that are lost.
  // Throttled, not debounced: decks that update the DOM constantly (video clocks, counters) must not starve it.
  let reanchorTimer = 0;
  const reanchorSoon = () => {
    if (reanchorTimer) return;
    reanchorTimer = setTimeout(() => {
      reanchorTimer = 0;
      invalidateSlides();
      const lost = S.items.some((it) => it._orphan || (it.target === 'text' && (!it._range || it._range.collapsed))
        || (it.target === 'element' && !it._el?.isConnected)
        || (it._slide && it._slide !== document.body && !it._slide.isConnected)); // slides re-rendered by the deck
      if (lost) {
        A.anchorAll();
        emit('items');
      }
      scheduleRender();
    }, 350);
  };
  new MutationObserver(reanchorSoon).observe(document.body, { childList: true, subtree: true });
  // A slide (or a wrapper of slides) changing class/style means slides are switching: follow every frame.
  new MutationObserver((mutations) => {
    const { set, els } = getSlides();
    const first = els[0];
    const switching = mutations.some((m) => set.has(m.target) || (first && m.target !== first && m.target.contains?.(first)));
    if (switching) renderBurst();
    else scheduleRender();
  }).observe(document.body, { attributes: true, subtree: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'aria-current', 'data-state', 'data-active'] });
  addEventListener('load', reanchorSoon);
  setTimeout(reanchorSoon, 1000);

  let lastSlide = '';
  setInterval(() => {
    const { els, single } = getSlides();
    const i = single ? -1 : currentSlideIndex();
    const key = `${i}/${els.length}`;
    if (key === lastSlide) return;
    lastSlide = key;
    toolbar.setSlide(i, single ? 1 : els.length, i >= 0 ? slideTitle(els[i]) : '');
  }, 300);

  // Never let marks pile up silently when the server is gone: say so, and save again once it is back.
  let connLost = false;
  let saveFailed = false;
  let lostTimer = 0;
  let retryTimer = 0;
  const showConnection = () => statusBanner(connLost || saveFailed
    ? '⚠️ 리뷰 서버와 연결이 끊겨 표시가 저장되지 않고 있어요. 터미널에서 redpen open 을 다시 실행해 주세요.'
    : null);
  onSaveState((ok) => {
    saveFailed = !ok;
    showConnection();
    clearTimeout(retryTimer);
    if (!ok) retryTimer = setTimeout(saveNow, 3000);
  });
  api.connect({
    state: (st) => A.onState(st),
    draft: (d) => {
      if (d.clientId !== clientId) A.onRemoteDraft(d);
    },
    reload: () => onFilesChanged(),
    open: () => {
      clearTimeout(lostTimer);
      lostTimer = 0;
      if (connLost) {
        connLost = false;
        showConnection();
        if (hasUnsaved()) saveNow();
      }
    },
    error: () => {
      // EventSource retries every ~1.5 s; warn once it has stayed down for a few seconds.
      if (lostTimer || connLost) return;
      lostTimer = setTimeout(() => {
        lostTimer = 0;
        connLost = true;
        showConnection();
      }, 4000);
    },
  });

  addEventListener('pagehide', () => {
    saveOnExit();
    if (!reloading) savePosition(false);
  });
  onboard();
}

// Keep a reference for debugging in DevTools: window.__redpen
window.__redpen = { S, getSlides, slideOf, slideVisible };

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
