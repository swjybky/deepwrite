import { effectScope, reactive } from "vue";
import { describe, expect, it } from "vitest";
import type { MaterialLibrary, SkillLibrary } from "@deepwrite/contracts";
import {
  useBookLibrarySelection,
  type BookLibrarySelectionProps
} from "./useBookLibrarySelection";
import { bookTemplateReferenceError } from "../utils/bookTemplateReferences";
import {
  loadBookTemplateDraftSchema,
  createDefaultCreativePlotStages
} from "@deepwrite/contracts";

function properties(): BookLibrarySelectionProps {
  return {
    workspaceType: "short",
    materials: [
      {
        id: "material_1",
        title: "人物素材",
        materialKind: "character",
        materialType: "script",
        parentGenre: "",
        subGenre: "",
        entries: []
      } as unknown as MaterialLibrary,
      {
        id: "material_lit",
        title: "AI 论文文献",
        materialKind: "other",
        customTag: "文献",
        materialType: "long",
        parentGenre: "",
        subGenre: "",
        entries: []
      } as unknown as MaterialLibrary
    ],
    skills: [
      {
        id: "skill_1",
        title: "文风技能",
        skillKind: "style",
        skillType: "long",
        entries: []
      } as unknown as SkillLibrary,
      {
        id: "skill_arg",
        title: "论证规范",
        skillKind: "other",
        customTag: "论证",
        skillType: "long",
        entries: []
      } as unknown as SkillLibrary
    ],
    materialGroups: [
      {
        id: "material_group",
        title: "素材分组",
        memberIds: ["material_1", "material_lit"],
        createdAt: "2026-07-19T00:00:00.000Z",
        updatedAt: "2026-07-19T00:00:00.000Z"
      }
    ],
    skillGroups: [
      {
        id: "skill_group",
        title: "技能分组",
        memberIds: ["skill_1", "skill_arg"],
        createdAt: "2026-07-19T00:00:00.000Z",
        updatedAt: "2026-07-19T00:00:00.000Z"
      }
    ]
  };
}

describe("shared book library selection", () => {
  it("toggles groups into independent multi-select ID snapshots and allows individual adjustments", () => {
    const scope = effectScope();
    const props = reactive(properties());
    try {
      const selection = scope.run(() => useBookLibrarySelection(props))!;
      selection.toggleMaterialGroup("material_group");
      selection.toggleSkillGroup("skill_group");
      const materials = selection.selectedMaterialLinks();
      const skills = selection.selectedSkillLinks();
      expect(materials.character).toEqual(["material_1"]);
      expect(materials.other).toEqual(["material_lit"]);
      expect(skills.style).toEqual(["skill_1"]);
      expect(skills.other).toEqual(["skill_arg"]);

      props.materialGroups[0]!.memberIds = [];
      props.skillGroups[0]!.memberIds = [];
      expect(selection.selectedMaterialLinks()).toEqual(materials);
      expect(selection.selectedSkillLinks()).toEqual(skills);

      selection.toggleMaterialLibrary("material_1");
      expect(selection.selectedMaterialLinks().character).toEqual([]);
      expect(selection.selectedMaterialLinks().other).toEqual(["material_lit"]);
    } finally {
      scope.stop();
    }
  });

  it("filters by custom/preset tag and search query across workspace types", () => {
    const scope = effectScope();
    const props = reactive(properties());
    try {
      const selection = scope.run(() => useBookLibrarySelection(props))!;
      selection.materialTagFilter.value = "文献";
      expect(selection.filteredMaterialItems.value.map((i) => i.id)).toEqual([
        "material_lit"
      ]);
      selection.materialTagFilter.value = "";
      selection.materialSearchQuery.value = "人物";
      expect(selection.filteredMaterialItems.value.map((i) => i.id)).toEqual([
        "material_1"
      ]);
    } finally {
      scope.stop();
    }
  });

  it("retains missing template references so validation blocks creation instead of dropping bindings", async () => {
    const scope = effectScope();
    const configuration = (await loadBookTemplateDraftSchema()).parse({
      workspaceType: "short",
      name: "模板",
      genre: "其他",
      characterFormat: "text",
      defaultPlotStageIds: ["plot_design"],
      linkedMaterialIdsByKind: {
        character: ["deleted_material"],
        gimmick: [],
        plot: [],
        draft: [],
        other: []
      },
      linkedSkillIdsByKind: { general: [], plot: [], style: [], other: [] }
    });
    if (configuration.workspaceType === "academic") {
      throw new Error("Expected short template draft");
    }
    const props = reactive({
      ...properties(),
      preserveMissing: true,
      initialMaterials: configuration.linkedMaterialIdsByKind
    });
    try {
      const selection = scope.run(() => useBookLibrarySelection(props))!;
      expect(selection.selectedMaterialLinks().character).toEqual([
        "deleted_material"
      ]);
      expect(selection.missingMaterialIds.value).toEqual(["deleted_material"]);
      expect(
        bookTemplateReferenceError(configuration, {
          ...props,
          creativePlotStages: createDefaultCreativePlotStages()
        })
      ).toContain("素材库已失效");
      selection.toggleMaterialLibrary("deleted_material");
      selection.toggleMaterialLibrary("material_lit");
      expect(
        bookTemplateReferenceError(
          {
            ...configuration,
            linkedMaterialIdsByKind: selection.selectedMaterialLinks()
          },
          { ...props, creativePlotStages: createDefaultCreativePlotStages() }
        )
      ).toBeNull();
    } finally {
      scope.stop();
    }
  });
});
