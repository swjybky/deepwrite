import { describe, expect, it } from "vitest";
import {
  BookTemplateDraftSchema,
  CreateBookFromTemplateInputSchema
} from "./book-templates";
import {
  CreateScriptBookInputSchema,
  CreateShortBookInputSchema
} from "./catalog";
const draft = {
  name: "短篇模板",
  workspaceType: "short",
  genre: "其他",
  characterFormat: "list",
  defaultPlotStageIds: ["plot_design"],
  linkedMaterialIdsByKind: {
    character: [],
    gimmick: [],
    plot: [],
    draft: [],
    other: []
  },
  linkedSkillIdsByKind: { general: [], plot: [], style: [], other: [] }
};
describe("book templates contracts", () => {
  it("accepts short, script, and academic configuration but rejects long and unsupported content", () => {
    const parsed = BookTemplateDraftSchema.parse(draft);
    expect(parsed.workspaceType).toBe("short");
    if (parsed.workspaceType !== "academic") {
      expect(parsed.characterFormat).toBe("list");
    }
    expect(
      BookTemplateDraftSchema.safeParse({ ...draft, workspaceType: "script" })
        .success
    ).toBe(true);
    expect(
      BookTemplateDraftSchema.safeParse({
        name: "学术论文模板",
        workspaceType: "academic",
        subtype: "empirical_paper",
        citationStyle: "ieee",
        defaultFrameworkStageIds: ["problem_and_gap", "argument_outline"],
        linkedMaterialIds: ["mat-1"],
        linkedSkillIds: ["skill-1"]
      }).success
    ).toBe(true);
    expect(
      BookTemplateDraftSchema.safeParse({ ...draft, workspaceType: "long" })
        .success
    ).toBe(false);
    expect(
      BookTemplateDraftSchema.safeParse({ ...draft, content: "正文" }).success
    ).toBe(false);
  });
  it("rejects blank names, no stages and duplicate stages", () => {
    for (const patch of [
      { name: " " },
      { defaultPlotStageIds: [] },
      { defaultPlotStageIds: ["plot_design", "plot_design"] }
    ])
      expect(
        BookTemplateDraftSchema.safeParse({ ...draft, ...patch }).success
      ).toBe(false);
  });
  it("accepts only template identity and book title on template creation", () => {
    expect(
      CreateBookFromTemplateInputSchema.safeParse({
        templateId: "template_1",
        title: "作品",
        genre: "其他"
      }).success
    ).toBe(false);
    expect(
      CreateBookFromTemplateInputSchema.safeParse({
        templateId: "template_1",
        title: " "
      }).success
    ).toBe(false);
  });
  it("keeps old creation inputs compatible and permits script stage and character overrides", () => {
    for (const schema of [
      CreateScriptBookInputSchema,
      CreateShortBookInputSchema
    ]) {
      expect(
        schema.parse({ title: "作品", genre: "其他" }).characterFormat
      ).toBeUndefined();
      expect(
        schema.parse({
          title: "作品",
          genre: "其他",
          characterFormat: "list",
          defaultPlotStageIds: ["outline"]
        })
      ).toMatchObject({
        characterFormat: "list",
        defaultPlotStageIds: ["outline"]
      });
    }
  });
});
