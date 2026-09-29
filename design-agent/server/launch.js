// What "Start Design Agent" runs: update first, then start the server.
// The server runs as a separate process so it always uses the freshly updated files.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { update } from "./update.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

console.log("");
await update(ROOT);

const server = spawn(process.execPath, [path.join(ROOT, "server", "index.js"), ...process.argv.slice(2)], {
  cwd: ROOT,
  stdio: "inherit",
});
server.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill(signal));
