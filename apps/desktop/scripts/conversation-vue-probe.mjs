import { createServer } from "vite";
import vue from "@vitejs/plugin-vue";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const require = createRequire(import.meta.url);
const server = await createServer({
  root,
  publicDir: resolve(root, "apps/desktop/src/renderer/public"),
  configFile: false,
  plugins: [vue()],
  server: {
    port: 0,
    hmr: false,
    watch: { ignored: ["**/out/**", "**/.git/**"] }
  },
  resolve: {
    alias: [
      {
        find: "@deepwrite/contracts/renderer",
        replacement: resolve(root, "packages/contracts/src/renderer.ts")
      },
      {
        find: "@deepwrite/contracts",
        replacement: resolve(root, "packages/contracts/src/renderer.ts")
      }
    ]
  }
});
try {
  await server.listen();
  const url = new URL(
    process.argv.includes("--management-only")
      ? "apps/desktop/scripts/fixtures/conversation-management-probe.html"
      : "apps/desktop/scripts/fixtures/conversation-vue-probe.html",
    server.resolvedUrls.local[0]
  );
  const child = spawn(
    require("electron"),
    [
      fileURLToPath(
        new URL("conversation-vue-probe-electron.mjs", import.meta.url)
      ),
      process.argv[2],
      url.href,
      ...process.argv.slice(3)
    ],
    { stdio: "inherit" }
  );
  const code = await new Promise((resolve) => child.once("exit", resolve));
  if (code) process.exitCode = Number(code);
} finally {
  await server.close();
}
