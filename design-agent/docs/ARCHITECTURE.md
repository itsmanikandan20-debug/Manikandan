# AI Design Agent — Architecture & Implementation Plan

> Status: **Step 1 built** (typed chat in the helper window). This document is
> the agreed blueprint. We build it phase by phase (see §9), and each phase ends
> with something you can try on your own computer.
>
> **Decisions made with the user (these override anything below that differs):**
> - **AI:** Google **Gemini free tier** instead of the Anthropic API (no paid key).
>   The newest stable "flash" model is picked automatically. The AI code sits
>   behind one small module (`server/ai/`) so Ollama or another provider can be
>   added later.
> - **Voice:** free browser voice (Web Speech API + `speechSynthesis`).
> - **Computer:** Windows. Started by double-clicking `Start Design Agent.bat`.
> - **Hosting:** none. Everything runs locally; no Vercel.
> - **Language:** plain JavaScript (no TypeScript, no build step) so it runs
>   with just `node`, which keeps setup simple for a beginner.
> - **Figma auto-start:** the plugin can't start itself, so the local server
>   will press Figma's "run last plugin" shortcut (Ctrl+Alt+P) for the user
>   when Figma is in front and the plugin isn't connected yet (Step 8).

---

## 1. What we are building (in one paragraph)

One AI design partner that you **talk to**. It can **see** the website in
your Chrome tab and the design open in Figma Desktop, **discuss** it with you
like a senior UX/UI designer, **point** at the exact things it is talking
about with its own on-screen pointer, and — **only after you say yes** —
**act**: take screenshots, place them in Figma, and edit your Figma file.

Internally it is several small programs; to you it is one assistant with one
voice, one conversation and one memory.

---

## 2. Requirements → what each one actually needs

| # | Requirement | What it really needs technically |
|---|---|---|
| 1 | Voice-first conversation | Microphone capture, speech-to-text (STT), text-to-speech (TTS), "barge-in" (you can interrupt), a typed fallback |
| 2 | Website analysis | Read the live page's DOM + computed CSS + a screenshot, from **your** browser (so logged-in pages work) |
| 3 | Screenshot capture | Chrome's tab capture API; for full pages, scroll-and-stitch |
| 3b | Screenshot → Figma | Move the image bytes to Figma and create an image node with the Plugin API |
| 4 | Figma analysis | Read the real node tree (frames, text, auto-layout, styles, variables, components) via the Figma Plugin API — not just pixels |
| 5 | AI pointer | An overlay drawn on the web page, and a temporary marker on the Figma canvas, both driven by the agent and synchronised with its speech |
| 6 | Conversational review | An LLM with a strong "design partner" system prompt, conversation memory, and grounded data (real px/hex values) |
| 7 | Approval before editing | A **hard gate in code** (not just an instruction to the AI) that blocks every change until you approve |
| 8 | Figma actions | Figma Plugin API calls: text, fonts, fills, auto-layout spacing, position, size, components, duplicate, group/organise |
| 9 | Find/move assets | Search the file's nodes (image fills, names, thumbnails) + a local log of what the agent inserted |
| 10 | One unified tool | One "brain" (local server) that owns the conversation and routes tool calls to the browser or Figma |
| 11 | Real agent loop | Observe → Understand → Discuss → Suggest → Ask approval → Act → Verify, implemented as an LLM tool-use loop |
| 12 | Local-first | Everything runs on `localhost`. No database, no login, no hosting. Only external calls: the AI model (and optionally voice) |

---

## 3. The architecture

