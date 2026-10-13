/*
 * Render submitted review rounds as a prompt an AI agent can apply without guessing:
 * slide number + title, exact text, surrounding context, DOM path and source file:line hints.
 */
import { tr, pick, withLang } from './client/i18n/index.js';
import { where } from './client/summary.js';

export { where };

const TYPE = {
  delete: { icon: '🗑', label: '삭제' },
  replace: { icon: '✏️', label: '수정' },
  comment: { icon: '💬', label: '코멘트' },
  layout: { icon: '📐', label: '레이아웃' },
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
  return `${s.slice(0, half)} ${tr('…(중략, 총 {n}자)…', { n: s.length })} ${s.slice(-half)}`;
}

const quote = (s, indent = '') => String(s).trim().split('\n').map((l) => `${indent}> ${l}`).join('\n');

/** Short label: cut at the end with an ellipsis (clip() keeps both ends for long quoted text). */
function short(s, max) {
  s = norm(s);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
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
  if (!src.total) return tr('소스: 원문 그대로는 못 찾음 (JS로 조합됐거나 태그로 쪼개진 텍스트일 수 있음 — 문맥으로 찾아 주세요)');
  if (src.status === 'exact') return tr('소스: {loc}', { loc: loc(src.hits[0]) });
  if (src.status === 'guess') return tr('소스: {loc} (같은 문구 {total}곳 중 {n}번째로 추정)', { loc: loc(src.hits[src.pick]), total: src.total, n: src.pick + 1 });
  const shown = src.hits.slice(0, 6);
  const list = shown.map(loc).join(', ');
  return src.total > shown.length
    ? tr('소스 후보: {list} 외 {more}곳 — 같은 문구가 여러 곳에 있으니 문맥으로 고르세요', { list, more: src.total - shown.length })
    : tr('소스 후보: {list} — 같은 문구가 여러 곳에 있으니 문맥으로 고르세요', { list });
}

function summary(items, deckComment) {
  const c = { delete: 0, replace: 0, comment: 0, layout: 0 };
  for (const it of items) c[it.type] = (c[it.type] || 0) + 1;
  const parts = Object.entries(c).filter(([, v]) => v).map(([k, v]) => `${TYPE[k].icon} ${tr(TYPE[k].label)} ${v}`);
  if (norm(deckComment)) parts.push(`📌 ${tr('전체 지시')} 1`);
  return parts.join(' · ');
}

function itemTitle(it) {
  const tag = code(`<${it.element?.tag || '?'}>`);
  switch (`${it.type}:${it.target}`) {
    case 'delete:text': return tr('텍스트 삭제');
    case 'delete:element': return tr('요소 삭제 {tag}', { tag });
    case 'delete:slide': return tr('슬라이드 통째로 삭제');
    case 'replace:text': return tr('텍스트 수정');
    case 'comment:text': return tr('코멘트 · 텍스트');
    case 'comment:element': return tr('코멘트 · 요소 {tag}', { tag });
    case 'comment:region': return tr('코멘트 · 영역');
    case 'comment:slide': return tr('코멘트 · 슬라이드 전체');
    case 'layout:element': return tr('레이아웃 변경 · 요소 {tag}', { tag });
    case 'layout:sketch': return tr('새 배치 스케치');
    case 'layout:slide': return tr('슬라이드 순서 옮기기');
    default: return `${TYPE[it.type] ? tr(TYPE[it.type].label) : it.type} · ${it.target}`;
  }
}

const span = (a, b) => `${pct(a)}–${pct(a + b)}%`;
const boxText = (f) => tr('가로 {x}, 세로 {y}', { x: span(f.x, f.w), y: span(f.y, f.h) });
const px = (list) => (list.every((v) => v === list[0]) ? `${list[0]}px` : `${list.join(' ')}px`);
const dirText = (d) => tr(String(d).startsWith('column') ? '세로로 쌓기(column)' : '가로로 늘어놓기(row)');

function parentText(p) {
  if (!p) return '';
  const sel = String(p.selector || p.tag).split(' > ').slice(-2).join(' > ');
  const how = /grid/.test(p.display) ? tr('grid · {n}열', { n: p.columns || '?' })
    : /flex/.test(p.display) ? tr(String(p.direction).startsWith('column') ? 'flex · 세로' : 'flex · 가로')
      : p.display;
  return `${code(sel)} (${how})`;
}

