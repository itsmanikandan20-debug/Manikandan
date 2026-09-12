import type { Browser, Page } from "playwright-core";
import type { DesignElement, ElementType, Viewport, WebsiteExtraction } from "./types";
import { makeId } from "./id";

export class WebsiteAnalysisError extends Error {}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// On a cold serverless instance, @sparticuz/chromium extracts its bundled
// Chromium binary to /tmp/chromium the first time it's needed, then reuses
// that file on subsequent warm invocations. Launching it in the brief
// window while that extraction is still being written to disk fails with
// "spawn ETXTBSY" ("text file busy") — a transient race, not a permanent
// failure. Retrying after a short pause lets the extraction finish and
// almost always succeeds on the next attempt.
//
// @sparticuz/chromium only extracts the binary once per container, but if
// two requests land on the same warm container close together, both would
// otherwise call executablePath() and race to extract the same file at
// once — the likely reason ETXTBSY kept recurring even with a retry loop
// around launch(). Caching the in-flight promise at module scope means a
// second concurrent call just awaits the first extraction instead of
// starting its own.
let cachedExecutablePath: Promise<string> | null = null;

async function launchServerlessBrowser(): Promise<Browser> {
  const chromiumMod = await import("@sparticuz/chromium");
  const chromium = chromiumMod.default;
  const { chromium: pwChromium } = await import("playwright-core");
  if (!cachedExecutablePath) cachedExecutablePath = chromium.executablePath();
  let executablePath: string;
  try {
    executablePath = await cachedExecutablePath;
  } catch (err) {
    cachedExecutablePath = null; // let a later call retry extraction instead of replaying this rejection forever
    throw err;
  }

  const attempts = 4;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await pwChromium.launch({ args: chromium.args, executablePath, headless: true });
    } catch (err) {
      const isTextBusy = err instanceof Error && err.message.includes("ETXTBSY");
      if (!isTextBusy || attempt === attempts) throw err;
      await sleep(400 * attempt);
    }
  }
  throw new Error("unreachable");
}

// Local dev uses the full `playwright` package (browsers installed via
// `npx playwright install chromium`). On Vercel's serverless functions we
// switch to `playwright-core` + `@sparticuz/chromium`, a Chromium build
// small enough to ship in a serverless function bundle. Same API either
// way — only how the browser executable is found differs.
async function launchBrowser(): Promise<Browser> {
  const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

  if (isServerless) {
    return launchServerlessBrowser();
  }

  const { chromium: pwChromium } = await import("playwright");
  return pwChromium.launch({ headless: true });
}

// Raw shape returned from the in-page evaluate() call — kept intentionally
// close to plain DOM data, normalized into DesignElement afterwards.
interface RawElement {
  tag: string;
  role: ElementType;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  color: string;
  backgroundColor: string;
  gradientStops: string[] | null;
  borderRadius: number;
  borderColor: string | null;
  borderWidth: number;
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  gap: number;
  opacity: number;
  imageUrl: string | null;
  href: string | null;
  selector: string;
  section: string;
  isContainer: boolean;
  autoLayout: "horizontal" | "vertical" | "none";
}

