import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

const root = resolve("apps/desktop/src/renderer");
const rendererContracts = resolve("packages/contracts/src/renderer.ts");
const allowedExtensions = new Set([".ts", ".vue"]);
const forbiddenImports = [
  /^electron$/,
  /^node:/,
  /^(fs|path|os|child_process|worker_threads|net|tls|http|https)$/,
  /^better-sqlite3$/,
  /^sqlite3(?:\/|$)/,
  /conversation-storage(?:\/|$)/,
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

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function splitImportedNames(body) {
  return body
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const typeOnly = /^type\s+/.test(part);
      const name = part
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)[0]
        .trim();
      return { name, typeOnly };
    })
    .filter((item) => item.name);
}

function collectValueExports(source) {
  const names = new Set();
  const text = stripComments(source);
  const pattern =
    /export\s+(?!type\b)(?:\{([\s\S]*?)\}|(?:async\s+)?function\s+(\w+)|const\s+(\w+)|class\s+(\w+)|enum\s+(\w+))/g;
  for (const match of text.matchAll(pattern)) {
    if (match[1]) {
      for (const item of splitImportedNames(match[1])) {
        if (!item.typeOnly) names.add(item.name);
      }
      continue;
    }
    for (const name of match.slice(2)) {
      if (name) names.add(name);
    }
  }
  return names;
}

function collectValueImports(source, specifier) {
  const names = [];
  const text = stripComments(source);
  const pattern =
    /import\s+(type\s+)?(?:\{([\s\S]*?)\}|\*\s+as\s+\w+)\s+from\s+["']([^"']+)["']/g;
  for (const match of text.matchAll(pattern)) {
    if (match[3] !== specifier || match[1] || !match[2]) continue;
    for (const item of splitImportedNames(match[2])) {
      if (!item.typeOnly) names.push(item.name);
    }
  }
  return names;
}

const files = await collectFiles(root);
const violations = [];
for (const file of files) {
  const source = await readFile(file, "utf8");
  const importPattern = /(?:from\s+|import\s*\()\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1];
    if (
      specifier &&
      forbiddenImports.some((pattern) => pattern.test(specifier))
    ) {
      violations.push(
        `${relative(process.cwd(), file)} imports forbidden renderer module ${specifier}`
      );
    }
  }
}

const rendererExports = collectValueExports(
  await readFile(rendererContracts, "utf8")
);
const missingContractExports = new Map();
for (const file of files) {
  if (file.includes(".test.")) continue;
  const source = await readFile(file, "utf8");
  for (const name of collectValueImports(source, "@deepwrite/contracts")) {
    if (rendererExports.has(name)) continue;
    const list = missingContractExports.get(name) ?? [];
    list.push(relative(process.cwd(), file));
    missingContractExports.set(name, list);
  }
}

for (const [name, usedBy] of [...missingContractExports.entries()].sort()) {
  violations.push(
    `Renderer imports runtime value ${name} from @deepwrite/contracts, but packages/contracts/src/renderer.ts does not export it (${usedBy.join(", ")}). This fails WorkspaceShell module load and shows a blank window.`
  );
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exit(1);
}

console.log(
  "Renderer boundary check passed: no Node, Electron, SQLite, or Pi runtime imports, and contracts renderer exports cover Renderer value imports."
);
