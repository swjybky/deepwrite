import { computed, ref, watch } from "vue";
import {
  flattenMaterialIdsByKind,
  flattenSkillIdsByKind,
  materialIdsToByKind,
  skillIdsToByKind,
  type LinkedMaterialIdsByKind,
  type LinkedSkillIdsByKind,
  type MaterialLibraryGroup,
  type SkillLibraryGroup
} from "@deepwrite/contracts/renderer";
import type {
  BookResourceDialogMode,
  ResourceTreeNode
} from "../types/workspace";
import {
  formatNodeTagBadge,
  sharingT
} from "../components/librarySharingLabels";

interface BookResourceBindingProps {
  mode: BookResourceDialogMode | null;
  book: ResourceTreeNode | null;
  materialLibraries: ResourceTreeNode[];
  skillLibraries: ResourceTreeNode[];
  materialGroups: readonly MaterialLibraryGroup[];
  skillGroups: readonly SkillLibraryGroup[];
  loading?: boolean;
}

export interface ResourceBindingPickerItem {
  id: string;
  title: string;
  tag: string;
  entryCount: number;
}

export function useBookResourceBindings(props: BookResourceBindingProps) {
  const selectedMaterialLibraryIds = ref<string[]>([]);
  const selectedSkillLibraryIds = ref<string[]>([]);
  const searchQuery = ref("");
  const tagFilter = ref("");

  const bindingDomain = computed<"skill" | "material" | null>(() => {
    if (props.mode === "bind-skill") return "skill";
    if (props.mode === "bind-material") return "material";
    return null;
  });

  const materialById = computed(
    () =>
      new Map(props.materialLibraries.map((item) => [item.id, item] as const))
  );
  const skillById = computed(
    () => new Map(props.skillLibraries.map((item) => [item.id, item] as const))
  );

  function countNodeEntries(node: ResourceTreeNode): number {
    return (node.children ?? []).filter((child) =>
      Boolean(child.catalogEntryId)
    ).length;
  }

  const activeItems = computed<ResourceBindingPickerItem[]>(() => {
    const domain = bindingDomain.value;
    if (!domain) return [];
    const nodes =
      domain === "material" ? props.materialLibraries : props.skillLibraries;
    return nodes.map((node) => ({
      id: node.id,
      title: node.badge ? `${node.label} · ${node.badge}` : node.label,
      tag: formatNodeTagBadge(domain, node),
      entryCount: countNodeEntries(node)
    }));
  });

  const tagFilterOptions = computed(() => {
    const tags = [...new Set(activeItems.value.map((item) => item.tag))];
    return [
      { value: "", label: sharingT("allTags") },
      ...tags.map((tag) => ({ value: tag, label: tag }))
    ];
  });

  const filteredItems = computed(() => {
    const query = searchQuery.value.trim().toLocaleLowerCase();
    const tag = tagFilter.value;
    return activeItems.value.filter(
      (item) =>
        (!tag || item.tag === tag) &&
        (!query ||
          item.title.toLocaleLowerCase().includes(query) ||
          item.tag.toLocaleLowerCase().includes(query))
    );
  });

  function validMaterialGroupMemberIds(
    group: Pick<MaterialLibraryGroup, "memberIds"> | undefined
  ): string[] {
    if (!group) return [];
    return group.memberIds.filter((id) => materialById.value.has(id));
  }

  function validSkillGroupMemberIds(
    group: Pick<SkillLibraryGroup, "memberIds"> | undefined
  ): string[] {
    if (!group) return [];
    return group.memberIds.filter((id) => skillById.value.has(id));
  }

  function materialGroupLinks(
    group: Pick<MaterialLibraryGroup, "memberIds"> | undefined
  ): LinkedMaterialIdsByKind {
    return materialIdsToByKind(
      validMaterialGroupMemberIds(group),
      props.materialLibraries.map((item) => ({
        id: item.id,
        materialKind: item.materialKind ?? "other"
      }))
    );
  }

  function skillGroupLinks(
    group: Pick<SkillLibraryGroup, "memberIds"> | undefined
  ): LinkedSkillIdsByKind {
    return skillIdsToByKind(
      validSkillGroupMemberIds(group),
      props.skillLibraries.map((item) => ({
        id: item.id,
        skillKind: item.skillKind ?? "other"
      }))
    );
  }

  const availableMaterialGroups = computed(() =>
    props.materialGroups.filter(
      (group) => validMaterialGroupMemberIds(group).length > 0
    )
  );
  const availableSkillGroups = computed(() =>
    props.skillGroups.filter(
      (group) => validSkillGroupMemberIds(group).length > 0
    )
  );
  const availableGroups = computed(() =>
    bindingDomain.value === "skill"
      ? availableSkillGroups.value
      : availableMaterialGroups.value
  );

  const selectedIds = computed(() =>
    bindingDomain.value === "skill"
      ? selectedSkillLibraryIds.value
      : selectedMaterialLibraryIds.value
  );
  const selectedSet = computed(() => new Set(selectedIds.value));

  function groupMemberCount(
    group: MaterialLibraryGroup | SkillLibraryGroup
  ): number {
    return bindingDomain.value === "skill"
      ? validSkillGroupMemberIds(group).length
      : validMaterialGroupMemberIds(group).length;
  }

  function isGroupSelected(
    group: MaterialLibraryGroup | SkillLibraryGroup
  ): boolean {
    const ids =
      bindingDomain.value === "skill"
        ? validSkillGroupMemberIds(group)
        : validMaterialGroupMemberIds(group);
    return ids.length > 0 && ids.every((id) => selectedSet.value.has(id));
  }

  function toggleGroup(groupId: string): void {
    if (bindingDomain.value === "skill") {
      const group = availableSkillGroups.value.find(
        (candidate) => candidate.id === groupId
      );
      if (!group) return;
      const ids = validSkillGroupMemberIds(group);
      if (!ids.length) return;
      if (isGroupSelected(group)) {
        const remove = new Set(ids);
        selectedSkillLibraryIds.value = selectedSkillLibraryIds.value.filter(
          (id) => !remove.has(id)
        );
      } else {
        selectedSkillLibraryIds.value = [
          ...new Set([...selectedSkillLibraryIds.value, ...ids])
        ];
      }
      return;
    }
    const group = availableMaterialGroups.value.find(
      (candidate) => candidate.id === groupId
    );
    if (!group) return;
    const ids = validMaterialGroupMemberIds(group);
    if (!ids.length) return;
    if (isGroupSelected(group)) {
      const remove = new Set(ids);
      selectedMaterialLibraryIds.value =
        selectedMaterialLibraryIds.value.filter((id) => !remove.has(id));
    } else {
      selectedMaterialLibraryIds.value = [
        ...new Set([...selectedMaterialLibraryIds.value, ...ids])
      ];
    }
  }

  function toggleLibrary(libraryId: string): void {
    if (bindingDomain.value === "skill") {
      if (selectedSkillLibraryIds.value.includes(libraryId)) {
        selectedSkillLibraryIds.value = selectedSkillLibraryIds.value.filter(
          (id) => id !== libraryId
        );
      } else {
        selectedSkillLibraryIds.value = [
          ...selectedSkillLibraryIds.value,
          libraryId
        ];
      }
      return;
    }
    if (selectedMaterialLibraryIds.value.includes(libraryId)) {
      selectedMaterialLibraryIds.value =
        selectedMaterialLibraryIds.value.filter((id) => id !== libraryId);
    } else {
      selectedMaterialLibraryIds.value = [
        ...selectedMaterialLibraryIds.value,
        libraryId
      ];
    }
  }

  function selectedMaterialLinks(): LinkedMaterialIdsByKind {
    const validIds = selectedMaterialLibraryIds.value.filter((id) =>
      materialById.value.has(id)
    );
    return materialIdsToByKind(
      validIds,
      props.materialLibraries.map((item) => ({
        id: item.id,
        materialKind: item.materialKind ?? "other"
      }))
    );
  }

  function selectedSkillLinks(): LinkedSkillIdsByKind {
    const validIds = selectedSkillLibraryIds.value.filter((id) =>
      skillById.value.has(id)
    );
    return skillIdsToByKind(
      validIds,
      props.skillLibraries.map((item) => ({
        id: item.id,
        skillKind: item.skillKind ?? "other"
      }))
    );
  }

  function clearUnavailableSelections(): void {
    if (props.loading) return;
    selectedMaterialLibraryIds.value = selectedMaterialLibraryIds.value.filter(
      (id) => materialById.value.has(id)
    );
    selectedSkillLibraryIds.value = selectedSkillLibraryIds.value.filter((id) =>
      skillById.value.has(id)
    );
  }

  function resetBindingDraft(): void {
    searchQuery.value = "";
    tagFilter.value = "";
    selectedMaterialLibraryIds.value = props.book?.boundMaterialLibraryIdsByKind
      ? flattenMaterialIdsByKind(props.book.boundMaterialLibraryIdsByKind)
      : [...(props.book?.boundMaterialLibraryIds ?? [])];
    selectedSkillLibraryIds.value = props.book?.boundSkillLibraryIdsByKind
      ? flattenSkillIdsByKind(props.book.boundSkillLibraryIdsByKind)
      : [...(props.book?.boundSkillLibraryIds ?? [])];
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

  watch(tagFilterOptions, (opts) => {
    if (
      tagFilter.value &&
      !opts.some((option) => option.value === tagFilter.value)
    ) {
      tagFilter.value = "";
    }
  });

  return {
    selectedMaterialLibraryIds,
    selectedSkillLibraryIds,
    selectedIds,
    selectedSet,
    searchQuery,
    tagFilter,
    tagFilterOptions,
    activeItems,
    filteredItems,
    bindingDomain,
    materialGroupLinks,
    skillGroupLinks,
    availableGroups,
    groupMemberCount,
    isGroupSelected,
    toggleGroup,
    toggleLibrary,
    selectedMaterialLinks,
    selectedSkillLinks,
    resetBindingDraft
  };
}
