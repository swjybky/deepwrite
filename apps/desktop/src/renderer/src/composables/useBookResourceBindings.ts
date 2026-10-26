import { createScopedTranslator } from "../i18n";
import { computed, reactive, ref, watch } from "vue";
import type {
  LinkedMaterialIdsByKind,
  LinkedSkillIdsByKind,
  MaterialKind,
  MaterialLibraryGroup,
  SkillKind,
  SkillLibraryGroup
} from "@deepwrite/contracts";
import type {
  BookResourceDialogMode,
  ResourceTreeNode
} from "../types/workspace";
import { MATERIAL_KINDS, SKILL_KINDS } from "./bookLibraryKinds";

const t = createScopedTranslator("workspace");

interface BookResourceBindingProps {
  mode: BookResourceDialogMode | null;
  book: ResourceTreeNode | null;
  materialLibraries: ResourceTreeNode[];
  skillLibraries: ResourceTreeNode[];
  materialGroups: readonly MaterialLibraryGroup[];
  skillGroups: readonly SkillLibraryGroup[];
  loading?: boolean;
}

export function useBookResourceBindings(props: BookResourceBindingProps) {
  const bindingMode = ref<"single" | "group">("single");
  const selectedGroupId = ref("");
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
  const bindingDomain = computed<"skill" | "material" | null>(() => {
    if (props.mode === "bind-skill") return "skill";
    if (props.mode === "bind-material") return "material";
    return null;
  });
  function materialCandidates(kind: MaterialKind): ResourceTreeNode[] {
    return props.materialLibraries.filter(
      (library) =>
        library.materialKind === kind || library.materialKind === "mixed"
    );
  }

  function materialKindDescription(
    kind: (typeof MATERIAL_KINDS)[number]
  ): string {
    return props.book?.workspaceType === "script" && kind.id === "plot"
      ? t("bookLibrarySelection.plotDesignAndRefinement")
      : kind.description;
  }

  function skillKindDescription(kind: (typeof SKILL_KINDS)[number]): string {
    return props.book?.workspaceType === "script" && kind.id === "style"
      ? t("bookLibrarySelection.manuscriptAndEpisodeWritingMethods")
      : kind.description;
  }

  function skillCandidates(kind: SkillKind): ResourceTreeNode[] {
    return props.skillLibraries.filter((library) => library.skillKind === kind);
  }

  function materialGroupLinks(
    group: Pick<MaterialLibraryGroup, "members"> | undefined
  ): LinkedMaterialIdsByKind {
    const links: LinkedMaterialIdsByKind = {
      character: [],
      gimmick: [],
      plot: [],
      draft: [],
      other: []
    };
    if (!group) return links;
    for (const { id: kind } of MATERIAL_KINDS) {
      const libraryId = group.members[kind];
      if (
        libraryId &&
        materialCandidates(kind).some((library) => library.id === libraryId)
      ) {
        links[kind] = [libraryId];
      }
    }
    return links;
  }

  function skillGroupLinks(
    group: Pick<SkillLibraryGroup, "members"> | undefined
  ): LinkedSkillIdsByKind {
    const links: LinkedSkillIdsByKind = {
      general: [],
      plot: [],
      style: [],
      other: []
    };
    if (!group) return links;
    for (const { id: kind } of SKILL_KINDS) {
      const libraryId = group.members[kind];
      if (
        libraryId &&
        skillCandidates(kind).some((library) => library.id === libraryId)
      ) {
        links[kind] = [libraryId];
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
  const availableGroups = computed(() =>
    bindingDomain.value === "skill"
      ? availableSkillGroups.value
      : availableMaterialGroups.value
  );
  const selectedMaterialGroup = computed(() =>
    availableMaterialGroups.value.find(
      (group) => group.id === selectedGroupId.value
    )
  );
  const selectedSkillGroup = computed(() =>
    availableSkillGroups.value.find(
      (group) => group.id === selectedGroupId.value
    )
  );
  const groupOptions = computed(() => [
    {
      value: "",
      label:
        bindingDomain.value === "skill"
          ? t("bookLibrarySelection.notLinked")
          : t("bookLibrarySelection.noAssociation")
    },
    ...availableGroups.value.map((group) => ({
      value: group.id,
      label: group.title
    }))
  ]);

  function materialOptions(
    kind: MaterialKind
  ): Array<{ value: string; label: string }> {
    return [
      { value: "", label: t("bookLibrarySelection.noAssociation") },
      ...materialCandidates(kind).map((library) => ({
        value: library.id,
        label: library.badge
          ? `${library.label} · ${library.badge}`
          : library.label
      }))
    ];
  }

  function skillOptions(
    kind: SkillKind
  ): Array<{ value: string; label: string }> {
    return [
      { value: "", label: t("bookLibrarySelection.notLinked") },
      ...skillCandidates(kind).map((library) => ({
        value: library.id,
        label: library.badge
          ? `${library.label} · ${library.badge}`
          : library.label
      }))
    ];
  }

  function selectedMaterialLinks(): LinkedMaterialIdsByKind {
    return materialGroupLinks({ members: selectedMaterialIds });
  }

  function selectedSkillLinks(): LinkedSkillIdsByKind {
    return skillGroupLinks({ members: selectedSkillIds });
  }

  function clearUnavailableSelections(): void {
    if (props.loading) return;
    const materials = selectedMaterialLinks();
    const skills = selectedSkillLinks();
    for (const { id } of MATERIAL_KINDS) {
      selectedMaterialIds[id] = materials[id][0] ?? "";
    }
    for (const { id } of SKILL_KINDS) {
      selectedSkillIds[id] = skills[id][0] ?? "";
    }
  }

  function resetBindingDraft(): void {
    bindingMode.value = "single";
    selectedGroupId.value = "";
    for (const { id } of MATERIAL_KINDS) {
      selectedMaterialIds[id] =
        props.book?.boundMaterialLibraryIdsByKind?.[id]?.[0] ?? "";
    }
    for (const { id } of SKILL_KINDS) {
      selectedSkillIds[id] =
        props.book?.boundSkillLibraryIdsByKind?.[id]?.[0] ?? "";
    }
    clearUnavailableSelections();
  }

  watch(
    [
      () => props.loading,
      () => props.materialLibraries,
      () => props.skillLibraries
    ],
    clearUnavailableSelections,
    { deep: true }
  );

  watch(availableGroups, (groups) => {
    if (
      selectedGroupId.value &&
      !groups.some((group) => group.id === selectedGroupId.value)
    ) {
      selectedGroupId.value = "";
    }
  });

  return {
    MATERIAL_KINDS,
    SKILL_KINDS,
    bindingMode,
    selectedGroupId,
    selectedMaterialIds,
    selectedSkillIds,
    bindingDomain,
    materialKindDescription,
    skillKindDescription,
    materialGroupLinks,
    skillGroupLinks,
    selectedMaterialLinks,
    selectedSkillLinks,
    availableGroups,
    selectedMaterialGroup,
    selectedSkillGroup,
    groupOptions,
    materialOptions,
    skillOptions,
    resetBindingDraft
  };
}
