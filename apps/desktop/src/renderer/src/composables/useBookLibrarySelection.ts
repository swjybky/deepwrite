import { computed, ref, watch } from "vue";
import {
  flattenMaterialIdsByKind,
  flattenSkillIdsByKind,
  materialIdsToByKind,
  skillIdsToByKind,
  type CatalogIndexSnapshot,
  type LinkedMaterialIdsByKind,
  type LinkedSkillIdsByKind,
  type MaterialKind,
  type MaterialLibrary,
  type MaterialLibraryGroup,
  type SkillKind,
  type SkillLibrary,
  type SkillLibraryGroup
} from "@deepwrite/contracts/renderer";
import {
  formatMaterialTagBadge,
  formatSkillTagBadge,
  sharingT
} from "../components/librarySharingLabels";

export interface BookLibrarySelectionProps {
  materials: readonly (
    MaterialLibrary | CatalogIndexSnapshot["materials"][number]
  )[];
  skills: readonly (SkillLibrary | CatalogIndexSnapshot["skills"][number])[];
  materialGroups: readonly MaterialLibraryGroup[];
  skillGroups: readonly SkillLibraryGroup[];
  workspaceType: "short" | "script" | "long" | "academic" | "mystery";
  initialMaterials?: LinkedMaterialIdsByKind | undefined;
  initialSkills?: LinkedSkillIdsByKind | undefined;
  initialMaterialIds?: readonly string[] | undefined;
  initialSkillIds?: readonly string[] | undefined;
  preserveMissing?: boolean;
}

export interface BookLibraryPickerItem {
  id: string;
  title: string;
  tag: string;
  entryCount: number;
}

