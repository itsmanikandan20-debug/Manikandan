// Design Agent's own pointer: an orange arrow + highlight box drawn over the web page.
// It is separate from your mouse, never blocks clicks, and follows the element when you scroll.
// Injected into the page on demand; running it again just reuses what's already there.
(function () {
  const VERSION = 1;
  const api = (window.__designAgent = window.__designAgent || {});
  if (api.pointerVersion === VERSION) return;
  api.pointerVersion = VERSION;

  const ORANGE = "#F2561D";
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let host = null;
  let box = null;
  let arrow = null;
  let current = null; // what we're pointing at: { a, b } elements (b = second element for a gap)
  let hideTimer = null;

  function build() {
    if (host && document.documentElement.contains(host)) return;
    host = document.createElement("div");
    host.setAttribute("data-design-agent", "pointer");
    host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647;";
    const shadow = host.attachShadow({ mode: "open" });
    const speed = reduceMotion ? "0s" : ".55s";
    shadow.innerHTML = `
      <style>
        .box { position: fixed; left: 0; top: 0; width: 0; height: 0; border: 2.5px solid ${ORANGE};
          border-radius: 8px; background: rgba(242, 86, 29, .10); box-shadow: 0 0 0 4px rgba(242, 86, 29, .18);
          opacity: 0; transition: left ${speed} cubic-bezier(.3,.8,.3,1), top ${speed} cubic-bezier(.3,.8,.3,1),
          width ${speed} cubic-bezier(.3,.8,.3,1), height ${speed} cubic-bezier(.3,.8,.3,1), opacity .25s; }
        .box.gap { border-style: dashed; border-radius: 4px; }
        .arrow { position: fixed; left: 0; top: 0; display: flex; align-items: flex-start; opacity: 0;
          transition: transform ${speed} cubic-bezier(.3,.8,.3,1), opacity .25s; will-change: transform; }
        .arrow svg { width: 30px; height: 34px; filter: drop-shadow(0 2px 3px rgba(0,0,0,.3)); flex: none; }
        .tag { margin: 24px 0 0 -4px; background: ${ORANGE}; color: #fff; font: 600 12px/1 system-ui, "Segoe UI", sans-serif;
          padding: 5px 9px; border-radius: 999px; white-space: nowrap; }
        .show { opacity: 1; }
      </style>
      <div class="box"></div>
      <div class="arrow">
        <svg viewBox="0 0 26 30"><path d="M2 2 L2 24 L8 18.5 L12.5 28 L16.5 26.2 L12 17 L20 17 Z"
          fill="${ORANGE}" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/></svg>
        <span class="tag">Design Agent</span>
      </div>`;
    document.documentElement.appendChild(host);
    box = shadow.querySelector(".box");
    arrow = shadow.querySelector(".arrow");
    // Start from the bottom-right corner so the first move is visible.
    arrow.style.transform = `translate(${window.innerWidth - 60}px, ${window.innerHeight - 60}px)`;
  }

  function find(id) {
    return document.querySelector(`[data-da-id="${CSS.escape(id)}"]`);
  }

  /** The area to highlight: one element, or the empty space between two elements. */
  function area() {
    if (!current) return null;
    const a = current.a.getBoundingClientRect();
    if (!current.b) return { left: a.left, top: a.top, width: a.width, height: a.height, gap: false };
    const b = current.b.getBoundingClientRect();
    const [upper, lower] = a.top <= b.top ? [a, b] : [b, a];
    const left = Math.min(upper.left, lower.left);
    const right = Math.max(upper.right, lower.right);
    const top = upper.bottom;
    const height = Math.max(lower.top - upper.bottom, 4);
    return { left, top, width: right - left, height, gap: true };
  }

  function place() {
    const r = area();
    if (!r) return;
    const pad = r.gap ? 0 : 5;
    box.classList.toggle("gap", r.gap);
    box.style.left = `${r.left - pad}px`;
    box.style.top = `${r.top - pad}px`;
    box.style.width = `${r.width + pad * 2}px`;
    box.style.height = `${r.height + pad * 2}px`;
    // Arrow tip just inside the lower part of the area, kept on screen.
    const x = Math.max(8, Math.min(r.left + Math.min(r.width * 0.55, r.width - 10), window.innerWidth - 150));
    const y = Math.max(8, Math.min(r.top + r.height - (r.gap ? r.height / 2 : 6), window.innerHeight - 60));
    arrow.style.transform = `translate(${x}px, ${y}px)`;
    box.classList.add("show");
    arrow.classList.add("show");
  }

  let frame = 0;
  function follow() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(place);
  }
  window.addEventListener("scroll", follow, { passive: true, capture: true });
  window.addEventListener("resize", follow, { passive: true });

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /** Points at "w12", or at the gap between two elements with "w4-w5". */
  api.show = async function (target) {
    const ids = String(target).split("-").map((s) => s.trim()).filter(Boolean);
    const a = find(ids[0]);
    const b = ids[1] ? find(ids[1]) : null;
    if (!a) return { ok: false, reason: `element ${ids[0]} not found (the page may have changed)` };
    build();
    clearTimeout(hideTimer);
    current = { a, b };

    // If it's off screen, bring it into view first, like a colleague scrolling to show you.
    const r = a.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) {
      a.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
      await wait(reduceMotion ? 50 : 450);
    }
    place();
    // Safety: never leave the pointer on screen forever.
    hideTimer = setTimeout(api.hide, 30000);
    return { ok: true };
  };

  api.hide = function () {
    clearTimeout(hideTimer);
    current = null;
    if (!host) return { ok: true };
    box.classList.remove("show");
    arrow.classList.remove("show");
    return { ok: true };
  };
})();
