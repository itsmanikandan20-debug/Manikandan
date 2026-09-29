// Reads and writes the simple KEY=VALUE settings file (.env).
// Written by hand so beginners don't need extra packages or a new Node version.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!match) continue;
    const [, key, raw] = match;
    const value = raw.replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function saveEnvValue(file, key, value) {
  const lines = existsSync(file) ? readFileSync(file, "utf8").split(/\r?\n/) : [];
  const index = lines.findIndex((line) => line.match(new RegExp(`^\\s*${key}\\s*=`)));
  if (index >= 0) lines[index] = `${key}=${value}`;
  else lines.push(`${key}=${value}`);
  writeFileSync(file, lines.filter((line, i) => line !== "" || i < lines.length - 1).join("\n") + "\n");
  process.env[key] = value;
}
