import { describe, expect, it } from "vitest";
import {
  parseMaterialMarkdown,
  resolveMaterialMetadata
} from "./material-markdown";
import { updateMaterialMarkdownMetadata } from "./material-markdown-edit";
import { AttachedMaterialSnapshotSchema } from "./session/runtime";

const old = {
  id: "material:test:one",
  title: "雨夜重逢",
  content: "# 场景\n\n车站相遇，谁都没有提起过去。\n\n完整正文继续。"
};

describe("optional material metadata", () => {
  it("keeps legacy attachments valid and derives a local excerpt without changing content", () => {
    expect(parseMaterialMarkdown(old.content)).toMatchObject({
      state: "legacy",
      body: old.content
    });
    expect(resolveMaterialMetadata(old)).toEqual({
      name: "雨夜重逢",
      nameSource: "title",
      description: "车站相遇，谁都没有提起过去。",
      descriptionSource: "excerpt"
    });
    expect(
      AttachedMaterialSnapshotSchema.parse({
        ...old,
        source: "attached-material",
        kind: "draft"
      }).content
    ).toBe(old.content);
  });

  it.each([
    [
      "name: 别名",
      "别名",
      "车站相遇，谁都没有提起过去。",
      "configured",
      "excerpt"
    ],
    ["description: 适合导语", "雨夜重逢", "适合导语", "title", "configured"],
    [
      'name: ""\ndescription:   ',
      "雨夜重逢",
      "车站相遇，谁都没有提起过去。",
      "title",
      "excerpt"
    ],
    [
      "name: 第一\nname: 第二\ndescription: 适合导语",
      "雨夜重逢",
      "适合导语",
      "title",
      "configured"
    ],
    [
      "name: 名称\ndescription: |\n  不支持多行",
      "名称",
      "车站相遇，谁都没有提起过去。",
      "configured",
      "excerpt"
    ]
  ])(
    "falls back per field for %s",
    (header, name, description, nameSource, descriptionSource) => {
      expect(
        resolveMaterialMetadata({
          ...old,
          content: `---\n${header}\n---\n${old.content}`
        })
      ).toEqual({ name, description, nameSource, descriptionSource });
    }
  );

  it("supports BOM, CRLF and quoted strings while retaining unknown fields", () => {
    const content =
      "\uFEFF---\r\nname: \"名称: 引号\"\r\ndescription: 'writer''s sample'\r\ntags: [a, b]\r\n---\r\n正文\r\n";
    expect(parseMaterialMarkdown(content)).toMatchObject({
      state: "configured",
      name: "名称: 引号",
      description: "writer's sample",
      body: "正文\r\n"
    });
    const updated = updateMaterialMarkdownMetadata(content, {
      name: "新名称",
      description: ""
    });
    expect(updated).toEqual({
      updated: true,
      content:
        '\uFEFF---\r\nname: "新名称"\r\ndescription: ""\r\ntags: [a, b]\r\n---\r\n正文\r\n'
    });
  });

  it.each([
    "---\n原有正文\n---\n段落",
    "---\n原有正文",
    "---\nname: 未闭合\n正文"
  ])("never strips an ambiguous header: %s", (content) => {
    expect(parseMaterialMarkdown(content).body).toBe(content);
    expect(resolveMaterialMetadata({ ...old, content }).name).toBe(old.title);
  });

  it("will not rewrite malformed metadata", () => {
    const result = updateMaterialMarkdownMetadata(
      "---\nname: a\nname: b\n---\n正文",
      { name: "新名称", description: "说明" }
    );
    expect(result.updated).toBe(false);
  });

  it("adds or removes optional values without modifying the original body", () => {
    const result = updateMaterialMarkdownMetadata(old.content, {
      name: "",
      description: ""
    });
    expect(result).toEqual({
      updated: true,
      content: `---\nname: ""\ndescription: ""\n---\n\n${old.content}`
    });
    if (!result.updated) throw new Error("Expected draft update");
    expect(
      resolveMaterialMetadata({ ...old, content: result.content })
    ).toEqual(resolveMaterialMetadata(old));
  });

  it("preserves unknown-only headers and does not require a material body", () => {
    expect(
      updateMaterialMarkdownMetadata("---\ntags: [a]\n---", {
        name: "新名",
        description: ""
      })
    ).toEqual({
      updated: true,
      content: '---\ntags: [a]\nname: "新名"\ndescription: ""\n---'
    });
    expect(
      resolveMaterialMetadata({ ...old, title: "", content: "" })
    ).toMatchObject({
      name: old.id,
      nameSource: "id",
      descriptionSource: "fallback"
    });
  });

  it("bounds derived metadata without rejecting or truncating the original", () => {
    const content = `---\nname: ${"名".repeat(500)}\ndescription: ${"述".repeat(500)}\n---\n正文`;
    const metadata = resolveMaterialMetadata({ ...old, content });
    expect(metadata.name).toHaveLength(80);
    expect(metadata.description).toHaveLength(160);
    expect(
      AttachedMaterialSnapshotSchema.parse({
        ...old,
        content,
        metadata,
        source: "attached-material"
      }).content
    ).toBe(content);
  });
});
