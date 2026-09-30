// Opens the helper window as a small app-style window (no tabs, no address bar).
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

function findBrowser() {
  if (process.platform !== "win32") return null;
  const roots = [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean);
  // Edge first: it has free "Natural" voices that sound far more human than Chrome's.
  const exes = [
    ["Microsoft", "Edge", "Application", "msedge.exe"],
    ["Google", "Chrome", "Application", "chrome.exe"],
  ];
  for (const exe of exes) {
    for (const root of roots) {
      const file = path.join(root, ...exe);
      if (existsSync(file)) return file;
    }
  }
  return null;
}

const WIDTH = 360;
const HEIGHT = 540;

/** Bottom-right corner of the main screen (Windows), so the helper sits out of the way. */
function cornerPosition() {
  if (process.platform !== "win32") return null;
  try {
    const script = "Add-Type -AssemblyName System.Windows.Forms; $a=[System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea; Write-Output \"$($a.Right) $($a.Bottom)\"";
    const out = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", timeout: 4000, windowsHide: true });
    const [right, bottom] = String(out.stdout || "").trim().split(/\s+/).map(Number);
    if (!right || !bottom) return null;
    return { x: Math.max(0, right - WIDTH - 24), y: Math.max(0, bottom - HEIGHT - 24) };
  } catch {
    return null;
  }
}

export function openWindow(url) {
  const browser = findBrowser();
  try {
    if (browser) {
      const args = [`--app=${url}`, `--window-size=${WIDTH},${HEIGHT}`];
      const corner = cornerPosition();
      if (corner) args.push(`--window-position=${corner.x},${corner.y}`);
      spawn(browser, args, { detached: true, stdio: "ignore" }).unref();
    } else if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    } else {
      const opener = process.platform === "darwin" ? "open" : "xdg-open";
      spawn(opener, [url], { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
    }
  } catch {
    // Opening the window is a convenience; the address is printed in the terminal too.
  }
}
