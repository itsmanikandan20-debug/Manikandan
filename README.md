# Design Similarity Finder

A SaaS dashboard for UI/UX designers: upload a screenshot of a Figma design
and find live websites with a similar layout, hero section, colour palette,
typography, card structure, spacing, and overall visual style.

This is the **v1 UI shell** — it uses mock data everywhere. No real image
analysis or web search happens yet. See "Connecting real APIs" below for the
plan to make it functional.

## Getting started

You need [Node.js](https://nodejs.org) version 18.18 or newer installed.

```bash
npm install
npm run dev
```

Then open http://localhost:3000 in your browser.

## Pages

- `/` — Dashboard / Upload: drag-and-drop a screenshot, see recent searches
- `/results` — Search Results: ranked candidate matches for the current upload
- `/compare` — Compare Designs: side-by-side attribute breakdown against one match
- `/history` — Search History: every past search and its outcome

## Project structure

```
src/
  app/
    layout.tsx        Root shell: fonts + sidebar
    page.tsx           Dashboard / Upload
    results/page.tsx   Search Results
    compare/page.tsx   Compare Designs
    history/page.tsx   Search History
    globals.css        Tailwind + base styles
  components/          Reusable UI pieces (Sidebar, Header, ResultCard, etc.)
  lib/
    types.ts           Shared TypeScript types for the domain model
    mock-data.ts        All mock data lives here — swap this out for real API calls
```

## Connecting real APIs

See the accompanying explanation from Claude for a full walkthrough of how to
wire up:

1. An AI vision API to describe the uploaded screenshot
2. A visual image-search API to find visually similar images on the web
3. A website URL identification step to go from "similar image" to "which
   site is this"
4. A live website verification step to confirm the site is real and still
   matches

The important design decision already built in: `MatchResult.stage` is a
strict enum (`similar_image_found` | `source_identified` | `live_verified` |
`source_not_found`). Every real API integration should only ever set a
match's stage to what has actually been confirmed — never upgrade a stage
optimistically.