export function useBookLibrarySelection(props: BookLibrarySelectionProps) {
  const selectedMaterialLibraryIds = ref<string[]>([]);
  const selectedSkillLibraryIds = ref<string[]>([]);
  const materialSearchQuery = ref("");
  const skillSearchQuery = ref("");
  const materialTagFilter = ref("");
  const skillTagFilter = ref("");

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

  const materialItems = computed<BookLibraryPickerItem[]>(() =>
    workspaceMaterials.value.map((library) => {
      const genreLabel = [library.parentGenre, library.subGenre]
        .map((value) => value.trim())
        .filter(Boolean)
        .join(" / ");
      return {
        id: library.id,
        title: genreLabel ? `${library.title} · ${genreLabel}` : library.title,
        tag: formatMaterialTagBadge(library),
        entryCount: Array.isArray(library.entries) ? library.entries.length : 0
      };
    })
  );

  const skillItems = computed<BookLibraryPickerItem[]>(() =>
    workspaceSkills.value.map((library) => ({
      id: library.id,
      title: library.isBuiltin
        ? `${library.title} (${sharingT("officialSuffix")})`
        : library.title,
      tag: formatSkillTagBadge(library),
      entryCount: Array.isArray(library.entries) ? library.entries.length : 0
    }))
  );

  const materialTagFilterOptions = computed(() => {
    const tags = [...new Set(materialItems.value.map((item) => item.tag))];
    return [
      { value: "", label: sharingT("allTags") },
      ...tags.map((tag) => ({ value: tag, label: tag }))
    ];
  });

  const skillTagFilterOptions = computed(() => {
    const tags = [...new Set(skillItems.value.map((item) => item.tag))];
    return [
      { value: "", label: sharingT("allTags") },
      ...tags.map((tag) => ({ value: tag, label: tag }))
    ];
  });

  const filteredMaterialItems = computed(() => {
    const query = materialSearchQuery.value.trim().toLocaleLowerCase();
    const tag = materialTagFilter.value;
    return materialItems.value.filter(
      (item) =>
        (!tag || item.tag === tag) &&
        (!query ||
          item.title.toLocaleLowerCase().includes(query) ||
          item.tag.toLocaleLowerCase().includes(query))
    );
  });

  const filteredSkillItems = computed(() => {
    const query = skillSearchQuery.value.trim().toLocaleLowerCase();
    const tag = skillTagFilter.value;
    return skillItems.value.filter(
      (item) =>
        (!tag || item.tag === tag) &&
        (!query ||
          item.title.toLocaleLowerCase().includes(query) ||
          item.tag.toLocaleLowerCase().includes(query))
    );
  });

  function validMaterialGroupMemberIds(group: MaterialLibraryGroup): string[] {
    return group.memberIds.filter((id) => materialById.value.has(id));
  }

  function validSkillGroupMemberIds(group: SkillLibraryGroup): string[] {
    return group.memberIds.filter((id) => skillById.value.has(id));
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

  const selectedMaterialSet = computed(
    () => new Set(selectedMaterialLibraryIds.value)
  );
  const selectedSkillSet = computed(
    () => new Set(selectedSkillLibraryIds.value)
  );

  function isMaterialGroupSelected(group: MaterialLibraryGroup): boolean {
    const ids = validMaterialGroupMemberIds(group);
    return (
      ids.length > 0 && ids.every((id) => selectedMaterialSet.value.has(id))
    );
  }

  function isSkillGroupSelected(group: SkillLibraryGroup): boolean {
    const ids = validSkillGroupMemberIds(group);
    return ids.length > 0 && ids.every((id) => selectedSkillSet.value.has(id));
  }

  function toggleMaterialGroup(groupId: string): void {
    const group = availableMaterialGroups.value.find(
      (candidate) => candidate.id === groupId
    );
    if (!group) return;
    const ids = validMaterialGroupMemberIds(group);
    if (ids.length === 0) return;
    if (isMaterialGroupSelected(group)) {
      const remove = new Set(ids);
      selectedMaterialLibraryIds.value =
        selectedMaterialLibraryIds.value.filter((id) => !remove.has(id));
    } else {
      selectedMaterialLibraryIds.value = [
        ...new Set([...selectedMaterialLibraryIds.value, ...ids])
      ];
    }
  }

  function toggleSkillGroup(groupId: string): void {
    const group = availableSkillGroups.value.find(
      (candidate) => candidate.id === groupId
    );
    if (!group) return;
    const ids = validSkillGroupMemberIds(group);
    if (ids.length === 0) return;
    if (isSkillGroupSelected(group)) {
      const remove = new Set(ids);
      selectedSkillLibraryIds.value = selectedSkillLibraryIds.value.filter(
        (id) => !remove.has(id)
      );
    } else {
      selectedSkillLibraryIds.value = [
        ...new Set([...selectedSkillLibraryIds.value, ...ids])
      ];
    }
  }

  function toggleMaterialLibrary(libraryId: string): void {
    if (selectedMaterialSet.value.has(libraryId)) {
      selectedMaterialLibraryIds.value =
        selectedMaterialLibraryIds.value.filter((id) => id !== libraryId);
    } else {
      selectedMaterialLibraryIds.value = [
        ...selectedMaterialLibraryIds.value,
        libraryId
      ];
    }
  }

  function toggleSkillLibrary(libraryId: string): void {
    if (selectedSkillSet.value.has(libraryId)) {
      selectedSkillLibraryIds.value = selectedSkillLibraryIds.value.filter(
        (id) => id !== libraryId
      );
    } else {
      selectedSkillLibraryIds.value = [
        ...selectedSkillLibraryIds.value,
        libraryId
      ];
    }
  }

  const missingMaterialIds = computed(() =>
    props.preserveMissing
      ? selectedMaterialLibraryIds.value.filter(
          (id) => !materialById.value.has(id)
        )
      : []
  );
  const missingSkillIds = computed(() =>
    props.preserveMissing
      ? selectedSkillLibraryIds.value.filter((id) => !skillById.value.has(id))
      : []
  );

  function selectedMaterialLinks(): LinkedMaterialIdsByKind {
    const validIds = selectedMaterialLibraryIds.value.filter((id) =>
      materialById.value.has(id)
    );
    const links = materialIdsToByKind(validIds, workspaceMaterials.value);
    if (props.preserveMissing) {
      for (const missingId of missingMaterialIds.value) {
        const originKind = (
          ["character", "gimmick", "plot", "draft", "other"] as MaterialKind[]
        ).find((kind) => props.initialMaterials?.[kind]?.includes(missingId));
        const bucket = originKind ?? "other";
        if (!links[bucket].includes(missingId)) {
          links[bucket].push(missingId);
        }
      }
    }
    return links;
  }

  function selectedSkillLinks(): LinkedSkillIdsByKind {
    const validIds = selectedSkillLibraryIds.value.filter((id) =>
      skillById.value.has(id)
    );
    const links = skillIdsToByKind(validIds, workspaceSkills.value);
    if (props.preserveMissing) {
      for (const missingId of missingSkillIds.value) {
        const originKind = (
          ["general", "plot", "style", "other"] as SkillKind[]
        ).find((kind) => props.initialSkills?.[kind]?.includes(missingId));
        const bucket = originKind ?? "other";
        if (!links[bucket].includes(missingId)) {
          links[bucket].push(missingId);
        }
      }
    }
    return links;
  }

  function selectedFlatMaterialIds(): string[] {
    const validIds = selectedMaterialLibraryIds.value.filter((id) =>
      materialById.value.has(id)
    );
    return props.preserveMissing
      ? [...new Set([...validIds, ...missingMaterialIds.value])]
      : [...new Set(validIds)];
  }

  function selectedFlatSkillIds(): string[] {
    const validIds = selectedSkillLibraryIds.value.filter((id) =>
      skillById.value.has(id)
    );
    return props.preserveMissing
      ? [...new Set([...validIds, ...missingSkillIds.value])]
      : [...new Set(validIds)];
  }

  watch(
    () =>
      [
        props.initialMaterials,
        props.initialSkills,
        props.initialMaterialIds,
        props.initialSkillIds
      ] as const,
    () => {
      selectedMaterialLibraryIds.value = props.initialMaterialIds
        ? [...new Set(props.initialMaterialIds)]
        : flattenMaterialIdsByKind(props.initialMaterials);
      selectedSkillLibraryIds.value = props.initialSkillIds
        ? [...new Set(props.initialSkillIds)]
        : flattenSkillIdsByKind(props.initialSkills);
    },
    { immediate: true }
  );

  watch(materialTagFilterOptions, (opts) => {
    if (
      materialTagFilter.value &&
      !opts.some((option) => option.value === materialTagFilter.value)
    ) {
      materialTagFilter.value = "";
    }
  });

  watch(skillTagFilterOptions, (opts) => {
    if (
      skillTagFilter.value &&
      !opts.some((option) => option.value === skillTagFilter.value)
    ) {
      skillTagFilter.value = "";
    }
  });

  return {
    selectedMaterialLibraryIds,
    selectedSkillLibraryIds,
    selectedMaterialSet,
    selectedSkillSet,
    materialSearchQuery,
    skillSearchQuery,
    materialTagFilter,
    skillTagFilter,
    materialItems,
    skillItems,
    filteredMaterialItems,
    filteredSkillItems,
    materialTagFilterOptions,
    skillTagFilterOptions,
    availableMaterialGroups,
    availableSkillGroups,
    missingMaterialIds,
    missingSkillIds,
    materialById,
    skillById,
    validMaterialGroupMemberIds,
    validSkillGroupMemberIds,
    isMaterialGroupSelected,
    isSkillGroupSelected,
    toggleMaterialGroup,
    toggleSkillGroup,
    toggleMaterialLibrary,
    toggleSkillLibrary,
    selectedMaterialLinks,
    selectedSkillLinks,
    selectedFlatMaterialIds,
    selectedFlatSkillIds
  };
}
