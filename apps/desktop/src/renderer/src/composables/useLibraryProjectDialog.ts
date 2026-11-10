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
  MaterialKind,
  MaterialLibraryKind,
  MaterialStageId,
  SkillKind
} from "@deepwrite/contracts";
import { uiMessage } from "../ui-feedback";
import * as options from "../components/libraryProjectDialogOptions";

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
    payload: { domain: LibraryDomain; libraryId: string; title: string }
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
  const libraryKind = ref<MaterialKind | SkillKind>("character");
  const titleInput = ref<HTMLInputElement | null>(null);
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
  const libraryKindOptions = computed(() =>
    options.libraryKindOptions(props.domain)
  );
  const stageOptions = computed(() => {
    const destinationKind = catalog.snapshot?.materials.find(
      (library) => library.id === (props.libraryId ?? destination.value)
    )?.materialKind;
    return options.entryStageOptions(
      destinationKind ?? props.materialKind ?? "mixed"
    );
  });
  watch(entryDestinations, (options) => {
    if (!options.some((option) => option.value === destination.value))
      destination.value = "";
  });
  watch(stageOptions, (options) => {
    if (!options.some((option) => option.value === stageId.value))
      stageId.value = (options[0]?.value as MaterialStageId) ?? "other";
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
        props.operation === "create-library"
          ? t("enterALibraryName")
          : t("enterAnEntryName")
      );
      titleInput.value?.focus();
      return;
    }
    if (props.operation === "create-library") {
      if (props.domain === "material") {
        emit("createLibrary", {
          domain: "material",
          name: normalizedTitle,
          materialKind: libraryKind.value as MaterialKind
        });
      } else {
        emit("createLibrary", {
          domain: "skill",
          name: normalizedTitle,
          skillKind: libraryKind.value as SkillKind
        });
      }
      return;
    }
    if (props.operation === "rename-library") {
      if (!props.libraryId) {
        uiMessage.error(t("libraryToRenameNotFound"));
        return;
      }
      emit("renameLibrary", {
        domain: props.domain,
        libraryId: props.libraryId,
        title: normalizedTitle
      });
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
        stageId: props.domain === "material" ? stageId.value : "draft",
        ...(props.domain === "skill"
          ? { skillKind: libraryKind.value as SkillKind }
          : {})
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
        props.materialKind
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
      libraryKind.value = props.domain === "material" ? "character" : "general";
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
    destination,
    entryDestinations,
    title,
    stageId,
    libraryKind,
    titleInput,
    domainLabel,
    heading,
    libraryKindOptions,
    stageOptions,
    showEntryStageField,
    requestClose,
    submit
  };
}
