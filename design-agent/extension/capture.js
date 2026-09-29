// Page-side helpers for screenshots: hide Design Agent's pointer, scroll through the page
// for full-page captures (hiding sticky headers after the first shot so they don't repeat),
// and put everything back afterwards. Injected on demand; running it again reuses it.
(function () {
  const VERSION = 2;
  const api = (window.__designAgent = window.__designAgent || {});
  if (api.captureVersion === VERSION) return;
  api.captureVersion = VERSION;

  let saved = null;

  api.captureStart = function () {
    saved = { x: window.scrollX, y: window.scrollY, hidden: [] };
    // Hide the scrollbar so it doesn't appear (repeated) in the picture.
    const style = document.createElement("style");
    style.setAttribute("data-design-agent", "capture-style");
    style.textContent = "html,body{scrollbar-width:none!important}::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}";
    document.documentElement.appendChild(style);
    saved.style = style;
    document.querySelectorAll("[data-design-agent]").forEach((el) => {
      saved.hidden.push([el, el.style.visibility]);
      el.style.visibility = "hidden";
    });
    const doc = document.documentElement;
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      pageHeight: Math.max(doc.scrollHeight, document.body ? document.body.scrollHeight : 0),
      dpr: window.devicePixelRatio || 1,
      url: location.href,
      title: document.title,
    };
  };

  /** Scrolls to y. From the second shot on, hides fixed/sticky bars so they appear only once. */
  api.captureScrollTo = function (y, hideFixed) {
    if (hideFixed && saved && !saved.fixedHidden) {
      saved.fixedHidden = true;
      for (const el of document.querySelectorAll("body *")) {
        const position = getComputedStyle(el).position;
        if (position === "fixed" || position === "sticky") {
          saved.hidden.push([el, el.style.visibility]);
          el.style.visibility = "hidden";
        }
      }
    }
    window.scrollTo({ top: y, left: 0, behavior: "instant" });
    return window.scrollY;
  };

  api.captureEnd = function () {
    if (!saved) return { ok: true };
    for (const [el, visibility] of saved.hidden) el.style.visibility = visibility;
    if (saved.style) saved.style.remove();
    window.scrollTo({ top: saved.y, left: saved.x, behavior: "instant" });
    saved = null;
    return { ok: true };
  };
})();
