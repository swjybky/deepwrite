import { createPinia } from "pinia";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it } from "vitest";
import LibraryProjectDialog from "./LibraryProjectDialog.vue";

describe("LibraryProjectDialog", () => {
  it.each(["material", "skill"] as const)(
    "creates %s entries without asking for a writing type",
    async (domain) => {
      const context: { teleports?: Record<string, string> } = {};
      const app = createSSRApp(LibraryProjectDialog, {
        open: true,
        operation: "create-entry",
        domain
      });
      app.use(createPinia());
      await renderToString(app, context);
      const html = context.teleports?.body ?? "";
      expect(html).toContain("新建条目");
      expect(html).toContain("条目名称");
      expect(html).toContain("所属库");
      expect(html).toContain("暂不放入库");
      expect(html).not.toMatch(/创作类型|短篇|剧本|长篇/);
      expect(html).toContain(domain === "material" ? "内容阶段" : "技能库分类");
      expect(html.match(/role="combobox"/g)).toHaveLength(2);
    }
  );

  it.each(["material", "skill"] as const)(
    "creates a shared %s library with its content category",
    async (domain) => {
      const context: { teleports?: Record<string, string> } = {};
      const app = createSSRApp(LibraryProjectDialog, {
        open: true,
        operation: "create-library",
        domain
      });
      app.use(createPinia());
      await renderToString(app, context);
      const html = context.teleports?.body ?? "";
      expect(html).toContain("无需再次选择目录");
      expect(html).toContain("可在任意作品中绑定");
      expect(html).toContain(
        domain === "material" ? "素材库分类" : "技能库分类"
      );
      expect(html).not.toContain("适用创作类型");
      expect(html.match(/role="combobox"/g)).toHaveLength(1);
    }
  );
});
