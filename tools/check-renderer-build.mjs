import { access, readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const rendererOut = resolve("apps/desktop/out/renderer");
const indexPath = join(rendererOut, "index.html");

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
  console.error("Renderer build does not contain the expected DeepWrite HTML, JavaScript, and CSS assets.");
  process.exit(1);
}

console.log("Renderer build smoke passed: DeepWrite HTML and compiled assets are present.");
