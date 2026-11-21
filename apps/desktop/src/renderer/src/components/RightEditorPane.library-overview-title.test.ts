import { createPinia } from "pinia";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it } from "vitest";
import type { WorkspaceDocument } from "../types/workspace";
import RightEditorPane from "./RightEditorPane.vue";

async function renderTitleInput(document: WorkspaceDocument) {
  const app = createSSRApp(RightEditorPane, {
    document,
    resourceId: document.id,
    locked: false,
    defaultViewMode: "edit",
    entrySearchItems: []
  });
  app.use(createPinia());
  const html = await renderToString(app);
  return html.match(/<input[^>]*class="document-title-input"[^>]*>/)?.[0];
}

describe("RightEditorPane library overview title", () => {
  it.each([
    ["skill", "库说明"],
    ["material", "库介绍"]
  ] as const)(
    "shows only the fixed %s overview label",
    async (domain, label) => {
      const input = await renderTitleInput({
        id: `${domain}-overview`,
        domain,
        title: `长篇全流程创作团队配套技能组 · ${label}`,
        eyebrow: "技能",
        path: ["长篇全流程创作团队配套技能组", label],
        content: "",
        catalogLibraryField: "overview",
        libraryId: "library-1"
      });
      expect(input).toContain(`value="${label}"`);
      expect(input).toContain("readonly");
    }
  );

  it("keeps entry titles editable", async () => {
    const input = await renderTitleInput({
      id: "skill-entry",
      domain: "skill",
      title: "追妻文极致操作技能",
      eyebrow: "技能",
      path: ["技能库", "追妻文极致操作技能"],
      content: "",
      libraryId: "library-1",
      catalogEntryId: "entry-1"
    });
    expect(input).toContain('value="追妻文极致操作技能"');
    expect(input).not.toContain("readonly");
  });
});
