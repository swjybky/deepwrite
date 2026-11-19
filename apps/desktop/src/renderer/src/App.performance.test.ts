import { describe, expect, it } from "vitest";
import source from "./WorkspaceShell.vue?raw";
import libraryTransactionsSource from "./composables/useCatalogLibraryTransactionsCoordinator.ts?raw";
import longBookLifecycleSource from "./composables/useLongBookLifecycleCoordinator.ts?raw";
import longManuscriptExportFlowSource from "./composables/useLongManuscriptExportFlow.ts?raw";
import longStructureTransactionsSyncSource from "./composables/long-structure-transactions/sync.ts?raw";
import resourceNavigationSource from "./composables/useWorkspaceResourceNavigation.ts?raw";
import shortBookLifecycleSource from "./composables/useShortBookLifecycleCoordinator.ts?raw";
import shortStructureSource from "./composables/useShortWorkspaceStructureCoordinator.ts?raw";
import { WORKSPACE_DIALOG_PRIORITY } from "./composables/useWorkspaceDialogModuleCoordinator";
import featureHostSource from "./composables/useWorkspaceFeatureHostCoordinator.ts?raw";

describe("App performance boundaries", () => {
  it("keeps the workspace shell below its orchestration budget", () => {
    expect(source.split("\n").length).toBeLessThanOrEqual(2_800);
    expect(source).toContain("useLongWorkspaceSessionCoordinator");
    expect(source).toContain("useLazyLongStructureTransactionsCoordinator");
    expect(source).toContain("useLongProposalRuntimeCoordinator");
    expect(source).toContain("useLazyLongBookLifecycleCoordinator");
    expect(source).not.toContain("useLazyLongRollbackCoordinator");
    expect(source).toContain("useCatalogLibraryTransactionsCoordinator");
    expect(source).toContain("useCatalogDocumentPersistence");
    expect(source).toContain("useCatalogWorkspaceProjectionCoordinator");
    expect(source).toContain("useWorkspaceResourceNavigation");
    expect(resourceNavigationSource).toContain(
      "useWorkspaceResourceCoordinator(options)"
    );
    expect(source).toContain("useWorkspaceResourceTreeCoordinator");
    expect(source).toContain("useShortConversationCoordinator");
    expect(source).toContain("useShortWorkspaceStructureCoordinator");
    expect(source).toContain("useLazyShortBookLifecycleCoordinator");
    expect(source).toContain("useWorkspaceDialogModuleCoordinator");
    expect(source).toContain("useWorkspaceFeatureHostCoordinator");
    expect(source).toContain(
      "const workspaceDialogModule = useWorkspaceDialogModuleCoordinator({"
    );
    expect(source).not.toContain("computed<WorkspaceDialogModule | null>");
    expect(source).not.toContain("computed<WorkspaceFeatureModule | null>");
    expect(featureHostSource).toContain(
      "const workspaceFeatureModule = computed"
    );
    for (const kind of WORKSPACE_DIALOG_PRIORITY) {
      expect(source).not.toContain(`kind: "${kind}"`);
    }
    expect(source).not.toContain("async function saveCatalogDocument(");
    expect(source).not.toContain("async function refreshActiveLongWorkspace(");
    expect(source).not.toContain("async function createCatalogLibrary(");
    expect(source).not.toContain("async function mutatePlotStructure(");
    expect(source).not.toContain("async function confirmCreateExpertSection(");
    expect(source).not.toContain(
      "async function executeLongStructureMutation("
    );
    expect(source).not.toContain("async function createLongBook(");
    expect(source).not.toContain("async function handleLongBookAction(");
    expect(source).not.toContain("async function exportLongBookManuscript(");
    expect(source).not.toContain("async function confirmLongBookRemoval(");
    expect(source).not.toContain("async function exportBookManuscript(");
    expect(source).not.toContain("function removeBook(");
    expect(source).not.toContain("function openLongRollbackDialog(");
    expect(source).not.toContain("function closeLongRollbackDialog(");
    expect(source).not.toContain("function confirmLongRollback(");
    expect(source).not.toContain("function applyCatalogSnapshot(");
    expect(source).not.toContain("function loadCatalogSnapshot(");
    expect(libraryTransactionsSource).toContain(
      "async function createCatalogLibrary("
    );
    expect(shortStructureSource).toContain(
      "async function mutatePlotStructure("
    );
    expect(shortStructureSource).toContain(
      "async function confirmCreateExpertSection("
    );
    expect(longStructureTransactionsSyncSource).toContain(
      "async function executeLongStructureMutation("
    );
    expect(longBookLifecycleSource).toContain("function createLongBook(");
    expect(longBookLifecycleSource).toContain("function handleLongBookAction(");
    expect(longBookLifecycleSource).toContain(
      "function exportLongBookManuscript("
    );
    expect(longBookLifecycleSource).toContain("createLongManuscriptExportFlow");
    expect(longManuscriptExportFlowSource).toContain(
      "function exportLongBookManuscript("
    );
    expect(longBookLifecycleSource).toContain(
      "function confirmLongBookRemoval("
    );
    expect(shortBookLifecycleSource).toContain(
      "function exportBookManuscript("
    );
    expect(shortBookLifecycleSource).toContain("function removeBook(");
  });
});