```
                    ┌──────────────────────────────────────────┐
   YOU  ──voice──►  │  AGENT CONSOLE  (the assistant's "face")  │
        ◄─voice───  │  mic · speaker · transcript · approve btn │
                    └───────────────┬──────────────────────────┘
                                    │ WebSocket (localhost)
                    ┌───────────────▼──────────────────────────┐
                    │  LOCAL AGENT SERVER  (the "brain")        │
                    │  Node.js · http://localhost:3456          │
                    │  • agent loop (Gemini API, tool use)      │
                    │  • approval gate  • session memory        │
                    │  • tool router    • files in ./data       │
                    └───────┬───────────────────────┬──────────┘
                WebSocket   │                       │  WebSocket
             ┌──────────────▼─────────┐   ┌─────────▼──────────────────┐
             │ CHROME EXTENSION       │   │ FIGMA PLUGIN (Desktop)     │
             │ "browser eyes & hands" │   │ "Figma eyes & hands"       │
             │ • read DOM + styles    │   │ • read node tree           │
             │ • screenshot tab       │   │ • edit nodes (approved)    │
             │ • AI pointer overlay   │   │ • place images             │
             └────────────────────────┘   │ • AI pointer marker        │
                                          └────────────────────────────┘
                           │
                    ┌──────▼──────────┐
                    │ Google Gemini   │  ← the only required cloud service
                    │ (free tier)     │
                    └─────────────────┘
```

### 3.1 The five parts and their jobs

**A. Local Agent Server — the AI agent / the brain** (`server/`)
- A small Node.js program you start by double-clicking `Start Design Agent.bat`.
- Owns the single conversation, calls the AI, decides which tool to use,
  enforces approvals, stores screenshots and history as plain files in
  `./data`.
- Is the only part that holds your API key. The extension and plugin never see it.

**B. Agent Console — voice + chat UI** (`console/`)
- A web page served by the server at `http://localhost:3456`.
- Open it once in a small Chrome "app window"
  (`chrome --app=http://localhost:3456`) and park it beside Figma/your browser.
- Does: microphone, STT, TTS, live transcript, text box, approval cards
  (Approve / Reject), connection status lights (Browser ● Figma ●).
- Later (optional, Phase 7): wrap it in Electron for an always-on-top
  floating window and a global push-to-talk hotkey.

**C. Chrome Extension — browser interaction** (`extension/`, Manifest V3)
- *Content script* (runs inside the web page): extracts a compact
  "design snapshot" — visible elements with bounding boxes, text, computed
  font family/size/weight/line-height, colors, backgrounds, margins/padding,
  gaps between siblings, heading outline, landmarks, links/buttons, alt text,
  contrast ratios. Every element gets a short ID like `w17` so the AI can
  refer to it precisely.
- Draws the **AI pointer**: a distinct coloured arrow + label + highlight box,
  inside a Shadow DOM so the site's CSS can't break it and it never blocks
  your clicks.
- *Background service worker*: keeps the WebSocket to the server, takes
  screenshots (`chrome.tabs.captureVisibleTab`), reports which tab is active.

**D. Figma Plugin — Figma integration** (`figma-plugin/`)
- A development plugin you import once into **Figma Desktop**
  (Plugins → Development → Import plugin from manifest).
- Two halves, because that is how Figma plugins work:
  - *main code* (`code.js`): has the Figma Plugin API (`figma.*`) but **no
    network**. Reads/edits the document.
  - *UI iframe* (`ui.html`): has network access (to `localhost` only, declared
    in the manifest) but no document access. Holds the WebSocket and relays
    messages to the main code via `postMessage`.
- Serialises the current selection / frame / page into a compact JSON
  (names, types, x/y/w/h, auto-layout direction/padding/itemSpacing, text
  content + font + size + line-height, fills as hex **and** their style /
  variable names, component + variant info). Every node is referenced by its
  real Figma node ID (e.g. `12:345`).
- Executes approved edits, and draws the Figma AI pointer.

**E. Shared protocol** (`shared/`)
- One file describing every message type, used by all parts, so
  they can't drift apart.

### 3.2 How the parts talk

All connections are **WebSockets on localhost:3456**, carrying small JSON
messages. The server is the hub; the other parts are "clients" that register
as `console`, `browser` or `figma`.

```jsonc
// server → extension: a tool request
{ "kind": "request", "id": "r42", "tool": "web.snapshot", "args": { "scope": "viewport" } }
// extension → server: its answer
{ "kind": "result",  "id": "r42", "ok": true, "data": { "url": "...", "elements": [ ... ] } }
// extension/figma → server: something happened (used for "what am I looking at?")
{ "kind": "event", "type": "figma.selectionChanged", "data": { "ids": ["12:345"] } }
```

