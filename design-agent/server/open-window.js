// Opens the helper window as a small app-style window (no tabs, no address bar).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

function findBrowser() {
  if (process.platform !== "win32") return null;
  const roots = [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean);
  const exes = [
    ["Google", "Chrome", "Application", "chrome.exe"],
    ["Microsoft", "Edge", "Application", "msedge.exe"],
  ];
  for (const exe of exes) {
    for (const root of roots) {
      const file = path.join(root, ...exe);
      if (existsSync(file)) return file;
    }
  }
  return null;
}

export function openWindow(url) {
  const browser = findBrowser();
  try {
    if (browser) {
      spawn(browser, [`--app=${url}`, "--window-size=420,760"], { detached: true, stdio: "ignore" }).unref();
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
