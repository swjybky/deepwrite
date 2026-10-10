import {
  assignLibraryPackageGroup,
  nextLibraryPackageTitle
} from "@deepwrite/contracts/renderer";
import type {
  LibraryPackageImportChoices,
  LibraryPackagePreview
} from "@deepwrite/contracts";
import { computed, ref, watch } from "vue";

export interface LibraryPackageImportRow {
  key: string;
  include: boolean;
  title: string;
  kind: string;
}

/**
 * The editable part of the import preview: which libraries, their names and
 * kinds, and whether they still fit into one group. Display only; Core
 * re-validates the resulting choices.
 */
export function useLibraryPackageImportForm(source: {
  preview(): LibraryPackagePreview | undefined;
  existingTitles(): readonly string[];
}) {
  const rows = ref<LibraryPackageImportRow[]>([]);
  const createGroup = ref(false);
  const groupTitle = ref("");
  const libraries = computed(
    () =>
      new Map(
        (source.preview()?.libraries ?? []).map((item) => [item.key, item])
      )
  );
  const included = computed(() => rows.value.filter(({ include }) => include));

  watch(
    source.preview,
    (preview) => {
      rows.value = (preview?.libraries ?? []).map((library) => ({
        key: library.key,
        include: library.blocked === null,
        title: library.title,
        kind: library.kind
      }));
      createGroup.value = preview?.group?.suggested ?? false;
      groupTitle.value = preview?.group?.title ?? "";
    },
    { immediate: true }
  );

  const groupProblem = computed(() => {
    const preview = source.preview();
    if (!preview?.group) return null;
    const assignment = assignLibraryPackageGroup(
      preview.domain,
      included.value.map(({ kind }) => kind)
    );
    return "problem" in assignment ? assignment.problem : null;
  });
  const groupEnabled = computed(
    () => createGroup.value && groupProblem.value === null
  );

  /** Titles Core will assign, numbered past existing and earlier rows. */
  const plannedTitles = computed(() => {
    const used = [...source.existingTitles()];
    return new Map(
      rows.value.map((row) => {
        const title = nextLibraryPackageTitle(
          row.title.trim() || libraries.value.get(row.key)!.title,
          used
        );
        if (row.include) used.push(title);
        return [row.key, title] as const;
      })
    );
  });

  const ready = computed(
    () =>
      included.value.length > 0 &&
      (!groupEnabled.value || groupTitle.value.trim().length > 0)
  );

  function updateRow(
    key: string,
    patch: Partial<Omit<LibraryPackageImportRow, "key">>
  ): void {
    rows.value = rows.value.map((row) =>
      row.key === key ? { ...row, ...patch } : row
    );
  }

  function choices(): LibraryPackageImportChoices {
    return {
      libraries: rows.value.map((row) => {
        const library = libraries.value.get(row.key)!;
        return {
          key: row.key,
          include: row.include,
          title: row.title.trim() || library.title,
          ...(library.kindEditable ? { kind: row.kind } : {})
        };
      }),
      createGroup: groupEnabled.value,
      ...(groupEnabled.value ? { groupTitle: groupTitle.value.trim() } : {})
    };
  }

  return {
    rows,
    createGroup,
    groupTitle,
    libraries,
    included,
    groupProblem,
    groupEnabled,
    plannedTitles,
    ready,
    updateRow,
    choices
  };
}
