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
      { id: "material-mixed", label: "综合素材", materialKind: "mixed" },
      {
        id: "material-lit",
        label: "文献库",
        materialKind: "other",
        customTag: "文献"
      }
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

describe("book resource bindings after library deletion and free sharing", () => {
  it.each(["short", "script"] as const)(
    "clears unavailable selections while preserving valid %s book bindings",
    (workspaceType) => {
      const { props, bindings } = harness(workspaceType);
      expect(bindings.selectedMaterialLibraryIds.value).toEqual([
        "material-plot"
      ]);
      expect(bindings.selectedSkillLibraryIds.value).toEqual(["skill-style"]);
      expect(props.book?.boundMaterialLibraryIdsByKind?.character).toEqual([
        "deleted-material"
      ]);
      expect(props.book?.boundSkillLibraryIdsByKind?.general).toEqual([
        "deleted-skill"
      ]);
    }
  );

  it("drops deleted selections while the dialog is open and keeps other multi-selections", async () => {
    const { props, bindings } = harness();
    bindings.selectedSkillLibraryIds.value = ["skill-style", "skill-other"];
    bindings.selectedMaterialLibraryIds.value = [
      "material-plot",
      "material-mixed",
      "material-lit"
    ];
    props.skillLibraries = props.skillLibraries.filter(
      ({ id }) => id !== "skill-style"
    );
    props.materialLibraries.splice(0, 1);
    await nextTick();
    expect(bindings.selectedSkillLibraryIds.value).toEqual(["skill-other"]);
    expect(bindings.selectedMaterialLibraryIds.value).toEqual([
      "material-mixed",
      "material-lit"
    ]);
  });

  it("filters deleted libraries at submission even before watchers flush", () => {
    const { props, bindings } = harness();
    bindings.selectedMaterialLibraryIds.value = ["material-mixed"];
    bindings.selectedSkillLibraryIds.value = ["skill-other"];
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

  it("supports multi-selecting multiple libraries of the same or custom tags", () => {
    const { bindings } = harness();
    bindings.selectedMaterialLibraryIds.value = [
      "material-mixed",
      "material-plot",
      "material-lit"
    ];
    bindings.selectedSkillLibraryIds.value = ["skill-style", "skill-other"];
    expect(bindings.selectedMaterialLinks()).toEqual({
      character: [],
      gimmick: [],
      plot: ["material-plot"],
      draft: [],
      other: ["material-mixed", "material-lit"]
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
    expect(bindings.selectedMaterialLibraryIds.value).toEqual([
      "deleted-material",
      "material-plot"
    ]);
    expect(bindings.selectedSkillLibraryIds.value).toEqual([
      "deleted-skill",
      "skill-style"
    ]);
    Object.assign(props, {
      loading: false,
      materialLibraries: materials,
      skillLibraries: skills
    });
    await nextTick();
    expect(bindings.selectedMaterialLibraryIds.value).toEqual([
      "material-plot"
    ]);
    expect(bindings.selectedSkillLibraryIds.value).toEqual(["skill-style"]);
  });

  it("toggles groups on and off and hides groups whose member libraries disappear", async () => {
    const { props, bindings } = harness();
    props.skillGroups = [
      {
        id: "skill-group",
        title: "技能分组",
        projectRevision: 0,
        createdAt: "2026-07-19T01:02:03.000Z",
        updatedAt: "2026-07-19T01:02:03.000Z",
        memberIds: ["skill-style", "skill-other"]
      }
    ];
    bindings.selectedSkillLibraryIds.value = [];
    bindings.toggleGroup("skill-group");
    expect(bindings.selectedSkillLinks()).toEqual({
      general: [],
      plot: [],
      style: ["skill-style"],
      other: ["skill-other"]
    });
    props.skillLibraries = [];
    await nextTick();
    expect(bindings.availableGroups.value).toEqual([]);
  });
});
