import { ui } from './root.js';
import { S } from '../state.js';
import { h, clamp, MOD } from '../util.js';
import { icon } from '../icons.js';
import { tr } from '../i18n/index.js';

const AI_TEXT = {
  offline: ['AI 미연결', 'AI 세션이 기다리고 있지 않아요.\n보내면 저장되고, AI 세션에서 /redpen 또는\n"리뷰 반영해줘"라고 하면 이어서 반영해요.'],
  waiting: ['AI 대기 중', 'AI 세션이 기다리는 중이에요.\n보내면 바로 반영을 시작해요.'],
  working: ['AI 반영 중…', 'AI가 보낸 수정 요청을 반영하고 있어요.\n끝나면 화면이 자동으로 새로고침돼요.'],
};

const POS_KEY = 'redpen:bar';

/** Floating toolbar: mode switch, slide menu, list, AI status, send. Draggable by the logo. */
export function mountToolbar(A) {
  const modeButton = (mode, ico, label, tip) => {
    const b = h('button', { class: 'tb', 'data-tip': tip, onClick: () => A.setMode(mode) }, icon(ico, 15), h('span', { class: 'lbl' }, label));
    b.dataset.mode = mode;
    return b;
  };
  const modes = [
    modeButton('text', 'text', tr('텍스트'), tr('텍스트 (Alt+1)\n드래그로 선택 → 삭제 D · 수정 R · 코멘트 C')),
    modeButton('element', 'layout', tr('레이아웃'), tr('레이아웃 (Alt+2)\n요소를 클릭해 선택 → 끌어서 이동·순서 바꾸기, 모서리로 크기\n글자·간격·여백 조절 · D 삭제 · C 코멘트')),
    modeButton('region', 'region', tr('영역'), tr('영역 (Alt+3)\n빈 곳에 범위를 그려 코멘트 (예: 여기에 그림 추가)')),
  ];
  const slideNo = h('span', { class: 'slide-no' }, '–');
  const slideBtn = h('button', {
    class: 'tb hide-paused',
    'data-tip': tr('지금 보이는 슬라이드에\n코멘트 · 새 배치 스케치 · 순서 옮기기 · 삭제'),
    onClick: (e) => A.openSlideMenu(e.currentTarget),
  }, icon('slide', 15), slideNo, icon('chevron', 12));
  const listCount = h('span', { class: 'count zero' }, '0');
  const listBtn = h('button', { class: 'tb', 'data-tip': tr('표시 목록 · 보낸 기록'), onClick: () => A.togglePanel() }, icon('list', 15), h('span', { class: 'lbl' }, tr('목록')), listCount);
  const aiLabel = h('span', { class: 'lbl' }, tr(AI_TEXT.offline[0]));
  const ai = h('span', { class: 'ai hide-paused', 'data-tip': tr(AI_TEXT.offline[1]) }, h('span', { class: 'dot' }), aiLabel);
  const sendBtn = h('button', { class: 'tb send hide-paused', 'data-tip': tr('AI에게 보내기 ({key})', { key: `${MOD}+Enter` }), onClick: () => A.send('agent') }, icon('send', 14), h('span', { class: 'lbl' }, tr('AI에게 보내기')));
  const pauseIco = h('span', null, icon('pause', 15));
  const pauseBtn = h('button', { class: 'tb', 'data-tip': tr('일시정지 — 표시를 숨기고 덱을 원래대로 조작'), onClick: () => A.togglePause() }, pauseIco);
  const logo = h('button', { class: 'logo', 'data-tip': tr('빨간펜 · 끌어서 옮기기 · 클릭하면 접기') }, icon('pen', 16), h('b', { 'data-paused': tr('일시정지') }, tr('빨간펜')));
  const mini = h('span', { class: 'count mini zero' }, '0');

  const bar = h('div', { class: 'bar' },
    logo, mini,
    h('div', { class: 'seg' }, modes),
    slideBtn,
    h('div', { class: 'vsep hide-paused' }),
    listBtn, ai, sendBtn, pauseBtn);
  ui.app.append(bar);

  // ---- drag to move / click to collapse ----
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
  } catch {
    saved = null;
  }
  const applyPos = (x, y) => {
    const w = bar.offsetWidth;
    const hh = bar.offsetHeight;
    x = clamp(x, 6, innerWidth - w - 6);
    y = clamp(y, 6, innerHeight - hh - 6);
    bar.classList.add('placed');
    bar.style.left = `${x}px`;
    bar.style.top = `${y}px`;
    bar.style.bottom = 'auto';
    bar.classList.toggle('top', y < innerHeight / 2);
    return { x, y };
  };
  if (saved?.collapsed) bar.classList.add('collapsed');
  if (saved?.x != null) requestAnimationFrame(() => applyPos(saved.x, saved.y));
  addEventListener('resize', () => {
    if (bar.classList.contains('placed')) applyPos(parseFloat(bar.style.left), parseFloat(bar.style.top));
  });
  const store = (patch) => {
    saved = { ...(saved || {}), ...patch };
    localStorage.setItem(POS_KEY, JSON.stringify(saved));
  };

  logo.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const r = bar.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    const sx = e.clientX;
    const sy = e.clientY;
    let moved = false;
    logo.setPointerCapture(e.pointerId);
    const move = (ev) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
      moved = true;
      applyPos(ev.clientX - dx, ev.clientY - dy);
    };
    const up = () => {
      logo.removeEventListener('pointermove', move);
      logo.removeEventListener('pointerup', up);
      logo.removeEventListener('pointercancel', up);
      if (moved) {
        store({ x: parseFloat(bar.style.left), y: parseFloat(bar.style.top) });
      } else {
        bar.classList.toggle('collapsed');
        store({ collapsed: bar.classList.contains('collapsed') });
        if (bar.classList.contains('placed')) requestAnimationFrame(() => applyPos(parseFloat(bar.style.left), parseFloat(bar.style.top)));
      }
    };
    logo.addEventListener('pointermove', move);
    logo.addEventListener('pointerup', up);
    logo.addEventListener('pointercancel', up);
  });
  logo.addEventListener('dblclick', () => {
    bar.classList.remove('placed', 'top', 'collapsed');
    bar.style.left = bar.style.top = bar.style.bottom = '';
    saved = null;
    localStorage.removeItem(POS_KEY);
  });

  function update() {
    for (const b of modes) b.classList.toggle('on', b.dataset.mode === S.mode);
    bar.classList.toggle('paused', S.paused);
    pauseIco.replaceChildren(icon(S.paused ? 'play' : 'pause', 15));
    pauseBtn.dataset.tip = tr(S.paused ? '다시 시작 — 표시 보이기' : '일시정지 — 표시를 숨기고 덱을 원래대로 조작');
    pauseBtn.classList.toggle('on', S.paused);
    const n = S.items.length + (S.deckComment.trim() ? 1 : 0);
    for (const c of [listCount, mini]) {
      c.textContent = String(n);
      c.classList.toggle('zero', !n);
    }
    listBtn.classList.toggle('on', S.panelOpen);
    sendBtn.classList.toggle('idle', !n);
    const status = AI_TEXT[S.agent?.status] ? S.agent.status : 'offline';
    ai.className = `ai hide-paused ${status}`;
    aiLabel.textContent = tr(AI_TEXT[status][0]);
    ai.dataset.tip = tr(AI_TEXT[status][1]);
  }

  function setSlide(index, total, title) {
    slideNo.textContent = total > 1 && index >= 0 ? `${index + 1} / ${total}` : tr('페이지');
    slideBtn.dataset.tip = `${total > 1 && index >= 0 ? `${tr('슬라이드 {n}', { n: index + 1 })}${title ? ` · ${title}` : ''}\n` : ''}${tr('코멘트 · 새 배치 스케치 · 순서 옮기기 · 삭제')}`;
  }

  return { update, setSlide, el: bar };
}
