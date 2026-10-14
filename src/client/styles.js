// Styles for the review UI (inside a shadow root, isolated from the deck's CSS).
export const SHADOW_CSS = `
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; }
.rp, .layer {
  font-family: Pretendard, "Pretendard Variable", -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", "Segoe UI", Roboto, sans-serif;
  font-size: 13px; line-height: 1.45; color: #1c2024; letter-spacing: -0.01em;
  -webkit-font-smoothing: antialiased; text-align: left;
}
.layer, .rp { position: fixed; inset: 0; pointer-events: none; }
.layer { overflow: hidden; }
button { font: inherit; color: inherit; letter-spacing: inherit; }
.ico { display: inline-flex; flex: none; }
.ico svg { width: 100%; height: 100%; }
kbd { font: 600 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace; padding: 2px 4px; border-radius: 4px; background: #f0f0f3; color: #60646c; border: 1px solid #e0e1e6; }

.t-delete  { --c: #e5484d; --bg: rgba(229, 72, 77, .13); --soft: #feebec; }
.t-replace { --c: #f76b15; --bg: rgba(247, 107, 21, .13); --soft: #ffefd6; }
.t-comment { --c: #3e63dd; --bg: rgba(62, 99, 221, .11); --soft: #edf2fe; }
.t-layout  { --c: #8e4ec6; --bg: rgba(142, 78, 198, .10); --soft: #f7edfe; }

/* ── toolbar ─────────────────────────────────────────── */
.bar {
  position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%);
  display: flex; align-items: center; gap: 2px; padding: 4px;
  background: rgba(255, 255, 255, .97); border: 1px solid rgba(0, 0, 0, .08); border-radius: 14px;
  box-shadow: 0 12px 32px -8px rgba(0, 0, 0, .25), 0 2px 6px rgba(0, 0, 0, .08);
  backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
  user-select: none; -webkit-user-select: none; pointer-events: auto; white-space: nowrap;
}
.bar.placed { transform: none; }
.bar:not(.placed) { transition: left .24s cubic-bezier(.2, .8, .2, 1); } /* slides aside with the list panel */
.logo {
  display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 10px 0 8px;
  border: 0; border-radius: 10px; background: none; cursor: grab; color: #e5484d;
}
.logo:active { cursor: grabbing; }
.logo b { color: #1c2024; font-size: 13px; font-weight: 750; letter-spacing: -0.02em; }
.logo:hover { background: #f4f4f6; }
.tb {
  position: relative; display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 10px;
  border: 0; border-radius: 10px; background: transparent; color: #3c4149; font-weight: 550; cursor: pointer;
  transition: background .12s, color .12s;
}
.tb:hover { background: #f0f0f3; color: #1c2024; }
.tb.on { background: #1c2024; color: #fff; }
.tb.quit:hover { background: #feebec; color: #ce2c31; }
.seg { display: flex; gap: 2px; padding: 2px; background: #f2f2f5; border-radius: 11px; }
.seg .tb { height: 28px; padding: 0 9px; border-radius: 9px; color: #60646c; }
.seg .tb.on { background: #fff; color: #1c2024; box-shadow: 0 1px 2px rgba(0, 0, 0, .14), 0 0 0 .5px rgba(0, 0, 0, .06); }
.vsep { width: 1px; height: 20px; background: #e4e4e9; margin: 0 4px; flex: none; }
.count {
  min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: #e5484d; color: #fff;
  font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center;
}
.count.zero { background: #e8e8ec; color: #8b8d98; }
.tb.on .count.zero { background: rgba(255, 255, 255, .2); color: #fff; }
.send { background: #e5484d; color: #fff; font-weight: 650; padding: 0 12px 0 11px; }
.send:hover { background: #d93d42; color: #fff; }
.send.idle { background: #f5c2c4; }
.send.idle:hover { background: #f0aeb1; }
.ai {
  display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 8px;
  font-size: 12px; font-weight: 550; color: #8b8d98; cursor: help;
}
.ai .dot { width: 8px; height: 8px; border-radius: 50%; background: #c8c9d0; flex: none; }
.ai.waiting { color: #18794e; }
.ai.waiting .dot { background: #30a46c; animation: rp-pulse 1.8s ease-out infinite; }
.ai.working { color: #0d74ce; }
.ai.working .dot { background: #0090ff; animation: rp-blink 1s ease-in-out infinite; }
@keyframes rp-pulse { 0% { box-shadow: 0 0 0 0 rgba(48, 164, 108, .55); } 70%, 100% { box-shadow: 0 0 0 7px rgba(48, 164, 108, 0); } }
@keyframes rp-blink { 50% { opacity: .3; } }
@media (max-width: 820px) { .bar .lbl { display: none; } .bar .tb { padding: 0 8px; } }
.bar.paused .seg, .bar.paused .hide-paused { display: none; }
.bar.paused .logo b::after { content: ' · ' attr(data-paused); color: #8b8d98; font-weight: 500; }
.bar.collapsed > :not(.logo):not(.mini) { display: none; }
.mini { display: none; }
.bar.collapsed .mini { display: inline-flex; }

[data-tip] { position: relative; }
[data-tip]:hover::after {
  content: attr(data-tip); position: absolute; left: 50%; bottom: calc(100% + 10px); transform: translateX(-50%);
  padding: 6px 9px; border-radius: 7px; background: #1c2024; color: #fff; font-size: 12px; font-weight: 500;
  line-height: 1.4; white-space: pre; pointer-events: none; z-index: 5; box-shadow: 0 6px 16px rgba(0, 0, 0, .2);
}
.bar.top [data-tip]:hover::after { bottom: auto; top: calc(100% + 10px); }

/* ── overlay: marks on the slide ─────────────────────── */
.pin {
  position: absolute; left: 0; top: 0; min-width: 20px; height: 20px; padding: 0 5px;
  display: flex; align-items: center; justify-content: center;
  border: 1.5px solid #fff; border-radius: 10px 10px 10px 3px; background: var(--c); color: #fff;
  font-size: 11px; font-weight: 750; line-height: 1; cursor: pointer; pointer-events: auto;
  box-shadow: 0 2px 6px rgba(0, 0, 0, .28); will-change: transform;
}
.pin:hover, .pin.focus { z-index: 3; box-shadow: 0 0 0 3px rgba(255, 214, 10, .85), 0 2px 8px rgba(0, 0, 0, .3); }
.box { position: absolute; left: 0; top: 0; border: 2px solid var(--c); background: var(--bg); border-radius: 4px; pointer-events: none; }
.box.region { border-style: dashed; }
.box.element.t-delete { background: repeating-linear-gradient(-45deg, rgba(229, 72, 77, .10) 0 8px, rgba(229, 72, 77, .22) 8px 16px); }
.box.slide { border-width: 3px; border-radius: 2px; background: transparent; }
.box.slide.t-delete { background: repeating-linear-gradient(-45deg, rgba(229, 72, 77, .08) 0 14px, rgba(229, 72, 77, .17) 14px 28px); }
.box.slide .tag {
  position: absolute; top: 10px; right: 10px; padding: 4px 10px; border-radius: 6px; background: var(--c); color: #fff;
  font-size: 13px; font-weight: 700; box-shadow: 0 2px 8px rgba(0, 0, 0, .2);
}
.box.focus { box-shadow: 0 0 0 4px rgba(255, 214, 10, .7); }
.chip {
  position: absolute; left: 0; top: 0; max-width: 280px; padding: 2px 8px; border-radius: 6px;
  background: #fff; color: #1c2024; border: 1.5px solid var(--c); font-size: 12px; font-weight: 650;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: none;
  box-shadow: 0 2px 6px rgba(0, 0, 0, .16);
}
.chip .arrow { color: var(--c); margin-right: 4px; }
.mark { position: absolute; left: 0; top: 0; background: var(--bg); border-bottom: 2px solid var(--c); pointer-events: none; }
.mark.t-delete { background: linear-gradient(transparent 46%, var(--c) 46%, var(--c) 58%, transparent 58%), var(--bg); }
.hover-box { position: absolute; left: 0; top: 0; border: 2px solid #0090ff; background: rgba(0, 144, 255, .07); border-radius: 3px; pointer-events: none; }
.hover-box.picked { border-color: #1c2024; background: rgba(28, 32, 36, .06); box-shadow: 0 0 0 9999px rgba(15, 17, 20, .12); }
.hover-label {
  position: absolute; left: 0; top: 0; padding: 2px 6px; border-radius: 4px; background: #0090ff; color: #fff;
  font: 600 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: nowrap; pointer-events: none;
}
.region-draft { position: absolute; left: 0; top: 0; border: 2px dashed #3e63dd; background: rgba(62, 99, 221, .12); border-radius: 4px; pointer-events: none; }
.card {
  position: absolute; left: 0; top: 0; max-width: 320px; padding: 8px 10px; border-radius: 9px;
  background: #1c2024; color: #fff; font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-word;
  box-shadow: 0 10px 24px rgba(0, 0, 0, .28); pointer-events: none; z-index: 4;
}
.card .k { display: block; margin-bottom: 2px; color: rgba(255, 255, 255, .6); font-size: 11px; font-weight: 700; }
.card s { color: rgba(255, 255, 255, .55); }

/* ── layout: selection, handles, guides ───────────────── */
.lsel { position: absolute; left: 0; top: 0; border: 1.5px solid #0a84ff; border-radius: 2px; pointer-events: none; box-shadow: 0 0 0 1px rgba(255, 255, 255, .7); z-index: 5; }
.lsel.slide { border-style: dashed; }
.lh { position: absolute; left: 0; top: 0; width: 10px; height: 10px; background: #fff; border: 1.5px solid #0a84ff; border-radius: 2px; pointer-events: auto; box-shadow: 0 1px 3px rgba(0, 0, 0, .25); z-index: 6; }
.lh:hover { background: #0a84ff; }
.lsize { position: absolute; left: 0; top: 0; padding: 2px 6px; border-radius: 4px; background: #0a84ff; color: #fff; font: 600 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: nowrap; pointer-events: none; z-index: 6; }
.lguide { position: absolute; left: 0; top: 0; background: #ff2d92; pointer-events: none; z-index: 5; }
.lins { position: absolute; left: 0; top: 0; background: #0a84ff; border-radius: 2px; box-shadow: 0 0 0 3px rgba(10, 132, 255, .25); pointer-events: none; z-index: 5; }
.lout { position: absolute; left: 0; top: 0; border: 2px dashed #0a84ff; background: rgba(10, 132, 255, .06); border-radius: 3px; pointer-events: none; }
.lout.fixed { border-color: #8e4ec6; background: rgba(142, 78, 198, .06); }
.lout-l { position: absolute; right: 4px; bottom: 4px; padding: 1px 6px; border-radius: 4px; background: #8e4ec6; color: #fff; font: 600 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
.lghost {
  position: absolute; left: 0; top: 0; border: 1.5px dashed rgba(142, 78, 198, .75); border-radius: 3px; pointer-events: none;
  background: repeating-linear-gradient(-45deg, rgba(142, 78, 198, .04) 0 6px, rgba(142, 78, 198, .11) 6px 12px);
}
.ltarget {
  position: absolute; left: 0; top: 0; border: 2px solid #8e4ec6; border-radius: 4px; background: rgba(142, 78, 198, .10);
  box-shadow: 0 0 0 4px rgba(142, 78, 198, .22); pointer-events: none; z-index: 4;
}
.larrows { position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
.larrows line { stroke: #8e4ec6; stroke-width: 2; stroke-dasharray: 6 4; }
.box.t-layout { border: 1.5px dashed var(--c); background: transparent; }

.lhint {
  position: fixed; display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 999px;
  background: #8e4ec6; color: #fff; font-size: 12.5px; font-weight: 650; white-space: nowrap; pointer-events: none;
  box-shadow: 0 6px 18px rgba(142, 78, 198, .35); animation: rp-pop .15s ease-out;
}
.lcoach { width: 330px; }

/* ── layout bar ──────────────────────────────────────── */
.lbar {
  position: fixed; z-index: 2; display: flex; flex-direction: column; gap: 6px; padding: 8px; max-width: min(580px, 94vw);
  border-radius: 12px; background: #fff; border: 1px solid rgba(0, 0, 0, .08); pointer-events: auto;
  box-shadow: 0 14px 36px -8px rgba(0, 0, 0, .3), 0 2px 6px rgba(0, 0, 0, .08); animation: rp-pop .12s ease-out;
}
.lb-head { display: flex; align-items: center; gap: 6px; min-width: 0; padding-left: 4px; }
.lb-head .ico { color: #8e4ec6; }
.lb-head b { font: 650 12px ui-monospace, SFMono-Regular, Menlo, monospace; color: #1c2024; white-space: nowrap; }
.lb-sum { flex: 1; min-width: 0; color: #8b8d98; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lb-head .iconbtn { margin-left: 0; }
.lb-row { display: flex; flex-wrap: wrap; gap: 4px; }
.lb {
  display: inline-flex; align-items: center; gap: 5px; height: 30px; padding: 0 9px; border: 1px solid #e0e1e6; border-radius: 8px;
  background: #fff; color: #1c2024; font-size: 12.5px; font-weight: 600; cursor: pointer; white-space: nowrap;
}
.lb:hover { background: #f4f4f6; }
.lb[disabled] { opacity: .45; cursor: default; }
.lb.danger { color: #ce2c31; }
.lb.sq { width: 26px; padding: 0; justify-content: center; font-size: 15px; }
.lstep { display: inline-flex; align-items: center; gap: 2px; height: 30px; padding: 0 3px 0 8px; border: 1px solid #e0e1e6; border-radius: 8px; background: #fbfbfc; }
.lstep .lb.sq { height: 24px; border-color: transparent; background: transparent; }
.lstep .lb.sq:hover { background: #ececf0; }
.lst-l { margin-right: 2px; color: #60646c; font-size: 12px; font-weight: 650; }
.lstep.off { opacity: .45; }

/* ── sketch editor ───────────────────────────────────── */
.sketch { position: fixed; z-index: 1; pointer-events: auto; }
.sk-veil { position: absolute; inset: 0; background: rgba(255, 255, 255, .72); transition: background .15s; }
.sketch.see .sk-veil { background: rgba(255, 255, 255, .15); }
.sk-area { position: absolute; inset: 0; cursor: crosshair; }
.skbox { position: absolute; border: 2px dashed #8e4ec6; border-radius: 6px; background: rgba(142, 78, 198, .10); cursor: move; }
.skbox.drawing { cursor: crosshair; }
.sk-n {
  position: absolute; left: -2px; top: -2px; min-width: 22px; height: 22px; padding: 0 6px; border-radius: 6px 0 6px 0;
  display: flex; align-items: center; justify-content: center; background: #8e4ec6; color: #fff; font-size: 12px; font-weight: 750;
}
.sk-label {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(80%, 260px); height: 32px; padding: 0 10px;
  border: 1px solid rgba(142, 78, 198, .4); border-radius: 8px; background: rgba(255, 255, 255, .96); color: #1c2024;
  font: inherit; font-weight: 600; text-align: center; outline: none;
}
.sk-label:focus { border-color: #8e4ec6; box-shadow: 0 0 0 3px rgba(142, 78, 198, .2); }
.sk-x { position: absolute; right: 4px; top: 4px; width: 22px; height: 22px; display: grid; place-items: center; border: 0; border-radius: 6px; background: rgba(255, 255, 255, .92); color: #60646c; cursor: pointer; }
.sk-x:hover { background: #fff; color: #ce2c31; }
.sk-h { position: absolute; right: -7px; bottom: -7px; width: 14px; height: 14px; border: 2px solid #8e4ec6; border-radius: 3px; background: #fff; cursor: nwse-resize; }
.skbar {
  position: fixed; left: 50%; transform: translateX(-50%); z-index: 2; display: flex; align-items: center; gap: 8px; max-width: 96vw;
  padding: 8px 10px 8px 12px; border-radius: 12px; background: #fff; border: 1px solid rgba(0, 0, 0, .08); white-space: nowrap;
  box-shadow: 0 14px 36px -8px rgba(0, 0, 0, .3); pointer-events: auto;
}
.skbar .ico { color: #8e4ec6; }
.skbar .hint { min-width: 0; color: #8b8d98; font-size: 12px; overflow: hidden; text-overflow: ellipsis; }
.sk-memo { width: 250px; height: 30px; padding: 0 10px; border: 1px solid #d9d9e0; border-radius: 8px; font: inherit; outline: none; }
.sk-memo:focus { border-color: #8e4ec6; box-shadow: 0 0 0 3px rgba(142, 78, 198, .16); }
.skview { position: absolute; left: 0; top: 0; pointer-events: none; }
.skvbox { position: absolute; border: 1.5px dashed rgba(142, 78, 198, .85); border-radius: 6px; background: rgba(142, 78, 198, .06); }
.skvbox span {
  position: absolute; left: -1px; top: -1px; max-width: 100%; padding: 1px 7px; border-radius: 5px 0 5px 0;
  background: rgba(142, 78, 198, .92); color: #fff; font-size: 11.5px; font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.move-quick { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.move-row { display: flex; gap: 6px; }
.ta.num { min-height: 34px; height: 34px; resize: none; }

/* ── selection bar ───────────────────────────────────── */
.selbar {
  position: fixed; display: flex; gap: 2px; padding: 3px; border-radius: 11px; background: #1c2024;
  box-shadow: 0 10px 28px rgba(0, 0, 0, .3); pointer-events: auto; animation: rp-pop .12s ease-out;
}
.selbar button {
  display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 9px 0 8px;
  border: 0; border-radius: 8px; background: transparent; color: #fff; font-weight: 650; cursor: pointer;
}
.selbar button:hover { background: rgba(255, 255, 255, .13); }
.selbar kbd { background: rgba(255, 255, 255, .14); border-color: transparent; color: rgba(255, 255, 255, .75); }
.selbar .d .ico { color: #ff8b8f; }
.selbar .r .ico { color: #ffa45c; }
.selbar .c .ico { color: #9db4ff; }
@keyframes rp-pop { from { opacity: 0; transform: translateY(4px) scale(.97); } }

/* ── popover ─────────────────────────────────────────── */
.pop {
  position: fixed; padding: 12px; border-radius: 13px; background: #fff; border: 1px solid rgba(0, 0, 0, .08);
  box-shadow: 0 18px 44px -10px rgba(0, 0, 0, .3), 0 2px 6px rgba(0, 0, 0, .08); pointer-events: auto;
  animation: rp-pop .12s ease-out;
}
.pop-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-weight: 750; font-size: 13.5px; }
.pop-head .sub { color: #8b8d98; font-weight: 550; font-size: 12px; }
.pop-head .ico { color: var(--c, #60646c); }
.iconbtn {
  margin-left: auto; width: 26px; height: 26px; display: grid; place-items: center; flex: none;
  border: 0; border-radius: 7px; background: none; color: #8b8d98; cursor: pointer;
}
.iconbtn:hover { background: #f0f0f3; color: #1c2024; }
.quote {
  max-height: 88px; overflow: auto; margin-bottom: 8px; padding: 6px 10px; border-left: 3px solid var(--c, #c8c9d0);
  border-radius: 0 7px 7px 0; background: #f7f7f8; color: #3c4149; font-size: 12.5px; white-space: pre-wrap; word-break: break-word;
}
.quote.strike { text-decoration: line-through; text-decoration-color: rgba(229, 72, 77, .8); }
.ta {
  display: block; width: 100%; min-height: 64px; max-height: 40vh; resize: vertical; padding: 8px 10px;
  border: 1px solid #d9d9e0; border-radius: 9px; background: #fff; color: #1c2024; font: inherit; line-height: 1.5; outline: none;
}
.ta:focus { border-color: #3e63dd; box-shadow: 0 0 0 3px rgba(62, 99, 221, .16); }
.ta.small { min-height: 40px; }
.label { margin: 8px 0 4px; color: #60646c; font-size: 12px; font-weight: 650; }
.pop-foot { display: flex; align-items: center; gap: 6px; margin-top: 10px; }
.pop-foot .hint { margin-right: auto; color: #8b8d98; font-size: 11px; }
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 30px; padding: 0 12px;
  border: 1px solid #d9d9e0; border-radius: 8px; background: #fff; color: #1c2024; font-weight: 650; cursor: pointer;
  white-space: nowrap;
}
.btn:hover { background: #f7f7f8; }
.btn.primary { background: #1c2024; border-color: #1c2024; color: #fff; }
.btn.primary:hover { background: #33383e; }
.btn.red { background: #e5484d; border-color: #e5484d; color: #fff; }
.btn.red:hover { background: #d93d42; }
.btn.ghost { border-color: transparent; background: none; color: #60646c; }
.btn.ghost:hover { background: #f0f0f3; color: #1c2024; }
.btn.danger { color: #ce2c31; }
.btn[disabled] { opacity: .5; cursor: default; }
.types { display: flex; gap: 4px; margin-bottom: 10px; }
.types button {
  flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 5px; height: 30px;
  border: 1px solid #e0e1e6; border-radius: 8px; background: #fff; color: #60646c; font-weight: 650; cursor: pointer;
}
.types button:hover { background: #f7f7f8; }
.types button.on { border-color: var(--c); background: var(--soft); color: var(--c); }
.menu { display: flex; flex-direction: column; gap: 2px; }
.menu button {
  display: flex; align-items: center; gap: 9px; height: 34px; padding: 0 10px; border: 0; border-radius: 8px;
  background: none; color: #1c2024; font-weight: 550; text-align: left; cursor: pointer;
}
.menu button:hover { background: #f2f2f5; }
.menu button .ico { color: var(--c, #60646c); }
.menu .kbd { margin-left: auto; }
.el-meta { margin: -2px 0 10px; color: #60646c; font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all; }
.shake { animation: rp-shake .32s; }
@keyframes rp-shake { 20%, 60% { transform: translateX(-5px); } 40%, 80% { transform: translateX(5px); } }

/* ── panel ───────────────────────────────────────────── */
.panel {
  position: fixed; top: 12px; right: 12px; bottom: 12px; width: 384px; max-width: calc(100vw - 24px);
  display: flex; flex-direction: column; overflow: hidden; pointer-events: auto;
  background: #fff; border: 1px solid rgba(0, 0, 0, .08); border-radius: 16px;
  box-shadow: 0 24px 56px -12px rgba(0, 0, 0, .32);
  transform: translateX(calc(100% + 28px)); transition: transform .24s cubic-bezier(.2, .8, .2, 1); visibility: hidden;
}
.panel.open { transform: none; visibility: visible; }
.p-head { display: flex; align-items: center; gap: 8px; padding: 14px 12px 8px 16px; }
.p-head .ico { color: #e5484d; }
.p-title { font-weight: 800; font-size: 15px; letter-spacing: -0.02em; }
.p-file { flex: 1; min-width: 0; color: #8b8d98; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tabs { display: flex; gap: 2px; margin: 0 12px; padding: 2px; border-radius: 10px; background: #f2f2f5; }
.tab {
  flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 30px;
  border: 0; border-radius: 8px; background: none; color: #60646c; font-weight: 650; cursor: pointer;
}
.tab.on { background: #fff; color: #1c2024; box-shadow: 0 1px 2px rgba(0, 0, 0, .12); }
.tab .n { color: #8b8d98; font-weight: 600; }
.p-body { flex: 1; overflow: auto; padding: 12px 12px 16px; overscroll-behavior: contain; }
.p-body[hidden] { display: none; }
.deck-note { margin-bottom: 6px; }
.deck-note .label { display: flex; align-items: center; gap: 6px; margin-top: 0; }
.group { margin-top: 14px; }
.g-head {
  display: flex; align-items: center; gap: 6px; padding: 4px 6px; border-radius: 7px; cursor: pointer;
  color: #60646c; font-size: 12px; font-weight: 750;
}
.g-head:hover { background: #f7f7f8; color: #1c2024; }
.g-head .t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 550; color: #8b8d98; }
.row { display: flex; align-items: flex-start; gap: 9px; padding: 8px; border-radius: 10px; cursor: pointer; }
.row:hover, .row.focus { background: #f4f4f6; }
.num {
  flex: none; min-width: 20px; height: 20px; padding: 0 5px; margin-top: 1px; border-radius: 10px 10px 10px 3px;
  background: var(--c); color: #fff; font-size: 11px; font-weight: 750; display: flex; align-items: center; justify-content: center;
}
.r-main { flex: 1; min-width: 0; }
.r-type { display: flex; align-items: center; gap: 6px; color: var(--c); font-size: 11px; font-weight: 750; }
.r-type .warn { color: #ce2c31; font-weight: 650; }
.r-text { margin-top: 1px; color: #1c2024; word-break: break-word; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.r-text s { color: #8b8d98; text-decoration-color: rgba(229, 72, 77, .7); }
.r-text .to { color: #f76b15; font-weight: 700; margin: 0 3px; }
.r-text .cm { color: #3c4149; }
.r-text .q { color: #8b8d98; }
.r-del { visibility: hidden; flex: none; width: 24px; height: 24px; display: grid; place-items: center; border: 0; border-radius: 6px; background: none; color: #8b8d98; cursor: pointer; }
.row:hover .r-del { visibility: visible; }
.r-del:hover { background: #e4e4e9; color: #1c2024; }
.empty { padding: 18px 6px 4px; color: #60646c; font-size: 13px; line-height: 1.75; }
.empty h4 { margin: 0 0 8px; color: #1c2024; font-size: 14px; }
.empty ul { margin: 0; padding-left: 18px; }
.empty li { margin: 3px 0; }
.empty b { color: #1c2024; }
.p-foot { display: flex; gap: 8px; padding: 12px; border-top: 1px solid #ececf0; background: #fbfbfc; }
.p-foot .btn { height: 38px; }
.p-foot .grow { flex: 1; }
.p-foot .hint { flex-basis: 100%; margin: -4px 0 0; color: #8b8d98; font-size: 11.5px; }
.p-foot { flex-wrap: wrap; }
.round { margin-bottom: 10px; padding: 10px 12px; border: 1px solid #ececf0; border-radius: 12px; }
.round-head { display: flex; align-items: center; gap: 8px; }
.round-title { font-weight: 750; }
.round-meta { color: #8b8d98; font-size: 12px; }
.status { margin-left: auto; padding: 2px 8px; border-radius: 999px; background: #f0f0f3; color: #60646c; font-size: 11px; font-weight: 700; }
.status.applied { background: #e6f6eb; color: #18794e; }
.status.working { background: #e6f4fe; color: #0d74ce; }
.status.queued { background: #fff4d5; color: #ab6400; }
.reply { margin-top: 8px; padding: 8px 10px; border-radius: 9px; background: #f4f4f6; font-size: 12.5px; white-space: pre-wrap; word-break: break-word; }
.reply .who { display: flex; align-items: center; gap: 5px; margin-bottom: 2px; color: #60646c; font-size: 11px; font-weight: 700; }
.round-items { margin: 8px 0 0; padding: 0; list-style: none; color: #60646c; font-size: 12px; }
.round-items li { display: flex; gap: 6px; margin: 3px 0; }
.round-items .num { min-width: 18px; height: 18px; font-size: 10px; margin: 0; }
.round-items span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.round-actions { display: flex; gap: 6px; margin-top: 8px; }
.round-actions .btn { height: 28px; padding: 0 10px; font-size: 12px; }

/* ── toast · modal · banner ──────────────────────────── */
.toasts { position: fixed; top: 14px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 8px; pointer-events: none; }
.toast {
  flex: none; display: flex; align-items: center; gap: 10px; max-width: min(620px, 92vw); padding: 10px 14px; border-radius: 12px;
  background: #1c2024; color: #fff; font-weight: 550; box-shadow: 0 12px 32px rgba(0, 0, 0, .26);
  pointer-events: auto; animation: rp-drop .18s ease-out; white-space: pre-wrap;
}
.toast.k-warn { background: #ab6400; }
.toast.k-error { background: #ce2c31; }
.toast.k-ai { align-items: flex-start; background: #fff; color: #1c2024; border: 1px solid #d9d9e0; }
.toast .msg { min-width: 0; }
.toast.k-ai .ico { color: #30a46c; margin-top: 1px; }
.toast .act { flex: none; border: 0; padding: 4px 9px; border-radius: 7px; background: rgba(255, 255, 255, .16); color: inherit; font-weight: 650; cursor: pointer; }
.toast.k-ai .act { background: #f0f0f3; }
@keyframes rp-drop { from { opacity: 0; transform: translateY(-8px); } }
.backdrop { position: fixed; inset: 0; display: grid; place-items: center; background: rgba(15, 17, 20, .38); pointer-events: auto; animation: rp-fade .15s; }
@keyframes rp-fade { from { opacity: 0; } }
.modal {
  width: min(var(--w, 480px), 92vw); max-height: 88vh; overflow: auto; padding: 20px 22px; border-radius: 16px;
  background: #fff; box-shadow: 0 30px 70px -14px rgba(0, 0, 0, .45); animation: rp-pop .15s ease-out;
}
.modal h3 { display: flex; align-items: center; gap: 8px; margin: 0 0 10px; font-size: 16px; letter-spacing: -0.02em; }
.modal p { margin: 6px 0; color: #3c4149; line-height: 1.65; }
.modal ul { margin: 6px 0; padding-left: 20px; color: #3c4149; line-height: 1.8; }
.modal code { padding: 1px 6px; border-radius: 5px; background: #f0f0f3; font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; }
.modal pre {
  max-height: 56vh; overflow: auto; margin: 8px 0 0; padding: 12px 14px; border-radius: 10px; background: #f7f7f8;
  font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; word-break: break-word; user-select: text;
}
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
.banner {
  position: fixed; top: 14px; right: 14px; display: flex; align-items: center; gap: 10px; padding: 10px 12px 10px 14px;
  border-radius: 12px; background: #1c2024; color: #fff; font-weight: 550; box-shadow: 0 12px 32px rgba(0, 0, 0, .26); pointer-events: auto;
}
.banner .btn { height: 28px; }
.banner.status { top: auto; bottom: 70px; right: 50%; transform: translateX(50%); max-width: min(560px, 92vw); background: #ce2c31; }
.onboard {
  position: fixed; width: 300px; padding: 14px 16px; border-radius: 14px; background: #1c2024; color: #fff;
  box-shadow: 0 18px 40px rgba(0, 0, 0, .3); pointer-events: auto; animation: rp-pop .2s ease-out; line-height: 1.6;
}
.onboard h4 { margin: 0 0 6px; font-size: 14px; }
.onboard ul { margin: 0 0 10px; padding-left: 18px; color: rgba(255, 255, 255, .85); font-size: 12.5px; }
.onboard kbd { background: rgba(255, 255, 255, .16); border-color: transparent; color: #fff; }
.onboard .btn { height: 28px; background: #fff; border-color: #fff; }
.rp.ended > :not(.toasts):not(.endcard) { display: none !important; }
.endcard { left: 50%; bottom: 24px; transform: translateX(-50%); width: 340px; }
.endcard p { margin: 0; color: rgba(255, 255, 255, .85); font-size: 12.5px; }
.endcard p + p { margin-top: 6px; }
.endcard code { color: #fff; background: rgba(255, 255, 255, .16); border-radius: 4px; padding: 1px 4px; white-space: nowrap; }
`;

// Styles injected into the deck document itself: text marks via the CSS Custom Highlight API.
export const DOC_CSS = `
::highlight(redpen-delete) { background-color: rgba(229, 72, 77, .20); color: inherit; text-decoration: line-through 2px rgba(229, 72, 77, .95); }
::highlight(redpen-replace) { background-color: rgba(247, 107, 21, .22); color: inherit; text-decoration: underline wavy rgba(247, 107, 21, .95); }
::highlight(redpen-comment) { background-color: rgba(62, 99, 221, .18); color: inherit; text-decoration: underline 2px rgba(62, 99, 221, .9); }
::highlight(redpen-focus) { background-color: rgba(255, 214, 10, .55); }
`;

// While reviewing text, make sure decks that disable selection (user-select: none) can still be marked.
export const TEXT_MODE_CSS = `
body, body *:not(img):not(video):not(canvas):not(button):not(input):not(select):not(textarea) {
  -webkit-user-select: text !important; user-select: text !important;
}`;

export const PICK_MODE_CSS = (cursor) => `
html, html * { cursor: ${cursor} !important; -webkit-user-select: none !important; user-select: none !important; }`;
