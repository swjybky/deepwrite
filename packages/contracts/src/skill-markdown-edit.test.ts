import { describe, expect, it } from "vitest";
import { parseSkillMarkdown } from "./skill-markdown";
import {
  readSkillMarkdownMetadata,
  updateSkillMarkdownMetadata
} from "./skill-markdown-edit";

const fields = {
  name: "人物动机检查",
  description: "在设计人物关系时检查动机与冲突。"
};

describe("skill metadata draft editing", () => {
  it("adds a header to a plain skill without changing its body or title", () => {
    const body = "# 人物设计方法\n\n先检查人物动机，再检查冲突。\n";
    const result = updateSkillMarkdownMetadata(body, fields);
    expect(result).toEqual({
      updated: true,
      content: `---\nname: ${fields.name}\ndescription: ${fields.description}\n---\n\n${body}`
    });
    if (!result.updated) throw new Error("Expected draft update");
    expect(parseSkillMarkdown(result.content)).toMatchObject({
      valid: true,
      ...fields
    });
  });

  it("prefills partial headers and preserves CRLF, unknown fields and the exact body", () => {
    const body = "\r\n# 技能正文\r\n\r\n  原有缩进与尾随空格  \r\n";
    const content = `---\r\ncategory: character\r\ndescription: 旧说明\r\nextra:\r\n  value: 保留\r\n---\r\n${body}`;
    expect(readSkillMarkdownMetadata(content)).toEqual({
      description: "旧说明"
    });
    expect(updateSkillMarkdownMetadata(content, fields)).toEqual({
      updated: true,
      content: `---\r\ncategory: character\r\ndescription: ${fields.description}\r\nextra:\r\n  value: 保留\r\nname: ${fields.name}\r\n---\r\n${body}`
    });
  });

  it("keeps the existing literal skill field syntax when applying special characters", () => {
    const values = {
      name: '检查: "人物" #关系',
      description: "提问：为什么？\n然后检查。"
    };
    const result = updateSkillMarkdownMetadata(
      "---\nname: 旧名\ndescription: 旧说明\n---\n正文",
      values
    );
    if (!result.updated) throw new Error("Expected draft update");
    expect(parseSkillMarkdown(result.content)).toEqual({
      valid: true,
      name: values.name,
      description: "提问：为什么？ 然后检查。",
      body: "正文"
    });
    expect(readSkillMarkdownMetadata(result.content)).toEqual({
      name: values.name,
      description: "提问：为什么？ 然后检查。"
    });
  });

  it.each([
    { name: "  ", description: fields.description },
    { name: fields.name, description: "\n\t" }
  ])(
    "requires both skill fields without returning a modified draft: %o",
    (values) => {
      expect(updateSkillMarkdownMetadata("原文", values)).toEqual({
        updated: false,
        message: "请填写技能名称和使用说明。"
      });
      expect(parseSkillMarkdown("原文").valid).toBe(false);
    }
  );

  it.each([
    "---\nname: 旧名\n未闭合原文",
    "---\nname: 旧名\nname: 重复名称\n---\n原文",
    "---\nname: 旧名\ndescription: |\n  多行说明\n---\n原文",
    "\uFEFF---\nname: 旧名\ndescription: 说明\n---\n原文"
  ])("leaves unsafe headers untouched: %s", (content) => {
    expect(updateSkillMarkdownMetadata(content, fields)).toMatchObject({
      updated: false
    });
  });

  it("retains leading Markdown separators as part of the skill body", () => {
    const content = "---\n原本的段落\n---\n后续正文";
    const result = updateSkillMarkdownMetadata(content, fields);
    if (!result.updated) throw new Error("Expected draft update");
    expect(parseSkillMarkdown(result.content)).toMatchObject({
      valid: true,
      body: content
    });
  });

  it("can prepare metadata before writing a body without making an empty skill valid", () => {
    const result = updateSkillMarkdownMetadata("", fields);
    if (!result.updated) throw new Error("Expected draft update");
    expect(readSkillMarkdownMetadata(result.content)).toEqual(fields);
    expect(parseSkillMarkdown(result.content)).toMatchObject({
      valid: false,
      code: "empty-body"
    });
  });
});
