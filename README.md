# Design Similarity Finder

A SaaS dashboard for UI/UX designers: upload a screenshot of a Figma design
and find live websites with a similar layout, hero section, colour palette,
typography, card structure, spacing, and overall visual style.

This version does **real analysis** — no mock results. Uploads are sent to
Google Gemini and a reverse-image search API to find actual live websites.
See "Setup: API keys" below to turn this on — all three required keys have a
genuinely free tier, no credit card needed for any of them.

## Getting started

You need [Node.js](https://nodejs.org) version 18.18 or newer installed.

```bash
npm install
cp .env.local.example .env.local   # then fill in your API keys — see below
npm run dev
```

Then open http://localhost:3000 in your browser. The sidebar shows whether
real analysis is configured yet.

## Setup: API keys (all genuinely free, no card required)

Real analysis needs three keys in `.env.local`:

| Key | What it's for | Where to get it | Free tier |
|---|---|---|---|
| `GEMINI_API_KEY` | Reads your screenshot (layout, colors, style) | aistudio.google.com → "Get API key" | Free, no card required |
| `SERPAPI_API_KEY` | Reverse-image search — finds visually similar live websites and their URLs | serpapi.com | 100 searches/month free, no card required |
| `IMGBB_API_KEY` | Temporarily hosts your uploaded screenshot at a public URL (the search API needs a URL, not a raw file) | api.imgbb.com | Free, no card required |

Until all three are set, uploading a screenshot shows a clear
**"API keys needed"** message instead of any results — this app never shows
made-up matches.

**Privacy note:** because the reverse-image search needs a public URL, your
uploaded screenshot is briefly hosted at a random public link on imgbb.
Don't upload confidential/unreleased designs unless you're fine with that.

## Pages

- `/` — Dashboard / Upload: drag-and-drop a screenshot, see recent searches
- `/results` — Search Results: ranked candidate matches for the current upload
- `/compare` — Compare Designs: side-by-side view against one match
- `/history` — Search History: past searches made in this browser

## How a search works (the 6 steps)

1. **Upload** — `UploadDropzone` sends the file to `POST /api/analyze`.
2. **AI vision** — `src/lib/vision.ts` sends the image to Google Gemini,
   which returns a structured description (layout, dominant colors,
   typography, hero section, overall style).
3. **Visual image search** — `src/lib/reverse-image-search.ts` calls SerpApi
   (Google Lens) with a public URL of the image (uploaded via
   `src/lib/image-host.ts`) and gets back visually similar pages.
4. **Extract source URLs** — each SerpApi match already includes the source
   page's URL and site name.
5. **Live check** — `src/lib/live-check.ts` fetches each candidate URL to
   see if the server responds.
6. **Display** — `src/lib/build-results.ts` turns all of this into
   `MatchResult[]`, which `/results` and `/compare` render. There's no
   database yet, so a result is stored in the browser (`sessionStorage` for
   the current search, `localStorage` for history) — see
   `src/lib/search-store.ts`.

## Project structure

```
src/
  app/
    api/analyze/route.ts  The real pipeline: upload -> vision -> search -> live-check
    api/status/route.ts   Tells the UI whether API keys are configured
    layout.tsx             Root shell: fonts + sidebar
    page.tsx                Dashboard / Upload
    results/page.tsx        Search Results
    compare/page.tsx        Compare Designs
    history/page.tsx        Search History
  components/               Reusable UI pieces (Sidebar, Header, ResultCard, etc.)
  lib/
    types.ts                Shared TypeScript types for the domain model
    env.ts                  Checks which API keys are configured
    vision.ts                Gemini Vision call
    image-host.ts            imgbb upload (for the search API's URL requirement)
    reverse-image-search.ts  SerpApi call
    live-check.ts             fetch()-based "is this site up" check
    build-results.ts         Combines everything into MatchResult[]
    search-store.ts          Browser storage for results/history (no DB yet)
    stage.ts                  Labels for the honesty-ladder stages
```

## The honesty ladder

`MatchResult.stage` is a strict enum (`similar_image_found` |
`source_identified` | `live_verified` | `source_not_found`). The real
pipeline only ever sets a stage to what it actually confirmed:

- No source URL from the search API → `similar_image_found`
- A source URL, but the live-check failed or timed out → `source_identified`
- A source URL that responded to a live fetch just now → `live_verified`
- No matches at all for the upload → the whole search shows "No similar
  websites found," not a fabricated result

## Known limitations (MVP)

- **No per-attribute breakdown for real results.** The 7-category score
  breakdown (Layout, Hero, Colour palette, etc.) shown on `/compare` needs a
  separate vision comparison per candidate site, which costs an extra API
  call per result — left out of this MVP to keep costs near $0. Real results
  currently show one overall approximate score instead.
- **Similarity score is a rank, not a measurement.** Google Lens doesn't
  return a numeric similarity score, only a relevance order, so the score is
  derived from ranking position. The UI says this explicitly.
- **History is per-browser, not per-account.** There's no database, so
  search history lives in `localStorage` and won't follow you to another
  device or browser.
- **Vercel request size / timeout limits.** Uploads are capped at 4MB
  server-side to stay under typical serverless body-size limits. The full
  pipeline (vision + search + live-checks) can take several seconds; if your
  Vercel plan has a short function timeout, large or slow requests may fail
  — check your plan's limits if this happens.

## Next steps beyond this MVP

- Add a database (e.g. Postgres via Vercel Postgres/Supabase) so history
  persists per account instead of per-browser.
- Add per-candidate attribute scoring by running a second, targeted vision
  comparison for each result (costs more — worth doing once accuracy matters
  more than staying free).
- Add real user accounts / auth if this becomes multi-user.
