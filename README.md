# DesignCheck

**A Figma-to-Live-Website QA tool.** Paste a Figma design link and a live
website link, pick a screen size, and DesignCheck compares them — flagging
meaningful differences only: wrong/missing/extra text, meaningful color
differences, wrong/missing/extra images and icons, broken links, buttons
with no destination, and forms with no way to submit. It deliberately does
**not** report 1-2px spacing, padding, font-size, alignment, or
border-radius nitpicks — those aren't worth a developer's time. Designers
review and annotate each issue; the app generates a clean, exportable QA
report for developers, who can click any issue to jump straight to it on
the live site.

Built for **multiple designers sharing one deployment** — each person
signs in with their own Figma account (OAuth), and DesignCheck only ever
sees the files that person personally has access to. There's no shared
Figma credential, no payments, and no separate password system to manage.
Everything needed to try it — including a full "Try Demo" mode with ~12
realistic sample issues — works with zero setup.

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

## Part 2 — Two ways to provide a real design (pick either)

DesignCheck can read your actual design in two completely different ways.
**You don't need both — pick whichever is easier for you:**

**Option A: Upload an SVG export.** No setup, no sign-in, works instantly:
1. In Figma, right-click the frame you want to check → **Export** → choose
   **SVG** as the format → export it.
   - Tip: click the gear/settings icon next to the SVG export row and turn
     on **"Include 'id' attribute"** — this carries each layer's name into
     the file, which is what lets DesignCheck recognize buttons, headings,
     and icons correctly. Without it, everything still gets compared by
     position/size/color/text, just with weaker element-type detection.
2. On the DesignCheck home page, click the **"Upload SVG export"** tab and
   choose that file.
3. That's it — no Figma account, no API keys, no waiting on anyone. This
   reads the SVG entirely in your own browser.
4. DesignCheck doesn't report spacing/padding/alignment differences at all
   (from any design source, not just SVG) — see "What gets checked" below.