Inside the extension, the service worker ↔ content script use
`chrome.runtime` messaging. Inside the plugin, UI iframe ↔ main code use
`figma.ui.postMessage` / `parent.postMessage`.

Screenshots travel as PNG files: extension → `POST /captures` → saved in
`data/captures/cap_001.png` → Figma plugin UI downloads it → main code calls
`figma.createImage(bytes)`.

---

## 4. The agent loop (how it "thinks")

The server runs the AI with **tool use**. Each user turn:

1. **OBSERVE** — The server works out the *active surface* (the thing you
   touched last: Chrome tab or Figma selection; "on the website" / "in Figma"
   in your sentence overrides it) and asks that side for a fresh snapshot +
   screenshot. The AI can also call observe tools itself to look closer.
2. **UNDERSTAND** — The AI gets: your words, the structured snapshot (real
   numbers), the screenshot (the visual gestalt), and the conversation so far.
3. **DISCUSS / SUGGEST** — The AI answers in speakable sentences, explaining
   *why*, pointing at elements as it goes.
4. **ASK FOR APPROVAL** — If a change is useful, the AI calls a *mutating*
   tool. The server does **not** run it; it turns it into a **Pending
   Action** ("Reduce gap between *Heading* and *Subtitle* from 32 → 24 px")
   and the AI asks you.
