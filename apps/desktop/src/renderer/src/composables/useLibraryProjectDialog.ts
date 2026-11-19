import { useCatalogIndexStore } from "../stores/catalogIndexStore";
import { createScopedTranslator } from "../i18n";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch
} from "vue";
import type {
  CreateLibraryInput,
  CreateLibraryEntryInput,
  MaterialLibraryKind,
  MaterialStageId,
  SkillKind
} from "@deepwrite/contracts";
import { uiMessage } from "../ui-feedback";
import * as options from "../components/libraryProjectDialogOptions";
import {
  CUSTOM_TAG_SELECT_VALUE,
  LIBRARY_CUSTOM_TAG_MAX_LENGTH,
  buildLibraryTagSelectOptions,
  initialTagSelectionFromLibrary,
  resolveMaterialTagSelection,
  resolveSkillTagSelection,
  sharingT
} from "../components/librarySharingLabels";

const t = createScopedTranslator("components.libraryProjectDialog");

type LibraryDomain = "material" | "skill";
type LibraryDialogOperation =
  | "create-library"
  | "create-entry"
  | "rename-library"
  | "rename-entry"
  | "remove-entry";
type CreateLibraryEntryDraft =
  | import("@deepwrite/contracts").UnboundEntryDraft
  | Omit<Extract<CreateLibraryEntryInput, { domain: "material" }>, "content">
  | Omit<Extract<CreateLibraryEntryInput, { domain: "skill" }>, "content">;

export interface LibraryProjectDialogProps {
  open: boolean;
  operation: LibraryDialogOperation | null;
  domain: LibraryDomain;
  libraryId?: string | undefined;
  libraryTitle?: string | undefined;
  materialKind?: MaterialLibraryKind | undefined;
  skillKind?: SkillKind | undefined;
  customTag?: string | undefined;
  entryId?: string | undefined;
  entryTitle?: string | undefined;
  workspaceType?: "short" | "script" | "long" | undefined;
  submitting?: boolean | undefined;
}

export type LibraryProjectDialogEvents = {
  close: [];
  createLibrary: [payload: CreateLibraryInput];
  createEntry: [payload: CreateLibraryEntryDraft];
  renameLibrary: [
    payload: {
      domain: LibraryDomain;
      libraryId: string;
      title: string;
      materialKind?: MaterialLibraryKind;
      skillKind?: SkillKind;
      customTag?: string | null;
    }
  ];
  renameEntry: [
    payload: {
      domain: LibraryDomain;
      libraryId: string;
      entryId: string;
      title: string;
    }
  ];
  removeEntry: [
    payload: {
      domain: LibraryDomain;
      libraryId: string;
      entryId: string;
    }
  ];
};