const EXTRACT_SCRIPT = `(() => {
  function cssSelector(el) {
    if (el.id) return '#' + CSS.escape(el.id);
    const path = [];
    let node = el;
    let depth = 0;
    while (node && node.nodeType === 1 && depth < 6) {
      let selector = node.tagName.toLowerCase();
      if (node.classList.length) {
        selector += '.' + Array.from(node.classList).slice(0, 2).map((c) => CSS.escape(c)).join('.');
      }
      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((s) => s.tagName === node.tagName);
        if (siblings.length > 1) selector += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
      }
      path.unshift(selector);
      node = parent;
      depth++;
    }
    return path.join(' > ');
  }

  function sectionFor(el) {
    let node = el;
    while (node && node !== document.body) {
      const tag = node.tagName.toLowerCase();
      if (['header', 'nav', 'footer', 'main', 'section'].includes(tag)) {
        return node.getAttribute('aria-label') || node.id || tag.charAt(0).toUpperCase() + tag.slice(1);
      }
      const role = node.getAttribute && node.getAttribute('role');
      if (role === 'banner') return 'Header';
      if (role === 'contentinfo') return 'Footer';
      node = node.parentElement;
    }
    return 'Page';
  }

  function classify(el) {
    const tag = el.tagName.toLowerCase();
    if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) return 'heading';
    if (tag === 'button') return 'button';
    if (tag === 'a') {
      const cls = (el.className || '').toString().toLowerCase();
      const looksLikeButton = cls.includes('btn') || cls.includes('button') || el.getAttribute('role') === 'button';
      return looksLikeButton ? 'button' : 'link';
    }
    if (tag === 'img' || tag === 'svg' || tag === 'picture') return 'image';
    if (['input', 'textarea', 'select'].includes(tag)) return 'input';
    if (tag === 'p' || tag === 'span' || tag === 'li') return 'text';
    return 'container';
  }

  const results = [];
  const seen = new Set();
  const selectorList = 'h1,h2,h3,h4,h5,h6,p,button,a,img,input,textarea,select,header,nav,footer,section,main,[role="button"]';
  const nodes = Array.from(document.querySelectorAll(selectorList));

  for (const el of nodes) {
    if (seen.has(el)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    const style = window.getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) continue;

    const tag = el.tagName.toLowerCase();
    const isContainer = ['header', 'nav', 'footer', 'main', 'section'].includes(tag);
    const text = isContainer ? '' : (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 300);
    if (!isContainer && !text && tag !== 'img' && tag !== 'input' && tag !== 'svg') continue;

    let imageUrl = null;
    if (tag === 'img') imageUrl = el.currentSrc || el.getAttribute('src');

    const gapRaw = style.gap || style.rowGap || '0px';
    const borderWidthPx = parseFloat(style.borderTopWidth) || 0;
    const borderColorHex = borderWidthPx > 0 ? rgbToHex(style.borderTopColor) : null;

    results.push({
      tag,
      role: classify(el),
      text,
      x: Math.round(rect.left + window.scrollX),
      y: Math.round(rect.top + window.scrollY),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      fontFamily: (style.fontFamily || '').split(',')[0].replace(/["']/g, '').trim(),
      fontSize: parseFloat(style.fontSize) || 0,
      fontWeight: style.fontWeight,
      color: rgbToHex(style.color),
      backgroundColor: rgbToHex(style.backgroundColor),
      gradientStops: extractGradientStops(style.backgroundImage),
      borderRadius: parseFloat(style.borderRadius) || 0,
      borderColor: borderColorHex,
      borderWidth: borderWidthPx,
      paddingTop: parseFloat(style.paddingTop) || 0,
      paddingRight: parseFloat(style.paddingRight) || 0,
      paddingBottom: parseFloat(style.paddingBottom) || 0,
      paddingLeft: parseFloat(style.paddingLeft) || 0,
      gap: parseFloat(gapRaw) || 0,
      opacity: parseFloat(style.opacity),
      imageUrl,
      href: tag === 'a' ? el.getAttribute('href') : null,
      selector: cssSelector(el),
      section: isContainer ? tag : sectionFor(el),
      isContainer,
      autoLayout: style.display === 'flex' ? (style.flexDirection && style.flexDirection.startsWith('row') ? 'horizontal' : 'vertical') : 'none',
    });
  }

  function extractGradientStops(backgroundImage) {
    if (!backgroundImage || backgroundImage.indexOf('gradient') === -1) return null;
    var matches = backgroundImage.match(/rgba?\\([^)]+\\)/g);
    if (!matches) return null;
    var stops = matches.map(rgbToHex).filter(function (c) { return c; });
    return stops.length > 0 ? stops : null;
  }

  function rgbToHex(rgb) {
    if (!rgb || !rgb.startsWith('rgb')) return null;
    const parts = rgb.match(/[\\d.]+/g);
    if (!parts || parts.length < 3) return null;
    const [r, g, b, a] = parts.map(Number);
    if (a === 0) return null;
    const toHex = (v) => Math.round(v).toString(16).padStart(2, '0');
    return ('#' + toHex(r) + toHex(g) + toHex(b)).toUpperCase();
  }

  return results;
})()`;

async function extractRawElements(page: Page): Promise<RawElement[]> {
  return page.evaluate(EXTRACT_SCRIPT) as Promise<RawElement[]>;
}

