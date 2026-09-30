// Review marks: numbered, coloured boxes with a short label drawn over the web page,
// one per finding (UX = purple, UI = blue, Content = green). They follow the page when you
// scroll, never block clicks, and stay until the next review or "clear the marks".
// Injected into the page on demand; running it again just reuses what's already there.
(function () {
  const VERSION = 1;
  const api = (window.__designAgent = window.__designAgent || {});
  if (api.marksVersion === VERSION) return;
  api.marksVersion = VERSION;

  const KINDS = {
    ux: { color: "#7C4DFF", label: "UX" },
    ui: { color: "#1E88E5", label: "UI" },
    content: { color: "#2E9E5B", label: "Content" },
  };
  let host = null;
  let layer = null;
  let items = []; // { el, box }

  function build() {
    if (host && document.documentElement.contains(host)) return;
    host = document.createElement("div");
    host.setAttribute("data-design-agent", "marks");
    host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483646;";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        .mark { position: fixed; border: 2.5px solid var(--c); border-radius: 8px;
          background: color-mix(in srgb, var(--c) 8%, transparent); box-sizing: border-box;
          animation: pop .35s cubic-bezier(.3,1.4,.5,1) both; }
        .label { position: absolute; left: -2.5px; bottom: calc(100% + 4px); display: flex; gap: 6px; align-items: center;
          max-width: 340px; background: var(--c); color: #fff; font: 600 12px/1.25 system-ui, "Segoe UI", sans-serif;
          padding: 5px 9px 5px 5px; border-radius: 10px; box-shadow: 0 2px 8px rgba(0,0,0,.25); }
        .mark.below .label { bottom: auto; top: calc(100% + 4px); }
        .num { flex: none; width: 20px; height: 20px; border-radius: 50%; background: #fff; color: var(--c);
          display: grid; place-items: center; font-weight: 800; }
        .kind { flex: none; opacity: .9; text-transform: uppercase; letter-spacing: .04em; font-size: 10.5px; }
        .note { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        @keyframes pop { from { opacity: 0; transform: scale(.94); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) { .mark { animation: none; } }
      </style>
      <div class="layer"></div>`;
    document.documentElement.appendChild(host);
    layer = shadow.querySelector(".layer");
  }

  function place() {
    for (const item of items) {
      const r = item.el.getBoundingClientRect();
      const pad = 4;
      item.box.style.left = `${r.left - pad}px`;
      item.box.style.top = `${r.top - pad}px`;
      item.box.style.width = `${r.width + pad * 2}px`;
      item.box.style.height = `${r.height + pad * 2}px`;
      item.box.classList.toggle("below", r.top < 34); // no room for the label above
      item.box.querySelector(".label").style.marginLeft = "0px";
    }
    // Labels must not cover each other: flip one to the other side, or slide it right.
    const placed = [];
    const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    for (const item of items) {
      const label = item.box.querySelector(".label");
      let rect = label.getBoundingClientRect();
      if (placed.some((p) => overlaps(rect, p))) {
        item.box.classList.toggle("below");
        rect = label.getBoundingClientRect();
        if (rect.top < 0 || rect.bottom > window.innerHeight) {
          item.box.classList.toggle("below"); // no room there: slide it instead
          rect = label.getBoundingClientRect();
        }
      }
      for (let shift = 0; placed.some((p) => overlaps(rect, p)) && shift < 600; ) {
        const hit = placed.find((p) => overlaps(rect, p));
        shift += hit.right - rect.left + 6;
        label.style.marginLeft = `${shift}px`;
        rect = label.getBoundingClientRect();
      }
      placed.push(rect);
    }
  }

  let frame = 0;
  const follow = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(place);
  };
  window.addEventListener("scroll", follow, { passive: true, capture: true });
  window.addEventListener("resize", follow, { passive: true });

  /** marks: [{ id: "w12", kind: "ux" | "ui" | "content", note: "Button label is vague" }] */
  api.mark = function (marks) {
    api.clearMarks();
    build();
    const missing = [];
    let number = 0;
    let first = null;
    for (const m of marks || []) {
      number++;
      const el = document.querySelector(`[data-da-id="${CSS.escape(String(m.id || "").split("-")[0])}"]`);
      if (!el) {
        missing.push(m.id);
        continue;
      }
      const kind = KINDS[String(m.kind || "").toLowerCase()] || KINDS.ux;
      const box = document.createElement("div");
      box.className = "mark";
      box.style.setProperty("--c", kind.color);
      box.style.animationDelay = `${(number - 1) * 0.08}s`;
      const label = document.createElement("div");
      label.className = "label";
      const num = document.createElement("span");
      num.className = "num";
      num.textContent = String(number);
      const tag = document.createElement("span");
      tag.className = "kind";
      tag.textContent = kind.label;
      const note = document.createElement("span");
      note.className = "note";
      note.textContent = String(m.note || "").slice(0, 80);
      label.append(num, tag, note);
      box.append(label);
      layer.append(box);
      items.push({ el, box });
      first = first || el;
    }
    place();
    // Bring the first mark into view if none are visible.
    const anyVisible = items.some(({ el }) => {
      const r = el.getBoundingClientRect();
      return r.bottom > 0 && r.top < window.innerHeight;
    });
    if (first && !anyVisible) first.scrollIntoView({ block: "center", behavior: "smooth" });
    return { ok: true, marked: items.length, missing };
  };

  api.clearMarks = function () {
    items = [];
    if (layer) layer.innerHTML = "";
    return { ok: true };
  };
})();
