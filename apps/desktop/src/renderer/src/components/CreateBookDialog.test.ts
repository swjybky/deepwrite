import { describe, expect, it } from "vitest";
import selectionSource from "../composables/useBookLibrarySelection.ts?raw";
import dialogSource from "./CreateBookDialog.vue?raw";
const source = selectionSource + dialogSource;

describe("CreateBookDialog shared libraries", () => {
  it("offers one material and skill pool to short, script, and long books", () => {
    expect(source).toContain(
      "props.materials.filter((library) => !library.isUnbound)"
    );
    expect(source).toContain(
      "props.skills.filter((library) => !library.isUnbound)"
    );
    expect(source).not.toContain(
      "material.materialType === workspaceType.value"
    );
    expect(source).not.toContain("skill.skillType === workspaceType.value");
    expect(source).toContain("linkedMaterialIdsByKind");
    expect(source).toContain("linkedSkillIdsByKind");
  });
});
