// The screenshot library: every screenshot is saved on this computer in data/captures,
// with a small index (index.json) of names, sources, sizes and where each was placed in Figma.
// It also remembers screenshots waiting to go into a Figma file that isn't open yet
// (deliveries.json), and the Figma files it has seen, with their links (files.json).
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
  /** Writes a file, recreating the folder if it was deleted. Never crashes Design Agent. */
  function write(file, data) {
    try {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, data);
    } catch (error) {
      console.log(`  Couldn't save ${path.basename(file)}: ${error.message}`);
    }
  }
  const save = () => write(indexFile, JSON.stringify(items, null, 2));

  const readJson = (file, fallback) => {
    try {
      return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : fallback;
    } catch {
      return fallback;
    }
  };
  const deliveriesFile = path.join(root, "data", "deliveries.json");
  const filesFile = path.join(root, "data", "files.json");
  let deliveries = readJson(deliveriesFile, []);
  let files = readJson(filesFile, {}); // lowercased name -> { name, key }
  const saveDeliveries = () => write(deliveriesFile, JSON.stringify(deliveries, null, 2));

  /** Loose file-name match: "portfolio" matches "My Portfolio 2026". */
  const simple = (name) => String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const sameFile = (a, b) => {
    const x = simple(a);
    const y = simple(b);
    if (!x || !y) return false;
    if (x === y) return true;
    const shorter = x.length < y.length ? x : y;
    return shorter.length >= 4 && (x.includes(y) || y.includes(x));
  };

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
    add({ url, title, fullPage, cssWidth, cssHeight, chunks, name }) {
      const number = items.reduce((max, item) => Math.max(max, Number(item.id.slice(3)) || 0), 0) + 1;
      const id = `cap${number}`;
      const files = chunks.map((chunk, i) => {
        const file = `${id}-${i}.png`;
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, file), Buffer.from(chunk.base64, "base64"));
        return { file, width: chunk.width, height: chunk.height };
      });
      const entry = {
        id,
        name: name || niceName(url, fullPage),
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

    markPlaced(id, nodeId, fileName, page) {
      const entry = items.find((item) => item.id === id);
      if (!entry) return;
      entry.placedInFigma.push({ nodeId, file: fileName, page: page || "", at: new Date().toISOString() });
      save();
    },

    sameFile,

    // ----- screenshots waiting for a Figma file that isn't open -----
    addDelivery(change, fileName) {
      deliveries.push({ id: `d${Date.now()}`, file: fileName, change, at: new Date().toISOString() });
      saveDeliveries();
    },
    deliveriesFor(fileName) {
      return deliveries.filter((d) => sameFile(d.file, fileName));
    },
    removeDelivery(id) {
      deliveries = deliveries.filter((d) => d.id !== id);
      saveDeliveries();
    },
    waitingDeliveries() {
      return deliveries.slice();
    },

    // ----- Figma files seen (so we can link to them) -----
    rememberFile(name, key) {
      if (!name) return;
      const known = files[simple(name)];
      if (known && known.key === key) return;
      files[simple(name)] = { name, key: key || (known && known.key) || "" };
      write(filesFile, JSON.stringify(files, null, 2));
    },
    findFile(name) {
      const match = Object.values(files).find((f) => sameFile(f.name, name));
      return match || null;
    },
  };
}
