import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

const root = resolve("apps/desktop/src/renderer");
const allowedExtensions = new Set([".ts", ".vue"]);
const forbiddenImports = [
  /^electron$/,
  /^node:/,
  /^(fs|path|os|child_process|worker_threads|net|tls|http|https)$/,
  /^better-sqlite3$/,
  /pi-agent-core/,
  /pi-ai/,
  /pi-runtime-adapter/
];

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
    } else if (allowedExtensions.has(extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

const violations = [];
for (const file of await collectFiles(root)) {
  const source = await readFile(file, "utf8");
  const importPattern = /(?:from\s+|import\s*\()\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1];
    if (specifier && forbiddenImports.some((pattern) => pattern.test(specifier))) {
      violations.push(`${relative(process.cwd(), file)} imports forbidden renderer module ${specifier}`);
    }
  }
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exit(1);
}

console.log("Renderer boundary check passed: no Node, Electron, SQLite, or Pi runtime imports.");
