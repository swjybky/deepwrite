import { createScopedTranslator } from "../i18n";
import { getErrorCode, getErrorDetail } from "../i18n/errors";
import type {
  CatalogIndexSnapshot,
  DeepWriteApi,
  LibraryPackageImportChoices,
  LibraryPackagePreview,
  LibraryPackageSourceKind
} from "@deepwrite/contracts";
import { ref, type Ref, type ShallowRef } from "vue";
import type {
  CatalogResourceNodeActionPayload,
  WorkspaceDocument
} from "../types/workspace";

const t = createScopedTranslator("workspace.libraryPackageCoordinator");

export interface LibraryPackageImportDialogState {
  /** The section the import started from; a package may belong elsewhere. */
  domain: "material" | "skill";
  previewId?: string;
  preview?: LibraryPackagePreview;
}

interface LibraryPackageContext {
  api(): DeepWriteApi["libraryPackage"] | undefined;
  isDesktop(): boolean;
  snapshot: Readonly<Ref<CatalogIndexSnapshot | null>>;
  documents: ShallowRef<WorkspaceDocument[]>;
  mutationPending: Ref<boolean>;
  prepareProjectsForExport(libraryIds: ReadonlySet<string>): Promise<boolean>;
  refreshCatalog(): Promise<boolean>;
  refreshWorkspaceDirectory(): Promise<void>;
  navigateToDocumentResource(documentId: string): Promise<void>;
  notifications: {
    error(message: string): void;
    success(message: string): void;
    warning(message: string): void;
  };
}

function withReason(headline: string, error: unknown): string {
  const detail = getErrorDetail(error);
  return detail
    ? t("headlineWithReason", { headline, reason: detail })
    : headline;
}

/** Export of one library or group, and the two-step package import dialog. */
export function useLibraryPackageCoordinator(context: LibraryPackageContext) {
  const notify = context.notifications;
  const importDialog = ref<LibraryPackageImportDialogState | null>(null);
  const choosing = ref(false);
  const importing = ref(false);
  let exporting = false;

  function notifyUnavailable(operation: "export" | "import"): void {
    notify.warning(
      context.isDesktop()
        ? t("desktopNeedsRestart")
        : t(
            operation === "export"
              ? "browserPreviewCannotExport"
              : "browserPreviewCannotImport"
          )
    );
  }

  function exportedLibraryIds(
    payload: CatalogResourceNodeActionPayload
  ): Set<string> {
    if (payload.action === "export-library") {
      return new Set(payload.node.libraryId ? [payload.node.libraryId] : []);
    }
    const snapshot = context.snapshot.value;
    const group =
      payload.domain === "material"
        ? snapshot?.materialGroups.find(({ id }) => id === payload.node.groupId)
        : snapshot?.skillGroups.find(({ id }) => id === payload.node.groupId);
    return new Set(
      Object.values(group?.members ?? {}).filter((id): id is string => !!id)
    );
  }

  async function exportPackage(
    payload: CatalogResourceNodeActionPayload
  ): Promise<void> {
    const api = context.api();
    if (!api) {
      notifyUnavailable("export");
      return;
    }
    const isGroup = payload.action === "export-group";
    const id = isGroup ? payload.node.groupId : payload.node.libraryId;
    if (!id || exporting) return;
    exporting = true;
    try {
      if (
        !(await context.prepareProjectsForExport(exportedLibraryIds(payload)))
      )
        return;
      const result = await api.exportPackage({
        domain: payload.domain,
        target: { type: isGroup ? "group" : "library", id }
      });
      if (result.status === "cancelled") return;
      notify.success(
        result.skippedLibraryCount > 0
          ? t("exportedToWithSkipped", {
              path: result.filePath,
              count: result.skippedLibraryCount
            })
          : t("exportedTo", { path: result.filePath })
      );
    } catch (error: unknown) {
      notify.error(withReason(t("exportFailed"), error));
    } finally {
      exporting = false;
    }
  }

  function discardPreview(state: LibraryPackageImportDialogState | null): void {
    if (state?.previewId) {
      void context.api()?.discardPreview({ previewId: state.previewId });
    }
  }

  function openImport(domain: "material" | "skill"): void {
    if (!context.api()) {
      notifyUnavailable("import");
      return;
    }
    importDialog.value = { domain };
  }

  function closeImport(): void {
    if (importing.value) return;
    discardPreview(importDialog.value);
    importDialog.value = null;
  }

  function restartImport(): void {
    const state = importDialog.value;
    if (!state || importing.value) return;
    discardPreview(state);
    importDialog.value = { domain: state.domain };
  }

  async function chooseSource(
    sourceKind: LibraryPackageSourceKind
  ): Promise<void> {
    const api = context.api();
    const state = importDialog.value;
    if (!api || !state || choosing.value) return;
    choosing.value = true;
    try {
      const chosen = await api.chooseSource({
        domain: state.domain,
        sourceKind
      });
      if (!chosen || importDialog.value !== state) return;
      importDialog.value = {
        domain: state.domain,
        previewId: chosen.previewId,
        preview: chosen.preview
      };
    } catch (error: unknown) {
      notify.error(withReason(t("recognitionFailed"), error));
    } finally {
      choosing.value = false;
    }
  }

  async function submitImport(
    choices: LibraryPackageImportChoices
  ): Promise<void> {
    const api = context.api();
    const state = importDialog.value;
    if (
      !api ||
      !state?.previewId ||
      importing.value ||
      context.mutationPending.value
    ) {
      return;
    }
    importing.value = true;
    context.mutationPending.value = true;
    try {
      const result = await api.importPackage({
        previewId: state.previewId,
        choices
      });
      importDialog.value = null;
      await context.refreshWorkspaceDirectory();
      await context.refreshCatalog();
      const target = context.documents.value.find(
        (document) => document.libraryId === result.libraryIds[0]
      );
      if (target) await context.navigateToDocumentResource(target.id);
      notify.success(
        t("imported", {
          libraries: result.libraryIds.length,
          entries: result.entryCount
        })
      );
    } catch (error: unknown) {
      if (getErrorCode(error) === "catalog.package_source_changed") {
        importDialog.value = { domain: state.domain };
        notify.warning(t("sourceChanged"));
      } else {
        notify.error(withReason(t("importFailed"), error));
      }
    } finally {
      importing.value = false;
      context.mutationPending.value = false;
    }
  }

  return {
    importDialog,
    choosing,
    importing,
    exportPackage,
    openImport,
    closeImport,
    restartImport,
    chooseSource,
    submitImport
  };
}