**Option B: "Connect Figma" sign-in (OAuth).** Reads the file live from
Figma's servers, so it always reflects the current version — but needs a
one-time setup by whoever deploys DesignCheck (see below), and each real
Figma API request needs the app to have been approved by Figma (see "A
note on Figma's app review" further down) or it will be rate-limited hard
while still in Draft.

### Setting up Option B: "Connect Figma" sign-in

Demo Mode uses realistic sample data and needs nothing from you. To let
designers analyze a *real* Figma file against a *real* website, you (the
person deploying DesignCheck) register **one Figma app** that lets any
designer sign in with their own Figma account — you're not sharing your
own Figma access, you're turning on a "Sign in with Figma" button for
everyone who uses your deployment.

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
4. Follow the instructions written inside that file to:
   - Create a free **Figma OAuth app** at figma.com/developers/apps, and
     paste its Client ID / Client Secret after `FIGMA_CLIENT_ID=` and
     `FIGMA_CLIENT_SECRET=`.
   - Generate a random `SESSION_SECRET` (the file tells you the exact
     one-line command to run).
5. (Optional) Also get a free Gemini API key the same way, for
   AI-generated "why this matters" explanations on each issue — paste it
   after `GEMINI_API_KEY=`. Skip this if you don't want it; everything
   else still works.
6. Save the file, go back to your terminal, stop the app (`Ctrl + C`) and
   run `npm run dev` again so it picks up the new keys.
7. Reload the app in your browser — you'll now see a **"Connect Figma"**
   button. Click it, approve access on Figma's screen, and you're back in
   DesignCheck signed in with your own account.

**Every designer who uses this deployment repeats step 7 for themselves**
— each person's "Connect Figma" click signs *them* into *their own* Figma
account and only ever gives DesignCheck access to files *they* can already
see. Nobody sees anyone else's files, and nobody needs your personal Figma
token.

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

### A note on Figma's app review (Option B only — Option A needs none of this)

A newly-created Figma app starts in **Draft** status, which carries a
very strict, multi-day rate limit — meant to stop dev credentials from
being used for real traffic, not a DesignCheck limitation. To get a
normal, usable rate limit for anyone other than yourself:

1. In your Figma app's settings → **Publish** → set **Audience to
   "Public: Anyone using Figma"** (leave "List this app on Community"
   unchecked — that's only for Figma's public app directory, not needed
   here) → fill in the description/scopes/testing-instructions steps it
   asks for → submit.
2. Figma reviews submitted apps before approving them. There's no
   published timeline for this, and it's entirely on Figma's side — no
   code change speeds it up.
3. Until it's approved, **only your own Figma account can sign in**
   (other people see "OAuth app with client id ... doesn't exist"), and
   even your own account is stuck with the Draft-tier rate limit.

**This is exactly why Option A (SVG upload) exists** — if you want to
demo or use DesignCheck for real before that review completes, or want
to entirely avoid ever setting up Figma OAuth, uploading an SVG export
gets you real (non-Demo-Mode) analysis with none of the above.

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
   - `FIGMA_CLIENT_ID` → paste your Figma app's Client ID
   - `FIGMA_CLIENT_SECRET` → paste your Figma app's Client Secret
   - `SESSION_SECRET` → paste your generated random string
   - `GEMINI_API_KEY` → paste your Gemini key (optional)
7. Click **Deploy**. After a minute or two, Vercel gives you a live URL
   like `designcheck-yourname.vercel.app` — that's your shareable link.
8. **One more required step — tell Figma about your new live URL:** go
   back to **figma.com/developers/apps**, open your app, and add a second
   Callback URL:
   ```
   https://designcheck-yourname.vercel.app/api/auth/figma/callback
   ```
   (using your actual Vercel URL from step 7). Without this, "Connect
   Figma" will fail on the deployed site with a Figma error page, even
   though it works locally — Figma only allows redirecting back to URLs
   you've explicitly registered.

Every designer you share the Vercel link with can now click **Connect
Figma** and sign in with their own account — nothing more for you to set
up per designer.

**A known limitation of real (non-demo) website analysis on Vercel's free
tier:** DesignCheck uses a real headless browser (Playwright) to open the
live website, which is a heavier operation than a typical serverless
function. It's configured to work within Vercel's free-tier limits using a
slimmed-down Chromium build, but very slow/heavy websites can still time
out. **Demo Mode always works regardless**, so your portfolio link is
never broken even if a specific live analysis times out — this is called
out in the "Known limitations" section below too.

---

## What gets checked

DesignCheck is scoped to differences meaningful enough to send to a
developer — not pixel-hunting. Results are grouped into 8 categories:

| Category | Catches |
|---|---|
| **Content** | Wrong/missing text, different headings, different button text |
| **Extra Text** | Copy on the live site with no corresponding element in the design |
| **Colors** | Meaningful background/text/button/border color or gradient differences |
| **Images** | Wrong/missing/extra images (including images that fail to load) |
| **Icons** | Missing/extra icons, and icon color differences |
| **Links** | Links that return an error or don't resolve |
| **Buttons** | Buttons/links with no real destination configured (heuristic — nothing is actually clicked) |
| **Forms** | Forms with input fields but no submit control (heuristic — nothing is actually submitted) |

**Deliberately not reported:** 1-2px spacing/padding differences, tiny
font-size or alignment nudges, and border-radius mismatches. A small color
difference that could be screenshot/rounding noise (a fixed color-distance
threshold) is filtered out too. None of this means the tool can't *see*
those things — it's a scope decision, so designers aren't sent a wall of
nitpicks a developer wouldn't act on.

The Buttons/Forms checks are intentionally structural, not a real
click/submit test: actually clicking buttons or submitting forms on a live
production site could trigger real side effects (navigation, real
submissions, sent emails), so DesignCheck never does that automatically.

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
- **Multi-user by design, with no shared credential.** DesignCheck never
  stores one Figma token that everyone's requests reuse. Each designer's
  "Connect Figma" sign-in (standard OAuth2 — see `src/lib/figma-oauth.ts`)
  gets its own access token, encrypted and kept only in *that person's own
  browser cookie* (`src/lib/session.ts`), never written to a server-side
  file or database. Two designers using the same deployed link at the same
  moment are fully isolated from each other automatically, because there's
  no shared state to collide on.

### MVP limitations (intentional, and worth knowing)

- **No database / no accounts beyond Figma sign-in.** "Connect Figma" is
  both the login and the permission grant — there's no separate DesignCheck
  password or profile. Analysis results and designer review notes
  (approve/reject/comments) are stored in each person's own browser
  `localStorage`, so they won't follow a designer to another browser or
  device, and clearing browser data clears that history. Good enough for a
  portfolio/team tool; a production version would add a database (e.g.
  Supabase) so results synced across devices.
- **A Figma session lasts until the browser cookie is cleared** (about 180
  days, auto-refreshed). If Figma revokes access or the refresh token
  expires, DesignCheck just asks the designer to click Connect Figma again
  — no error state is silent about this.
- **"Open on Website" element highlighting.** For a real (non-demo)
  analysis, clicking an issue opens the actual live website in a new tab
  and offers a **draggable bookmarklet** — drag it to your bookmarks bar
  once, then click it while on the live site to draw a red outline +
  tooltip around that exact element. This is the practical stand-in for a
  full browser extension, which is out of scope for an MVP. In Demo Mode,
  "Open on Website" instead opens a simulated page inside DesignCheck
  itself (since the demo's website isn't a real URL), scrolled and
  highlighted the same way.
- **Sites behind bot-protection (Cloudflare, etc.) can't be analyzed.**
  Some production websites show automated browsers a "verifying you're
  human" interstitial instead of the real page. DesignCheck waits several
  extra seconds for this to clear (it often does on lighter protection
  tiers) and detects when it hasn't — showing a clear warning banner
  rather than silently comparing against the wrong page — but there's no
  way to solve a CAPTCHA on someone's behalf, so sites with strict bot
  protection genuinely can't be analyzed this way.
- **Responsive checking is heuristic-based**, not pixel-perfect — it flags
  likely overflow, overlapping elements, tiny tap targets, and probable
  text cut-off from the page's rendered layout, clearly labeled as
  estimates rather than guarantees.
- **Section-level background color detection** matches Figma sections to
  website sections by name (e.g. a Figma frame named "Hero" is matched to
  a website section named "Hero") — name your top-level Figma frames to
  match your page's actual sections for the most useful results.

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
    api/status/route.ts       Tells the UI whether Figma sign-in / Gemini are configured
    api/auth/figma/login/     Redirects the designer to Figma to approve access
    api/auth/figma/callback/  Figma redirects back here with a code; exchanged for tokens
    api/auth/figma/logout/    Clears the designer's session cookie
    api/auth/me/              Tells the UI who (if anyone) is currently connected
  components/                 Reusable UI pieces (score gauge, issue cards, screenshot compare…)
  lib/
    types.ts                  Shared TypeScript types for the whole domain model
    figma-oauth.ts              Figma OAuth2: authorize URL, token exchange, refresh, /v1/me
    session.ts                   Encrypts each designer's Figma tokens into their own cookie
    use-figma-account.ts         Client hook: "is Figma sign-in available, is this visitor connected"
    figma-api.ts               Real Figma REST API client + node-tree extraction (takes a token in)
    svg-import.ts               Reads an uploaded Figma SVG export in the browser — the no-OAuth path
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

Next.js (App Router) · React · TypeScript · Tailwind CSS · Figma REST API +
OAuth2 · Playwright · Google Gemini (optional) · deployed on Vercel. No
database — per-designer Figma sessions live in an encrypted browser
cookie, and everything ships on Vercel's free tier.
