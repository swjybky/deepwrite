import { formatError } from "../i18n/errors";
import { createScopedTranslator } from "../i18n";
import { computed, ref, shallowRef, type ComputedRef } from "vue";
import type {
  LongWorkspaceImpactConfirmation,
  LongWorkspaceIndexSnapshot,
  LongWorkspaceOperationBatch
} from "@deepwrite/contracts";
import { previewLongWorkspaceOperations } from "@deepwrite/contracts/renderer";
import { createLongStructureMutationBuilder } from "../types/longStructureMutations";
import {
  isLongMigrationEvidenceCategoryId,
  type LongStructureMutationCompletion
} from "../types/longWorkspace";

const t = createScopedTranslator("workspace.longStructureDeleteConfirmation");

export interface LongStructureDeleteRow {
  kind: "worldbuilding" | "characterType";
  id: string;
  title: string;
  detail: string;
  readOnly?: boolean;
}

export type PendingLongStructureDelete = LongStructureDeleteRow & {
  previewPending: boolean;
  batch?: LongWorkspaceOperationBatch;
  expectedImpact?: LongWorkspaceImpactConfirmation;
};

interface Options {
  snapshot: ComputedRef<LongWorkspaceIndexSnapshot | null>;
  locked: () => boolean;
  mutate(
    batch: LongWorkspaceOperationBatch,
    completion: LongStructureMutationCompletion
  ): void;
  notify: {
    info(message: string): void;
    warning(message: string): void;
  };
}

export function useLongStructureDeleteConfirmation(options: Options) {
  // Electron cannot structured-clone Vue proxies. Keep the cached IPC batch and
  // impact confirmation raw while replacing the top-level value for updates.
  const pendingDelete = shallowRef<PendingLongStructureDelete | null>(null);
  const moveCharactersToTypeId = ref("");
  const characterTypeDeleteMode = ref<"move" | "cascade">("move");
  const submitting = ref(false);

  const deletingCharacterCount = computed(() =>
    pendingDelete.value?.kind === "characterType"
      ? (options.snapshot.value?.characters.filter(
          ({ group }) => group === pendingDelete.value?.id
        ).length ?? 0)
      : 0
  );
  const deletingLastCharacterType = computed(
    () =>
      pendingDelete.value?.kind === "characterType" &&
      (options.snapshot.value?.characterTypes.length ?? 0) <= 1
  );
  const characterTypeMoveOptions = computed(() =>
    (options.snapshot.value?.characterTypes ?? [])
      .filter(({ id }) => id !== pendingDelete.value?.id)
      .sort((left, right) => left.order - right.order)
      .map(({ id, title }) => ({ value: id, label: title }))
  );
  const pendingWorldbuildingDeleteDescription = computed(() => {
    const target = pendingDelete.value;
    if (target?.kind !== "worldbuilding") return "";
    if (target.previewPending)
      return t("checkingRelationshipsAndDeletionImpact");
    const category = options.snapshot.value?.worldbuilding.find(
      ({ id }) => id === target.id
    );
    if (!category) return t("thisCategoryNoLongerExists");
    if (category.format === "list" && category.items.length > 0) {
      return t("thisDeletionWillBeSavedLocallyImmediatelyAndWill", {
        length: category.items.length
      });
    }
    return t("thisCategoryHasNoDependentEntriesConfirmingWillDelete");
  });

  function reset(): void {
    pendingDelete.value = null;
    moveCharactersToTypeId.value = "";
    characterTypeDeleteMode.value = "move";
    submitting.value = false;
  }

  function openDelete(row: LongStructureDeleteRow): void {
    const snapshot = options.snapshot.value;
    if (!snapshot || options.locked()) return;
    if (
      row.readOnly ||
      (row.kind === "worldbuilding" &&
        isLongMigrationEvidenceCategoryId(row.id))
    ) {
      options.notify.info(t("migrationEvidenceIsReadOnlyAndCannotBeDeleted"));
      return;
    }
    moveCharactersToTypeId.value = "";
    characterTypeDeleteMode.value =
      row.kind === "characterType" && snapshot.characterTypes.length <= 1
        ? "cascade"
        : "move";
    pendingDelete.value = { ...row, previewPending: true };
    if (
      row.kind === "worldbuilding" ||
      !snapshot.characters.some(({ group }) => group === row.id) ||
      characterTypeDeleteMode.value === "cascade"
    ) {
      previewPendingDelete();
    }
  }

  function closeDelete(): void {
    if (options.locked() || submitting.value) return;
    reset();
  }

  function setMoveCharactersToTypeId(value: unknown): void {
    moveCharactersToTypeId.value = typeof value === "string" ? value : "";
    if (moveCharactersToTypeId.value) previewPendingDelete();
  }

  function setCharacterTypeDeleteMode(mode: "move" | "cascade"): void {
    const target = pendingDelete.value;
    if (
      !target ||
      target.kind !== "characterType" ||
      options.locked() ||
      submitting.value
    ) {
      return;
    }
    characterTypeDeleteMode.value = mode;
    moveCharactersToTypeId.value = "";
    const { batch: _batch, expectedImpact: _expectedImpact, ...row } = target;
    pendingDelete.value = { ...row, previewPending: true };
    if (mode === "cascade") previewPendingDelete();
  }

  function previewPendingDelete(): void {
    const target = pendingDelete.value;
    const snapshot = options.snapshot.value;
    if (!target || !snapshot) return;
    try {
      const builder = createLongStructureMutationBuilder(snapshot);
      const batch =
        target.kind === "characterType"
          ? builder.deleteCharacterType(
              target.id,
              characterTypeDeleteMode.value === "move"
                ? moveCharactersToTypeId.value || undefined
                : undefined
            )
          : builder.deleteWorldbuilding(target.id);
      const pending: PendingLongStructureDelete = {
        ...target,
        previewPending: false,
        batch,
        expectedImpact: previewLongWorkspaceOperations(snapshot, batch)
          .confirmation
      };
      pendingDelete.value = pending;
    } catch (error: unknown) {
      options.notify.warning(
        formatError(error, t("couldNotReadTheImpactOfDeletingThisStructure"))
      );
      reset();
    }
  }

  function confirmDelete(): void {
    const target = pendingDelete.value;
    if (
      !target ||
      target.previewPending ||
      !target.batch ||
      !target.expectedImpact ||
      submitting.value
    ) {
      return;
    }
    submitting.value = true;
    options.mutate(
      { ...target.batch, expectedImpact: target.expectedImpact },
      {
        succeed: reset,
        fail: (_message, changedImpact) => {
          submitting.value = false;
          if (!changedImpact || pendingDelete.value !== target) return;
          pendingDelete.value = {
            ...target,
            previewPending: false,
            expectedImpact: changedImpact
          };
        },
        appliedButRefreshFailed: reset
      }
    );
  }

  return {
    pendingDelete,
    moveCharactersToTypeId,
    characterTypeDeleteMode,
    submitting,
    deletingCharacterCount,
    deletingLastCharacterType,
    characterTypeMoveOptions,
    pendingWorldbuildingDeleteDescription,
    openDelete,
    closeDelete,
    setMoveCharactersToTypeId,
    setCharacterTypeDeleteMode,
    confirmDelete
  };
}
