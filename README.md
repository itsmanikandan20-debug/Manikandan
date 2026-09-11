# DesignCheck

**A Figma-to-Live-Website QA tool.** Paste a Figma design link and a live
website link, pick a screen size, and DesignCheck compares them — flagging
mismatched button text, wrong colors, missing images, spacing drift,
broken links, and more. Designers review and annotate each issue; the app
generates a clean, exportable QA report for developers, who can click any
issue to jump straight to it on the live site.

This is a **portfolio project**, not a production SaaS: no payments, no
accounts, no database. Everything needed to try it — including a full
"Try Demo" mode with ~12 realistic sample issues — works with zero setup.

---

## Part 1 — Try it in 3 minutes (no coding, no API keys)

You need one thing installed: **Node.js** (the engine that runs this kind
of app on your computer).

1. Go to **https://nodejs.org**, download the "LTS" version, and install it
   like any other program (click Next/Next/Finish).
2. Open a terminal:
   - **Mac:** press `Cmd + Space`, type `Terminal`, press Enter.
   - **Windows:** press the Start key, type `Command Prompt`, press Enter.
3. In that terminal, type `cd ` (with a space after it), then drag this
   project's folder into the terminal window — it'll paste the folder path
   — then press Enter. This moves you "into" the project.
4. Type this and press Enter (only needed once — it downloads the pieces
   this project depends on, including a small headless browser used to
   inspect live websites):
   ```
   npm install
   ```
   This can take a minute or two the first time.
5. Type this and press Enter:
   ```
   npm run dev
   ```
6. You'll see a message like `Local: http://localhost:3000`. Open your
   browser and go to that address.
7. Click **Try Demo**. That's it — no keys needed.

To stop the app later, click back in the terminal window and press
`Ctrl + C`.

---

## Part 2 — Turning on real analysis (optional)

Demo Mode uses realistic sample data. To analyze a *real* Figma file and a
*real* website, add one free API key.

1. In the project folder, find the file named **`.env.local.example`**.
2. Make a copy of it in the same folder, and rename the copy to exactly
   **`.env.local`** (note the leading dot, and no `.example` at the end).
   - On Mac/Windows Finder/Explorer, you may need to enable "show hidden
     files" to see files starting with a dot — or just do this step from
     the terminal: `cp .env.local.example .env.local` (Mac) or
     `copy .env.local.example .env.local` (Windows), run from inside the
     project folder.
3. Open `.env.local` in any text editor (Notepad, TextEdit, VS Code — all
   fine).
4. Follow the instructions written inside that file to get a **free Figma
   personal access token**, and paste it after `FIGMA_TOKEN=`.
5. (Optional) Also get a free Gemini API key the same way, for
   AI-generated "why this matters" explanations on each issue — paste it
   after `GEMINI_API_KEY=`. Skip this if you don't want it; everything
   else still works.
6. Save the file, go back to your terminal, stop the app (`Ctrl + C`) and
   run `npm run dev` again so it picks up the new keys.

**Important — matching Figma frame and website viewport:** for an
accurate comparison, the Figma frame you select should be the same width
as the viewport you pick in DesignCheck (e.g. a 1440px-wide desktop frame
compared against the "1440 × 900" viewport). Comparing a 1440px design
against a 390px mobile screenshot will produce a lot of noise — the app
will warn you if the widths look mismatched.

**Copying a Figma link:** open your file in Figma, select the top-level
frame you want to check (e.g. "Desktop / Home"), right-click it →
**Copy link to selection**. That link includes the frame ID, so
DesignCheck analyzes exactly that frame instead of guessing.

---

## Part 3 — Deploying to Vercel (put it online, free)

[Vercel](https://vercel.com) is a hosting service with a generous free
tier, made by the same company behind Next.js (the framework this app is
built with).

1. Push this project to a GitHub repository (if you're reading this inside
   a repository that a Claude Code session already created for you, this
   step is likely done — check with whoever set it up).
2. Go to **https://vercel.com** and sign up/log in (you can sign in with
   your GitHub account).
3. Click **Add New… → Project**.
4. Select this GitHub repository from the list and click **Import**.
5. Vercel auto-detects this as a Next.js project — you don't need to
   change any build settings.
6. Before clicking Deploy, open **Environment Variables** and add the same
   keys from your `.env.local` file:
   - `FIGMA_TOKEN` → paste your Figma token
   - `GEMINI_API_KEY` → paste your Gemini key (optional)
7. Click **Deploy**. After a minute or two, Vercel gives you a live URL
   like `designcheck-yourname.vercel.app` — that's your portfolio link.

