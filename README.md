<div align="center">

# <img src="docs/logo.svg" width="30" height="30" alt=""> Redpen

Mark up your AI-made HTML slides in the browser, and the AI that made them fixes them.

**English** | [한국어](README.ko.md)

<p><img src="docs/hero-en.png" alt="Slides marked up with Redpen" width="100%"></p>

</div>

Getting an AI to draft HTML slides is quick. Fixing them takes longer, because you have to describe every change in words: "on slide 7, delete 'And this is very important' from the second paragraph."

Redpen lets you mark the slides directly in the browser. Drag over a sentence to delete or replace it, drag a card to move it, or draw a box on empty space to leave a note. Each mark becomes an edit request with the slide number, the original text and the source file and line, and goes to the Claude Code or Codex session that made the slides. When the AI has edited the files, the page reloads and shows its reply.

## Install

Requires Node.js 18 or later.

```bash
npm install -g @woosopyi/redpen
redpen setup
```

`redpen setup` installs the redpen skill for Claude Code and Codex. To update, run `npm update -g @woosopyi/redpen`; the installed skill catches up the next time you open Redpen. To uninstall, run `redpen setup --remove` and then `npm uninstall -g @woosopyi/redpen`.

## Usage

In the AI session that made your slides, type `/redpen` (or `$redpen` in Codex). You can also just say "let's review with redpen".

The AI opens the review page in your browser and waits. Mark what you want changed and click Send to AI. The AI edits the files, the page reloads, and the AI's reply tells you what it changed. Repeat as many times as you like. When you're done, click the quit button (⏻) at the right end of the toolbar, or tell the AI "end the review".

You can also open a deck yourself:

```bash
redpen slides/index.html
```

Whatever you send is saved, and the AI applies it later when you say "apply my review" in your session. If you use some other AI chat, the Copy button in the list panel copies the edit request so you can paste it there.

### Fixing text

Drag over the text, then press D to delete it, R to replace it, or C to comment.

<img src="docs/media/en/01-text.gif" alt="Dragging over text and pressing D, R and C to delete, replace and comment" width="100%">

### Changing the layout

In Layout mode, click a card or an image and drag it to move it. Drop it on another slot to change the order. Pull a corner to resize it, and use the bar below it for font size and spacing. What you see is a preview; the AI makes the real change in the files after you send.

<img src="docs/media/en/02-layout.gif" alt="Dragging a card to reorder it and pulling a corner to enlarge it" width="100%">

### Empty space and whole slides

In Area mode, draw a box on empty space and write something like "add a picture here". The slide menu in the toolbar lets you comment on a whole slide, delete it or move it. You can also sketch a new layout for the slide there by drawing boxes.

<img src="docs/media/en/03-areas-slides.gif" alt="Leaving a note on empty space, sketching a new layout and marking a slide for deletion" width="100%">

### Sending to the AI

The waiting AI session picks up your marks and edits the source. The toolbar shows "AI working" in the meantime, and the page reloads when it's done.

<img src="docs/media/en/04-send.gif" alt="The AI session applying the edit request and the page reloading" width="100%">

These are real screen recordings. The deck in them is in [examples/showcase](examples/showcase), and you can open it with `redpen examples/showcase/en.html --lang en`.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `D` `R` `C` | Delete, replace or comment on the selected text. In Layout mode, mark the selected element for deletion or comment on it |
| `Alt+1` `Alt+2` `Alt+3` | Text, Layout and Area mode |
| `Shift+arrows` | Nudge the selected element (add `Alt` for bigger steps) |
| `Alt+↑` `Alt+↓` | Select the parent or child element |
| `⌘Z` `⌘⇧Z` | Undo, redo (`Ctrl` on Windows) |
| `⌘Enter` | Send to AI |
| `Esc` | Deselect, close the open popup |

Turn slides with the deck's own keys (arrows, space). The arrow keys keep turning slides in Layout mode, even with an element selected.

A few more things:

- Elements you drag snap to the center of the slide and to the edges of other elements. Hold `Alt` while dragging to turn snapping off.
- Marks are saved as you go. After a reload, or after the AI has edited the files, each mark finds its text again. If the text changed too much to be sure, the mark is flagged "not found on the page" instead of ending up in the wrong place.
- Instructions for the whole deck ("make all the text bigger") go in the Deck-wide instructions box at the top of the list panel.
- To use the deck's own buttons or videos, click the pause button in the toolbar. It also hides your marks, which helps when you want to compare with the original.
- Drag the Redpen logo at the left of the toolbar to move the toolbar. Click the logo to collapse it, and double-click to put it back in place.

## What the AI receives

When you send, the AI gets text like this. Even if the slide content lives in a script such as `slides.js` instead of the HTML, Redpen finds the visible text in the sources and tells the AI which file and line to edit.

```markdown
# ✒️ Redpen edit request · round 1

- File: `/Users/me/slides/data-101/index.html`
- Sources that hold the content: `index.html`, `slides.js`, `deck.js`
- Slide numbering: `.slide` elements in document order (4 in total) — "Slide N" is the Nth one
- Requests: 🗑 Delete 1 · ✏️ Replace 1 · 💬 Comment 1

## How to apply
1. 🗑 **Delete** — remove only the marked text, element or slide. …

## Slide 3 · “Handling missing values”
Slide location: around `slides.js:23`

### #1 🗑 Delete element `<div>`
- Target: `<div class="box">` — content: "Delete Drop rows when only a few values are missing at random. …"
- Location: DOM `div#deck > section.slide:nth-of-type(3) > div.body > div.two > div.box:nth-of-type(1)` · Source: `slides.js:25`

