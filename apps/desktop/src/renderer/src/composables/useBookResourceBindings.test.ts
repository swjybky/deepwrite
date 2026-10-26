import { effectScope, nextTick, reactive } from "vue";
import { afterEach, describe, expect, it } from "vitest";
import { useBookResourceBindings } from "./useBookResourceBindings";

const scopes: ReturnType<typeof effectScope>[] = [];
afterEach(() => scopes.splice(0).forEach((scope) => scope.stop()));

function harness(workspaceType: "short" | "script" = "short") {
  const props = reactive<Parameters<typeof useBookResourceBindings>[0]>({
    mode: "bind-skill",
    book: {
      id: "book-1",
      label: "绑定测试",
      workspaceType,
      boundMaterialLibraryIdsByKind: {
        character: ["deleted-material"],
        gimmick: [],
        plot: ["material-plot"],
        draft: [],
        other: []
      },
      boundSkillLibraryIdsByKind: {
        general: ["deleted-skill"],
        plot: [],
        style: ["skill-style"],
        other: []
      }
    },
    materialLibraries: [
      { id: "material-plot", label: "剧情素材", materialKind: "plot" },
      { id: "material-mixed", label: "综合素材", materialKind: "mixed" }
    ],
    skillLibraries: [
      { id: "skill-style", label: "文风技能", skillKind: "style" },
      { id: "skill-other", label: "其他技能", skillKind: "other" }
    ],
    materialGroups: [],
    skillGroups: []
  });
  const scope = effectScope();
  scopes.push(scope);
  const bindings = scope.run(() => useBookResourceBindings(props))!;
  bindings.resetBindingDraft();
  return { props, bindings };
}

describe("book resource bindings after library deletion", () => {
  it.each(["short", "script"] as const)(
    "clears unavailable selections while preserving valid %s book bindings",
    (workspaceType) => {
      const { props, bindings } = harness(workspaceType);
      expect(bindings.selectedMaterialIds.character).toBe("");
      expect(bindings.selectedSkillIds.general).toBe("");
      expect(bindings.selectedMaterialIds.plot).toBe("material-plot");
      expect(bindings.selectedSkillIds.style).toBe("skill-style");
      // Opening the editor must not mutate the persisted book snapshot.
      expect(props.book?.boundMaterialLibraryIdsByKind?.character).toEqual([
        "deleted-material"
      ]);
      expect(props.book?.boundSkillLibraryIdsByKind?.general).toEqual([
        "deleted-skill"
      ]);
    }
  );

  it("drops deleted selections while the dialog is open and keeps other edits", async () => {
    const { props, bindings } = harness();
    bindings.selectedSkillIds.other = "skill-other";
    bindings.selectedMaterialIds.character = "material-mixed";
    props.skillLibraries = props.skillLibraries.filter(
      ({ id }) => id !== "skill-style"
    );
    props.materialLibraries.splice(0, 1);
    await nextTick();
    expect(bindings.selectedSkillIds.style).toBe("");
    expect(bindings.selectedMaterialIds.plot).toBe("");
    expect(bindings.selectedSkillIds.other).toBe("skill-other");
    expect(bindings.selectedMaterialIds.character).toBe("material-mixed");
  });

  it("filters invalid categories at submission even before watchers flush", () => {
    const { props, bindings } = harness();
    bindings.selectedMaterialIds.character = "material-mixed";
    bindings.selectedSkillIds.other = "skill-other";
    props.materialLibraries = [];
    props.skillLibraries = [];
    expect(bindings.selectedMaterialLinks()).toEqual({
      character: [],
      gimmick: [],
      plot: [],
      draft: [],
      other: []
    });
    expect(bindings.selectedSkillLinks()).toEqual({
      general: [],
      plot: [],
      style: [],
      other: []
    });
  });

  it("allows rebinding after clearing deleted references and rejects mismatched kinds", () => {
    const { bindings } = harness();
    bindings.selectedMaterialIds.character = "material-mixed";
    bindings.selectedMaterialIds.other = "material-plot";
    bindings.selectedSkillIds.other = "skill-other";
    bindings.selectedSkillIds.general = "skill-style";
    expect(bindings.selectedMaterialLinks()).toEqual({
      character: ["material-mixed"],
      gimmick: [],
      plot: ["material-plot"],
      draft: [],
      other: []
    });
    expect(bindings.selectedSkillLinks()).toEqual({
      general: [],
      plot: [],
      style: ["skill-style"],
      other: ["skill-other"]
    });
  });

  it("waits for the library catalog to finish loading before pruning bindings", async () => {
    const { props, bindings } = harness();
    const materials = [...props.materialLibraries];
    const skills = [...props.skillLibraries];
    Object.assign(props, {
      loading: true,
      materialLibraries: [],
      skillLibraries: []
    });
    bindings.resetBindingDraft();
    await nextTick();
    expect(bindings.selectedMaterialIds.plot).toBe("material-plot");
    expect(bindings.selectedSkillIds.style).toBe("skill-style");
    Object.assign(props, {
      loading: false,
      materialLibraries: materials,
      skillLibraries: skills
    });
    await nextTick();
    expect(bindings.selectedMaterialIds.character).toBe("");
    expect(bindings.selectedSkillIds.general).toBe("");
    expect(bindings.selectedMaterialIds.plot).toBe("material-plot");
    expect(bindings.selectedSkillIds.style).toBe("skill-style");
  });

  it("clears a selected group when all of its member libraries disappear", async () => {
    const { props, bindings } = harness();
    props.skillGroups = [
      {
        id: "skill-group",
        title: "技能分组",
        projectRevision: 0,
        createdAt: "2026-07-19T01:02:03.000Z",
        updatedAt: "2026-07-19T01:02:03.000Z",
        members: { style: "skill-style" }
      }
    ];
    bindings.bindingMode.value = "group";
    bindings.selectedGroupId.value = "skill-group";
    expect(
      bindings.skillGroupLinks(bindings.selectedSkillGroup.value).style
    ).toEqual(["skill-style"]);
    props.skillLibraries = [];
    await nextTick();
    expect(bindings.selectedGroupId.value).toBe("");
    expect(
      bindings.skillGroupLinks(bindings.selectedSkillGroup.value).style
    ).toEqual([]);
  });
});
