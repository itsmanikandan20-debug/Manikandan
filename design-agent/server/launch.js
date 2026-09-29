// What "Start Design Agent" runs: update first, then start the server.
// The server runs as a separate process so it always uses the freshly updated files.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./env.js";
import { update } from "./update.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv(path.join(ROOT, ".env"));
const PORT = Number(process.env.PORT) || 3456;

/** If Design Agent is already running (maybe an older version), ask it to close. */
async function closeRunningCopy() {
  try {
    await fetch(`http://127.0.0.1:${PORT}/api/quit`, {
      method: "POST",
      headers: { "x-design-agent": "1" },
      signal: AbortSignal.timeout(1500),
    });
  } catch {
    return; // nothing running
  }
  console.log("  Closing the Design Agent that was already running...");
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    try {
      await fetch(`http://127.0.0.1:${PORT}/api/status`, { signal: AbortSignal.timeout(300) });
    } catch {
      return; // it has closed
    }
  }
}

console.log("");
await update(ROOT);
await closeRunningCopy();

const server = spawn(process.execPath, [path.join(ROOT, "server", "index.js"), ...process.argv.slice(2)], {
  cwd: ROOT,
  stdio: "inherit",
});
server.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill(signal));