**A known limitation of real (non-demo) website analysis on Vercel's free
tier:** DesignCheck uses a real headless browser (Playwright) to open the
live website, which is a heavier operation than a typical serverless
function. It's configured to work within Vercel's free-tier limits using a
slimmed-down Chromium build, but very slow/heavy websites can still time
out. **Demo Mode always works regardless**, so your portfolio link is
never broken even if a specific live analysis times out — this is called
out in the "Known limitations" section below too.

---

## What's real vs. simplified (read this before showing it off)

This project follows a principle of **never faking a result** — if
something can be measured, DesignCheck measures it directly instead of
guessing or hard-coding it:

- **Demo Mode is not a hard-coded "results" screen.** The demo's sample
  Figma data and sample website data are run through the exact same
  matching → comparison → scoring engine used for real analyses. It's a
  fair demonstration of how the tool actually works, not a mockup.
- **Element matching is a heuristic, and says so.** Figma elements are
  matched to website DOM elements using text similarity, type, position,
  and size — never assumed to be 100% correct. Every matched issue shows
  its **match confidence %** in the UI.
- **AI is used narrowly, for one thing.** An optional Gemini API call
  turns already-computed differences into a one-sentence, plain-language
  "why this matters" note. It never decides *whether* something is
  different or *by how much* — that's plain measurement/arithmetic.

### MVP limitations (intentional, and worth knowing)

- **No database / no accounts.** Analysis results and your designer review
  notes (approve/reject/comments) are stored in your browser's
  `localStorage`. They won't follow you to another browser or device, and
  clearing your browser data clears your history. Good enough for a
  portfolio demo; a real product would add a database (e.g. Supabase) here.
- **"Open on Website" element highlighting.** For a real (non-demo)
  analysis, clicking an issue opens the actual live website in a new tab
  and offers a **draggable bookmarklet** — drag it to your bookmarks bar
  once, then click it while on the live site to draw a red outline +
  tooltip around that exact element. This is the practical stand-in for a
  full browser extension, which is out of scope for an MVP. In Demo Mode,
  "Open on Website" instead opens a simulated page inside DesignCheck
  itself (since the demo's website isn't a real URL), scrolled and
  highlighted the same way.
- **Responsive checking is heuristic-based**, not pixel-perfect — it flags
  likely overflow, overlapping elements, tiny tap targets, and probable
  text cut-off from the page's rendered layout, clearly labeled as
  estimates rather than guarantees.
- **Figma section/spacing detection** relies on your Figma frame using
  named top-level frames (e.g. "Header", "Hero", "Footer") and Auto Layout
  for the most useful results. A file with no Auto Layout still compares
  fine on position/size/color/text — just without the spacing/gap checks.

---

## Project structure (for anyone who wants to look under the hood)

```
src/
  app/
    page.tsx                  Landing page: URL inputs, viewport picker, Analyze / Try Demo
    results/[id]/page.tsx     Score dashboard, screenshots, issue list, designer review
    report/[id]/page.tsx      Printable developer QA report
    history/page.tsx          Past analyses (stored in this browser)
    demo-site/page.tsx        Simulated "live site" used by Demo Mode's Open-on-Website
    api/analyze/route.ts      Real analysis: Figma API + Playwright + comparison engine
    api/demo/route.ts         Demo Mode data (same engine, sample input)
    api/status/route.ts       Tells the UI which API keys are configured
  components/                 Reusable UI pieces (score gauge, issue cards, screenshot compare…)
  lib/
    types.ts                  Shared TypeScript types for the whole domain model
    figma-api.ts               Real Figma REST API client + node-tree extraction
    website-analyzer.ts        Playwright: screenshot + DOM/CSS extraction + broken link/image checks
    responsive-check.ts        Heuristic overflow/overlap/cutoff checks at other viewport sizes
    matcher.ts                 Figma ↔ website element matching (with confidence scoring)
    compare.ts                 Turns matched/unmatched elements into Issue[]
    scoring.ts                  Category + overall score calculation
    ai-explain.ts               Optional Gemini call for plain-language issue explanations
    mock-page.ts, demo-*.ts     Demo Mode's sample Figma/website data + generated SVG screenshots
    storage.ts                  Browser localStorage helpers (history + results)
    bookmarklet.ts               Generates the "highlight this element" bookmarklet
```

## Tech stack

Next.js (App Router) · React · TypeScript · Tailwind CSS · Figma REST API
· Playwright · Google Gemini (optional) · deployed on Vercel. No database
— everything ships on Vercel's free tier.
