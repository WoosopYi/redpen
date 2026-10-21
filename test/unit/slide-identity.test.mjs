import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchSlide, positionalSlideId } from '../../src/client/slide-identity.js';

const slide = (index, title, body, extra = {}) => ({
  index, id: `slide-${index + 1}`, title,
  anchor: { body, media: '', positionalId: true, contentUnique: true, titleUnique: true, ...extra },
});

test('marks follow their content when preceding slides are removed and numeric ids are regenerated', () => {
  const original = slide(2, '중복 제목', '원래 표시한 슬라이드의 본문', { titleUnique: false });
  const current = [slide(0, '중복 제목', '다른 본문'), slide(1, '중복 제목', '원래 표시한 슬라이드의 본문'), slide(2, '다음 페이지', '뒤의 내용')];
  assert.equal(matchSlide(original, current), 1);
  assert.equal(matchSlide(original, [current[2], current[1], current[0]]), 1);
  assert.equal(positionalSlideId('slide-3', 2), true);
  assert.equal(positionalSlideId('s2', 2), true);
  assert.equal(positionalSlideId('deck-slide-3-content', 2), true);
  assert.equal(positionalSlideId('introduction', 2), false);
});

test('stable authored ids survive both title and body edits', () => {
  const saved = { ...slide(2, '이전 제목', '이전 본문', { positionalId: false }), id: 'project-results' };
  const edited = { ...slide(0, '새 제목', '새 본문'), id: 'project-results' };
  assert.equal(matchSlide(saved, [edited]), 0);
});

test('a deleted slide never transfers to the remaining copy of its title or former number', () => {
  const saved = slide(1, '같은 제목', '삭제된 대상의 본문', { titleUnique: false });
  const remaining = [slide(0, '같은 제목', '다른 대상의 본문'), slide(1, '다음 페이지', '뒤의 내용')];
  assert.equal(matchSlide(saved, remaining), -1);
});

test('identical slides stay unresolved when their original identity was ambiguous', () => {
  const saved = slide(1, '반복', '동일한 내용', { titleUnique: false, contentUnique: false });
  assert.equal(matchSlide(saved, [slide(0, '반복', '동일한 내용')]), -1);
});

test('unique titles support body edits; body snapshots support heading edits', () => {
  const saved = slide(3, '고유 제목', '고유 본문');
  assert.equal(matchSlide(saved, [slide(0, '고유 제목', '수정한 본문')]), 0);
  assert.equal(matchSlide(saved, [slide(0, '수정한 제목', '고유 본문')]), 0);
});

test('legacy marks can use a unique title but never their index alone', () => {
  const current = [slide(0, '원래 대상', '본문'), slide(1, '다른 대상', '다른 본문')];
  assert.equal(matchSlide({ index: 1, title: '원래 대상', id: 'slide-2' }, current), 0);
  assert.equal(matchSlide({ index: 1 }, current), -1);
});