function toDesignElements(raw: RawElement[]): DesignElement[] {
  return raw.map((r) => ({
    id: makeId("website"),
    source: "website" as const,
    type: (r.isContainer ? "section" : r.role) as ElementType,
    name: r.tag + (r.text ? `: ${r.text.slice(0, 40)}` : ""),
    text: r.isContainer ? undefined : r.text || undefined,
    x: r.x,
    y: r.y,
    width: r.width,
    height: r.height,
    fontFamily: r.fontFamily || undefined,
    fontSize: r.fontSize || undefined,
    fontWeight: r.fontWeight || undefined,
    color: r.color ?? undefined,
    backgroundColor: r.backgroundColor ?? undefined,
    gradientStops: r.gradientStops ?? undefined,
    borderRadius: r.borderRadius,
    borderColor: r.borderColor ?? undefined,
    borderWidth: r.borderWidth,
    paddingTop: r.paddingTop,
    paddingRight: r.paddingRight,
    paddingBottom: r.paddingBottom,
    paddingLeft: r.paddingLeft,
    gap: r.gap,
    opacity: Number.isFinite(r.opacity) ? r.opacity : undefined,
    imageUrl: r.imageUrl ?? undefined,
    href: r.href ?? undefined,
    selector: r.selector,
    autoLayout: r.autoLayout,
    section: r.section,
  }));
}

async function findBrokenLinks(page: Page, limit = 15): Promise<string[]> {
  const hrefs: string[] = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("a[href]"))
      .map((a) => a.getAttribute("href") || "")
      .filter((h) => h && !h.startsWith("#") && !h.startsWith("mailto:") && !h.startsWith("tel:") && !h.startsWith("javascript:"));
  });

  const unique = Array.from(new Set(hrefs)).slice(0, limit);
  const broken: string[] = [];

  await Promise.all(
    unique.map(async (href) => {
      try {
        const url = new URL(href, page.url()).toString();
        const res = await page.request.head(url, { timeout: 6000 }).catch(() =>
          page.request.get(url, { timeout: 6000 })
        );
        if (res.status() >= 400) broken.push(`${href} (${res.status()})`);
      } catch {
        broken.push(`${href} (unreachable)`);
      }
    })
  );

  return broken;
}

// Non-destructive structural check: an <a> styled/used as a button with no
// real destination (empty href, "#", or a javascript:void placeholder) is
// a common, objectively-detectable dev mistake. Native <button> elements
// are deliberately NOT flagged here — most rely on a JS click handler that
// can't be verified from markup alone, and guessing would produce mostly
// false positives. This never clicks anything, so it can't trigger a real
// navigation or side effect on the live site.
async function findBrokenButtons(page: Page, limit = 8): Promise<string[]> {
  return page.evaluate((max) => {
    function isPlaceholderHref(href: string | null): boolean {
      if (href === null) return true;
      const h = href.trim().toLowerCase();
      return h === "" || h === "#" || h.startsWith("javascript:void") || h === "javascript:;";
    }
    const seen = new Set<string>();
    const results: string[] = [];
    const candidates = Array.from(
      document.querySelectorAll('a[class*="btn" i], a[class*="button" i], a[role="button"]')
    );
    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      const style = window.getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") continue;
      if (!isPlaceholderHref(el.getAttribute("href"))) continue;
      const label = (el.textContent || "").trim().slice(0, 60) || el.getAttribute("aria-label") || "(unlabeled button)";
      if (seen.has(label)) continue;
      seen.add(label);
      results.push(label);
      if (results.length >= max) break;
    }
    return results;
  }, limit);
}

// Non-destructive structural check: a <form> with real input fields but no
// submit control at all can't be submitted by a normal user, regardless of
// what JS framework handles it. This deliberately does NOT flag a missing
// `action` attribute (extremely common and correct for JS-driven/SPA
// forms) or attempt an actual submission (which could send real data).
async function findBrokenForms(page: Page, limit = 5): Promise<string[]> {
  return page.evaluate((max) => {
    const results: string[] = [];
    const forms = Array.from(document.querySelectorAll("form"));
    for (const form of forms) {
      const rect = form.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      const inputs = form.querySelectorAll("input, textarea, select");
      if (inputs.length === 0) continue; // not a real data-entry form
      const hasSubmit =
        form.querySelector('button:not([type="button"]):not([type="reset"])') ||
        form.querySelector('input[type="submit"], input[type="image"]');
      if (hasSubmit) continue;
      const label = form.getAttribute("aria-label") || form.getAttribute("name") || form.getAttribute("id") || "Unnamed form";
      results.push(label);
      if (results.length >= max) break;
    }
    return results;
  }, limit);
}