/** `- 대상: <tag> — 내용: "…"` line shared by element and layout items. */
function targetLine(E) {
  const tag = code(E.startTag || `<${E.tag}>`);
  return E.text ? tr('- 대상: {tag} — 내용: "{text}"', { tag, text: short(E.text, 80) }) : tr('- 대상: {tag}', { tag });
}

function renderLayout(it) {
  const L = it.layout || {};
  const E = it.element || {};
  const lines = [targetLine(E)];
  const ctx = L.ctx || {};
  const slot = ctx.parent && ctx.index >= 0
    ? ` · ${tr('{parent} 안의 {n}번째 칸 (전체 {count}칸)', { parent: parentText(ctx.parent), n: ctx.index + 1, count: ctx.parent.count })}` : '';
  if (L.from) lines.push(`${tr('- 지금: 슬라이드 {where} ({box})', { where: where(L.from), box: boxText(L.from) })}${slot}`);
  lines.push(tr('- 바꿀 것:'));
  if (L.reorder) {
    const r = L.reorder;
    const near = r.before ? tr(' — {name} 앞으로', { name: r.before }) : r.after ? tr(' — {name} 뒤로', { name: r.after }) : '';
    lines.push(`  - ${tr('순서: {from}번째 → {to}번째', { from: r.from + 1, to: r.to + 1 })}${near}`);
  }
  const moved = L.to && L.from && ['x', 'y', 'w', 'h'].some((k) => Math.abs(L.to[k] - L.from[k]) > 0.002);
  if (moved) {
    // with a new order the position follows from the order itself — only sizes matter here
    if (!L.reorder && (Math.abs(L.to.x - L.from.x) > 0.005 || Math.abs(L.to.y - L.from.y) > 0.005)) {
      lines.push(`  - ${tr('위치: 슬라이드 {where}로 옮기기 → {box}', { where: where(L.to), box: boxText(L.to) })}`);
    }
    const ratio = L.to.w / (L.from.w || 1);
    if (L.fit === 'box') {
      lines.push(`  - ${tr('상자 크기: 너비 {w0}% → {w1}%, 높이 {h0}% → {h1}% (글자 크기는 그대로, 바뀐 상자에 맞춰 다시 배치)', { w0: pct(L.from.w), w1: pct(L.to.w), h0: pct(L.from.h), h1: pct(L.to.h) })}`);
    } else if (Math.abs(ratio - 1) > 0.01) {
      const size = { n: pct(ratio), w0: pct(L.from.w), w1: pct(L.to.w) };
      lines.push(`  - ${tr(ratio > 1 ? '크기: {n}%로 키우기 — 비율 유지 (너비 {w0}% → {w1}%)' : '크기: {n}%로 줄이기 — 비율 유지 (너비 {w0}% → {w1}%)', size)}`);
    }
    if (L.snaps?.length) lines.push(`  - ${tr('맞춤: {list}', { list: L.snaps.join(', ') })}`);
  }
  if (L.font) {
    const change = `${L.font.to > L.font.from ? '+' : ''}${pct(L.font.to / L.font.from - 1)}`;
    lines.push(`  - ${tr('글자 크기: {from}px → {to}px ({change}%)', { from: L.font.from, to: L.font.to, change })}`);
  }
  if (L.gap) lines.push(`  - ${tr('안쪽 요소 사이 간격(gap): {from}px → {to}px', { from: L.gap.from, to: L.gap.to })}`);
  if (L.padding) lines.push(`  - ${tr('안쪽 여백(padding): {from} → {to}', { from: px(L.padding.from), to: px(L.padding.to) })}`);
  if (L.direction) lines.push(`  - ${tr('안쪽 요소 배치: {from} → {to}', { from: dirText(L.direction.from), to: dirText(L.direction.to) })}`);
  if (L.columns) lines.push(`  - ${tr('열 수: {from}열 → {to}열', { from: L.columns.from, to: L.columns.to })}`);
  return lines;
}

function renderSketch(it) {
  const boxes = it.sketch?.boxes || [];
  const lines = [tr('- 이 슬라이드를 아래 칸 배치(와이어프레임)대로 다시 구성하세요. 번호는 읽는 순서입니다.')];
  boxes.forEach((b, i) => {
    const now = (b.inside || []).map((o) => `${code(`<${o.tag}>`)}${o.text ? ` "${short(o.text, 30)}"` : ''}`).join(', ');
    const name = b.label ? `"${clip(b.label, 80)}"` : tr('(이름 없는 칸)');
    lines.push(`  ${i + 1}. ${name} — ${b.where || where(b)} (${boxText(b)}) · ${tr('지금 그 자리: {now}', { now: now || tr('빈 공간') })}`);
  });
  return lines;
}

