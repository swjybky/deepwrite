import { computed, ref } from "vue";
import { formatBytes } from "@deepwrite/shared";
import type {
  DeepWriteApi,
  LocalBackupConflictPolicy,
  LocalBackupExportResult,
  LocalBackupImportPreview,
  LocalBackupImportResult,
  LocalBackupInventoryItem,
  LocalBackupInventorySnapshot
} from "@deepwrite/contracts";
import { createScopedTranslator } from "../i18n";
import { formatError, getErrorCode } from "../i18n/errors";
import type { UiConfirmRequest } from "../ui-confirm";

type LocalBackupApi = NonNullable<DeepWriteApi["localBackup"]>;

export interface UseLocalBackupOptions {
  api: () => LocalBackupApi | undefined;
  notifications: {
    error(message: string): unknown;
    success(message: string): unknown;
  };
  confirm: (request: UiConfirmRequest) => Promise<boolean>;
  onImported?: () => void;
}

export function useLocalBackup(options: UseLocalBackupOptions) {
  const t = createScopedTranslator("components.storageSettingsPanel");

  const inventory = ref<LocalBackupInventorySnapshot | null>(null);
  const loadingInventory = ref(false);
  const exportDialogOpen = ref(false);
  const selectedExportKeys = ref<string[]>([]);
  const exporting = ref(false);
  const lastExportResult = ref<LocalBackupExportResult | null>(null);

  const importPreview = ref<LocalBackupImportPreview | null>(null);
  const choosingImport = ref(false);
  const selectedImportKeys = ref<string[]>([]);
  const conflictPolicy = ref<LocalBackupConflictPolicy>("keep_both");
  const importing = ref(false);
  const lastImportResult = ref<LocalBackupImportResult | null>(null);

  const busy = computed(
    () =>
      loadingInventory.value ||
      exporting.value ||
      choosingImport.value ||
      importing.value
  );

  const itemsByKey = computed(
    () =>
      new Map((inventory.value?.items ?? []).map((item) => [item.key, item]))
  );
  const itemsById = computed(() => {
    const map = new Map<string, LocalBackupInventoryItem>();
    for (const item of inventory.value?.items ?? []) {
      map.set(item.id, item);
    }
    return map;
  });

  const exportGroups = computed(() => {
    const all = inventory.value?.items ?? [];
    return {
      works: all.filter(
        (item) =>
          item.kind === "book" ||
          item.kind === "long-book" ||
          item.kind === "mystery-book"
      ),
      materials: all.filter(
        (item) =>
          item.kind === "material-library" || item.kind === "material-group"
      ),
      skills: all.filter(
        (item) => item.kind === "skill-library" || item.kind === "skill-group"
      )
    };
  });

  const selectedExportBytes = computed(() => {
    let total = 0;
    for (const key of selectedExportKeys.value) {
      total += itemsByKey.value.get(key)?.sizeBytes ?? 0;
    }
    return total;
  });

  const missingLinkedTitles = computed(() => {
    const selectedSet = new Set(selectedExportKeys.value);
    const missing = new Set<string>();
    for (const key of selectedExportKeys.value) {
      const item = itemsByKey.value.get(key);
      if (!item) continue;
      for (const libId of [...item.linkedMaterialIds, ...item.linkedSkillIds]) {
        const linked = itemsById.value.get(libId);
        if (linked && !selectedSet.has(linked.key)) {
          missing.add(linked.title);
        }
      }
      for (const memberId of item.memberIds ?? []) {
        const member = itemsById.value.get(memberId);
        if (member && !selectedSet.has(member.key)) {
          missing.add(member.title);
        }
      }
    }
    return [...missing];
  });

  const selectedImportConflicts = computed(() => {
    const preview = importPreview.value;
    if (!preview) return 0;
    const selectedSet = new Set(selectedImportKeys.value);
    return preview.items.filter(
      (item) => item.status === "conflict_same_id" && selectedSet.has(item.key)
    ).length;
  });

  const selectableImportKeys = computed(() =>
    (importPreview.value?.items ?? [])
      .filter(
        (item) => item.status === "new" || item.status === "conflict_same_id"
      )
      .map((item) => item.key)
  );

  const isReplaceDanger = computed(
    () =>
      conflictPolicy.value === "replace" && selectedImportConflicts.value > 0
  );

  function setGroupExportSelection(keys: readonly string[], checked: boolean) {
    const groupSet = new Set(keys);
    selectedExportKeys.value = checked
      ? [...new Set([...selectedExportKeys.value, ...keys])]
      : selectedExportKeys.value.filter((key) => !groupSet.has(key));
  }

  function dependencyLabelsFor(item: LocalBackupInventoryItem): string[] {
    const ids = [
      ...item.linkedMaterialIds,
      ...item.linkedSkillIds,
      ...(item.memberIds ?? [])
    ];
    const titles: string[] = [];
    for (const id of ids) {
      const found = itemsById.value.get(id);
      if (found) titles.push(found.title);
    }
    return titles;
  }

  async function openExportDialog(): Promise<void> {
    const api = options.api();
    if (!api || busy.value) return;
    exportDialogOpen.value = true;
    loadingInventory.value = true;
    try {
      const snapshot = await api.getInventory();
      inventory.value = snapshot;
      selectedExportKeys.value = snapshot.items.map((item) => item.key);
    } catch (error) {
      exportDialogOpen.value = false;
      options.notifications.error(formatError(error, t("loadFailed")));
    } finally {
      loadingInventory.value = false;
    }
  }

  function closeExportDialog(): void {
    if (exporting.value) return;
    exportDialogOpen.value = false;
  }

  async function submitExport(): Promise<void> {
    const api = options.api();
    if (!api || exporting.value || selectedExportKeys.value.length === 0) {
      return;
    }
    exporting.value = true;
    try {
      const result = await api.exportPackage({
        selectedKeys: [...selectedExportKeys.value]
      });
      if (!result) return;
      lastExportResult.value = result;
      exportDialogOpen.value = false;
      options.notifications.success(
        t("exportSuccess", {
          count: String(result.itemCount),
          size: formatBytes(result.archiveBytes)
        })
      );
    } catch (error) {
      options.notifications.error(formatError(error, t("errFailed")));
    } finally {
      exporting.value = false;
    }
  }

  async function cancelExport(): Promise<void> {
    const api = options.api();
    if (!api || !exporting.value) return;
    try {
      await api.cancelExport();
    } catch (error) {
      options.notifications.error(formatError(error, t("errFailed")));
    }
  }

  async function openExportFolder(): Promise<void> {
    const api = options.api();
    const target = lastExportResult.value?.filePath;
    if (!api || !target) return;
    try {
      await api.openExportFolder(target);
    } catch (error) {
      options.notifications.error(formatError(error, t("errFailed")));
    }
  }

  async function chooseImportPackage(): Promise<void> {
    const api = options.api();
    if (!api || busy.value) return;
    choosingImport.value = true;
    try {
      const preview = await api.chooseImportPackage();
      if (!preview) return;
      importPreview.value = preview;
      conflictPolicy.value = "keep_both";
      selectedImportKeys.value = preview.items
        .filter(
          (item) => item.status === "new" || item.status === "conflict_same_id"
        )
        .map((item) => item.key);
    } catch (error) {
      options.notifications.error(formatError(error, t("errFailed")));
    } finally {
      choosingImport.value = false;
    }
  }

  function closeImportDialog(): void {
    if (importing.value) return;
    const current = importPreview.value;
    importPreview.value = null;
    if (current) {
      void options.api()?.discardImportPreview(current.previewId);
    }
  }

  async function submitImport(): Promise<void> {
    const api = options.api();
    const preview = importPreview.value;
    if (
      !api ||
      !preview ||
      importing.value ||
      !preview.diskSpaceSufficient ||
      selectedImportKeys.value.length === 0
    ) {
      return;
    }

    if (isReplaceDanger.value) {
      const confirmed = await options.confirm({
        message: t("replaceConfirmBody", {
          count: String(selectedImportConflicts.value)
        }),
        confirmLabel: t("replaceConfirmBtn"),
        danger: true
      });
      if (!confirmed) return;
    }

    importing.value = true;
    try {
      const result = await api.applyImport({
        previewId: preview.previewId,
        selectedKeys: [...selectedImportKeys.value],
        conflictPolicy: conflictPolicy.value,
        ...(isReplaceDanger.value ? { confirmReplace: true } : {})
      });
      importPreview.value = null;
      lastImportResult.value = result;
      options.notifications.success(
        t("importDone", {
          added: String(result.added),
          dup: String(result.duplicated),
          rep: String(result.replaced),
          skip: String(result.skipped),
          dangling: String(result.danglingBindingsRemoved)
        })
      );
      options.onImported?.();
    } catch (error) {
      const code = getErrorCode(error);
      if (
        code === "local_backup.preview_expired" ||
        code === "local_backup.target_changed"
      ) {
        importPreview.value = null;
      }
      options.notifications.error(formatError(error, t("errFailed")));
    } finally {
      importing.value = false;
    }
  }

  return {
    inventory,
    loadingInventory,
    exportDialogOpen,
    selectedExportKeys,
    exporting,
    lastExportResult,
    importPreview,
    choosingImport,
    selectedImportKeys,
    conflictPolicy,
    importing,
    lastImportResult,
    busy,
    exportGroups,
    selectedExportBytes,
    missingLinkedTitles,
    selectedImportConflicts,
    selectableImportKeys,
    isReplaceDanger,
    setGroupExportSelection,
    dependencyLabelsFor,
    openExportDialog,
    closeExportDialog,
    submitExport,
    cancelExport,
    openExportFolder,
    chooseImportPackage,
    closeImportDialog,
    submitImport
  };
}
