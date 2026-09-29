// Starts the Design Agent plugin in Figma Desktop for you (Windows only).
// Figma doesn't let other programs start plugins, but it has a shortcut, Ctrl+Alt+P,
// that runs the last plugin you used. So:
// - When a Figma file comes to the front and the plugin isn't connected, we press it once.
// - When you ask about Figma and it isn't connected, we bring Figma to the front and press it.
// If you used a different plugin last, that one starts instead; then we ask you to run
// Design Agent once from the Plugins menu, and the shortcut works again after that.
import { spawn } from "node:child_process";

const WATCH_SCRIPT = `
$code = @'
using System; using System.Runtime.InteropServices; using System.Text;
public class DAFg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
}
'@
Add-Type -TypeDefinition $code
while ($true) {
  $h = [DAFg]::GetForegroundWindow()
  $sb = New-Object System.Text.StringBuilder 512
  [void][DAFg]::GetWindowText($h, $sb, 512)
  [uint32]$procId = 0
  [void][DAFg]::GetWindowThreadProcessId($h, [ref]$procId)
  $name = ""
  try { $name = (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch {}
  [Console]::Out.WriteLine($name + [char]9 + $sb.ToString())
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds 1500
}
`;

// Ctrl+Alt+P to the window in front (Figma).
const PRESS_SCRIPT = `$w = New-Object -ComObject WScript.Shell; $w.SendKeys('^%p')`;

// Bring Figma to the front first, then press Ctrl+Alt+P.
const ACTIVATE_AND_PRESS_SCRIPT = `
$p = Get-Process -Name Figma -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { Write-Output "no-figma"; exit }
$w = New-Object -ComObject WScript.Shell
[void]$w.AppActivate($p.Id)
Start-Sleep -Milliseconds 500
$w.SendKeys('^%p')
Write-Output "pressed"
`;

function encoded(script) {
  return Buffer.from(script, "utf16le").toString("base64");
}

function runPowerShell(script) {
  return new Promise((resolve) => {
    let out = "";
    try {
      const child = spawn("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded(script)], {
        windowsHide: true,
      });
      child.stdout.on("data", (d) => (out += d));
      child.on("error", () => resolve(""));
      child.on("exit", () => resolve(out.trim()));
    } catch {
      resolve("");
    }
  });
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createFigmaAutostart({ isConnected, enabled, onNeedsHelp, onFront = () => {} }) {
  const supported = process.platform === "win32";
  const tried = new Map(); // window title -> last time we pressed the shortcut there
  let front = { app: "", title: "" };

  function isFigmaFile(app, title) {
    // Figma's file windows are titled like "My Portfolio – Figma"; the home screen is just "Figma".
    return /^figma$/i.test(app) && title && !/^figma$/i.test(title.trim());
  }

  async function checkAfterPress(title) {
    for (let i = 0; i < 14; i++) {
      await wait(500);
      if (isConnected()) return true;
    }
    onNeedsHelp(title);
    return false;
  }

  function watch() {
    if (!supported) return;
    let buffer = "";
    const child = spawn("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded(WATCH_SCRIPT)], {
      windowsHide: true,
    });
    child.on("error", () => {});
    child.on("exit", () => setTimeout(watch, 5000)); // restart the watcher if it stops
    child.stdout.on("data", (data) => {
      buffer += data;
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        const [app = "", title = ""] = line.split("\t");
        front = { app, title };
        onFront(app, title);
        if (!enabled() || isConnected() || !isFigmaFile(app, title)) continue;
        const last = tried.get(title) || 0;
        if (Date.now() - last < 60000) continue; // once a minute per file at most
        tried.set(title, Date.now());
        console.log(`  Starting the Figma plugin in "${title}" (Ctrl+Alt+P)...`);
        runPowerShell(PRESS_SCRIPT).then(() => checkAfterPress(title));
      }
    });
  }

  return {
    supported,
    start: watch,
    /** The app and window title in front right now (Windows only). */
    front: () => ({ ...front }),
    /** Makes sure the plugin is running: brings Figma forward and presses the shortcut. */
    async ensure() {
      if (isConnected()) return true;
      if (!supported || !enabled()) return false;
      const result = await runPowerShell(ACTIVATE_AND_PRESS_SCRIPT);
      if (result !== "pressed") return false;
      console.log("  Starting the Figma plugin (Ctrl+Alt+P)...");
      return checkAfterPress("Figma");
    },
  };
}
