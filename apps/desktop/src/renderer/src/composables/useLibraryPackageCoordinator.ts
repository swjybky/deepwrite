import { createScopedTranslator } from "../i18n";
import { getErrorCode, getErrorDetail } from "../i18n/errors";
import type {
  CatalogIndexSnapshot,
  DeepWriteApi,
  LibraryPackageImportChoices,
  LibraryPackagePreview,
  LibraryPackageSourceKind
} from "@deepwrite/contracts";
import { ref, shallowRef, type Ref, type ShallowRef } from "vue";
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

export interface LibraryPackageExportDialogState {
  domain: "material" | "skill";
  target: { type: "group" | "library"; id: string };
  title: string;
  memberCount?: number;
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
  const exportDialog = shallowRef<LibraryPackageExportDialogState | null>(null);
  const exporting = ref(false);

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

  function groupMemberIds(
    domain: LibraryPackageExportDialogState["domain"],
    id: string
  ): string[] | undefined {
    const snapshot = context.snapshot.value;
    const groups =
      domain === "material" ? snapshot?.materialGroups : snapshot?.skillGroups;
    return groups?.find((group) => group.id === id)?.memberIds;
  }

  function openExport(payload: CatalogResourceNodeActionPayload): void {
    if (exporting.value) return;
    if (!context.api()) {
      notifyUnavailable("export");
      return;
    }

    const { domain, node } = payload;
    const isGroup = payload.action === "export-group";
    const id = isGroup ? node.groupId : node.libraryId;
    if (!id) return;
    const members = isGroup ? groupMemberIds(domain, id) : undefined;
    exportDialog.value = {
      domain,
      target: { type: isGroup ? "group" : "library", id },
      title: node.label,
      ...(members ? { memberCount: new Set(members).size } : {})
    };
  }

  function closeExport(): void {
    if (!exporting.value) exportDialog.value = null;
  }

  async function submitExport(): Promise<void> {
    if (exporting.value || !exportDialog.value) return;
    const api = context.api();
    if (!api) {
      notifyUnavailable("export");
      return;
    }

    const { domain, target } = exportDialog.value;
    const ids =
      target.type === "library"
        ? [target.id]
        : groupMemberIds(domain, target.id);
    exporting.value = true;
    try {
      if (!(await context.prepareProjectsForExport(new Set(ids)))) return;
      const result = await api.exportPackage({ domain, target });
      if (result.status === "cancelled") return;
      exportDialog.value = null;
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
      exporting.value = false;
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
    exportDialog,
    exporting,
    openExport,
    closeExport,
    submitExport,
    openImport,
    closeImport,
    restartImport,
    chooseSource,
    submitImport
  };
}
