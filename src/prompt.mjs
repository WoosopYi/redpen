/*
 * Render submitted review rounds as a prompt an AI agent can apply without guessing:
 * slide number + title, exact text, surrounding context, DOM path and source file:line hints.
 */

const TYPE = {
  delete: { icon: '🗑', ko: '삭제' },
  replace: { icon: '✏️', ko: '수정' },
  comment: { icon: '💬', ko: '코멘트' },
  layout: { icon: '📐', ko: '레이아웃' },
};

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const pct = (v) => Math.round((Number(v) || 0) * 100);

/** Inline code span that survives backticks inside the text. */
function code(s) {
  s = String(s ?? '').replace(/\s*\n\s*/g, ' ');
  const longest = (s.match(/`+/g) || []).reduce((m, t) => Math.max(m, t.length), 0);
  const fence = '`'.repeat(longest + 1);
  const pad = longest || s.startsWith('`') || s.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${s}${pad}${fence}`;
}

function clip(s, max = 400) {
  s = norm(s);
  if (s.length <= max) return s;
  const half = Math.floor((max - 24) / 2);
  return `${s.slice(0, half)} …(중략, 총 ${s.length}자)… ${s.slice(-half)}`;
}

const quote = (s, indent = '') => String(s).trim().split('\n').map((l) => `${indent}> ${l}`).join('\n');

/** Short label: cut at the end with an ellipsis (clip() keeps both ends for long quoted text). */
function short(s, max) {
  s = norm(s);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function where({ x = 0, y = 0, w = 0, h = 0 } = {}) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const H = cx < 0.36 ? '왼쪽' : cx > 0.64 ? '오른쪽' : '가운데';
  const V = cy < 0.36 ? '위' : cy > 0.64 ? '아래' : '가운데';
  if (H === '가운데' && V === '가운데') return '가운데';
  if (H === '가운데') return V === '위' ? '위쪽 가운데' : '아래쪽 가운데';
  if (V === '가운데') return `${H} 가운데`;
  return `${H} ${V}`;
}

function context(t) {
  const pre = String(t.prefix || '').replace(/\s+/g, ' ').slice(-40).replace(/^\s+/, '');
  const suf = String(t.suffix || '').replace(/\s+/g, ' ').slice(0, 40).replace(/\s+$/, '');
  if (!pre.trim() && !suf.trim()) return '';
  return `${pre.trim() ? `…${pre}` : ''}⟦${clip(t.exact, 60)}⟧${suf.trim() ? `${suf}…` : ''}`;
}

function loc(h) {
  return code(`${h.file}:${h.line}${h.endLine && h.endLine !== h.line ? `-${h.endLine}` : ''}`);
}

export function formatSource(src) {
  if (!src) return '';
  if (!src.total) return '소스: 원문 그대로는 못 찾음 (JS로 조합됐거나 태그로 쪼개진 텍스트일 수 있음 — 문맥으로 찾아 주세요)';
  if (src.status === 'exact') return `소스: ${loc(src.hits[0])}`;
  if (src.status === 'guess') return `소스: ${loc(src.hits[src.pick])} (같은 문구 ${src.total}곳 중 ${src.pick + 1}번째로 추정)`;
  const shown = src.hits.slice(0, 6);
  const more = src.total > shown.length ? ` 외 ${src.total - shown.length}곳` : '';
  return `소스 후보: ${shown.map(loc).join(', ')}${more} — 같은 문구가 여러 곳에 있으니 문맥으로 고르세요`;
}

function summary(items, deckComment) {
  const c = { delete: 0, replace: 0, comment: 0, layout: 0 };
  for (const it of items) c[it.type] = (c[it.type] || 0) + 1;
  const parts = Object.entries(c).filter(([, v]) => v).map(([k, v]) => `${TYPE[k].icon} ${TYPE[k].ko} ${v}`);
  if (norm(deckComment)) parts.push('📌 전체 지시 1');
  return parts.join(' · ');
}

function itemTitle(it) {
  const tag = code(`<${it.element?.tag || '?'}>`);
  switch (`${it.type}:${it.target}`) {
    case 'delete:text': return '텍스트 삭제';
    case 'delete:element': return `요소 삭제 ${tag}`;
    case 'delete:slide': return '슬라이드 통째로 삭제';
    case 'replace:text': return '텍스트 수정';
    case 'comment:text': return '코멘트 · 텍스트';
    case 'comment:element': return `코멘트 · 요소 ${tag}`;
    case 'comment:region': return '코멘트 · 영역';
    case 'comment:slide': return '코멘트 · 슬라이드 전체';
    case 'layout:element': return `레이아웃 변경 · 요소 ${tag}`;
    case 'layout:sketch': return '새 배치 스케치';
    case 'layout:slide': return '슬라이드 순서 옮기기';
    default: return `${TYPE[it.type]?.ko || it.type} · ${it.target}`;
  }
}

const span = (a, b) => `${pct(a)}–${pct(a + b)}%`;
const boxText = (f) => `가로 ${span(f.x, f.w)}, 세로 ${span(f.y, f.h)}`;
const px = (list) => (list.every((v) => v === list[0]) ? `${list[0]}px` : `${list.join(' ')}px`);
const dirKo = (d) => (String(d).startsWith('column') ? '세로로 쌓기(column)' : '가로로 늘어놓기(row)');

function parentKo(p) {
  if (!p) return '';
  const sel = String(p.selector || p.tag).split(' > ').slice(-2).join(' > ');
  const how = /grid/.test(p.display) ? `grid · ${p.columns || '?'}열`
    : /flex/.test(p.display) ? `flex · ${String(p.direction).startsWith('column') ? '세로' : '가로'}`
      : p.display;
  return `${code(sel)} (${how})`;
}

function renderLayout(it) {
  const L = it.layout || {};
  const E = it.element || {};
  const lines = [`- 대상: ${code(E.startTag || `<${E.tag}>`)}${E.text ? ` — 내용: "${short(E.text, 80)}"` : ''}`];
  const ctx = L.ctx || {};
  const where_ = ctx.parent && ctx.index >= 0 ? ` · ${parentKo(ctx.parent)} 안의 ${ctx.index + 1}번째 칸 (전체 ${ctx.parent.count}칸)` : '';
  if (L.from) lines.push(`- 지금: 슬라이드 ${where(L.from)} (${boxText(L.from)})${where_}`);
  lines.push('- 바꿀 것:');
  if (L.reorder) {
    const r = L.reorder;
    const near = r.before ? ` — ${r.before} 앞으로` : r.after ? ` — ${r.after} 뒤로` : '';
    lines.push(`  - 순서: ${r.from + 1}번째 → ${r.to + 1}번째${near}`);
  }
  const moved = L.to && L.from && ['x', 'y', 'w', 'h'].some((k) => Math.abs(L.to[k] - L.from[k]) > 0.002);
  if (moved) {
    // with a new order the position follows from the order itself — only sizes matter here
    if (!L.reorder && (Math.abs(L.to.x - L.from.x) > 0.005 || Math.abs(L.to.y - L.from.y) > 0.005)) {
      lines.push(`  - 위치: 슬라이드 ${where(L.to)}로 옮기기 → ${boxText(L.to)}`);
    }
    const ratio = L.to.w / (L.from.w || 1);
    if (L.fit === 'box') {
      lines.push(`  - 상자 크기: 너비 ${pct(L.from.w)}% → ${pct(L.to.w)}%, 높이 ${pct(L.from.h)}% → ${pct(L.to.h)}% (글자 크기는 그대로, 바뀐 상자에 맞춰 다시 배치)`);
    } else if (Math.abs(ratio - 1) > 0.01) {
      lines.push(`  - 크기: ${pct(ratio)}%로 ${ratio > 1 ? '키우기' : '줄이기'} — 비율 유지 (너비 ${pct(L.from.w)}% → ${pct(L.to.w)}%)`);
    }
    if (L.snaps?.length) lines.push(`  - 맞춤: ${L.snaps.join(', ')}`);
  }
  if (L.font) lines.push(`  - 글자 크기: ${L.font.from}px → ${L.font.to}px (${L.font.to > L.font.from ? '+' : ''}${pct(L.font.to / L.font.from - 1)}%)`);
  if (L.gap) lines.push(`  - 안쪽 요소 사이 간격(gap): ${L.gap.from}px → ${L.gap.to}px`);
  if (L.padding) lines.push(`  - 안쪽 여백(padding): ${px(L.padding.from)} → ${px(L.padding.to)}`);
  if (L.direction) lines.push(`  - 안쪽 요소 배치: ${dirKo(L.direction.from)} → ${dirKo(L.direction.to)}`);
  if (L.columns) lines.push(`  - 열 수: ${L.columns.from}열 → ${L.columns.to}열`);
  return lines;
}

function renderSketch(it) {
  const boxes = it.sketch?.boxes || [];
  const lines = ['- 이 슬라이드를 아래 칸 배치(와이어프레임)대로 다시 구성하세요. 번호는 읽는 순서입니다.'];
  boxes.forEach((b, i) => {
    const now = (b.inside || []).map((o) => `${code(`<${o.tag}>`)}${o.text ? ` "${short(o.text, 30)}"` : ''}`).join(', ');
    lines.push(`  ${i + 1}. ${b.label ? `"${clip(b.label, 80)}"` : '(이름 없는 칸)'} — ${b.where || where(b)} (${boxText(b)}) · 지금 그 자리: ${now || '빈 공간'}`);
  });
  return lines;
}

function renderSlideMove(it) {
  const m = it.move;
  const near = m.before ? ` — 지금의 「${clip(m.before, 40)}」 앞` : m.after ? ` — 맨 끝 (「${clip(m.after, 40)}」 뒤)` : '';
  return [`- 이 슬라이드를 **${m.to + 1}번째**로 옮기세요 (지금 ${m.from + 1}번째, 전체 ${m.total}장${near}).`];
}

function renderItem(it) {
  const T = TYPE[it.type] || TYPE.comment;
  const L = [`### ${it.n ? `#${it.n} ` : ''}${T.icon} ${itemTitle(it)}`];
  const note = String(it.comment || '').trim();
  const pushNote = (label) => {
    if (!note) return;
    if (note.includes('\n')) L.push(`- **${label}:**`, quote(note, '  '));
    else L.push(`- **${label}:** ${note}`);
  };

  if (it.orphan) L.push('- ⚠️ 표시한 위치를 현재 화면에서 다시 찾지 못했습니다. 원문·문맥으로 찾아 주세요.');
  if (it.type === 'comment') pushNote('지시');
  if (it.type === 'layout') {
    if (it.target === 'element') L.push(...renderLayout(it));
    else if (it.target === 'sketch') L.push(...renderSketch(it));
    else if (it.target === 'slide' && it.move) L.push(...renderSlideMove(it));
    if (it.target === 'slide' && it.slide?.startTag) L.push(`- 슬라이드 요소: ${code(it.slide.startTag)}`);
    pushNote('메모');
    const dom = it.element?.selector;
    const src = formatSource(it.source);
    const at = [dom && `DOM ${code(dom)}`, src].filter(Boolean);
    if (at.length) L.push(`- 위치: ${at.join(' · ')}`);
    return L.join('\n');
  }

  if (it.target === 'text' && it.text) {
    L.push(`- 원문: ${code(clip(it.text.exact))}${it.text.spans ? ' (여러 태그에 걸친 선택)' : ''}`);
    if (it.type === 'replace') L.push(`- 변경: ${code(clip(it.replacement ?? '', 2000))}`);
    const ctx = context(it.text);
    if (ctx) L.push(`- 문맥: ${ctx}`);
  }
  if (it.target === 'element' && it.element) {
    const E = it.element;
    L.push(`- 대상: ${code(E.startTag || `<${E.tag}>`)}${E.text ? ` — 내용: "${short(E.text, 80)}"` : ''}`);
    if (E.box) L.push(`- 위치·크기: 슬라이드 ${where(E.box)}, 너비 ${pct(E.box.w)}% × 높이 ${pct(E.box.h)}%`);
  }
  if (it.target === 'region' && it.region) {
    const g = it.region;
    L.push(`- 영역: 슬라이드 ${g.where || where(g)} (가로 ${pct(g.x)}–${pct(g.x + g.w)}%, 세로 ${pct(g.y)}–${pct(g.y + g.h)}%)`);
    const inside = (g.overlaps || []).map((o) => `${code(`<${o.tag}>`)}${o.text ? ` "${short(o.text, 40)}"` : ''}`);
    L.push(`- 영역 안 요소: ${inside.length ? inside.join(', ') : '없음 (빈 공간)'}`);
  }
  if (it.target === 'slide') {
    if (it.type === 'delete') L.push('- 이 슬라이드 전체를 지우세요.');
    if (it.slide?.startTag) L.push(`- 슬라이드 요소: ${code(it.slide.startTag)}`);
  }
  if (it.type !== 'comment') pushNote('메모');

  const where_ = [];
  const dom = it.selector || it.element?.selector;
  if (dom) where_.push(`DOM ${code(dom)}`);
  const src = formatSource(it.source);
  if (src) where_.push(src);
  if (where_.length) L.push(`- 위치: ${where_.join(' · ')}`);
  return L.join('\n');
}

const RULES = `## 반영 규칙
1. 🗑 **삭제** — 표시된 텍스트·요소·슬라이드만 지웁니다. 지운 뒤 비게 되는 태그(빈 \`<li>\`·\`<p>\`·\`<div>\` 등)와 어색하게 남는 구두점·공백도 정리하세요.
2. ✏️ **수정** — \`원문\`을 \`변경\`으로 바꿉니다. 굵게·링크 같은 주변 서식은 유지하세요.
3. 💬 **코멘트** — **지시**를 해석해 반영합니다. 대상(텍스트·요소·영역·슬라이드)과 위치를 기준으로 판단하세요.
4. 같은 문구가 여러 곳에 있으면 슬라이드 번호·문맥(⟦ ⟧ 안이 표시한 부분)·소스 위치로 정확한 곳을 고르세요. 슬라이드 번호와 소스 행은 모두 **편집 전** 기준입니다.
5. 📐 **레이아웃** — 사람이 화면에서 직접 옮기고·키우고·순서를 바꿔 본 결과입니다. 그 모습이 되도록 HTML/CSS를 고치되, \`translate\`·절대 좌표로 흉내 내기보다 원래 방식(flex·grid·요소 순서·여백·글자 크기)에 맞게 구조를 바꾸세요. %·px 수치는 목표값 참고용입니다. **새 배치 스케치**는 칸의 위치·비율대로 슬라이드를 다시 구성하라는 뜻입니다.
6. 요청하지 않은 부분은 바꾸지 마세요. 지시가 모호하면 가장 합리적으로 해석하고, 결과 보고에 그 해석을 적으세요.`;

function renderRound(r, { rules }) {
  const items = r.items || [];
  const deck = r.deck || {};
  const L = [`# ✒️ 빨간펜 수정 요청 · ${r.round}차`, ''];
  L.push(`- 대상 파일: ${code(deck.path || '')}`);
  if (deck.sourceFiles?.length > 1) L.push(`- 내용이 들어 있는 소스: ${deck.sourceFiles.slice(0, 8).map(code).join(', ')}`);
  if (deck.slideSelector) {
    L.push(`- 슬라이드 번호 기준: 문서 순서상 ${code(deck.slideSelector)} 요소 (총 ${deck.slideCount}장) — "슬라이드 N"은 N번째 요소`);
  }
  L.push(`- 요청: ${summary(items, r.deckComment)}`);
  if (rules) L.push('', RULES);

  if (norm(r.deckComment)) L.push('', '## 📌 전체 지시사항', '', quote(r.deckComment));

  const groups = new Map();
  for (const it of items) {
    const key = it.slide && !it.slide.single && Number.isInteger(it.slide.index) ? it.slide.index : -1;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  for (const [key, list] of [...groups].sort((a, b) => a[0] - b[0])) {
    const s = list[0].slide;
    L.push('');
    if (key === -1) L.push('## 페이지');
    else L.push(`## 슬라이드 ${key + 1}${s?.title ? ` · 「${clip(s.title, 60)}」` : ''}`);
    const hint = r.slideSources?.[key];
    if (hint?.total) L.push(`슬라이드 위치 참고: ${hint.hits.slice(0, 3).map(loc).join(', ')} 부근`);
    for (const it of list) L.push('', renderItem(it));
  }
  return L.join('\n');
}

function renderTail(channel, deckPath) {
  const p = JSON.stringify(deckPath || '');
  const reply = '--reply "<무엇을 바꿨는지 1~3문장 · 못 한 항목은 이유>"';
  if (channel === 'wait') {
    return [
      '## 반영한 뒤',
      `1. 결과를 알리고 다음 피드백을 기다리세요: \`redpen wait ${p} ${reply}\``,
      '   (Claude Code는 run_in_background로 실행 — 사용자가 다시 보내면 완료 알림이 옵니다)',
      `2. 사용자가 리뷰를 끝내자고 하면 대신: \`redpen done ${p} ${reply}\``,
    ].join('\n');
  }
  if (channel === 'pending' || channel === 'file') {
    return ['## 반영한 뒤', `결과를 브라우저에 알려 주세요: \`redpen done ${p} ${reply}\``].join('\n');
  }
  return '반영한 뒤 무엇을 바꿨는지 짧게 요약해 주세요.';
}

/**
 * @param {object[]} rounds  round records from the store
 * @param {{channel?: 'wait'|'pending'|'file'|'clipboard'}} opts  how the prompt reaches the AI (changes the closing instructions)
 */
export function renderRounds(rounds, { channel = 'file' } = {}) {
  if (!rounds?.length) return '';
  const parts = rounds.map((r, i) => renderRound(r, { rules: i === 0 }));
  parts.push(renderTail(channel, rounds[0].deck?.path));
  return `${parts.join('\n\n---\n\n').trim()}\n`;
}