// Detects the common bot-protection interstitials (Cloudflare, generic
// "verifying you are human" pages, etc.) that some real production sites
// show to automated browsers. These usually clear on their own within a
// few seconds — long enough that our normal networkidle wait isn't
// always sufficient — so we check for one and give it extra time before
// giving up and just reporting that the challenge was still showing.
const BOT_CHALLENGE_PATTERNS = [
  "checking your browser",
  "verifying you are human",
  "verify you are human",
  "performing security verification",
  "just a moment",
  "attention required! | cloudflare",
  "cf-browser-verification",
  "please stand by, while we are checking your browser",
  "ddos protection by",
];

async function looksLikeBotChallenge(page: Page): Promise<boolean> {
  const text = await page
    .evaluate(() => `${document.title} ${document.body?.innerText ?? ""}`.toLowerCase())
    .catch(() => "");
  return BOT_CHALLENGE_PATTERNS.some((p) => text.includes(p));
}

async function waitOutBotChallenge(page: Page): Promise<boolean> {
  let stillBlocked = await looksLikeBotChallenge(page);
  for (let attempt = 0; attempt < 3 && stillBlocked; attempt++) {
    await page.waitForTimeout(3000);
    stillBlocked = await looksLikeBotChallenge(page);
  }
  return stillBlocked;
}

// Makes the automated browser look like an ordinary desktop Chrome visit
// rather than an obviously-scripted one. This helps against common,
// lighter-weight bot checks (a lot of real sites use these) — it is NOT
// an attempt to defeat dedicated enterprise bot-management (Cloudflare
// Enterprise, etc.), which often fingerprints at the network/TLS level
// before any of this would even matter, and which this project has no
// business trying to bypass on someone else's website.
const REALISTIC_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function newStealthContext(browser: Browser, viewport: Viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    userAgent: REALISTIC_USER_AGENT,
    locale: "en-US",
    timezoneId: "America/New_York",
    extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
  });
  // The single most common automated-browser tell: navigator.webdriver is
  // true by default in Playwright/Puppeteer. Real Chrome always reports
  // false/undefined. Patching it before any page script runs is a
  // standard, widely-used practice for legitimate test automation.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  return context;
}

async function findBrokenImages(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll("img"))
      .filter((img) => img.src && img.complete && img.naturalWidth === 0)
      .map((img) => img.getAttribute("src") || img.src);
  });
}

// A real landing page's full-page screenshot is photographic, not the flat
// shapes a lossless PNG compresses well — a single tall, image-heavy page
// can produce a PNG tens of megabytes in size once base64-encoded for
// storage, which alone blows past a browser's ~5-10MB localStorage quota
// (measured: a 6000px noise-heavy page came to 32MB as PNG base64 vs
// 2.7MB capped+JPEG). JPEG compression and a height cap bring every real
// screenshot down to a predictable, storable size; resizing the viewport
// to the capped height (rather than using fullPage, which ignores any
// size limit) is what actually bounds it, since `clip` alone only crops
// within whatever is already rendered and doesn't reveal more page below
// the fold.
const MAX_SCREENSHOT_HEIGHT = 6000;
const SCREENSHOT_JPEG_QUALITY = 55;

// Responsive checking can capture up to 5 extra screenshots in one
// analysis (one per other viewport) on top of the main one — that budget
// needs each of them smaller than the primary comparison screenshot, since
// they only need to be legible enough to spot overflow/cutoff/overlap, not
// pixel-accurate for side-by-side comparison.
const RESPONSIVE_MAX_SCREENSHOT_HEIGHT = 4000;
const RESPONSIVE_SCREENSHOT_JPEG_QUALITY = 42;

async function captureCappedScreenshot(
  page: Page,
  viewport: Viewport,
  opts: { maxHeight: number; quality: number } = { maxHeight: MAX_SCREENSHOT_HEIGHT, quality: SCREENSHOT_JPEG_QUALITY }
): Promise<string> {
  const scrollHeight = await page.evaluate(() => document.body.scrollHeight).catch(() => viewport.height);
  const capHeight = Math.max(viewport.height, Math.min(scrollHeight, opts.maxHeight));
  if (capHeight !== viewport.height) {
    await page.setViewportSize({ width: viewport.width, height: capHeight });
    await page.waitForTimeout(80);
  }
  const buffer = await page.screenshot({ fullPage: false, type: "jpeg", quality: opts.quality });
  return `data:image/jpeg;base64,${buffer.toString("base64")}`;
}

