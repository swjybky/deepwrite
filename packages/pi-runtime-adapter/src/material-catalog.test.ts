import { describe, expect, it } from "vitest";
import {
  buildMaterialCatalogPrompt,
  queryAttachedMaterials,
  type AttachedMaterial
} from "./material-catalog";

const original = "# 场景\n\n正文摘录。\n\n只在全文后段出现的关键词。";
const old: AttachedMaterial = {
  id: "material:library:old",
  title: "场景库 · 旧素材",
  kind: "draft",
  source: "attached-material",
  content: original
};
const configured: AttachedMaterial = {
  ...old,
  id: "material:library:new",
  title: "场景库 · 新素材",
  content: "---\nname: 雨夜重逢\ndescription: 适合情感转折\n---\n新素材全文。"
};

describe("material discovery and compatible reads", () => {
  it("announces configured and old entries together without injecting full text", () => {
    const prompt = buildMaterialCatalogPrompt([old, configured]);
    expect(prompt).toContain("正文摘录：正文摘录。");
    expect(prompt).toContain("名称：雨夜重逢");
    expect(prompt).toContain("说明：适合情感转折");
    expect(prompt).not.toContain("只在全文后段出现的关键词");
    expect(prompt).not.toContain("新素材全文");
    expect(prompt.indexOf(old.id)).toBeLessThan(prompt.indexOf(configured.id));
  });

  it.each([old.id, old.title, "旧素材"])(
    "keeps original read identifier %s",
    (entry_name) => {
      expect(
        queryAttachedMaterials([old, configured], { mode: "read", entry_name })
      ).toContain(original);
    }
  );

  it("supports configured names and exact ids, retaining frontmatter on read", () => {
    expect(
      queryAttachedMaterials([old, configured], {
        mode: "read",
        entry_name: "雨夜重逢"
      })
    ).toContain(configured.content);
    expect(
      queryAttachedMaterials([old, configured], {
        mode: "read",
        entry_id: old.id,
        entry_name: "雨夜重逢"
      })
    ).toContain(original);
    expect(
      queryAttachedMaterials([old], { mode: "read", entry_id: configured.id })
    ).not.toContain(original);
  });

  it("keeps ambiguous aliases and titles instead of silently picking one", () => {
    const duplicate = { ...configured, id: "material:library:duplicate" };
    const result = queryAttachedMaterials([configured, duplicate], {
      mode: "read",
      entry_name: "雨夜重逢"
    });
    expect(result).toContain("匹配到多个素材条目");
    expect(result).toContain(configured.id);
    expect(result).toContain(duplicate.id);
    expect(result).not.toContain("新素材全文");
  });

  it("searches configured fields and legacy full text, respecting kind filters", () => {
    expect(
      queryAttachedMaterials([old, configured], {
        mode: "search",
        query: "情感转折"
      })
    ).toContain(configured.id);
    expect(
      queryAttachedMaterials([old, configured], {
        mode: "search",
        query: "后段出现"
      })
    ).toContain(old.id);
    expect(
      queryAttachedMaterials([old, configured], {
        mode: "read",
        entry_id: old.id,
        material_kind: "character"
      })
    ).not.toContain(original);
  });

  it("only clips prompt details, leaving every attachment queryable", () => {
    const many = Array.from({ length: 64 }, (_, index) => ({
      ...old,
      id: `material:library:${index}`,
      title: `库${index} · ${"名".repeat(220)}`,
      content: "文".repeat(1000)
    }));
    const prompt = buildMaterialCatalogPrompt(many);
    expect(prompt).toContain("未展示详情");
    expect(prompt.length).toBeLessThan(13_000);
    expect(queryAttachedMaterials(many, { mode: "list" })).toContain(
      "material:library:63"
    );
    expect(
      queryAttachedMaterials(many, {
        mode: "read",
        entry_id: "material:library:63"
      })
    ).toContain(many[63]!.content);
  });
});
