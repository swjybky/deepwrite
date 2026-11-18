import { describe, expect, it } from "vitest";
import source from "./LibraryGroupDialog.vue?raw";

describe("LibraryGroupDialog free multi-select composition", () => {
  it("supports inline quick-creating a library and adding it to memberIds", () => {
    expect(source).toContain("quickCreateLibrary");
    expect(source).toContain("catalog.createLibrary");
    expect(source).toContain("memberIds");
  });

  it("displays library tag badges and search filtering across domains", () => {
    expect(source).toContain("formatMaterialTagBadge");
    expect(source).toContain("formatSkillTagBadge");
    expect(source).toContain("searchQuery");
  });

  it("allows updating a group's name together with its memberIds", () => {
    expect(source).toContain("title: name");
    expect(source).toContain("editGroup");
    expect(source).toContain('v-model="title"');
  });

  it("groups libraries without separating them by historical writing type or single-slot kind", () => {
    expect(source).not.toContain('library.materialType === "short"');
    expect(source).not.toContain('library.skillType === "short"');
    expect(source).not.toContain("selectedInAnotherRow");
  });
});
