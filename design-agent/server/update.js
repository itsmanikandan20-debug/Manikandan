// Keeps Design Agent up to date by itself, so nobody has to download ZIPs again.
// On every start it asks GitHub for the newest version and, if there is one,
// downloads it and replaces the program files. Your key (.env) and your
// screenshots (data/) are never touched.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { inflateRawSync } from "node:zlib";

const OWNER = "itsmanikandan20-debug";
const REPO = "Manikandan";
const DEFAULT_BRANCH = "claude/gallant-shannon-egv9lb";
const FOLDER_IN_REPO = "design-agent";

// Never overwritten by an update.
const KEEP = new Set([".env", "data", "node_modules", ".version"]);
// A running .bat file must not change under Windows' feet; it is tiny and rarely changes.
const SKIP_WHILE_RUNNING = /\.bat$/i;

async function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => (timer = setTimeout(() => reject(new Error("timeout")), ms)));
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function latestVersion(branch) {
  const response = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/commits/${branch}`, {
    headers: { accept: "application/vnd.github.sha", "user-agent": "design-agent-updater" },
  });
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  return (await response.text()).trim();
}

/** Extracts a ZIP file using only Node's built-in zlib, so no outside tool is needed. */
function unzip(zip, target) {
  // Find the "end of central directory" record near the end of the file.
  let end = zip.length - 22;
  while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error("the update download is damaged");
  const count = zip.readUInt16LE(end + 10);
  let entry = zip.readUInt32LE(end + 16);

  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(entry) !== 0x02014b50) throw new Error("the update download is damaged");
    const method = zip.readUInt16LE(entry + 10);
    const compressedSize = zip.readUInt32LE(entry + 20);
    const nameLength = zip.readUInt16LE(entry + 28);
    const extraLength = zip.readUInt16LE(entry + 30);
    const commentLength = zip.readUInt16LE(entry + 32);
    const localHeader = zip.readUInt32LE(entry + 42);
    const name = zip.toString("utf8", entry + 46, entry + 46 + nameLength);
    entry += 46 + nameLength + extraLength + commentLength;

    const file = path.resolve(target, name);
    if (!file.startsWith(path.resolve(target) + path.sep)) continue; // ignore unsafe paths
    if (name.endsWith("/")) {
      mkdirSync(file, { recursive: true });
      continue;
    }
    const dataStart = localHeader + 30 + zip.readUInt16LE(localHeader + 26) + zip.readUInt16LE(localHeader + 28);
    const data = zip.subarray(dataStart, dataStart + compressedSize);
    mkdirSync(path.dirname(file), { recursive: true });
    if (method === 0) writeFileSync(file, data);
    else if (method === 8) writeFileSync(file, inflateRawSync(data));
    else throw new Error("the update uses an unknown ZIP format");
  }
}

/** Returns true when files were updated. Never throws: an update must not stop Design Agent from starting. */
export async function update(root) {
  if (process.env.AUTO_UPDATE === "off") return false;
  if (existsSync(path.join(root, "..", ".git")) || existsSync(path.join(root, ".git"))) {
    console.log("  Updates: this is a Git copy, so use \"git pull\" to update.");
    return false;
  }

  const branch = process.env.UPDATE_BRANCH || DEFAULT_BRANCH;
  const versionFile = path.join(root, ".version");
  const current = existsSync(versionFile) ? readFileSync(versionFile, "utf8").trim() : "";
  let temp = null;

  try {
    process.stdout.write("  Checking for updates... ");
    const latest = await withTimeout(latestVersion(branch), 8000);
    if (latest === current) {
      console.log("you have the newest version.");
      return false;
    }

    process.stdout.write("downloading the newest version... ");
    const response = await withTimeout(fetch(`https://codeload.github.com/${OWNER}/${REPO}/zip/${latest}`), 60000);
    if (!response.ok) throw new Error(`download failed (${response.status})`);
    const zip = Buffer.from(await response.arrayBuffer());
    temp = mkdtempSync(path.join(os.tmpdir(), "design-agent-update-"));
    const extracted = path.join(temp, "files");
    unzip(zip, extracted);
    const top = readdirSync(extracted).find((name) => existsSync(path.join(extracted, name, FOLDER_IN_REPO)));
    if (!top) throw new Error("the download didn't contain Design Agent");
    const source = path.join(extracted, top, FOLDER_IN_REPO);

    const oldPackage = existsSync(path.join(root, "package.json")) ? readFileSync(path.join(root, "package.json"), "utf8") : "";
    for (const name of readdirSync(source)) {
      if (KEEP.has(name) || SKIP_WHILE_RUNNING.test(name)) continue;
      cpSync(path.join(source, name), path.join(root, name), { recursive: true, force: true });
    }
    writeFileSync(versionFile, latest + "\n");
    console.log("done!");

    if (readFileSync(path.join(root, "package.json"), "utf8") !== oldPackage) {
      console.log("  Installing new parts...");
      spawnSync("npm", ["install", "--no-fund", "--no-audit"], { cwd: root, stdio: "inherit", shell: true });
    }
    return true;
  } catch (error) {
    console.log(`skipped (${error.message === "timeout" ? "no answer from GitHub" : error.message}).`);
    return false;
  } finally {
    if (temp) rmSync(temp, { recursive: true, force: true });
  }
}