function renderSlideMove(it) {
  const m = it.move;
  const near = m.before ? tr(' — 지금의 「{name}」 앞', { name: clip(m.before, 40) }) : m.after ? tr(' — 맨 끝 (「{name}」 뒤)', { name: clip(m.after, 40) }) : '';
  return [tr('- 이 슬라이드를 **{to}번째**로 옮기세요 (지금 {from}번째, 전체 {total}장{near}).', { to: m.to + 1, from: m.from + 1, total: m.total, near })];
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

  if (it.orphan) L.push(tr('- ⚠️ 표시한 위치를 현재 화면에서 다시 찾지 못했습니다. 원문·문맥으로 찾아 주세요.'));
  if (it.type === 'comment') pushNote(tr('지시'));
  if (it.type === 'layout') {
    if (it.target === 'element') L.push(...renderLayout(it));
    else if (it.target === 'sketch') L.push(...renderSketch(it));
    else if (it.target === 'slide' && it.move) L.push(...renderSlideMove(it));
    if (it.target === 'slide' && it.slide?.startTag) L.push(tr('- 슬라이드 요소: {tag}', { tag: code(it.slide.startTag) }));
    pushNote(tr('메모'));
    const dom = it.element?.selector;
    const src = formatSource(it.source);
    const at = [dom && `DOM ${code(dom)}`, src].filter(Boolean);
    if (at.length) L.push(tr('- 위치: {at}', { at: at.join(' · ') }));
    return L.join('\n');
  }

  if (it.target === 'text' && it.text) {
    L.push(`${tr('- 원문: {text}', { text: code(clip(it.text.exact)) })}${it.text.spans ? tr(' (여러 태그에 걸친 선택)') : ''}`);
    if (it.type === 'replace') L.push(tr('- 변경: {text}', { text: code(clip(it.replacement ?? '', 2000)) }));
    const ctx = context(it.text);
    if (ctx) L.push(tr('- 문맥: {ctx}', { ctx }));
  }
  if (it.target === 'element' && it.element) {
    const E = it.element;
    L.push(targetLine(E));
    if (E.box) L.push(tr('- 위치·크기: 슬라이드 {where}, 너비 {w}% × 높이 {h}%', { where: where(E.box), w: pct(E.box.w), h: pct(E.box.h) }));
  }
  if (it.target === 'region' && it.region) {
    const g = it.region;
    L.push(tr('- 영역: 슬라이드 {where} ({box})', { where: g.where || where(g), box: boxText(g) }));
    const inside = (g.overlaps || []).map((o) => `${code(`<${o.tag}>`)}${o.text ? ` "${short(o.text, 40)}"` : ''}`);
    L.push(tr('- 영역 안 요소: {list}', { list: inside.length ? inside.join(', ') : tr('없음 (빈 공간)') }));
  }
  if (it.target === 'slide') {
    if (it.type === 'delete') L.push(tr('- 이 슬라이드 전체를 지우세요.'));
    if (it.slide?.startTag) L.push(tr('- 슬라이드 요소: {tag}', { tag: code(it.slide.startTag) }));
  }
  if (it.type !== 'comment') pushNote(tr('메모'));

  const at = [];
  const dom = it.selector || it.element?.selector;
  if (dom) at.push(`DOM ${code(dom)}`);
  const src = formatSource(it.source);
  if (src) at.push(src);
  if (at.length) L.push(tr('- 위치: {at}', { at: at.join(' · ') }));
  return L.join('\n');
}

const RULES = {
  ko: `## 반영 규칙
1. 🗑 **삭제** — 표시된 텍스트·요소·슬라이드만 지웁니다. 지운 뒤 비게 되는 태그(빈 \`<li>\`·\`<p>\`·\`<div>\` 등)와 어색하게 남는 구두점·공백도 정리하세요.
2. ✏️ **수정** — \`원문\`을 \`변경\`으로 바꿉니다. 굵게·링크 같은 주변 서식은 유지하세요.
3. 💬 **코멘트** — **지시**를 해석해 반영합니다. 대상(텍스트·요소·영역·슬라이드)과 위치를 기준으로 판단하세요.
4. 같은 문구가 여러 곳에 있으면 슬라이드 번호·문맥(⟦ ⟧ 안이 표시한 부분)·소스 위치로 정확한 곳을 고르세요. 슬라이드 번호와 소스 행은 모두 **편집 전** 기준입니다.
5. 📐 **레이아웃** — 사람이 화면에서 직접 옮기고·키우고·순서를 바꿔 본 결과입니다. 그 모습이 되도록 HTML/CSS를 고치되, \`translate\`·절대 좌표로 흉내 내기보다 원래 방식(flex·grid·요소 순서·여백·글자 크기)에 맞게 구조를 바꾸세요. %·px 수치는 목표값 참고용입니다. **새 배치 스케치**는 칸의 위치·비율대로 슬라이드를 다시 구성하라는 뜻입니다.
6. 요청하지 않은 부분은 바꾸지 마세요. 지시가 모호하면 가장 합리적으로 해석하고, 결과 보고에 그 해석을 적으세요.`,
};

