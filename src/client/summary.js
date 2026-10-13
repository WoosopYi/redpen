// Short summaries of layout marks, shared by the panel, hover cards and the layout bar (and the server).
import { tr } from './i18n/index.js';

const pct = (v) => Math.round(v * 100);
const changed = (L) => !!L?.to && ['x', 'y', 'w', 'h'].some((k) => Math.abs(L.to[k] - L.from[k]) > 0.002);

const WHERE = {
  'top-left': '왼쪽 위', 'top-center': '위쪽 가운데', 'top-right': '오른쪽 위',
  'middle-left': '왼쪽 가운데', 'middle-center': '가운데', 'middle-right': '오른쪽 가운데',
  'bottom-left': '왼쪽 아래', 'bottom-center': '아래쪽 가운데', 'bottom-right': '오른쪽 아래',
};

/** Where a box (fractions of the slide) sits, in words: "오른쪽 위". */
export function where({ x = 0, y = 0, w = 0, h = 0 } = {}) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const H = cx < 0.36 ? 'left' : cx > 0.64 ? 'right' : 'center';
  const V = cy < 0.36 ? 'top' : cy > 0.64 ? 'bottom' : 'middle';
  return tr(WHERE[`${V}-${H}`]);
}

const MOVE = {
  r: '오른쪽으로 이동', l: '왼쪽으로 이동', d: '아래로 이동', u: '위로 이동',
  rd: '오른쪽 아래로 이동', ru: '오른쪽 위로 이동', ld: '왼쪽 아래로 이동', lu: '왼쪽 위로 이동',
};

export function layoutSummary(L) {
  if (!L) return '';
  const out = [];
  if (L.reorder) out.push(tr('순서 {from}→{to}번째', { from: L.reorder.from + 1, to: L.reorder.to + 1 }));
  if (changed(L)) {
    const dx = L.to.x - L.from.x;
    const dy = L.to.y - L.from.y;
    if (!L.reorder && (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01)) {
      const hor = Math.abs(dx) > 0.01 ? (dx > 0 ? 'r' : 'l') : '';
      const ver = Math.abs(dy) > 0.01 ? (dy > 0 ? 'd' : 'u') : '';
      out.push(tr(MOVE[hor + ver]));
    }
    if (L.fit === 'box') out.push(tr('상자 {w}%×{h}%', { w: pct(L.to.w), h: pct(L.to.h) }));
    else if (Math.abs(L.to.w / (L.from.w || 1) - 1) > 0.01) out.push(tr('크기 {n}%', { n: pct(L.to.w / (L.from.w || 1)) }));
  }
  if (L.font) out.push(tr('글자 {n}%', { n: `${L.font.to > L.font.from ? '+' : ''}${pct(L.font.to / L.font.from - 1)}` }));
  if (L.gap) out.push(tr('간격 {from}→{to}px', { from: L.gap.from, to: L.gap.to }));
  if (L.padding) out.push(tr('여백 변경'));
  if (L.direction) out.push(tr(L.direction.to.startsWith('column') ? '세로로 배치' : '가로로 배치'));
  if (L.columns) out.push(tr('{from}열→{to}열', { from: L.columns.from, to: L.columns.to }));
  return out.join(' · ');
}

/** Summary of any layout item: element change, sketch, or slide move. */
export function itemSummary(it) {
  if (it.target === 'sketch') {
    const boxes = it.sketch?.boxes || [];
    const names = boxes.map((b) => b.label).filter(Boolean).slice(0, 4).join(', ');
    return tr('새 배치 스케치 · 칸 {n}개', { n: boxes.length }) + (names ? ` (${names})` : '');
  }
  if (it.target === 'slide' && it.move) return tr('슬라이드를 {n}번째로 옮기기', { n: it.move.to + 1 });
  return layoutSummary(it.layout) || tr('레이아웃 변경');
}