export function useLibraryProjectDialog(
  props: LibraryProjectDialogProps,
  emit: {
    <K extends keyof LibraryProjectDialogEvents>(
      event: K,
      ...args: LibraryProjectDialogEvents[K]
    ): void;
  }
) {
  const catalog = useCatalogIndexStore();
  const destination = ref("");
  const entryDestinations = computed(() => [
    { value: "", label: t("unboundDestination") },
    ...(
      (props.domain === "material"
        ? catalog.snapshot?.materials
        : catalog.snapshot?.skills) ?? []
    )
      .filter(
        (library) =>
          !library.isUnbound && !("isBuiltin" in library && library.isBuiltin)
      )
      .map((library) => ({ value: library.id, label: library.title }))
  ]);
  const title = ref("");
  const stageId = ref<MaterialStageId>("other");
  const libraryTagChoice = ref("preset:文献");
  const customTagDraft = ref("");
  const titleInput = ref<HTMLInputElement | null>(null);
  const customTagInput = ref<HTMLInputElement | null>(null);

  const isCustomTagSelected = computed(
    () => libraryTagChoice.value === CUSTOM_TAG_SELECT_VALUE
  );
  const domainLabel = computed(() =>
    props.domain === "material" ? t("material") : t("skill")
  );
  const heading = computed(() => {
    if (props.operation === "create-library")
      return t("newValueLibrary", {
        arg0: domainLabel.value
      });
    if (props.operation === "create-entry")
      return props.libraryId
        ? t("newEntryInValue", { arg0: props.libraryTitle ?? "" })
        : t("newEntry");
    if (props.operation === "rename-library")
      return t("renameValueLibrary", {
        arg0: domainLabel.value
      });
    if (props.operation === "rename-entry") return t("renameEntry");
    return t("deleteValue", {
      arg0: props.entryTitle ?? t("entry")
    });
  });
  const libraryTagOptions = computed(() =>
    buildLibraryTagSelectOptions(
      props.domain,
      props.operation === "rename-library" && props.materialKind === "mixed"
    )
  );
  const stageOptions = computed(options.entryStageOptions);
  watch(entryDestinations, (opts) => {
    if (!opts.some((option) => option.value === destination.value))
      destination.value = "";
  });
  const showEntryStageField = computed(
    () => props.operation === "create-entry" && props.domain === "material"
  );

  function requestClose(): void {
    if (!props.submitting) emit("close");
  }

  function submit(): void {
    if (props.operation === "remove-entry") {
      if (!props.libraryId || !props.entryId) {
        uiMessage.error(t("entryToDeleteNotFound"));
        return;
      }
      emit("removeEntry", {
        domain: props.domain,
        libraryId: props.libraryId,
        entryId: props.entryId
      });
      return;
    }

    const normalizedTitle = title.value.trim();
    if (!normalizedTitle) {
      uiMessage.warning(
        props.operation === "create-library" ||
          props.operation === "rename-library"
          ? t("enterALibraryName")
          : t("enterAnEntryName")
      );
      titleInput.value?.focus();
      return;
    }
    if (props.operation === "create-library") {
      if (props.domain === "material") {
        const resolved = resolveMaterialTagSelection(
          libraryTagChoice.value,
          customTagDraft.value
        );
        if (!resolved) {
          uiMessage.warning(sharingT("enterCustomTagWarning"));
          customTagInput.value?.focus();
          return;
        }
        emit("createLibrary", {
          domain: "material",
          name: normalizedTitle,
          materialKind: resolved.materialKind,
          ...(resolved.customTag ? { customTag: resolved.customTag } : {})
        });
      } else {
        const resolved = resolveSkillTagSelection(
          libraryTagChoice.value,
          customTagDraft.value
        );
        if (!resolved) {
          uiMessage.warning(sharingT("enterCustomTagWarning"));
          customTagInput.value?.focus();
          return;
        }
        emit("createLibrary", {
          domain: "skill",
          name: normalizedTitle,
          skillKind: resolved.skillKind,
          ...(resolved.customTag ? { customTag: resolved.customTag } : {})
        });
      }
      return;
    }
    if (props.operation === "rename-library") {
      if (!props.libraryId) {
        uiMessage.error(t("libraryToRenameNotFound"));
        return;
      }
      if (props.domain === "material") {
        const resolved = resolveMaterialTagSelection(
          libraryTagChoice.value,
          customTagDraft.value,
          props.materialKind ?? "other"
        );
        if (!resolved) {
          uiMessage.warning(sharingT("enterCustomTagWarning"));
          customTagInput.value?.focus();
          return;
        }
        const nextKind: MaterialLibraryKind = resolved.preserveMixed
          ? "mixed"
          : resolved.materialKind;
        const initialCustomTag = props.customTag?.trim() || null;
        const kindChanged =
          props.materialKind !== undefined && nextKind !== props.materialKind;
        const tagChanged = resolved.customTag !== initialCustomTag;
        emit("renameLibrary", {
          domain: "material",
          libraryId: props.libraryId,
          title: normalizedTitle,
          ...(kindChanged ? { materialKind: nextKind } : {}),
          ...(tagChanged ? { customTag: resolved.customTag } : {})
        });
      } else {
        const resolved = resolveSkillTagSelection(
          libraryTagChoice.value,
          customTagDraft.value,
          props.skillKind ?? "general"
        );
        if (!resolved) {
          uiMessage.warning(sharingT("enterCustomTagWarning"));
          customTagInput.value?.focus();
          return;
        }
        const initialCustomTag = props.customTag?.trim() || null;
        const kindChanged =
          props.skillKind !== undefined &&
          resolved.skillKind !== props.skillKind;
        const tagChanged = resolved.customTag !== initialCustomTag;
        emit("renameLibrary", {
          domain: "skill",
          libraryId: props.libraryId,
          title: normalizedTitle,
          ...(kindChanged ? { skillKind: resolved.skillKind } : {}),
          ...(tagChanged ? { customTag: resolved.customTag } : {})
        });
      }
      return;
    }
    if (props.operation === "rename-entry") {
      if (!props.libraryId || !props.entryId) {
        uiMessage.error(t("entryToRenameNotFound"));
        return;
      }
      emit("renameEntry", {
        domain: props.domain,
        libraryId: props.libraryId,
        entryId: props.entryId,
        title: normalizedTitle
      });
      return;
    }
    const targetLibraryId = props.libraryId ?? destination.value;
    if (!targetLibraryId) {
      emit("createEntry", {
        unbound: true,
        domain: props.domain,
        title: normalizedTitle,
        stageId: props.domain === "material" ? stageId.value : "draft"
      });
      return;
    }
    if (props.domain === "material") {
      emit("createEntry", {
        domain: "material",
        libraryId: targetLibraryId,
        title: normalizedTitle,
        stageId: stageId.value
      });
    } else {
      emit("createEntry", {
        domain: "skill",
        libraryId: targetLibraryId,
        title: normalizedTitle
      });
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (props.open && event.key === "Escape") requestClose();
  }

  watch(
    () =>
      [
        props.open,
        props.operation,
        props.domain,
        props.libraryId,
        props.materialKind,
        props.skillKind,
        props.customTag
      ] as const,
    ([open]) => {
      if (!open) return;
      destination.value = "";
      title.value =
        props.operation === "rename-library"
          ? (props.libraryTitle ?? "")
          : props.operation === "rename-entry"
            ? (props.entryTitle ?? "")
            : "";
      if (props.operation === "rename-library") {
        const currentLibrary =
          props.domain === "material"
            ? catalog.snapshot?.materials.find(
                (item) => item.id === props.libraryId
              )
            : catalog.snapshot?.skills.find(
                (item) => item.id === props.libraryId
              );
        const initial = initialTagSelectionFromLibrary({
          domain: props.domain,
          materialKind:
            props.materialKind ??
            (currentLibrary && "materialKind" in currentLibrary
              ? currentLibrary.materialKind
              : undefined),
          skillKind:
            props.skillKind ??
            (currentLibrary && "skillKind" in currentLibrary
              ? currentLibrary.skillKind
              : undefined),
          customTag: props.customTag ?? currentLibrary?.customTag
        });
        libraryTagChoice.value = initial.choice;
        customTagDraft.value = initial.customDraft;
      } else {
        libraryTagChoice.value =
          props.domain === "material" ? "preset:文献" : "general";
        customTagDraft.value = "";
      }
      stageId.value =
        (stageOptions.value[0]?.value as MaterialStageId | undefined) ??
        "other";
      if (props.operation !== "remove-entry") {
        void nextTick(() => titleInput.value?.focus());
      }
    },
    { immediate: true }
  );

  onMounted(() => document.addEventListener("keydown", handleKeydown));
  onBeforeUnmount(() => document.removeEventListener("keydown", handleKeydown));

  return {
    LIBRARY_CUSTOM_TAG_MAX_LENGTH,
    destination,
    entryDestinations,
    title,
    stageId,
    libraryTagChoice,
    customTagDraft,
    isCustomTagSelected,
    titleInput,
    customTagInput,
    domainLabel,
    heading,
    libraryTagOptions,
    stageOptions,
    showEntryStageField,
    requestClose,
    submit
  };
}
