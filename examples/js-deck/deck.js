(() => {
  const W = 1920;
  const H = 1080;
  const deck = document.querySelector('#deck');
  deck.innerHTML = (window.SLIDES || []).map((s, i) => {
    const page = String(i + 1).padStart(2, '0');
    if (s.raw) return s.raw;
    return `<section class="slide" data-title="${s.title}">
      <header><div class="eyebrow">${s.eyebrow}</div><h2>${s.title}</h2></header>
      <div class="body">${s.body}</div>
      <footer><span>데이터 분석 입문</span><span class="pg">${page}</span></footer>
    </section>`;
  }).join('');

  const nodes = [...deck.querySelectorAll('.slide')];
  let current = 0;
  function fit() {
    const scale = Math.min(innerWidth / W, innerHeight / H);
    const stage = document.querySelector('#stage');
    stage.style.left = `${(innerWidth - W * scale) / 2}px`;
    stage.style.top = `${(innerHeight - H * scale) / 2}px`;
    stage.style.transform = `scale(${scale})`;
  }
  function go(i, push = true) {
    current = Math.max(0, Math.min(nodes.length - 1, i));
    nodes.forEach((n, k) => n.classList.toggle('is-active', k === current));
    document.querySelector('#counter').textContent = `${String(current + 1).padStart(2, '0')} / ${String(nodes.length).padStart(2, '0')}`;
    if (push) history.replaceState(null, '', `#${current + 1}`);
  }
  addEventListener('keydown', (e) => {
    if (['ArrowRight', 'ArrowDown', ' ', 'PageDown'].includes(e.key)) go(current + 1);
    else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) go(current - 1);
  });
  document.querySelector('#prev').addEventListener('click', () => go(current - 1));
  document.querySelector('#next').addEventListener('click', () => go(current + 1));
  addEventListener('hashchange', () => go(Number(location.hash.slice(1) || 1) - 1, false));
  addEventListener('resize', fit);
  fit();
  go(Number(location.hash.slice(1) || 1) - 1, false);
})();