### #2 ✏️ Replace text
- Original: `mean, median or mode`
- New: `mean or median`
- Location: DOM `… > div.box:nth-of-type(2) > p` · Source: `slides.js:26`

### #3 💬 Comment · text
- **Instruction:** move this tip above the boxes
- Original: `Before deleting missing values, find out why they are empty`
- Context: …this can distort the distribution. Tip: ⟦Before deleting missing values, find out why they are empty⟧. Data Analysis 10103…
- Location: DOM `div#deck > section.slide:nth-of-type(3) > div.body > p.note` · Source: `slides.js:28`
```

<details>
<summary>When you change the layout</summary>

The AI also gets the current layout (which slot of which flex or grid container) and what to change, with numbers before and after.

```markdown
### #3 📐 Layout change · element `<div>`
- Target: `<div class="card">` — content: "Be careful with Recent facts, exact numbers, …"
- Now: middle right of the slide (x 51–94%, y 37–85%) · the 2nd of 2 slots in `div.cols` (grid · 2 columns)
- Change:
  - Order: 2nd → 1st — before “Good at First drafts, …”
  - Size: scale up to 110% — keep the proportions (width 43% → 47%)
  - Font size: 24px → 29px (+21%)

### #4 📐 New layout sketch
- Rebuild this slide following the boxes below (a wireframe). The numbers are the reading order.
  1. "Big photo" — middle left (x 5–50%, y 30–90%) · there now: `<div>` "Good at …"
  2. "Three lines of text" — middle right (x 55–95%, y 30–90%) · there now: `<div>` "Be careful with …"
```

</details>

## Supported decks

Redpen works with decks that stack `.slide` elements and show one at a time (arrow keys or a `#5`-style address), scrolling decks, reveal.js, and decks that scale a 1920×1080 stage with `transform: scale()`. Decks built with JavaScript and plain web pages without slides work too.

Click-to-advance decks don't advance while you drag or double-click text. If the slide numbers come out wrong, tell Redpen what a slide is:

```bash
redpen open deck.html --slide "section.page"
```

## Commands

| Command | Description |
|---|---|
| `redpen <html>`, `redpen open <html>` | Open the review page. Options: `--port`, `--slide <selector>`, `--lang ko\|en`, `--no-open` |
| `redpen status` | Server address, whether an AI is waiting, and what was sent (`--json`) |
| `redpen stop` | Stop the review server. It also stops on its own after two hours without a browser |
| `redpen setup` | Link the command and install the skill. `--claude` or `--codex` for just one, `--remove` to uninstall |

These are for the AI:

| Command | Description |
|---|---|
| `redpen wait` | Wait until the browser sends, then print the edit request. `--reply` answers the previous one, `--timeout` sets how long to wait (seconds) |
| `redpen pending` | Print edit requests that haven't been applied yet |
| `redpen done` | Report the result to the page with `--reply` and stop waiting. With `--stop`, the review page closes too |

Without `html`, the file you opened last is used. `wait` exits with 0 when it gets an edit request and 2 when it times out.

## Language

The page, the edit requests and the command output come in English and Korean. Redpen follows your computer's language by default. To pick one, add `--lang en` or set `REDPEN_LANG=en`. A page that is already open switches language at the same address. Text inside your deck is passed on as written, whatever the language.

## Data and security

Marks and sent requests are stored next to the deck in `.redpen/<file name>/`, including the text the AI received (`rounds/0001.md` and so on). A `.gitignore` inside keeps the folder out of git.

The review server only listens on your own machine (`127.0.0.1`) and ignores requests from other websites. It never serves files outside the deck folder, or dot files such as `.git` and `.env`.

## Troubleshooting

- Slide numbers are off: tell Redpen what a slide is with `--slide`.
- The toolbar says "AI offline": run `/redpen` in your AI session, or send first and then say "apply my review".
- The browser didn't open: open the address printed in the terminal (`http://localhost:4545/…`).
- "Lost the connection to the review server": the server has stopped. Open the deck again with `redpen <html>`. Marks you were making are saved once it reconnects.
- The server log is in `.redpen/<file name>/server.log`.

## Development

```bash
npm install          # puppeteer-core for the tests (uses your installed Chrome)
npm test             # unit tests
npm run test:e2e     # browser tests (CHROME_PATH picks the browser, HEADFUL=1 shows the window)
npm run demo         # open the Korean example deck (npm run demo:en for English)
npm run screenshots  # rebuild the image at the top of this README
npm run media        # rebuild the README videos (needs ffmpeg, FFMPEG=path)
```

To use a clone directly, run `node bin/redpen.mjs setup` in it. That links the `redpen` command into `~/.local/bin` (use `npm link` if that isn't on your PATH).

The server and CLI are in `src/*.mjs`, and the in-page overlay is in `src/client/`, written as dependency-free ES modules.
