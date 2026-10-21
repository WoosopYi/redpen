// Ordinals (including generated DOM ids) describe a position, not a slide's identity.
export function positionalSlideId(id, index) {
  return (String(id || '').match(/\d+/g) || []).some((n) => !Number.isInteger(index) || index < 0
    || Number(n) === index || Number(n) === index + 1);
}

const unique = (slides, test) => {
  const hits = slides.map((s, i) => test(s) ? i : -1).filter((i) => i >= 0);
  return hits.length === 1 ? hits[0] : -1;
};

export const slideContentKey = (anchor) => JSON.stringify([anchor?.body || '', anchor?.media || '']);

/** Resolve a captured slide without ever falling back to its former ordinal. */
export function matchSlide(saved, slides) {
  if (!saved) return -1;
  const a = saved.anchor;
  if (saved.id && a?.idUnique !== false && !(a?.positionalId ?? positionalSlideId(saved.id, saved.index))) {
    const hit = unique(slides, (s) => s.id === saved.id);
    if (hit >= 0) return hit;
  }
  if (a?.contentUnique && (a.body || a.media)) {
    const key = slideContentKey(a);
    const hit = unique(slides, (s) => slideContentKey(s.anchor) === key);
    if (hit >= 0) return hit;
  }
  // A duplicate title must not become an identity merely because the other copy was deleted.
  if (saved.title && (!a || a.titleUnique)) {
    return unique(slides, (s) => s.title === saved.title);
  }
  return -1;
}
