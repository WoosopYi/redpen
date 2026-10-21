import { ui, activeInUI } from './root.js';
import { S, ordered, numbering, saveSoon, emit, TYPE_LABEL, TYPE_ICON, TARGET_LABEL } from '../state.js';
import { h, trunc, timeLabel, MOD, rich } from '../util.js';
import { icon } from '../icons.js';
import { itemSummary } from '../summary.js';
import { tr } from '../i18n/index.js';

/** Side panel: the marks being written (grouped by slide) and the history of sent rounds. */
export function mountPanel(A) {
  const fileName = h('span', { class: 'p-file' });
  const tabDraft = h('button', { class: 'tab', onClick: () => setTab('draft') }, tr('작성 중'), h('span', { class: 'n' }));
  const tabSent = h('button', { class: 'tab', onClick: () => setTab('sent') }, tr('보낸 기록'), h('span', { class: 'n' }));

  const deckNote = h('textarea', {
    class: 'ta small',
    rows: 2,
    placeholder: tr('덱 전체에 대한 지시 (선택)\n예: 전체적으로 글자를 키우고 말투를 친근하게'),
  });
  deckNote.addEventListener('input', () => {
    S.deckComment = deckNote.value;
    saveSoon();
    emit('deck');
  });
  deckNote.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      A.send('agent');
    } else if (e.key === 'Escape') {
      deckNote.blur();
    }
  });

  const list = h('div', { class: 'list' });
  const draftBody = h('div', { class: 'p-body' },
    h('div', { class: 'deck-note' }, h('div', { class: 'label' }, icon('sparkle', 13), tr('전체 지시사항')), deckNote),
    list);
  const sentBody = h('div', { class: 'p-body', hidden: true });

  const copyBtn = h('button', { class: 'btn', onClick: () => A.send('clipboard') }, icon('copy', 14), tr('복사'));
  const clearBtn = h('button', { class: 'btn ghost', onClick: () => A.clearAll() }, icon('trash', 14));
  clearBtn.title = tr('작성 중인 표시 모두 지우기');
  const sendBtn = h('button', { class: 'btn red grow', onClick: () => A.send('agent') }, icon('send', 14), tr('AI에게 보내기'));
  const footHint = h('p', { class: 'hint' });
  const foot = h('div', { class: 'p-foot' }, clearBtn, copyBtn, sendBtn, footHint);

  const panel = h('aside', { class: 'panel' },
    h('div', { class: 'p-head' }, icon('pen', 18), h('span', { class: 'p-title' }, tr('빨간펜')), fileName,
      h('button', { class: 'iconbtn', title: tr('닫기 (Esc)'), onClick: () => A.togglePanel(false) }, icon('x', 16))),
    h('div', { class: 'tabs' }, tabDraft, tabSent),
    draftBody, sentBody, foot);
  ui.app.append(panel);

  function setTab(tab) {
    S.panelTab = tab;
    update('all');
  }

  // ---- draft list ----
  function rowText(it) {
    const q = (s, n) => h('span', { class: 'q' }, `“${trunc(s, n)}”`);
    if (it.type === 'layout') {
      const what = it.target === 'element' ? h('span', { class: 'q' }, ` <${it.element?.tag}>${it.element?.text ? ` ${trunc(it.element.text, 24)}` : ''}`) : null;
      return [h('span', { class: 'cm' }, itemSummary(it)), what, it.comment && h('span', { class: 'cm' }, ` — ${trunc(it.comment, 80)}`)];
    }
    if (it.target === 'text') {
      if (it.type === 'delete') return [h('s', null, trunc(it.text.exact, 140)), it.comment && h('span', { class: 'cm' }, ` — ${trunc(it.comment, 80)}`)];
      if (it.type === 'replace') return [h('s', null, trunc(it.text.exact, 60)), h('span', { class: 'to' }, '→'), trunc(it.replacement, 100) || tr('(빈칸)')];
      return [h('span', { class: 'cm' }, trunc(it.comment, 140)), ' ', q(it.text.exact, 40)];
    }
    if (it.target === 'element') {
      const desc = `<${it.element?.tag}>${it.element?.text ? ` ${trunc(it.element.text, 30)}` : ''}`;
      return it.type === 'comment' ? [h('span', { class: 'cm' }, trunc(it.comment, 140)), ' ', h('span', { class: 'q' }, desc)] : [h('s', null, desc), it.comment && h('span', { class: 'cm' }, ` — ${trunc(it.comment, 80)}`)];
    }
    if (it.target === 'region') return [h('span', { class: 'cm' }, trunc(it.comment, 140)), ' ', h('span', { class: 'q' }, `(${it.region?.where || tr('영역')})`)];
    if (it.target === 'slide') return it.type === 'delete' ? [h('s', null, tr('이 슬라이드 전체')), it.comment && h('span', { class: 'cm' }, ` — ${trunc(it.comment, 80)}`)] : [h('span', { class: 'cm' }, trunc(it.comment, 160))];
    return [];
  }

  function renderList() {
    const items = ordered();
    const nums = numbering();
    if (!items.length) {
      list.replaceChildren(h('div', { class: 'empty' },
        h('h4', null, tr('고칠 곳을 화면에 바로 표시하세요')),
        h('ul', null,
          h('li', null, rich(tr('**텍스트** — 드래그하면 메뉴가 떠요. [[D]] 삭제 · [[R]] 수정 · [[C]] 코멘트'))),
          h('li', null, rich(tr('**레이아웃** — 클릭해 선택 → 끌어서 이동·순서 바꾸기, 모서리로 크기, 글자·간격·여백 조절'))),
          h('li', null, rich(tr('**영역** — 빈 곳에 범위를 그려 "여기에 그림 추가" 같은 지시'))),
          h('li', null, rich(tr('**슬라이드** — 툴바의 슬라이드 메뉴로 코멘트·삭제·순서 옮기기, 새 배치 스케치'))),
          h('li', null, rich(tr('다 표시했으면 **AI에게 보내기** ({key})', { key: `${MOD}+Enter` })))),
      ));
      return;
    }
    const groups = new Map();
    for (const it of items) {
      const key = it.slide && !it.slide.single && Number.isInteger(it.slide.index) ? it.slide.index : -1;
      const identity = JSON.stringify([key, it.slide?.id, it.slide?.title, !!it._slideMissing]);
      if (!groups.has(identity)) groups.set(identity, []);
      groups.get(identity).push(it);
    }
    const out = [];
    for (const group of groups.values()) {
      const s = group[0].slide;
      const key = s && !s.single && Number.isInteger(s.index) ? s.index : -1;
      const missing = group[0]._slideMissing;
      out.push(h('div', { class: 'group' },
        h('div', { class: 'g-head', title: tr('이 슬라이드로 이동'), onClick: () => !missing && key >= 0 && A.goToSlide(key) },
          key >= 0 ? tr(missing ? '원래 슬라이드 {n}' : '슬라이드 {n}', { n: key + 1 }) : tr('페이지'),
          s?.title && h('span', { class: 't' }, `· ${trunc(s.title, 36)}`)),
        group.map((it) => {
          const row = h('div', {
            class: `row t-${it.type}${S.focusId === it.id ? ' focus' : ''}`,
            onClick: () => A.focusItem(it.id),
            onMouseenter: () => { S.focusId = it.id; A.onFocusChange(); },
            onMouseleave: () => { if (S.focusId === it.id) S.focusId = null; A.onFocusChange(); },
          },
          h('span', { class: 'num' }, String(nums.get(it.id))),
          h('div', { class: 'r-main' },
            h('div', { class: 'r-type' }, icon(TYPE_ICON[it.type], 12), tr(TYPE_LABEL[it.type]),
              it.target !== 'text' && h('span', null, `· ${tr(TARGET_LABEL[it.target])}`),
              it._orphan && h('span', { class: 'warn' }, `· ${tr(it._slideMissing ? '대상 슬라이드 확인 필요' : '위치 못 찾음')}`)),
            h('div', { class: 'r-text' }, rowText(it))),
          h('button', {
            class: 'r-del',
            title: tr('표시 지우기'),
            onClick: (e) => { e.stopPropagation(); A.removeItem(it.id); },
          }, icon('x', 14)));
          row.dataset.id = it.id;
          return row;
        })));
    }
    list.replaceChildren(...out);
  }

  // ---- history ----
  function roundStatus(r) {
    if (r.replies?.length) return ['applied', tr('반영 완료')];
    if (r.delivered?.via === 'clipboard') return ['', tr('복사함')];
    if (r.delivered) return ['working', tr('AI 반영 중')];
    return ['queued', tr('전달 대기')];
  }

  function renderSent() {
    const rounds = [...S.rounds].reverse();
    if (!rounds.length) {
      sentBody.replaceChildren(h('div', { class: 'empty' }, h('h4', null, tr('아직 보낸 수정 요청이 없어요')), tr('보낸 요청과 AI의 답장이 여기에 쌓여요.')));
      return;
    }
    sentBody.replaceChildren(...rounds.map((r) => {
      const [cls, label] = roundStatus(r);
      const counts = Object.entries(r.counts || {}).filter(([, v]) => v).map(([k, v]) => `${tr(TYPE_LABEL[k])} ${v}`).join(' · ');
      return h('div', { class: 'round' },
        h('div', { class: 'round-head' },
          h('span', { class: 'round-title' }, tr('{n}차', { n: r.round })),
          h('span', { class: 'round-meta' }, `${timeLabel(r.createdAt)} · ${counts || tr('전체 지시')}`),
          h('span', { class: `status ${cls}` }, label)),
        r.deckComment && h('div', { class: 'round-meta', style: { marginTop: '6px' } }, `📌 ${r.deckComment}`),
        h('ul', { class: 'round-items' }, (r.items || []).slice(0, 6).map((it) => h('li', { class: `t-${it.type}` },
          h('span', { class: 'num' }, String(it.n || '')),
          h('span', null, `${it.slide ? `S${it.slide} · ` : ''}${it.type === 'replace' ? `${it.text} → ${it.replacement}` : it.comment || it.text || tr(TARGET_LABEL[it.target])}`)))),
        (r.items || []).length > 6 && h('div', { class: 'round-meta' }, tr('… 외 {n}개', { n: (r.items || []).length - 6 })),
        (r.replies || []).map((rep) => h('div', { class: 'reply' }, h('div', { class: 'who' }, icon('bot', 12), `AI · ${timeLabel(rep.at)}`), rep.message)),
        h('div', { class: 'round-actions' },
          h('button', { class: 'btn', onClick: () => A.viewRound(r.round) }, icon('eye', 13), tr('프롬프트 보기')),
          h('button', { class: 'btn', onClick: () => A.copyRound(r.round) }, icon('copy', 13), tr('복사'))));
    }));
  }

  function update(kind = 'all') {
    panel.classList.toggle('open', S.panelOpen);
    const n = S.items.length + (S.deckComment.trim() ? 1 : 0);
    tabDraft.classList.toggle('on', S.panelTab === 'draft');
    tabSent.classList.toggle('on', S.panelTab === 'sent');
    tabDraft.lastChild.textContent = n ? ` ${n}` : '';
    tabSent.lastChild.textContent = S.rounds.length ? ` ${S.rounds.length}` : '';
    draftBody.hidden = S.panelTab !== 'draft';
    sentBody.hidden = S.panelTab !== 'sent';
    foot.style.display = S.panelTab === 'draft' ? '' : 'none';
    if (activeInUI() !== deckNote && deckNote.value !== S.deckComment) deckNote.value = S.deckComment;
    if (kind !== 'deck' && kind !== 'focus') renderList();
    if (kind === 'focus') {
      for (const row of list.querySelectorAll('.row')) row.classList.toggle('focus', row.dataset.id === S.focusId);
    }
    if (kind === 'all' || kind === 'rounds') renderSent();
    copyBtn.disabled = !n;
    sendBtn.disabled = !n;
    const status = S.agent?.status;
    footHint.textContent = tr(status === 'waiting' ? '✅ AI 세션이 기다리는 중 — 보내면 바로 반영돼요.'
      : status === 'working' ? '⏳ AI가 이전 요청을 반영하는 중이에요. 보내면 다음 차례로 전달돼요.'
        : 'AI 세션이 기다리지 않아도 저장돼요. 복사는 다른 AI 채팅에 붙여넣을 때 사용하세요.');
  }

  function setFile(name) {
    fileName.textContent = name;
  }

  return { update, setFile, el: panel, focusDeckNote: () => deckNote.focus() };
}
