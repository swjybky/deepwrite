import { describe, expect, it } from "vitest";
import { parseSkillMarkdown } from "@deepwrite/contracts/renderer";
import { ensureSkillFrontmatter } from "./skill-frontmatter";

// Deliberately generic: never use a real library or book name in a fixture.
const NAME = "示例作品 · 文风";
const DESCRIPTION = "提炼可直接交给分节写手执行的行文规则与检查清单。";

describe("skill frontmatter completion", () => {
  it("gives a header-less analysis result a usable skill header", () => {
    // Exactly what a 文风 round produces when the model skips the header: the
    // library editor flags this as "技能格式错误 · 首行缺少 ---".
    const body = "# 一句话核心\n\n冷静克制的叙述腔调。";
    expect(parseSkillMarkdown(body).valid).toBe(false);

    const content = ensureSkillFrontmatter(body, NAME, DESCRIPTION);

    expect(content.startsWith("---\n")).toBe(true);
    expect(content).toContain(`name: ${NAME}`);
    expect(content).toContain(`description: ${DESCRIPTION}`);
    expect(content).toContain(body);

    const parsed = parseSkillMarkdown(content);
    expect(parsed.valid).toBe(true);
    if (parsed.valid) {
      expect(parsed.name).toBe(NAME);
      expect(parsed.description).toBe(DESCRIPTION);
      expect(parsed.body).toContain("冷静克制的叙述腔调。");
    }
  });

  it("keeps the header the model wrote instead of overwriting it", () => {
    const content = [
      "---",
      "name: 模型自己起的名字",
      "description: 模型自己写的说明",
      "---",
      "",
      "# 正文"
    ].join("\n");

    const next = ensureSkillFrontmatter(content, NAME, DESCRIPTION);

    expect(next).toContain("name: 模型自己起的名字");
    expect(next).toContain("description: 模型自己写的说明");
    expect(next).not.toContain(NAME);
  });

  it("completes only the field that is missing", () => {
    const content = ["---", "name: 已有名称", "---", "", "# 正文"].join("\n");

    const next = ensureSkillFrontmatter(content, NAME, DESCRIPTION);

    expect(next).toContain("name: 已有名称");
    expect(next).toContain(`description: ${DESCRIPTION}`);
    expect(parseSkillMarkdown(next).valid).toBe(true);
  });

  it("leaves a header it cannot safely rewrite untouched", () => {
    // Duplicate fields: the editor refuses these, and rewriting by hand would
    // risk destroying content the user wrote deliberately.
    const content = [
      "---",
      "name: 一个名字",
      "name: 另一个名字",
      "description: 说明",
      "---",
      "",
      "# 正文"
    ].join("\n");

    expect(ensureSkillFrontmatter(content, NAME, DESCRIPTION)).toBe(content);
  });

  it("keeps CRLF endings when it inserts the header", () => {
    const content = "# 正文\r\n\r\n规则。";
    const next = ensureSkillFrontmatter(content, NAME, DESCRIPTION);

    expect(next).toContain("---\r\nname:");
    // Every newline it inserted is part of a CRLF pair.
    expect(next.replace(/\r\n/gu, "")).not.toContain("\n");
    expect(next).toContain("# 正文\r\n");
  });
});
