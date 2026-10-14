/* 덱 엔진: slides.js(window.SLIDES)와 credits.js(window.CREDITS)를 읽어 슬라이드를 그린다.
   (빨간펜 예제용 복사본: 바닥글 브랜드는 DECK.mark, 화면 문구는 DECK.ui로 바꿀 수 있다)
   조작: ← → / Space / PageUp·Down / 휠 = 이동(단계 슬라이드는 단계 먼저), F = 전체화면, G = 전체 목차,
         M = 영상 소리 켜기/끄기, P = PDF 인쇄, Home/End = 처음/끝 */
(function () {
  "use strict";
  const SL = window.SLIDES || [];
  const CR = window.CREDITS || {};
  const DECK = window.DECK || { brand: "DECK", short: "DECK" };
  const UI = Object.assign({
    placeholder: "자료 준비 중", stepHint: "→ 다음 단계 · ← 이전 단계", copy: "프롬프트 복사", copied: "복사됨 ✓", prep: "준비물",
    srcTitle: "자료 출처", srcLead: "비영리 교육 목적으로만 사용했습니다. 모든 이미지·영상의 저작권은 원저작자에게 있습니다.", srcPrefix: "출처 · ",
    soundOff: "소리 끔", soundOn: "소리 켬", total: "전체 {n}장", tapGo: "누르면 이동", clickGo: "클릭하면 이동 · Esc 닫기", close: "닫기",
    swipe: "좌우로 밀어서 넘길 수 있습니다",
  }, DECK.ui || {});
  const stage = document.getElementById("stage");
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  // 텍스트 필드는 간단한 마크업 허용: **굵게**, `코드`, <br>
  const rich = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`(.+?)`/g, "<code>$1</code>").replace(/&lt;(\/?)(br|em|b)&gt;/g, "<$1$2>");

  /* ---------- 사용한 자산 목록(출처 페이지용) ---------- */
  const USED_KEYS = [];
  (function walk(o) {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (typeof o.src === "string") { const k = o.src.replace(/^\.?\/?assets\//, ""); if (!USED_KEYS.includes(k)) USED_KEYS.push(k); }
    Object.values(o).forEach(walk);
  })(SL);

  /* ---------- 미디어 ---------- */
  const used = []; // 슬라이드별로 쓴 자산 경로 수집(출처 표기용)
  function keyOf(src) { return String(src || "").replace(/^\.?\/?assets\//, ""); }
  function media(m, extraCls = "") {
    if (!m) return "";
    if (typeof m === "string") m = { src: m };
    const t = m.type || (/\.(mp4|webm|mov)$/i.test(m.src || "") ? "video" : /\.html?$/i.test(m.src || "") ? "iframe" : m.src ? "image" : "none");
    if (m.src) used.push(keyOf(m.src));
    const cls = ["media", m.fit === "cover" ? "cover" : "", m.dark ? "dark" : "", extraCls].filter(Boolean).join(" ");
    const cap = m.cap ? `<figcaption>${rich(m.cap)}</figcaption>` : "";
    let inner;
    if (t === "video") {
      const poster = m.poster || (m.src ? m.src.replace(/\.(mp4|webm|mov)$/i, ".jpg") : "");
      inner = `<video data-src="${esc(m.src)}" ${poster ? `poster="${esc(poster)}"` : ""} muted ${m.loop === false ? "" : "loop"} ${m.controls ? "controls" : ""} playsinline preload="none"></video><span class="vbadge">VIDEO</span>`;
    } else if (t === "iframe") {
      inner = `<iframe data-src="${esc(m.src)}" loading="lazy" title="${esc(m.cap || "demo")}"></iframe>`;
    } else if (t === "image") {
      inner = `<img data-src="${esc(m.src)}" alt="${esc(m.alt || m.cap || "")}">`;
    } else {
      inner = `<div class="placeholder">${rich(m.text || UI.placeholder)}</div>`;
    }
    const style = m.style ? ` style="${esc(m.style)}"` : "";
    return `<figure class="${cls}"${style}>${inner}${cap}</figure>`;
  }
  const head = (s) => `
    <div class="s-head">
      ${s.eyebrow || s.live ? `<div class="eyebrow">${s.live ? `<span class="live">LIVE DEMO</span>` : ""}${s.eyebrow ? `<span>${esc(s.eyebrow)}</span>` : ""}${s.chip ? `<span class="chip">· ${esc(s.chip)}</span>` : ""}</div>` : ""}
      ${s.title ? `<h2 class="title">${rich(s.title)}</h2>` : ""}
      ${s.lead ? `<p class="lead">${rich(s.lead)}</p>` : ""}
    </div>`;
  const bullets = (arr) => (arr && arr.length ? `<ul class="bul">${arr.map((b) => `<li>${rich(b)}</li>`).join("")}</ul>` : "");
  const tags = (arr) => (arr && arr.length ? `<div style="display:flex;gap:10px;flex-wrap:wrap">${arr.map((t) => { const [cls, txt] = t.includes(":") ? t.split(/:(.+)/) : ["", t]; return `<span class="tag ${esc(cls)}">${esc(txt)}</span>`; }).join("")}</div>` : "");

  /* ---------- 레이아웃 ---------- */
  const L = {
    cover: (s) => `
      <div class="cover-wrap">
        <div>
          <div class="k">${esc(s.kicker || "")}</div>
          <h1>${rich(s.title)}</h1>
          <p class="sub">${rich(s.sub || "")}</p>
        </div>
        <div class="side">
          <div class="meta">${(s.meta || []).map((x) => `<div>${rich(x)}</div>`).join("")}</div>
        </div>
      </div>`,
    section: (s) => `
      <div class="sec">
        <div class="no">${esc(s.no)}</div>
        <div>
          <div class="eyebrow">${esc(s.eyebrow || "CHAPTER " + s.no)}</div>
          <h2>${rich(s.title)}</h2>
          ${s.desc ? `<p class="desc">${rich(s.desc)}</p>` : ""}
          ${s.items ? `<div class="items">${s.items.map((i) => `<span class="tag">${esc(i)}</span>`).join("")}</div>` : ""}
        </div>
      </div>`,
    statement: (s) => `
      ${s.eyebrow ? `<div class="s-head"><div class="eyebrow">${esc(s.eyebrow)}</div></div>` : ""}
      <div class="st"><p class="big">${rich(s.big)}</p>${s.small ? `<p class="small">${rich(s.small)}</p>` : ""}</div>`,
    split: (s) => `
      ${head(s)}
      <div class="s-body">
        <div class="col-media">${[].concat(s.media || []).map((m) => media(m)).join("")}</div>
        <div class="col-text">${tags(s.tags)}${bullets(s.bullets)}${s.cards ? s.cards.map((c) => `<div class="card ${c.inv ? "inv" : ""}"><h3>${rich(c.h)}</h3><p>${rich(c.p)}</p></div>`).join("") : ""}${s.note ? `<div class="note">${rich(s.note)}</div>` : ""}</div>
      </div>`,
    full: (s) => `
      <div class="full">${media(Object.assign({ fit: "cover" }, s.media))}</div>
      ${s.title || s.lead ? `<div class="cap">${s.eyebrow ? `<div class="eyebrow">${esc(s.eyebrow)}</div>` : ""}<h2 class="title">${rich(s.title || "")}</h2>${s.lead ? `<p class="lead">${rich(s.lead)}</p>` : ""}</div>` : ""}`,
    grid: (s) => `
      ${head(s)}
      <div class="s-body"><div class="grid c${s.cols || s.items.length} ${s.rows === 2 ? "r2" : ""}">
        ${s.items.map((it) => `<div class="cell">${media(it.media || it)}${it.t ? `<div class="ct">${rich(it.t)}</div>` : ""}${it.d ? `<div class="cd">${rich(it.d)}</div>` : ""}</div>`).join("")}
      </div></div>`,
    steps: (s) => {
      const st = s.steps || [];
      return `
      ${head(s)}
      <div class="s-body">
        <div class="steps">${st.map((x, i) => `<div class="step" data-step="${i}"><span class="n">${i + 1}</span><div><h4>${rich(x.h)}</h4>${x.p ? `<p>${rich(x.p)}</p>` : ""}</div></div>`).join("")}</div>
        <div class="stage-media">
          <figure class="media ${s.dark ? "dark" : ""}">${st.map((x, i) => `<div class="sm ${i === st.length - 1 ? "last" : ""}" data-step="${i}">${x.media ? media(x.media).replace(/^<figure class="[^"]*"( style="[^"]*")?>|<\/figure>$/g, "") : `<div class="placeholder">${rich(x.text || "")}</div>`}</div>`).join("")}</figure>
          <div class="hint">${esc(UI.stepHint)}</div>
        </div>
      </div>`;
    },
    compare: (s) => `
      ${head(s)}
      <div class="s-body"><div class="cmp">
        ${s.sides.map((x) => `<div class="card side ${x.inv ? "inv" : ""}"><div class="who">${esc(x.who || "")}</div><h3>${rich(x.h)}</h3>${bullets(x.bullets)}${x.media ? media(x.media) : ""}</div>`).join("")}
      </div></div>`,
    table: (s) => `
      ${head(s)}
      <div class="s-body"><div class="tbl ${s.compact ? "compact" : ""} ${s.dense ? "dense" : ""}"><table class="t"><thead><tr>${s.cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>
      <tbody>${s.rows.map((r) => `<tr>${r.map((c) => `<td>${rich(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>
      ${s.note ? `<p class="note" style="font-size:18px;color:#666;margin-top:22px">${rich(s.note)}</p>` : ""}</div></div>`,
    prompt: (s) => `
      ${head(s)}
      <div class="s-body">
        <div class="pbox ${(s.prompt || "").length > 600 ? "wide" : ""}"><div class="cli"><div class="bar"><span>▲ ${esc(s.tool || "PROMPT")}</span><button class="copy" type="button">${esc(UI.copy)}</button></div><pre class="${(s.prompt || "").length > 600 ? "long" : (s.prompt || "").length < 260 ? "short" : ""}">${esc(s.prompt)}</pre></div></div>
        <div class="pside">${s.media ? media(s.media) : ""}${bullets(s.bullets)}</div>
      </div>`,
    cards: (s) => `
      ${head(s)}
      <div class="s-body"><div class="cards c${s.cols || 3} ${s.cards.length <= (s.cols || 3) ? "one-row" : ""}">
        ${s.cards.map((c) => `<div class="card ${c.inv ? "inv" : ""}">${c.media ? media(c.media) : ""}${c.k ? `<div class="k"><span>${esc(c.k)}</span>${c.tag ? `<span class="tag ${c.tagCls || ""}">${esc(c.tag)}</span>` : ""}</div>` : ""}<h3>${rich(c.h)}</h3>${c.p ? `<p>${rich(c.p)}</p>` : ""}</div>`).join("")}
      </div></div>`,
    demo: (s) => `
      ${head(Object.assign({ live: true }, s))}
      <div class="s-body">
        <div class="prep">
          ${s.prep ? `<div class="card"><h3>${esc(UI.prep)}</h3><ul class="check">${s.prep.map((p) => `<li>${rich(p)}</li>`).join("")}</ul></div>` : ""}
          ${s.media ? media(Object.assign({ style: "flex:1" }, s.media)) : ""}
        </div>
        <div class="flow">${(s.flow || []).map((f, i) => `<div class="fs"><span class="n">${String(i + 1).padStart(2, "0")}</span><div><b>${rich(f.h)}</b>${f.p ? `<span>${rich(f.p)}</span>` : ""}</div></div>`).join("")}</div>
      </div>`,
    howto: (s) => `
      ${head(s)}
      <div class="s-body">
        <div class="flow">${(s.flow || []).map((f, i) => `<div class="fs"><span class="n">${String(i + 1).padStart(2, "0")}</span><div><b>${rich(f.h)}</b>${f.p ? `<span>${rich(f.p)}</span>` : ""}</div></div>`).join("")}${s.note ? `<p class="note">${rich(s.note)}</p>` : ""}</div>
        <div class="side">${[].concat(s.media || []).map((m) => media(m)).join("")}</div>
      </div>`,
    timeline: (s) => {
      const it = s.items || []; const half = Math.ceil(it.length / 2);
      const col = (arr) => `<div class="tl-col">${arr.map((x) => `<div class="tl-item ${x.key ? "key" : ""}"><div class="tl-date">${esc(x.date)}</div><div class="tl-dot"></div><div class="tl-body"><b>${rich(x.h)}</b>${x.p ? `<span>${rich(x.p)}</span>` : ""}${x.tag ? `<em class="tag ${esc(x.tagCls || "")}">${esc(x.tag)}</em>` : ""}</div></div>`).join("")}</div>`;
      return `${head(s)}<div class="s-body"><div class="tl ${it.length > 7 ? "two" : ""}">${it.length > 7 ? col(it.slice(0, half)) + col(it.slice(half)) : col(it)}</div></div>`;
    },
    video: (s) => s.bleed ? `<div class="vbleed">${media(Object.assign({ loop: false }, s.media))}</div>` : `
      ${head(s)}
      <div class="s-body"><div class="vwrap">${media(Object.assign({}, s.media))}${s.bullets ? `<div class="vside">${bullets(s.bullets)}</div>` : ""}</div></div>`,
    gallery: (s) => `
      ${head(s)}
      <div class="s-body"><div class="gal">
        <div class="gal-row">${[].concat(s.media || []).map((m) => media(m)).join("")}</div>
        ${s.bullets ? `<ul class="bul gal-bul">${s.bullets.map((b) => `<li>${rich(b)}</li>`).join("")}</ul>` : ""}
      </div></div>`,
    sources: (s) => {
      const per = s.per || 72, page = s.page || 1;
      const keys = USED_KEYS.filter((k) => CR[k]);
      const chunk = keys.slice((page - 1) * per, page * per);
      const pages = Math.max(1, Math.ceil(keys.length / per));
      const items = chunk.map((k) => { const v = CR[k]; return `<div><b>${esc(v.author || "")}</b> · ${esc(v.platform || "")} · ${esc(v.title || "")}<br><span>${esc(v.source_url || "")}${v.clip ? " · " + esc(v.clip) : ""}</span></div>`; });
      const extra = page === pages ? (window.TEXT_SOURCES || []).map((u) => `<div><span>${esc(u)}</span></div>`) : [];
      return `${head({ eyebrow: `CREDITS · ${page} / ${pages}`, title: UI.srcTitle, lead: page === 1 ? UI.srcLead : "" })}<div class="s-body"><div class="srcs">${items.join("")}${extra.join("")}</div></div>`;
    },
    end: (s) => `<div class="endw"><div class="eyebrow" style="color:#a8a8a8">${esc(s.eyebrow || "THANK YOU")}</div><h2>${rich(s.title)}</h2>${s.sub ? `<p>${rich(s.sub)}</p>` : ""}</div>`,
  };

  /* ---------- 출처 바닥글 ---------- */
  function shortUrl(u) { return String(u || "").replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""); }
  function footSources(keys, s) {
    const seen = new Set(); const parts = [];
    keys.forEach((k) => {
      const c = CR[k]; if (!c) return;
      const id = (c.author || "") + (c.source_url || "");
      if (seen.has(id)) return; seen.add(id);
      parts.push(`${esc(c.author || c.platform || "")}${c.platform && c.author ? " (" + esc(c.platform) + ")" : ""} ${esc(shortUrl(c.source_url))}`);
    });
    (s.sources || []).forEach((u) => { if (!seen.has(u)) { seen.add(u); parts.push(esc(shortUrl(u))); } });
    return parts.length ? UI.srcPrefix + parts.join("  ·  ") : "";
  }

  /* ---------- 렌더 ---------- */
  const total = SL.length;
  let html = "";
  const slideKeys = [];
  SL.forEach((s, i) => {
    used.length = 0;
    const body = (L[s.layout] || L.split)(s);
    const keys = used.slice(); slideKeys.push(keys);
    const src = footSources(keys, s);
    const noFoot = s.layout === "cover" ? false : s.foot === false;
    html += `<section class="slide l-${s.layout}${s.rev ? " rev" : ""}${s.bleed ? " bleed" : ""}" data-i="${i}" ${s.id ? `id="s-${esc(s.id)}"` : ""}>
      ${body}
      ${noFoot ? "" : `<div class="s-foot"><span class="brand">${DECK.mark ? `<b>${esc(DECK.mark)}</b> · ` : ""}${esc(DECK.short)}</span><span class="src" title="${src.replace(/"/g, "&quot;")}">${src}</span><span class="num">${String(i + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}</span></div>`}
    </section>`;
  });
  stage.innerHTML = html;
  const slides = [...stage.querySelectorAll(".slide")];

  /* ---------- 크기 맞춤 ---------- */
  const vpEl = document.getElementById("viewport");
  function fit() {
    const w = vpEl.clientWidth || window.innerWidth, h = vpEl.clientHeight || window.innerHeight;
    const s = Math.min(w / 1920, h / 1080);
    stage.style.transform = `translate(-50%, -50%) scale(${s})`;
  }
  window.addEventListener("resize", fit); window.addEventListener("orientationchange", () => setTimeout(fit, 250)); fit();

  /* ---------- 지연 로딩 ---------- */
  function load(i) {
    const el = slides[i]; if (!el || el.dataset.loaded) return;
    el.querySelectorAll("[data-src]").forEach((m) => { m.src = m.dataset.src; if (m.tagName === "VIDEO") m.preload = "auto"; });
    el.dataset.loaded = "1";
  }

  /* ---------- 이동 ---------- */
  // 휴대폰·태블릿(주 입력이 손가락)만 터치 화면으로 본다. 터치 노트북은 마우스 화면 그대로, 밀어서 넘기기는 어디서나 동작
  const isTouch = window.matchMedia("(pointer: coarse)").matches;
  if (isTouch) document.body.classList.add("touch");
  if (!document.documentElement.requestFullscreen) document.body.classList.add("no-fs");
  let swipedAt = 0;
  let cur = 0, step = 0;
  const stepsOf = (i) => slides[i].querySelectorAll(".step").length;
  function applyStep() {
    const el = slides[cur];
    el.querySelectorAll(".step").forEach((x, k) => { x.classList.toggle("cur", k === step); x.classList.toggle("done", k < step); });
    el.querySelectorAll(".sm").forEach((x, k) => {
      const on = k === step; x.classList.toggle("on", on);
      const v = x.querySelector("video"); if (v) { if (on) v.play().catch(() => {}); else v.pause(); }
    });
  }
  let muted = true;
  function playActive() {
    slides.forEach((el, k) => el.querySelectorAll("video").forEach((v) => {
      if (k !== cur) { v.pause(); return; }
      v.muted = muted;
      const inStep = v.closest(".sm");
      if (!inStep || inStep.classList.contains("on")) v.play().catch(() => {});
    }));
  }
  function go(i, st = 0) {
    i = Math.max(0, Math.min(total - 1, i));
    slides[cur].classList.remove("is-active");
    if (i !== cur) slides[i].querySelectorAll(".vbleed video").forEach((v) => { try { v.currentTime = 0; } catch (e) {} });
    cur = i; step = st === "last" ? Math.max(0, stepsOf(i) - 1) : st;
    [i, i + 1, i + 2, i - 1].forEach((k) => k >= 0 && k < total && load(k));
    slides[cur].classList.add("is-active");
    if (document.activeElement && document.activeElement.tagName === "IFRAME") { document.activeElement.blur(); window.focus(); }
    applyStep(); playActive();
    document.getElementById("progress").firstElementChild.style.width = ((cur + 1) / total) * 100 + "%";
    document.getElementById("cnt").textContent = `${cur + 1} / ${total}`;
    history.replaceState(null, "", "#" + (cur + 1));
  }
  function next() { const n = stepsOf(cur); if (n && step < n - 1) { step++; applyStep(); } else go(cur + 1); }
  function prev() { const n = stepsOf(cur); if (n && step > 0) { step--; applyStep(); } else go(cur - 1, "last"); }

  /* ---------- 입력 ---------- */
  const overview = document.getElementById("overview");
  const lightbox = document.getElementById("lightbox");
  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (lightbox.classList.contains("open")) { if (e.key === "Escape" || e.key === " ") closeLight(); return; }
    if (overview.classList.contains("open")) { if (e.key === "Escape" || e.key === "g" || e.key === "G") toggleOverview(false); return; }
    switch (e.key) {
      case "ArrowRight": case "PageDown": case " ": case "ArrowDown": e.preventDefault(); next(); break;
      case "ArrowLeft": case "PageUp": case "ArrowUp": e.preventDefault(); prev(); break;
      case "Home": go(0); break;
      case "End": go(total - 1); break;
      case "f": case "F": toggleFull(); break;
      case "g": case "G": toggleOverview(true); break;
      case "m": case "M": muted = !muted; playActive(); toast(muted ? UI.soundOff : UI.soundOn); break;
      case "p": case "P": printAll(); break;
    }
  });
  let wheelAcc = 0, wheelLock = 0;
  window.addEventListener("wheel", (e) => {
    if (overview.classList.contains("open") || lightbox.classList.contains("open")) return;
    if (e.target.closest("pre, .srcs, iframe")) return;
    const now = Date.now(); if (now < wheelLock) return;
    wheelAcc += e.deltaY;
    if (Math.abs(wheelAcc) > 60) { wheelAcc > 0 ? next() : prev(); wheelAcc = 0; wheelLock = now + 650; }
  }, { passive: true });

  stage.addEventListener("click", (e) => {
    if (Date.now() - swipedAt < 450) return;
    const stp = e.target.closest(".step");
    if (stp) { step = +stp.dataset.step; applyStep(); return; }
    const cp = e.target.closest(".copy");
    if (cp) {
      const txt = cp.closest(".cli").querySelector("pre").innerText;
      navigator.clipboard.writeText(txt).then(() => { cp.classList.add("done"); cp.textContent = UI.copied; setTimeout(() => { cp.classList.remove("done"); cp.textContent = UI.copy; }, 1600); });
      return;
    }
    const img = e.target.closest(".media img");
    if (img) { openLight(img.currentSrc || img.src); return; }
    const v = e.target.closest(".media video");
    if (v && !v.controls) { v.paused ? v.play() : v.pause(); }
  });

  function openLight(src) { lightbox.innerHTML = `<img src="${esc(src)}">`; lightbox.classList.add("open"); }
  function closeLight() { lightbox.classList.remove("open"); lightbox.innerHTML = ""; }
  lightbox.addEventListener("click", closeLight);

  function toggleFull() { if (!document.fullscreenElement) document.documentElement.requestFullscreen?.(); else document.exitFullscreen?.(); }
  function toggleOverview(open) {
    if (open) {
      let h = `<div class="oh"><span>${esc(DECK.brand)} · ${esc(UI.total.replace("{n}", total))}</span><span class="oh-r"><span>${esc(isTouch ? UI.tapGo : UI.clickGo)}</span><button class="oclose" data-close>${esc(UI.close)}</button></span></div><div class="og">`;
      SL.forEach((s, i) => {
        if (s.layout === "section") h += `<div class="sec-h">${esc(s.no)} · ${esc(String(s.title).replace(/<[^>]+>/g, " ").replace(/\s+/g, " "))}</div>`;
        const t = String(s.title || s.big || s.layout).replace(/<br\s*\/?>/g, " ").replace(/<[^>]+>|\*\*|`/g, "").replace(/\s+/g, " ").trim();
        h += `<div class="oi ${i === cur ? "cur" : ""}" data-go="${i}"><div class="on"><span>${String(i + 1).padStart(2, "0")}</span><span>${esc(s.live ? "LIVE" : s.layout.toUpperCase())}</span></div><div class="ot">${esc(t)}</div></div>`;
      });
      overview.innerHTML = h + "</div>";
      overview.classList.add("open");
      overview.querySelector(".oi.cur")?.scrollIntoView({ block: "center" });
    } else overview.classList.remove("open");
  }
  overview.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) { toggleOverview(false); return; } const o = e.target.closest("[data-go]"); if (o) { toggleOverview(false); go(+o.dataset.go); } });

  function printAll() { slides.forEach((_, k) => load(k)); setTimeout(() => window.print(), 600); }
  function toast(t) { const el = document.getElementById("toast"); el.textContent = t; el.classList.add("show"); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("show"), 1400); }

  document.getElementById("controls").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    ({ prev, next, grid: () => toggleOverview(true), full: toggleFull, print: printAll }[b.dataset.act] || (() => {}))();
  });

  /* ---------- 터치: 좌우로 밀어서 넘기기 ---------- */
  const controls = document.getElementById("controls");
  let ctrlT = 0;
  function showControls() {
    if (!isTouch) return;
    controls.classList.add("show"); clearTimeout(ctrlT);
    ctrlT = setTimeout(() => controls.classList.remove("show"), 3000);
  }
  let t0 = null, tMulti = false;
  vpEl.addEventListener("touchstart", (e) => {
    showControls();
    if (e.touches.length !== 1 || e.target.closest("pre, .srcs")) { tMulti = true; t0 = null; return; }
    tMulti = false; const t = e.touches[0]; t0 = { x: t.clientX, y: t.clientY, lx: t.clientX, ly: t.clientY, at: Date.now() };
  }, { passive: true });
  vpEl.addEventListener("touchmove", (e) => {
    if (e.touches.length > 1) { tMulti = true; return; }
    const t = e.touches[0]; if (t0 && t) { t0.lx = t.clientX; t0.ly = t.clientY; }
  }, { passive: true });
  function touchEnd(e) {
    if (tMulti || !t0) { t0 = null; return; }
    const t = e.changedTouches && e.changedTouches[0];
    const dx = (t ? t.clientX : t0.lx) - t0.x, dy = (t ? t.clientY : t0.ly) - t0.y, dt = Date.now() - t0.at;
    t0 = null;
    if (window.visualViewport && window.visualViewport.scale > 1.02) return; // 확대해서 보는 중이면 화면 이동으로 둔다
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.3 || dt > 900) return;
    swipedAt = Date.now();
    if (dx < 0) next(); else prev();
  }
  vpEl.addEventListener("touchend", touchEnd);
  vpEl.addEventListener("touchcancel", touchEnd);
  controls.addEventListener("touchstart", showControls, { passive: true });
  if (isTouch) { showControls(); if (window.innerWidth > window.innerHeight) setTimeout(() => toast(UI.swipe), 600); }

  window.addEventListener("hashchange", () => { const n = parseInt(location.hash.slice(1), 10); if (Number.isFinite(n) && n - 1 !== cur) go(n - 1); });

  window.__deck = { go, next, prev, count: total, cur: () => cur, slideKeys, loadAll: () => slides.forEach((_, k) => load(k)) };
  const start = parseInt(location.hash.slice(1), 10);
  go(Number.isFinite(start) ? start - 1 : 0);
})();
