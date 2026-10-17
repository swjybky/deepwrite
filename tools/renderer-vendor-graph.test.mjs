import { describe, expect, it } from "vitest";
import { assertRendererVendorGraph } from "./renderer-vendor-graph.mjs";

function inspect(chunks) {
  return assertRendererVendorGraph(
    "/assets/i18n-runtime-test.js",
    async (rawPath) => {
      // join() renders platform separators, so look fixtures up by the
      // platform-neutral form the graph uses in tests.
      const path = rawPath.replaceAll("\\", "/");
      if (!(path in chunks)) throw new Error(`Missing fixture chunk: ${path}`);
      return chunks[path];
    }
  );
}

describe("Renderer vendor initialization graph", () => {
  it("permits Vue and shared bundler helpers without treating strings as imports", async () => {
    await expect(
      inspect({
        "/assets/i18n-runtime-test.js": `import { ref } from './vue-runtime-test.js';
        const example = "import './application.js'"; // import './application.js'
        export const locale = ref(example);`,
        "/assets/vue-runtime-test.js": `import './rolldown-runtime-test.js'; export const ref = value => ({ value });`,
        "/assets/rolldown-runtime-test.js": `export const empty = {};`
      })
    ).resolves.toBeUndefined();
  });

  it("rejects the app/Vue coalescing cycle that prevented startup", async () => {
    await expect(
      inspect({
        "/assets/i18n-runtime-test.js": `import { ref } from './i18n-app.js'; export const createI18n = () => ref();`,
        "/assets/i18n-app.js": `import { createI18n } from './i18n-runtime-test.js'; export const ref = () => ({}); createI18n();`
      })
    ).rejects.toThrow("i18n-runtime-test.js → ./i18n-app.js");
  });

  it.each([
    "import './application.js';",
    "export { value } from './application.js';"
  ])(
    "rejects application dependencies in the shared Vue chunk: %s",
    async (source) => {
      await expect(
        inspect({
          "/assets/i18n-runtime-test.js": `import './vue-runtime-test.js';`,
          "/assets/vue-runtime-test.js": source
        })
      ).rejects.toThrow("vue-runtime-test.js → ./application.js");
    }
  );

  it("also inspects transitive helper dependencies", async () => {
    await expect(
      inspect({
        "/assets/i18n-runtime-test.js": `import './vue-runtime-test.js';`,
        "/assets/vue-runtime-test.js": `import './rolldown-runtime-test.js';`,
        "/assets/rolldown-runtime-test.js": `import './application.js';`
      })
    ).rejects.toThrow("rolldown-runtime-test.js → ./application.js");
  });
});