5. **ACT** — Only after your approval does the server send it to Figma.
6. **VERIFY** — The plugin re-reads the changed nodes and exports a small
   image; the AI checks the result and tells you what changed ("Done — the
   gap is now 24 px and the group reads as one unit"). You can say
   "undo that" (we keep the before-values; Figma's own Cmd/Ctrl+Z also works).

### 4.1 Tools the agent can use

| Group | Tools | Needs approval? |
|---|---|---|
| Observe (browser) | `web.snapshot`, `web.inspect(id)`, `web.screenshot`, `web.fontInfo(id)` | No |
| Observe (Figma) | `figma.snapshot(scope)`, `figma.inspect(id)`, `figma.findNodes(query)`, `figma.exportImage(id)`, `figma.listAssets` | No |
| Present | `point_at(target, label)`, `highlight_area(box)`, `clear_pointer`, `figma.focus(id)` (scroll viewport) | No (visual only) |
| Capture | `web.screenshot` (save to local library) | No (saves a local file only) |
| **Change Figma** | `figma.setText`, `figma.setFontSize`, `figma.setFont`, `figma.setFill`, `figma.setSpacing` (auto-layout gap/padding), `figma.move`, `figma.resize`, `figma.setLayout`, `figma.duplicate`, `figma.group`, `figma.rename`, `figma.createComponent`, `figma.placeImage` | **Yes — always** |

### 4.2 The approval gate (why it is safe)

- Mutating tools are marked `requiresApproval` in code. The server
  intercepts them *before* anything is sent to Figma.
- A pending action can be approved only by **you**: clicking *Approve*, or a
  clear spoken/typed "yes / do it / apply it" that the server itself checks
  while exactly one action is pending. The AI cannot approve its own action.
- Anything ambiguous ("hmm, maybe") → not approved; the agent asks again.
- Batch changes are shown as one list ("3 changes: …") and approved together
  or one by one.

### 4.3 Pointer ↔ speech synchronisation

The AI writes its reply with tiny inline markers, e.g.

`[[point:w17|heading]] This heading is doing its job. [[point:w23]] But the button below it…`

The server strips the markers before speaking, splits the text into
sentences, and fires each pointer move **at the moment that sentence starts
playing**. So the arrow moves in step with the voice.

---

## 5. Voice design

- **Continuous mode**: the mic stays open; a pause ends your turn; the agent
  replies; the mic reopens. **Barge-in**: if you start talking while it
  speaks, it stops and listens.
- **Push-to-talk mode** and **typing** are always available.
- **Streaming**: The AI's answer is streamed and spoken sentence by sentence,
  so it starts talking after ~1–2 s instead of waiting for the whole answer.
- Built behind a `VoiceProvider` interface so providers can be swapped:

| Option | STT | TTS | Cost / setup | Quality |
|---|---|---|---|---|
| **A. Start here** | Chrome Web Speech API | Browser `speechSynthesis` | Free, no keys | OK; robotic-ish voice; Chrome sends audio to Google for STT |
| B. Upgrade | Deepgram / OpenAI transcription | ElevenLabs / OpenAI TTS | Paid API keys | Natural, faster, better with design jargon |
| C. Fully local (later) | whisper.cpp | Piper | Free, but heavier install | Good, more setup |

Tip: use headphones — speakers + open mic causes echo and self-interruption.

---

## 6. Technologies that are actually necessary

| Part | Technology | Why this one |
|---|---|---|
| Everything | **JavaScript** on **Node.js 18+**, no build step | One language everywhere; you already have Node |
| Monorepo | npm workspaces | No extra tools |
| AI | **Google Gemini API, free tier** (streaming, image input, function calling), plain `fetch` | The agent brain, free |
| Server | Node `http` + `ws` (WebSocket) | Tiny, no framework needed |
| Console UI | Plain HTML, CSS and JavaScript served by the local server | Nothing to build or install |
| Extension | Chrome Manifest V3 (`tabs`, `scripting`, `activeTab`, `storage`) | Official, required for tab screenshots and DOM access |
| Figma | Figma **Plugin API** (official) + esbuild to bundle | Only official way to read *and write* the open file |
| Voice | Web Speech API → swappable providers | Zero setup first |
| Storage | Plain JSON + PNG files in `./data` | No database needed |

**Not needed (on purpose):** database, user accounts, cloud hosting, Docker,
Figma REST API tokens (the plugin already has full access to the open file),
Playwright (we use your real browser instead).

About the official **Figma MCP server**: useful for coding assistants, but for
this product the Plugin API is the right core — it works offline against the
open file, can write, and is what lets us draw a pointer. We can revisit MCP later.

---

## 7. Local vs external

| Runs 100 % on your computer | Needs an external service |
|---|---|
| Agent server, approval gate, memory, file storage | **Google Gemini API (free tier)** — required |
| Chrome extension (DOM reading, screenshots, pointer) | STT: Chrome's Web Speech API uses Google's servers (free) — or a paid provider |
| Figma plugin (reading, editing, pointer) | TTS: browser voices are local/free; premium voices are paid APIs |
| Console UI | Figma Desktop itself syncs your file to Figma's cloud as usual |

**AI service:** Google Gemini's free tier (key from
<https://aistudio.google.com/apikey>, no credit card). It has per-minute and
per-day limits; the helper window says so plainly when one is hit. On the free
tier Google may use prompts to improve its products.

Privacy: page contents, screenshots and Figma data you discuss are sent to
Google's Gemini API. The extension only reads a tab when you ask the agent
something about it.

---

## 8. Honest limitations

### Browser
- Works in **Chrome** (and Chromium browsers like Edge/Brave). Not Safari/Firefox at first.
- Chrome blocks extensions on `chrome://` pages, the Chrome Web Store, and
  some built-in PDF viewers.
- Cross-origin iframes (embedded videos, some checkout widgets), `<canvas>`/
  WebGL content, and closed shadow DOM can only be *seen* in the screenshot,
  not read structurally.
- **Fonts:** CSS tells us the *declared* stack (`"Inter", Arial, sans-serif`)
  and which web fonts actually loaded (`document.fonts`). Knowing the exact
  *rendered* font for every glyph needs Chrome's debugger API, which shows a
  "being debugged" banner — we'll offer that as an opt-in "deep font check".
- Screenshots capture the **visible part** of the tab. Full-page capture =
  scrolling + stitching, which can glitch with sticky headers / lazy content.
- The analysis sees the page **as it is right now** (your hover/menu states
  vanish when you click into the console).

### Figma
- The plugin must be **started manually** each time you open a file
  (Plugins → Development → AI Design Agent). Figma doesn't allow auto-start.
  It can then keep running in the background (a small minimised panel).
- It only sees the **currently open file**. It can't browse your other
  files or projects. "The screenshot I uploaded earlier" is searched within
  this file (all pages) plus the agent's own log of what it inserted.
- The Plugin API has **no overlay layer**, so the Figma pointer is a real,
  temporary, locked node named `🤖 AI Pointer`. Collaborators in the file can
  briefly see it; it's removed automatically when it moves away, when the
  plugin closes, or on "clear pointer". This is the one thing the agent adds
  without asking, and it never touches your layers.
- The plugin cannot see your mouse cursor. It *can* read your selection,
  current page and visible viewport area — that's how it knows what "this"
  means.
- Editing text requires the font to be installed/loadable; missing fonts
  block text edits (the agent will tell you).
- Instances can only change overrides; main components from a *team library*
  must be edited in the library file.
- `figma.createImage` accepts images up to 4096 × 4096 px; taller full-page
  screenshots are sliced into stacked images.
- Very large files are slow to serialise, so the agent reads the selection /
  current frame first and zooms in on demand rather than reading everything.

### "Which one am I looking at?"
- Neither Chrome nor Figma can tell us which app window is in front of you.
  We use "last activity" (you switched tabs → browser; you selected something
  in Figma → Figma) plus your words ("in Figma…", "on this site…"). The
  console always shows which one it thinks is active; you can tap to switch.

### AI
- Design judgments are opinions — good ones, grounded in real numbers, but it
  can be wrong. It will say *why*, so you can disagree.
- Pixel measurements come from DOM/Figma data, **not** guessed from the image.
- Voice round-trip latency is roughly 1–3 seconds.

---

## 9. Build plan — step by step

Each phase is small and ends with a demo you can run. We only move on when
the previous phase works on your machine.

| Phase | What we build | You can try… |
|---|---|---|
| **0. Foundation** | Workspace skeleton, `.env` with API key, server + WebSocket hub, console with **typed** chat to the AI | "Hi, are you there?" → a reply in the console |
| **1. Browser eyes** | Chrome extension: connect, page snapshot + screenshot tools, "design partner" system prompt | Type "Review this page" on any website → grounded critique |
| **2. Voice** | Continuous voice (Web Speech), sentence-streamed TTS, barge-in, push-to-talk | *Say* "What font are they using?" and hear the answer |
| **3. Browser pointer** | Overlay pointer + inline `[[point:…]]` sync with speech | The arrow moves to each element as it talks about it |
| **4. Figma eyes** | Figma plugin: connect, selection/frame snapshot, export image, Figma pointer, active-surface detection | "Is this spacing correct?" on a Figma frame |
| **5. Figma hands** | Approval gate + pending-action cards, edit tools, verify step, undo | "Tighten that spacing" → it proposes → you say "yes" → it edits and checks |
| **6. Screenshots ↔ Figma** | Capture library, transfer to Figma, asset log, find/select/move assets | "Screenshot this page… put it in my Figma file… where's the one from earlier? Move it next to the hero" |
| **7. Polish** | Conversation memory summaries, better voice provider option, full-page capture, optional Electron floating window + global hotkey | Feels like a colleague beside you |

### Planned folder structure

```
design-agent/
├── Start Design Agent.bat  ← double-click to start (Windows)
├── package.json            ← one dependency: ws
├── .env.example            ← GEMINI_API_KEY=... (the helper window fills .env for you)
├── docs/ARCHITECTURE.md    ← this file
├── server/                 ← the brain
│   ├── index.js            ← http + WebSocket hub, serves the helper window
│   ├── env.js              ← reads/writes .env
│   ├── open-window.js      ← opens the helper as an app window
│   ├── ai/gemini.js        ← talks to Gemini (swappable)
│   └── agent/              ← agent loop, system prompt; later: tools, approvals
├── console/                ← helper window (index.html, style.css, app.js)
├── extension/              ← Step 2: Chrome add-on (load unpacked)
├── figma-plugin/           ← Step 5: import manifest in Figma Desktop
└── data/                   ← screenshots, logs (git-ignored)
```

Daily use, once built: double-click **Start Design Agent** → the helper window
opens → the Chrome add-on is already on → Figma connects automatically → talk.

---

## 10. Decisions

Confirmed; see the list at the top of this document.
