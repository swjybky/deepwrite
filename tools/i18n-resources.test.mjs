import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "vite";
import { describe, expect, it, vi } from "vitest";
import { i18nResourcesPlugin } from "../apps/desktop/scripts/i18n-resources";
import { messageCatalogKeys } from "../apps/desktop/src/localization/message-catalog";
import { messages } from "../apps/desktop/src/renderer/src/i18n/messages";

describe("language data assets", () => {
  it("emits exact catalogs as separate assets with a validated schema", async () => {
    const plugin = i18nResourcesPlugin(
      resolve("apps/desktop/src/renderer/src/i18n/messages")
    );
    const assets = [];
    const addWatchFile = vi.fn();
    const entry = plugin.resolveId("virtual:deepwrite-locale-resources");
    const source = await plugin.load.call(
      {
        addWatchFile,
        emitFile(asset) {
          assets.push(asset);
          return `locale${assets.length}`;
        }
      },
      entry
    );
    expect(assets).toHaveLength(2);
    for (const [index, language] of ["zh-CN", "en-US"].entries()) {
      const asset = assets[index];
      expect(asset.fileName).toBe(`locales/${language}.json`);
      expect(JSON.parse(asset.source)).toEqual(messages[language]);
      const signature = createHash("sha256")
        .update(messageCatalogKeys(messages[language]).join("\n"))
        .digest("hex");
      expect(source).toContain(signature);
      expect(source).toContain(
        `import.meta.ROLLUP_FILE_URL_locale${index + 1}`
      );
    }
    expect(source.length).toBeLessThan(500);
    expect(addWatchFile).toHaveBeenCalledWith(
      resolve("apps/desktop/src/renderer/src/i18n/messages/index.ts")
    );
  });

  it("drops deleted message dependencies when a running dev server reloads", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deepwrite-i18n-"));
    let server;
    try {
      const entry = join(directory, "index.ts");
      const removed = join(directory, "removed.ts");
      await writeFile(removed, 'export default { label: "old" };');
      await writeFile(
        entry,
        'import removed from "./removed"; export const messages = { "zh-CN": removed, "en-US": removed };'
      );
      server = await createServer({
        configFile: false,
        root: directory,
        plugins: [i18nResourcesPlugin(directory)],
        server: { middlewareMode: true, watch: null, ws: false }
      });
      const send = vi.spyOn(server.ws, "send");
      const url = "virtual:deepwrite-locale-resources";
      await server.environments.client.moduleGraph.ensureEntryFromUrl(url);
      await server.transformRequest(url);
      const dependencyFiles = () =>
        [
          ...server.environments.client.moduleGraph.getModuleById(`\0${url}`)
            .importedModules
        ].map((module) => module.file);
      expect(dependencyFiles()).toContain(removed);

      await writeFile(
        entry,
        'export const messages = { "zh-CN": { label: "new" }, "en-US": { label: "new" } };'
      );
      await rm(removed);
      server.watcher.emit("unlink", removed);
      await vi.waitFor(() => expect(send).toHaveBeenCalled());
      const transformed = await server.transformRequest(url);
      expect(dependencyFiles()).not.toContain(removed);
      expect(transformed.code).toContain("/@deepwrite-locales/zh-CN.json");
    } finally {
      await server?.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("retries a catalog read after an incomplete file update", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deepwrite-i18n-"));
    try {
      const plugin = i18nResourcesPlugin(directory);
      const entry = join(directory, "index.ts");
      const id = plugin.resolveId("virtual:deepwrite-locale-resources");
      const context = { addWatchFile: vi.fn(), emitFile: vi.fn() };
      await expect(plugin.load.call(context, id)).rejects.toThrow("ENOENT");
      await writeFile(
        entry,
        'export const messages = { "zh-CN": { label: "new" }, "en-US": { label: "new" } };'
      );
      await expect(plugin.load.call(context, id)).resolves.toContain("schema");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([{}, [], null, { foundation: {} }, { foundation: 2 }])(
    "rejects malformed resource trees: %j",
    (value) => {
      expect(() => messageCatalogKeys(value)).toThrow("malformed");
    }
  );
});
