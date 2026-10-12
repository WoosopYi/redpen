// Short Korean summaries of layout marks, shared by the panel, hover cards and the layout bar.

const pct = (v) => Math.round(v * 100);
const changed = (L) => !!L?.to && ['x', 'y', 'w', 'h'].some((k) => Math.abs(L.to[k] - L.from[k]) > 0.002);

export function layoutSummary(L) {
  if (!L) return '';
  const out = [];
  if (L.reorder) out.push(`순서 ${L.reorder.from + 1}→${L.reorder.to + 1}번째`);
  if (changed(L)) {
    const dx = L.to.x - L.from.x;
    const dy = L.to.y - L.from.y;
    if (!L.reorder && (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01)) {
      const hor = Math.abs(dx) > 0.01 ? (dx > 0 ? '오른쪽' : '왼쪽') : '';
      const ver = Math.abs(dy) > 0.01 ? (dy > 0 ? '아래' : '위') : '';
      out.push(`${[hor, ver].filter(Boolean).join(' ')}로 이동`);
    }
    if (L.fit === 'box') out.push(`상자 ${pct(L.to.w)}%×${pct(L.to.h)}%`);
    else if (Math.abs(L.to.w / (L.from.w || 1) - 1) > 0.01) out.push(`크기 ${pct(L.to.w / (L.from.w || 1))}%`);
  }
  if (L.font) out.push(`글자 ${L.font.to > L.font.from ? '+' : ''}${pct(L.font.to / L.font.from - 1)}%`);
  if (L.gap) out.push(`간격 ${L.gap.from}→${L.gap.to}px`);
  if (L.padding) out.push('여백 변경');
  if (L.direction) out.push(L.direction.to.startsWith('column') ? '세로로 배치' : '가로로 배치');
  if (L.columns) out.push(`${L.columns.from}열→${L.columns.to}열`);
  return out.join(' · ');
}

/** Summary of any layout item: element change, sketch, or slide move. */
export function itemSummary(it) {
  if (it.target === 'sketch') {
    const boxes = it.sketch?.boxes || [];
    const names = boxes.map((b) => b.label).filter(Boolean).slice(0, 4).join(', ');
    return `새 배치 스케치 · 칸 ${boxes.length}개${names ? ` (${names})` : ''}`;
  }
  if (it.target === 'slide' && it.move) return `슬라이드를 ${it.move.to + 1}번째로 옮기기`;
  return layoutSummary(it.layout) || '레이아웃 변경';
}
