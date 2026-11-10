import { createScopedTranslator } from "../i18n";
import { computed, reactive, ref, toRef, watch } from "vue";
import type {
  MaterialKind,
  SkillKind,
  MaterialLibrary,
  SkillLibrary,
  MaterialLibraryGroup,
  SkillLibraryGroup,
  LinkedMaterialIdsByKind,
  LinkedSkillIdsByKind
} from "@deepwrite/contracts";
import { MATERIAL_KINDS, SKILL_KINDS } from "./bookLibraryKinds";

const t = createScopedTranslator("workspace.bookLibrarySelection");
export interface BookLibrarySelectionProps {
  materials: readonly MaterialLibrary[];
  skills: readonly SkillLibrary[];
  materialGroups: readonly MaterialLibraryGroup[];
  skillGroups: readonly SkillLibraryGroup[];
  workspaceType: "short" | "script" | "long";
  initialMaterials?: LinkedMaterialIdsByKind | undefined;
  initialSkills?: LinkedSkillIdsByKind | undefined;
  preserveMissing?: boolean;
}
export function useBookLibrarySelection(props: BookLibrarySelectionProps) {
  const workspaceType = toRef(props, "workspaceType");
  const materialBindingMode = ref<"single" | "group">("single");
  const skillBindingMode = ref<"single" | "group">("single");
  const selectedMaterialGroupId = ref("");
  const selectedSkillGroupId = ref("");
  const selectedMaterialIds = reactive<Record<MaterialKind, string>>({
    character: "",
    gimmick: "",
    plot: "",
    draft: "",
    other: ""
  });
  const selectedSkillIds = reactive<Record<SkillKind, string>>({
    general: "",
    plot: "",
    style: "",
    other: ""
  });
  // Library type is retained in persisted manifests for backwards compatibility,
  // but short stories, scripts, and long-form books all bind from one shared pool.
  const workspaceMaterials = computed(() =>
    props.materials.filter((library) => !library.isUnbound)
  );
  const workspaceSkills = computed(() =>
    props.skills.filter((library) => !library.isUnbound)
  );
  const materialById = computed(
    () =>
      new Map(
        workspaceMaterials.value.map(
          (material) => [material.id, material] as const
        )
      )
  );
  const skillById = computed(
    () =>
      new Map(workspaceSkills.value.map((skill) => [skill.id, skill] as const))
  );

  function materialCandidates(kind: MaterialKind): MaterialLibrary[] {
    return workspaceMaterials.value.filter(
      (material) =>
        material.materialKind === kind || material.materialKind === "mixed"
    );
  }

  function skillCandidates(kind: SkillKind): SkillLibrary[] {
    return workspaceSkills.value.filter((skill) => skill.skillKind === kind);
  }

  function materialKindDescription(
    kind: (typeof MATERIAL_KINDS)[number]
  ): string {
    if (workspaceType.value === "long") {
      if (kind.id === "plot") return t("longFormPlotAndStructureReferences");
      if (kind.id === "other") return t("customNovelMaterials");
    }
    return workspaceType.value === "script" && kind.id === "plot"
      ? t("plotDesignAndRefinement")
      : kind.description;
  }

  function skillKindDescription(kind: (typeof SKILL_KINDS)[number]): string {
    if (workspaceType.value === "long") {
      if (kind.id === "general") return t("availableAcrossMultipleNovelStages");
      if (kind.id === "style") return t("chapterAndSectionWritingMethods");
    }
    return workspaceType.value === "script" && kind.id === "style"
      ? t("manuscriptAndEpisodeWritingMethods")
      : kind.description;
  }

  function emptyMaterialLinks(): Record<MaterialKind, string[]> {
    return {
      character: [],
      gimmick: [],
      plot: [],
      draft: [],
      other: []
    };
  }

  function emptySkillLinks(): Record<SkillKind, string[]> {
    return {
      general: [],
      plot: [],
      style: [],
      other: []
    };
  }

  function materialGroupLinks(
    group: MaterialLibraryGroup | undefined
  ): Record<MaterialKind, string[]> {
    const links = emptyMaterialLinks();
    if (!group) return links;
    for (const { id: kind } of MATERIAL_KINDS) {
      const libraryId = group.members[kind];
      const library = libraryId ? materialById.value.get(libraryId) : undefined;
      if (
        library &&
        (library.materialKind === kind || library.materialKind === "mixed")
      ) {
        links[kind] = [library.id];
      }
    }
    return links;
  }

  function skillGroupLinks(
    group: SkillLibraryGroup | undefined
  ): Record<SkillKind, string[]> {
    const links = emptySkillLinks();
    if (!group) return links;
    for (const { id: kind } of SKILL_KINDS) {
      const libraryId = group.members[kind];
      const library = libraryId ? skillById.value.get(libraryId) : undefined;
      if (library?.skillKind === kind) {
        links[kind] = [library.id];
      }
    }
    return links;
  }

  const availableMaterialGroups = computed(() =>
    props.materialGroups.filter((group) =>
      MATERIAL_KINDS.some(({ id }) => materialGroupLinks(group)[id].length > 0)
    )
  );
  const availableSkillGroups = computed(() =>
    props.skillGroups.filter((group) =>
      SKILL_KINDS.some(({ id }) => skillGroupLinks(group)[id].length > 0)
    )
  );
  const selectedMaterialGroup = computed(() =>
    availableMaterialGroups.value.find(
      (group) => group.id === selectedMaterialGroupId.value
    )
  );
  const selectedSkillGroup = computed(() =>
    availableSkillGroups.value.find(
      (group) => group.id === selectedSkillGroupId.value
    )
  );

  function materialLibraryLabel(library: MaterialLibrary): string {
    const genreLabel = [library.parentGenre, library.subGenre]
      .map((value) => value.trim())
      .filter(Boolean)
      .join(" / ");
    return genreLabel ? `${library.title} · ${genreLabel}` : library.title;
  }

  function skillLibraryLabel(library: SkillLibrary): string {
    return library.isBuiltin
      ? t("official", { title: library.title })
      : library.title;
  }

  function materialSelectOptions(
    kind: MaterialKind
  ): Array<{ value: string; label: string }> {
    return [
      { value: "", label: t("noAssociation") },
      ...(props.preserveMissing &&
      selectedMaterialIds[kind] &&
      !materialCandidates(kind).some(
        (item) => item.id === selectedMaterialIds[kind]
      )
        ? [
            {
              value: selectedMaterialIds[kind],
              label: t("materialLibraryUnavailableSelectAgain")
            }
          ]
        : []),
      ...materialCandidates(kind).map((library) => ({
        value: library.id,
        label: materialLibraryLabel(library)
      }))
    ];
  }

  function skillSelectOptions(
    kind: SkillKind
  ): Array<{ value: string; label: string }> {
    return [
      { value: "", label: t("notLinked") },
      ...(props.preserveMissing &&
      selectedSkillIds[kind] &&
      !skillCandidates(kind).some((item) => item.id === selectedSkillIds[kind])
        ? [
            {
              value: selectedSkillIds[kind],
              label: t("skillLibraryUnavailableSelectAgain")
            }
          ]
        : []),
      ...skillCandidates(kind).map((library) => ({
        value: library.id,
        label: skillLibraryLabel(library)
      }))
    ];
  }

  const materialGroupOptions = computed(() => [
    { value: "", label: t("noAssociation") },
    ...availableMaterialGroups.value.map((group) => ({
      value: group.id,
      label: group.title
    }))
  ]);
  const skillGroupOptions = computed(() => [
    { value: "", label: t("notLinked") },
    ...availableSkillGroups.value.map((group) => ({
      value: group.id,
      label: group.title
    }))
  ]);

  function selectedMaterialLinks(): Record<MaterialKind, string[]> {
    if (materialBindingMode.value === "group") {
      return materialGroupLinks(selectedMaterialGroup.value);
    }
    return Object.fromEntries(
      MATERIAL_KINDS.map(({ id }) => {
        const selectedId = selectedMaterialIds[id];
        const valid =
          selectedId &&
          materialCandidates(id).some((library) => library.id === selectedId);
        return [
          id,
          (valid || props.preserveMissing) && selectedId ? [selectedId] : []
        ];
      })
    ) as Record<MaterialKind, string[]>;
  }

  function selectedSkillLinks(): Record<SkillKind, string[]> {
    if (skillBindingMode.value === "group") {
      return skillGroupLinks(selectedSkillGroup.value);
    }
    return Object.fromEntries(
      SKILL_KINDS.map(({ id }) => {
        const selectedId = selectedSkillIds[id];
        const valid =
          selectedId &&
          skillCandidates(id).some((library) => library.id === selectedId);
        return [
          id,
          (valid || props.preserveMissing) && selectedId ? [selectedId] : []
        ];
      })
    ) as Record<SkillKind, string[]>;
  }

  watch(
    () => [props.initialMaterials, props.initialSkills],
    () => {
      for (const { id } of MATERIAL_KINDS)
        selectedMaterialIds[id] = props.initialMaterials?.[id][0] ?? "";
      for (const { id } of SKILL_KINDS)
        selectedSkillIds[id] = props.initialSkills?.[id][0] ?? "";
      materialBindingMode.value = "single";
      skillBindingMode.value = "single";
    },
    { immediate: true }
  );
  watch(availableMaterialGroups, (groups) => {
    if (
      selectedMaterialGroupId.value &&
      !groups.some((group) => group.id === selectedMaterialGroupId.value)
    )
      selectedMaterialGroupId.value = "";
  });
  watch(availableSkillGroups, (groups) => {
    if (
      selectedSkillGroupId.value &&
      !groups.some((group) => group.id === selectedSkillGroupId.value)
    )
      selectedSkillGroupId.value = "";
  });
  return {
    MATERIAL_KINDS,
    SKILL_KINDS,
    materialBindingMode,
    skillBindingMode,
    selectedMaterialGroupId,
    selectedSkillGroupId,
    selectedMaterialIds,
    selectedSkillIds,
    availableMaterialGroups,
    availableSkillGroups,
    selectedMaterialGroup,
    selectedSkillGroup,
    materialById,
    skillById,
    materialKindDescription,
    skillKindDescription,
    materialSelectOptions,
    skillSelectOptions,
    materialGroupOptions,
    skillGroupOptions,
    selectedMaterialLinks,
    selectedSkillLinks
  };
}
