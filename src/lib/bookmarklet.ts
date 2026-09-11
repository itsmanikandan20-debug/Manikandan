// Generates a "highlight this issue" bookmarklet — a javascript: URI that,
// when clicked while the user is on the real live website, finds the
// element by CSS selector and draws a red outline + tooltip over it.
//
// This is the MVP's answer to "exact element highlighting": a full browser
// extension is out of scope for a portfolio project, but a bookmarklet
// achieves the same practical result (developer clicks issue -> opens the
// site -> highlights the exact element) without installing anything.
export function buildHighlightBookmarklet(selector: string, issueNumber: number, title: string): string {
  const safeSelector = JSON.stringify(selector);
  const safeLabel = JSON.stringify(`Issue #${issueNumber} — ${title}`);

  const script = `
    (function(){
      var sel = ${safeSelector};
      var label = ${safeLabel};
      document.querySelectorAll('[data-designcheck-highlight]').forEach(function(n){ n.remove(); });
      var el = document.querySelector(sel);
      if (!el) { alert('DesignCheck: could not find an element matching ' + sel + ' on this page. The selector may not exist here — this is expected outside the DesignCheck demo.'); return; }
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      var rect = el.getBoundingClientRect();
      var box = document.createElement('div');
      box.setAttribute('data-designcheck-highlight', '1');
      box.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border:3px solid #E4342A;border-radius:6px;box-shadow:0 0 0 4px rgba(228,52,42,0.25);left:' + rect.left + 'px;top:' + rect.top + 'px;width:' + rect.width + 'px;height:' + rect.height + 'px;transition:all .15s ease;';
      var tip = document.createElement('div');
      tip.setAttribute('data-designcheck-highlight', '1');
      tip.textContent = label;
      tip.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;background:#181321;color:#fff;font:600 12px/1.4 system-ui,sans-serif;padding:6px 10px;border-radius:6px;left:' + rect.left + 'px;top:' + (rect.top - 34) + 'px;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,.25);';
      document.body.appendChild(box);
      document.body.appendChild(tip);
      setTimeout(function(){ box.remove(); tip.remove(); }, 8000);
    })();
  `
    .replace(/\s+/g, " ")
    .trim();

  return `javascript:${encodeURIComponent(script)}`;
}
