/* Redpen example deck (used for the README videos) — the content is a made-up team workshop.
   The engine (app.js) and design (styles.css) come from a real presentation deck; edit only this file. */
window.DECK = {
  brand: "Making Presentations with AI", short: "HTML Slides Workshop", mark: "WORKSHOP",
  ui: {
    placeholder: "Coming soon", stepHint: "→ next step · ← previous step", copy: "Copy prompt", copied: "Copied ✓", prep: "You need",
    srcTitle: "Sources", srcLead: "Used for non-commercial education only. All images and videos belong to their creators.", srcPrefix: "Sources · ",
    soundOff: "Sound off", soundOn: "Sound on", total: "{n} slides", tapGo: "Tap to go", clickGo: "Click to go · Esc to close", close: "Close",
    swipe: "Swipe left or right to turn slides",
  },
};

window.SLIDES = [
  {
    layout: "cover",
    kicker: "Team workshop · design & planning",
    title: "Making presentations<br>with AI",
    sub: "AI drafts fast,<br>people decide and finish",
    meta: ["<b>Nov 18, 2026</b>", "Whole product team · 90 min", "Hosted by Design Systems"],
  },
  {
    layout: "table", eyebrow: "Today", title: "Agenda",
    cols: ["#", "Topic", "Format"],
    rows: [
      ["01", "Why HTML slides", "Concept"],
      ["02", "From draft to talk", "Hands-on · first draft"],
      ["03", "Fixing on the screen", "Hands-on · marks and edit requests"],
      ["04", "What makes a good edit request", "Discussion"],
      ["05", "Team rules", "Wrap-up"],
    ],
  },
  {
    layout: "cards", eyebrow: "Why HTML", title: "Why HTML slides",
    cards: [
      { k: "01", h: "Source as text", p: "Every sentence and layout lives in code, so AI can read and fix it directly." },
      { k: "02", h: "Version history", p: "Branch with git and see at a glance what changed and when." },
      { k: "03", h: "Reusable layouts", p: "Covers, tables and card grids carry over to the next talk as they are." },
    ],
  },
  {
    layout: "statement", eyebrow: "The real problem",
    big: "Drafts take 10 minutes,<br><em>edits take 2 hours</em>",
    small: "Most of the time goes into explaining where and how to fix things.",
  },
  {
    layout: "section", no: "02", eyebrow: "CHAPTER 02", title: "From draft to talk",
    desc: "Five steps, each with a clear owner.",
    items: ["Scope", "AI draft", "Screen review", "Apply edits", "Rehearsal"],
  },
  {
    layout: "timeline", eyebrow: "Workflow", title: "From draft to talk",
    lead: "Always review on the screen you will present from.",
    items: [
      { date: "STEP 1", h: "Scope and audience", p: "Write in one line who decides what in this meeting." },
      { date: "STEP 2", h: "AI draft", p: "Give the outline and key messages, get an HTML draft back." },
      { date: "STEP 3", h: "Screen review", p: "Look at the real slides and mark what to fix.", key: true },
      { date: "STEP 4", h: "Apply edits", p: "The AI takes the marks, edits the source and shows it again." },
      { date: "STEP 5", h: "Rehearsal", p: "Click through in order and polish the last details." },
    ],
  },
  {
    layout: "table", eyebrow: "Edit requests", title: "Explaining vs. marking",
    lead: "The same fix takes very different time depending on how it is passed on. And this is very important.",
    cols: ["", "Explain in chat", "Mark on screen"],
    rows: [
      ["Pointing at the spot", "“Page 7, second paragraph…”", "Drag over it"],
      ["Time per request", "12 min on average", "2 min on average"],
      ["Follow-up questions", "Frequent", "Rare"],
      ["What the AI gets", "Your sentence only", "Slide number · text · source line"],
    ],
  },
  {
    layout: "compare", eyebrow: "Writing requests", title: "What makes a good edit request",
    sides: [
      { who: "Vague", h: "“Make it cleaner”", bullets: ["Nothing specific to change", "Means something different to everyone", "Hard to check the result"] },
      { who: "Good", inv: true, h: "“Stack the two cards, title on one line”", bullets: ["Clear target and result", "One thing at a time", "Easy to check"] },
    ],
  },
  {
    layout: "cards", eyebrow: "Team", title: "Team rules",
    cards: [
      { k: "01", h: "One source", p: "Edit the deck in one repository only; no copies passed around." },
      { k: "02", h: "Mark on screen", p: "Leave fixes as marks on the slides instead of long messages." },
      { k: "03", h: "Same session applies", p: "The AI session that made the deck takes the marks and edits it." },
    ],
  },
  { layout: "end", eyebrow: "THANK YOU", title: "Questions & discussion", sub: "Practice files are in the team's shared folder." },
];
