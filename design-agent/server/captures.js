// The screenshot library: every screenshot is saved on this computer in data/captures,
// with a small index (index.json) of names, sources, sizes and where each was placed in Figma.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export function createCaptures(root) {
  const dir = path.join(root, "data", "captures");
  const indexFile = path.join(dir, "index.json");
  mkdirSync(dir, { recursive: true });

  let items = [];
  try {
    if (existsSync(indexFile)) items = JSON.parse(readFileSync(indexFile, "utf8"));
  } catch {
    items = [];
  }
  const save = () => writeFileSync(indexFile, JSON.stringify(items, null, 2));

  function niceName(url, fullPage) {
    let host = "page";
    try {
      host = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      // keep "page"
    }
    const when = new Date().toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    return `Screenshot – ${host}${fullPage ? " (full page)" : ""} – ${when}`;
  }

  return {
    dir,

    /** Saves a screenshot (one or more PNG slices, top to bottom). Returns its entry. */
    add({ url, title, fullPage, cssWidth, cssHeight, chunks }) {
      const number = items.reduce((max, item) => Math.max(max, Number(item.id.slice(3)) || 0), 0) + 1;
      const id = `cap${number}`;
      const files = chunks.map((chunk, i) => {
        const file = `${id}-${i}.png`;
        writeFileSync(path.join(dir, file), Buffer.from(chunk.base64, "base64"));
        return { file, width: chunk.width, height: chunk.height };
      });
      const entry = {
        id,
        name: niceName(url, fullPage),
        url,
        title,
        fullPage: Boolean(fullPage),
        cssWidth,
        cssHeight,
        files,
        createdAt: new Date().toISOString(),
        placedInFigma: [],
      };
      items.push(entry);
      save();
      return entry;
    },

    list() {
      return items.slice().reverse();
    },

    /** Finds by id; "latest" means the newest one. */
    get(id) {
      if (!id || id === "latest") return items[items.length - 1] || null;
      return items.find((item) => item.id === id) || null;
    },

    /** The image slices as base64, for sending to Figma. */
    load(entry) {
      return entry.files.map((f) => ({
        base64: readFileSync(path.join(dir, f.file)).toString("base64"),
        width: f.width,
        height: f.height,
      }));
    },

    markPlaced(id, nodeId, fileName) {
      const entry = items.find((item) => item.id === id);
      if (!entry) return;
      entry.placedInFigma.push({ nodeId, file: fileName, at: new Date().toISOString() });
      save();
    },
  };
}