export async function analyzeWebsite(url: string, viewport: Viewport): Promise<WebsiteExtraction> {
  let normalizedUrl = url.trim();
  if (!/^https?:\/\//i.test(normalizedUrl)) normalizedUrl = `https://${normalizedUrl}`;

  let browser: Browser | null = null;
  try {
    browser = await launchBrowser();
  } catch (err) {
    throw new WebsiteAnalysisError(
      `Couldn't start the headless browser (${(err as Error).message}). In local development, run "npx playwright install chromium" once and try again.`
    );
  }

  try {
    const context = await newStealthContext(browser, viewport);
    const page = await context.newPage();

    let response;
    try {
      response = await page.goto(normalizedUrl, { waitUntil: "networkidle", timeout: 25000 });
    } catch {
      response = await page.goto(normalizedUrl, { waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => null);
    }
    if (!response) {
      throw new WebsiteAnalysisError(`Couldn't load ${normalizedUrl}. Check the URL is correct and publicly accessible.`);
    }

    await page.waitForTimeout(600); // let fonts/late content settle

    const botChallengeDetected = await waitOutBotChallenge(page);

    const [raw, brokenLinks, brokenImages, brokenButtons, brokenForms] = await Promise.all([
      extractRawElements(page),
      findBrokenLinks(page),
      findBrokenImages(page),
      findBrokenButtons(page),
      findBrokenForms(page),
    ]);

    const screenshotDataUrl = await captureCappedScreenshot(page, viewport);

    return {
      url: normalizedUrl,
      finalUrl: page.url(),
      viewport,
      screenshotDataUrl,
      elements: toDesignElements(raw),
      brokenLinks,
      brokenImages,
      brokenButtons,
      brokenForms,
      isDemo: false,
      botChallengeDetected,
    };
  } catch (err) {
    // Anything below this point that throws (a Playwright internal error,
    // a bad selector, whatever) used to surface to the designer as an
    // opaque "Something went wrong" with no way to tell what actually
    // failed. Re-wrapping as WebsiteAnalysisError keeps the real message
    // and routes it through the existing 400/WEBSITE_ERROR handling in
    // the API route instead of the generic 500 catch-all.
    if (err instanceof WebsiteAnalysisError) throw err;
    throw new WebsiteAnalysisError(`Ran into an unexpected problem analyzing ${normalizedUrl}: ${(err as Error).message}`);
  } finally {
    await browser.close();
  }
}

/**
 * Captures a screenshot + a lightweight element pass at extra viewports,
 * purely to power the Responsive Checking tab (overflow / overlap /
 * cutoff). Kept separate from the primary Figma-vs-website comparison,
 * per the product spec.
 */
export async function captureResponsiveSnapshot(
  url: string,
  viewport: Viewport
): Promise<{ screenshotDataUrl: string; elements: DesignElement[]; brokenImages: string[] }> {
  let normalizedUrl = url.trim();
  if (!/^https?:\/\//i.test(normalizedUrl)) normalizedUrl = `https://${normalizedUrl}`;

  const browser = await launchBrowser();
  try {
    const context = await newStealthContext(browser, viewport);
    const page = await context.newPage();
    await page.goto(normalizedUrl, { waitUntil: "networkidle", timeout: 25000 }).catch(() =>
      page.goto(normalizedUrl, { waitUntil: "domcontentloaded", timeout: 25000 })
    );
    await page.waitForTimeout(400);

    const [raw, brokenImages] = await Promise.all([extractRawElements(page), findBrokenImages(page)]);
    const screenshotDataUrl = await captureCappedScreenshot(page, viewport, {
      maxHeight: RESPONSIVE_MAX_SCREENSHOT_HEIGHT,
      quality: RESPONSIVE_SCREENSHOT_JPEG_QUALITY,
    });

    return {
      screenshotDataUrl,
      elements: toDesignElements(raw),
      brokenImages,
    };
  } finally {
    await browser.close();
  }
}
