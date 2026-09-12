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
async function launchServerlessBrowser(): Promise<Browser> {
  const chromiumMod = await import("@sparticuz/chromium");
  const chromium = chromiumMod.default;
  const { chromium: pwChromium } = await import("playwright-core");
  const executablePath = await chromium.executablePath();

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
  borderRadius: number;
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
      borderRadius: parseFloat(style.borderRadius) || 0,
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
    borderRadius: r.borderRadius,
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

async function findBrokenImages(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll("img"))
      .filter((img) => img.src && img.complete && img.naturalWidth === 0)
      .map((img) => img.getAttribute("src") || img.src);
  });
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
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
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

    const [raw, brokenLinks, brokenImages, screenshotBuffer] = await Promise.all([
      extractRawElements(page),
      findBrokenLinks(page),
      findBrokenImages(page),
      page.screenshot({ fullPage: true, type: "png" }),
    ]);

    const screenshotDataUrl = `data:image/png;base64,${screenshotBuffer.toString("base64")}`;

    return {
      url: normalizedUrl,
      finalUrl: page.url(),
      viewport,
      screenshotDataUrl,
      elements: toDesignElements(raw),
      brokenLinks,
      brokenImages,
      isDemo: false,
    };
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
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
    const page = await context.newPage();
    await page.goto(normalizedUrl, { waitUntil: "networkidle", timeout: 25000 }).catch(() =>
      page.goto(normalizedUrl, { waitUntil: "domcontentloaded", timeout: 25000 })
    );
    await page.waitForTimeout(400);

    const [raw, brokenImages, screenshotBuffer] = await Promise.all([
      extractRawElements(page),
      findBrokenImages(page),
      page.screenshot({ fullPage: true, type: "png" }),
    ]);

    return {
      screenshotDataUrl: `data:image/png;base64,${screenshotBuffer.toString("base64")}`,
      elements: toDesignElements(raw),
      brokenImages,
    };
  } finally {
    await browser.close();
  }
}
