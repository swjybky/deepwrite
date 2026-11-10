import { assertRendererVendorGraph } from "./renderer-vendor-graph.mjs";
import { gzipSync } from "node:zlib";
import { access, readdir, readFile } from "node:fs/promises";
import { basename, dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const rendererOut = fileURLToPath(
  new URL("../apps/desktop/out/renderer/", import.meta.url)
);
const indexPath = join(rendererOut, "index.html");
// Allow moderate feature growth while keeping a guard on workspace startup size.
// Account separately for Vue I18n: its build group excludes Vue and application
// modules, and is measured from the same startup graph as every other script.
const APP_READY_APPLICATION_JS_BUDGET_BYTES = 1_200_000;
const I18N_RUNTIME_JS_BUDGET_BYTES = 60_000;
const APP_READY_JS_BUDGET_BYTES =
  APP_READY_APPLICATION_JS_BUDGET_BYTES + I18N_RUNTIME_JS_BUDGET_BYTES;
// Includes library organization, preset editors, and model/search settings.
const APP_READY_LANGUAGE_DATA_BUDGET_BYTES = 840_000;
const APP_READY_BASELINE_BYTES = 2_504_722;

try {
  await access(indexPath);
} catch {
  console.error("Renderer build is missing. Run `pnpm build` first.");
  process.exit(1);
}

const html = await readFile(indexPath, "utf8");
const assets = await readdir(join(rendererOut, "assets"));
const hasScript = /<script[^>]+src=["'][^"']+["']/.test(html);
const hasJavaScript = assets.some((asset) => asset.endsWith(".js"));
const hasCss = assets.some((asset) => asset.endsWith(".css"));

if (!html.includes("DeepWrite") || !hasScript || !hasJavaScript || !hasCss) {
  console.error(
    "Renderer build does not contain the expected DeepWrite HTML, JavaScript, and CSS assets."
  );
  process.exit(1);
}

function attribute(tag, name) {
  return tag.match(new RegExp(`\\b${name}=["']([^"']+)["']`, "i"))?.[1] ?? "";
}

function resolveHtmlAsset(assetPath) {
  const normalizedPath = normalize(assetPath.replace(/^\.\//, ""));
  const resolvedPath = join(rendererOut, normalizedPath);
  if (!resolvedPath.startsWith(rendererOut)) {
    throw new Error(
      `Renderer asset escaped its output directory: ${assetPath}`
    );
  }
  return resolvedPath;
}

const scriptSources = [...html.matchAll(/<script\b[^>]*>/gi)]
  .map(([tag]) => attribute(tag, "src"))
  .filter((source) => source.endsWith(".js"));
const modulePreloads = [...html.matchAll(/<link\b[^>]*>/gi)]
  .filter(([tag]) => attribute(tag, "rel") === "modulepreload")
  .map(([tag]) => attribute(tag, "href"))
  .filter((source) => source.endsWith(".js"));

if (scriptSources.length !== 1) {
  console.error(
    `Expected one Renderer module entry, found ${scriptSources.length}.`
  );
  process.exit(1);
}

const entryPath = resolveHtmlAsset(scriptSources[0]);
const entrySource = await readFile(entryPath, "utf8");
const dependencyTableMatch = entrySource.match(
  /\.f\s*\|\|\s*\([^)]*?\.f\s*=\s*(\[[^\]]*\])\s*\)/
);
const shellImportMatch = entrySource.match(
  /import\([`"'](\.\/WorkspaceShell-[^`"']+\.js)[`"']\)\s*,\s*__vite__mapDeps\(\[([\d,\s]+)\]\)/
);

if (!dependencyTableMatch || !shellImportMatch) {
  console.error(
    "Unable to identify the async WorkspaceShell preload graph; Renderer performance budget cannot be verified."
  );
  process.exit(1);
}

let dependencyTable;
try {
  dependencyTable = JSON.parse(dependencyTableMatch[1]);
} catch (error) {
  console.error("Renderer dependency table is invalid JSON.", error);
  process.exit(1);
}

const shellDependencyIndices = shellImportMatch[2]
  .split(",")
  .map((value) => Number.parseInt(value.trim(), 10));
const shellDependencies = shellDependencyIndices
  .map((index) => dependencyTable[index])
  .filter(
    (assetPath) => typeof assetPath === "string" && assetPath.endsWith(".js")
  )
  .map((assetPath) => join(dirname(entryPath), assetPath));

const strictInitialPaths = [
  ...new Set([...scriptSources, ...modulePreloads].map(resolveHtmlAsset))
];
const appReadyPaths = [
  ...new Set([...strictInitialPaths, ...shellDependencies])
];

async function measureJavaScript(paths) {
  const files = await Promise.all(paths.map((path) => readFile(path)));
  return {
    rawBytes: files.reduce((total, contents) => total + contents.byteLength, 0),
    gzipBytes: files.reduce(
      (total, contents) => total + gzipSync(contents).byteLength,
      0
    )
  };
}

const strictInitial = await measureJavaScript(strictInitialPaths);
const appReady = await measureJavaScript(appReadyPaths);
const reductionPercent =
  (1 - appReady.rawBytes / APP_READY_BASELINE_BYTES) * 100;

console.log(
  `Renderer JS: strict initial ${strictInitial.rawBytes.toLocaleString("en-US")} B raw / ${strictInitial.gzipBytes.toLocaleString("en-US")} B gzip; ` +
    `app-ready ${appReady.rawBytes.toLocaleString("en-US")} B raw / ${appReady.gzipBytes.toLocaleString("en-US")} B gzip ` +
    `(${reductionPercent.toFixed(1)}% below baseline).`
);

// Language dictionaries are parsed as data before mount. Report them explicitly
// so moving data out of JavaScript never hides the total startup payload.
const localeResources = await measureJavaScript(
  ["zh-CN", "en-US"].map((locale) =>
    join(rendererOut, "locales", `${locale}.json`)
  )
);
console.log(
  `Renderer language data: ${localeResources.rawBytes.toLocaleString("en-US")} B raw / ${localeResources.gzipBytes.toLocaleString("en-US")} B gzip; total app-ready JS + language data ${(appReady.rawBytes + localeResources.rawBytes).toLocaleString("en-US")} B raw.`
);
if (localeResources.rawBytes >= APP_READY_LANGUAGE_DATA_BUDGET_BYTES) {
  console.error(
    `Renderer language data exceeds its ${APP_READY_LANGUAGE_DATA_BUDGET_BYTES.toLocaleString("en-US")} B budget.`
  );
  process.exit(1);
}

const i18nRuntimePaths = appReadyPaths.filter((path) =>
  /^i18n-runtime-[^/]+\.js$/.test(basename(path))
);
if (i18nRuntimePaths.length !== 1) {
  throw new Error(
    "Expected one isolated internationalization runtime in the startup graph."
  );
}
await assertRendererVendorGraph(i18nRuntimePaths[0]);
const i18nRuntime = await measureJavaScript(i18nRuntimePaths);
const applicationBytes = appReady.rawBytes - i18nRuntime.rawBytes;
console.log(
  `Renderer application JS: ${applicationBytes.toLocaleString("en-US")} B raw; ` +
    `internationalization runtime: ${i18nRuntime.rawBytes.toLocaleString("en-US")} B raw / ${i18nRuntime.gzipBytes.toLocaleString("en-US")} B gzip.`
);
if (applicationBytes >= APP_READY_APPLICATION_JS_BUDGET_BYTES) {
  throw new Error(
    `Renderer application JavaScript exceeds its ${APP_READY_APPLICATION_JS_BUDGET_BYTES.toLocaleString("en-US")} B budget.`
  );
}
if (i18nRuntime.rawBytes >= I18N_RUNTIME_JS_BUDGET_BYTES) {
  throw new Error(
    "Renderer internationalization runtime exceeds its 60,000 B budget."
  );
}
const totalStartupBytes = appReady.rawBytes + localeResources.rawBytes;
if (
  totalStartupBytes >=
  APP_READY_JS_BUDGET_BYTES + APP_READY_LANGUAGE_DATA_BUDGET_BYTES
) {
  throw new Error(
    "Renderer total startup code and language data exceed their combined budget."
  );
}

if (appReady.rawBytes >= APP_READY_JS_BUDGET_BYTES) {
  console.error(
    `Renderer app-ready JavaScript exceeds the ${APP_READY_JS_BUDGET_BYTES.toLocaleString("en-US")} B budget.`
  );
  process.exit(1);
}

if (reductionPercent < 40) {
  console.error(
    "Renderer app-ready JavaScript has not reached the required 40% reduction."
  );
  process.exit(1);
}

console.log("Renderer build smoke and performance budgets passed.");
