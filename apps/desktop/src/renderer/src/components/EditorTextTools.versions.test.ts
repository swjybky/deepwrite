import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it } from "vitest";
import EditorTextTools from "./EditorTextTools.vue";
import { t } from "../i18n";

async function render(versionVisible: boolean) {
  return renderToString(
    createSSRApp({
      render: () =>
        h(EditorTextTools, {
          canUndo: false,
          canRedo: false,
          disabled: true,
          findPanelOpen: false,
          findPanelMode: "find",
          formatVisible: true,
          versionVisible
        })
    })
  );
}
describe("editor version button", () => {
  it("renders history after replace and before formatting", async () => {
    const html = await render(true);
    const replace = html.indexOf(
      `aria-label="${t("components.editorTextTools.replace")}"`
    );
    const version = html.indexOf(
      `aria-label="${t("components.editorTextTools.versions")}"`
    );
    const format = html.indexOf(
      `aria-label="${t("components.editorTextTools.formatManuscript")}"`
    );
    expect(version).toBeGreaterThan(replace);
    expect(format).toBeGreaterThan(version);
    expect(
      html.slice(
        html.lastIndexOf("<button", version),
        html.indexOf(">", version)
      )
    ).not.toContain("disabled");
  });
  it("omits history when hidden", async () => {
    expect(await render(false)).not.toContain(
      `aria-label="${t("components.editorTextTools.versions")}"`
    );
  });
});
