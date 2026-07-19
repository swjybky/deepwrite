import { describe, expect, it } from "vitest";
import {
  ExpertDraftSchema,
  appendExpertDraftSection,
  createDefaultExpertDraft,
  findExpertDraftSection,
  parseExpertDraftMarkdown,
  removeExpertDraftSection,
  renderExpertDraftManuscript,
  renderExpertDraftReview,
  serializeExpertDraftMarkdown,
  updateExpertDraftSection,
  updateExpertDraftSectionBody,
  updateExpertDraftSectionCharacterState,
  type ExpertDraft,
  type ExpertDraftSectionPatch
} from "./index";

describe("expert draft Markdown contracts", () => {
  it("creates the short-story defaults for empty Markdown", () => {
    expect(parseExpertDraftMarkdown(" \r\n\t")).toEqual({
      sections: [
        {
          id: "intro",
          title: "导语",
          wordCountRequirement: "",
          body: "",
          characterState: ""
        },
        {
          id: "section-1",
          title: "第一节",
          wordCountRequirement: "",
          body: "",
          characterState: ""
        }
      ]
    });
  });

  it("appends manually created sections after the highest numbered section", () => {
    const draft = createDefaultExpertDraft();
    const withSecondSection = appendExpertDraftSection(draft);
    const withFourthSection = appendExpertDraftSection({
      sections: [
        ...withSecondSection.sections,
        {
          id: "section-3",
          title: "自定义第三节",
          wordCountRequirement: "",
          body: "",
          characterState: ""
        }
      ]
    });

    expect(withSecondSection.sections.at(-1)).toMatchObject({
      id: "section-2",
      title: "第二节"
    });
    expect(withFourthSection.sections.at(-1)).toMatchObject({
      id: "section-4",
      title: "第四节"
    });
    expect(draft.sections).toHaveLength(2);
  });

  it("removes a section without allowing the final section to be deleted", () => {
    const draft = createDefaultExpertDraft();
    const withoutIntro = removeExpertDraftSection(draft, "intro");

    expect(withoutIntro.sections.map((section) => section.id)).toEqual(["section-1"]);
    expect(removeExpertDraftSection(withoutIntro, "section-1")).toBe(withoutIntro);
    expect(removeExpertDraftSection(draft, "missing")).toBe(draft);
  });

  it("maps an untitled legacy manuscript safely to section-1", () => {
    const parsed = parseExpertDraftMarkdown("雨落下来。\r\n\r\n门外没有人。");

    expect(parsed.sections).toHaveLength(2);
    expect(findExpertDraftSection(parsed, "intro")?.body).toBe("");
    expect(findExpertDraftSection(parsed, "section-1")?.body).toBe(
      "雨落下来。\n\n门外没有人。"
    );
  });

  it("parses explicit level-two headings without injecting an intro", () => {
    const parsed = parseExpertDraftMarkdown(
      [
        "## 雨夜",
        "",
        "> 字数要求：800—1000 字",
        "",
        "她在门外找到钥匙。",
        "",
        "## 清晨",
        "",
        "真相终于出现。"
      ].join("\n")
    );

    expect(parsed).toEqual({
      sections: [
        {
          id: "section-1",
          title: "雨夜",
          wordCountRequirement: "800—1000 字",
          body: "她在门外找到钥匙。",
          characterState: ""
        },
        {
          id: "section-2",
          title: "清晨",
          wordCountRequirement: "",
          body: "真相终于出现。",
          characterState: ""
        }
      ]
    });
  });

  it("recognizes an explicit intro and ignores headings inside fenced code", () => {
    const parsed = parseExpertDraftMarkdown(
      [
        "## 导语",
        "钩子。",
        "",
        "## 第一节",
        "```md",
        "## 这不是新小节",
        "```"
      ].join("\n")
    );

    expect(parsed.sections.map(({ id, title }) => ({ id, title }))).toEqual([
      { id: "intro", title: "导语" },
      { id: "section-1", title: "第一节" }
    ]);
    expect(parsed.sections[1]?.body).toBe("```md\n## 这不是新小节\n```");
  });

  it("round-trips stable ids, word requirements, bodies, and character states", () => {
    const draft: ExpertDraft = {
      sections: [
        {
          id: "intro",
          title: "导语",
          wordCountRequirement: "100 字",
          body: "他只说了一句话。",
          characterState: "读者尚不知道真相。"
        },
        {
          id: "scene/雨夜",
          title: "雨夜",
          wordCountRequirement: "1200 字",
          body: "> 字数要求：这是正文，不是元数据\n\n## 正文中的二级标题",
          characterState: "林岚持有钥匙。\n注释样文本：-->"
        }
      ]
    };

    const serialized = serializeExpertDraftMarkdown(draft);

    expect(serialized).toContain("id=intro");
    expect(serialized).toContain("id=scene%2F%E9%9B%A8%E5%A4%9C");
    expect(parseExpertDraftMarkdown(serialized)).toEqual(draft);
    expect(serializeExpertDraftMarkdown(parseExpertDraftMarkdown(serialized))).toBe(
      serialized
    );
  });

  it("renders a manuscript without persistence metadata or character state", () => {
    const draft = updateExpertDraftSection(
      updateExpertDraftSectionBody(createDefaultExpertDraft(), "section-1", "正文。"),
      "section-1",
      {
        wordCountRequirement: "1000 字",
        characterState: "她已经受伤。"
      }
    );
    const manuscript = renderExpertDraftManuscript(draft);

    expect(manuscript).toBe("## 导语\n\n## 第一节\n\n正文。");
    expect(manuscript).not.toContain("1000 字");
    expect(manuscript).not.toContain("她已经受伤");
    expect(manuscript).not.toContain("deepwrite:");
  });

  it("renders readable review metadata instead of encoded persistence markers", () => {
    const draft = updateExpertDraftSection(
      createDefaultExpertDraft(),
      "section-1",
      {
        body: "正文。",
        wordCountRequirement: "1000 字",
        characterState: "她已经受伤。"
      }
    );
    const review = renderExpertDraftReview(draft);

    expect(review).toContain("正文。");
    expect(review).toContain("字数要求：1000 字");
    expect(review).toContain("人物状态：\n她已经受伤。");
    expect(review).not.toContain("deepwrite:");
    expect(review).not.toContain("%E5");
  });

  it("updates section fields immutably and rejects duplicate ids", () => {
    const draft = createDefaultExpertDraft();
    const patch: ExpertDraftSectionPatch = { title: "新的第一节" };
    const renamed = updateExpertDraftSection(draft, "section-1", patch);
    const withState = updateExpertDraftSectionCharacterState(
      renamed,
      "section-1",
      "人物状态"
    );

    expect(renamed).not.toBe(draft);
    expect(findExpertDraftSection(draft, "section-1")?.title).toBe("第一节");
    expect(findExpertDraftSection(withState, "section-1")).toMatchObject({
      title: "新的第一节",
      characterState: "人物状态"
    });
    expect(updateExpertDraftSection(draft, "missing", { body: "不会写入" })).toBe(
      draft
    );
    expect(() =>
      ExpertDraftSchema.parse({
        sections: [draft.sections[0], { ...draft.sections[1], id: "intro" }]
      })
    ).toThrow();
  });
});