function renderRound(r, { rules }) {
  const items = r.items || [];
  const deck = r.deck || {};
  const L = [tr('# ✒️ 빨간펜 수정 요청 · {n}차', { n: r.round }), ''];
  L.push(tr('- 대상 파일: {path}', { path: code(deck.path || '') }));
  if (deck.sourceFiles?.length > 1) L.push(tr('- 내용이 들어 있는 소스: {list}', { list: deck.sourceFiles.slice(0, 8).map(code).join(', ') }));
  if (deck.slideSelector) {
    L.push(tr('- 슬라이드 번호 기준: 문서 순서상 {sel} 요소 (총 {n}장) — "슬라이드 N"은 N번째 요소', { sel: code(deck.slideSelector), n: deck.slideCount }));
  }
  L.push(tr('- 요청: {summary}', { summary: summary(items, r.deckComment) }));
  if (rules) L.push('', pick(RULES));

  if (norm(r.deckComment)) L.push('', tr('## 📌 전체 지시사항'), '', quote(r.deckComment));

  const groups = new Map();
  for (const it of items) {
    const key = it.slide && !it.slide.single && Number.isInteger(it.slide.index) ? it.slide.index : -1;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  for (const [key, list] of [...groups].sort((a, b) => a[0] - b[0])) {
    const s = list[0].slide;
    L.push('');
    if (key === -1) L.push(tr('## 페이지'));
    else L.push(`${tr('## 슬라이드 {n}', { n: key + 1 })}${s?.title ? ` · 「${clip(s.title, 60)}」` : ''}`);
    const hint = r.slideSources?.[key];
    if (hint?.total) L.push(tr('슬라이드 위치 참고: {list} 부근', { list: hint.hits.slice(0, 3).map(loc).join(', ') }));
    for (const it of list) L.push('', renderItem(it));
  }
  return L.join('\n');
}

function renderTail(channel, deckPath) {
  const p = JSON.stringify(deckPath || '');
  const reply = `--reply "${tr('<무엇을 바꿨는지 1~3문장 · 못 한 항목은 이유>')}"`;
  const wait = `\`redpen wait ${p} ${reply}\``;
  const done = `\`redpen done ${p} ${reply}\``;
  if (channel === 'wait') {
    return [
      tr('## 반영한 뒤'),
      tr('1. 결과를 알리고 다음 피드백을 기다리세요: {cmd}', { cmd: wait }),
      tr('   (Claude Code는 run_in_background로 실행 — 사용자가 다시 보내면 완료 알림이 옵니다)'),
      tr('2. 사용자가 리뷰를 끝내자고 하면 대신: {cmd}', { cmd: done }),
    ].join('\n');
  }
  if (channel === 'pending' || channel === 'file') {
    return [tr('## 반영한 뒤'), tr('결과를 브라우저에 알려 주세요: {cmd}', { cmd: done })].join('\n');
  }
  return tr('반영한 뒤 무엇을 바꿨는지 짧게 요약해 주세요.');
}

/**
 * @param {object[]} rounds  round records from the store
 * @param {{channel?: 'wait'|'pending'|'file'|'clipboard', lang?: string}} opts  how the prompt reaches the AI
 *   (changes the closing instructions) and its language (default: the language the round was sent in)
 */
export function renderRounds(rounds, { channel = 'file', lang } = {}) {
  if (!rounds?.length) return '';
  return withLang(lang || rounds.at(-1).lang || 'ko', () => {
    const parts = rounds.map((r, i) => renderRound(r, { rules: i === 0 }));
    parts.push(renderTail(channel, rounds[0].deck?.path));
    return `${parts.join('\n\n---\n\n').trim()}\n`;
  });
}
