import { describe, expect, it } from "vitest";
import { expectSourceToContain } from "../../test-utils/sourceText";
import appSource from "./App.vue?raw";
import source from "./WorkspaceShell.vue?raw";
import catalogLoaderSource from "./composables/useCatalogDocumentLoader.ts?raw";
import catalogProjectionSource from "./composables/useCatalogWorkspaceProjectionCoordinator.ts?raw";
import libraryTransactionsSource from "./composables/useCatalogLibraryTransactionsCoordinator.ts?raw";
import lifecycleSource from "./composables/useWorkspaceLifecycleCoordinator.ts?raw";
import layoutStoreSource from "./stores/layoutStore.ts?raw";
import lazyLongBookLifecycleSource from "./composables/useLazyLongBookLifecycleCoordinator.ts?raw";
import lazyLongStructureTransactionsSource from "./composables/useLazyLongStructureTransactionsCoordinator.ts?raw";
import lazyShortBookLifecycleSource from "./composables/useLazyShortBookLifecycleCoordinator.ts?raw";
import longBookLifecycleSource from "./composables/useLongBookLifecycleCoordinator.ts?raw";
import longStructureTransactionsSource from "./composables/useLongStructureTransactionsCoordinator.ts?raw";
import longStructureTransactionsSyncSource from "./composables/long-structure-transactions/sync.ts?raw";
import resourceSource from "./composables/useWorkspaceResourceCoordinator.ts?raw";
import resourceTreeSource from "./composables/useWorkspaceResourceTreeCoordinator.ts?raw";
import shortConversationSource from "./composables/useShortConversationCoordinator.ts?raw";
import shortBookLifecycleSource from "./composables/useShortBookLifecycleCoordinator.ts?raw";
import shortManuscriptExportTransactionSource from "./composables/short-manuscript-export-transaction.ts?raw";
import shortStructureSource from "./composables/useShortWorkspaceStructureCoordinator.ts?raw";
import dialogCoordinatorSource from "./composables/useWorkspaceDialogModuleCoordinator.ts?raw";
import { WORKSPACE_DIALOG_PRIORITY } from "./composables/useWorkspaceDialogModuleCoordinator";
import featureHostSource from "./composables/useWorkspaceFeatureHostCoordinator.ts?raw";
import shortManuscriptExportSource from "./utils/shortManuscriptExport.ts?raw";
import writingWorkspaceSource from "./components/WritingWorkspaceModule.vue?raw";
import catalogStoreSource from "./stores/catalogIndexStore.ts?raw";

describe("App performance boundaries", () => {
  it("keeps App as a small asynchronous assembly root", () => {
    expect(appSource.split("\n").length).toBeLessThanOrEqual(25);
    expect(appSource).toContain("defineAsyncComponent");
    expect(appSource).toContain('import("./WorkspaceShell.vue")');
    expect(appSource).not.toContain("useAgentConversation");
    expect(appSource).not.toContain("projectCatalogWorkspace");
  });

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
    expect(source).toContain("useWorkspaceResourceCoordinator");
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
    expect(source).not.toContain("function updateBookBindings(");
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
    expect(longBookLifecycleSource).toContain(
      "function confirmLongBookRemoval("
    );
    expect(shortBookLifecycleSource).toContain(
      "function exportBookManuscript("
    );
    expect(shortBookLifecycleSource).toContain("function updateBookBindings(");
    expect(shortBookLifecycleSource).toContain("function removeBook(");
  });

  it("keeps whole-book lifecycle behavior behind a lazy static boundary", () => {
    expect(source).toContain(
      'import { useLazyLongBookLifecycleCoordinator } from "./composables/useLazyLongBookLifecycleCoordinator";'
    );
    expect(source).toContain(
      'import { useLazyShortBookLifecycleCoordinator } from "./composables/useLazyShortBookLifecycleCoordinator";'
    );
    expect(source).not.toContain("useLazyLongRollbackCoordinator");
    expect(source).toContain(
      'import { useLazyLongStructureTransactionsCoordinator } from "./composables/useLazyLongStructureTransactionsCoordinator";'
    );
    expect(source).not.toContain(
      'from "./composables/useLongBookLifecycleCoordinator"'
    );
    expect(source).not.toContain(
      'from "./composables/useShortBookLifecycleCoordinator"'
    );
    expect(source).not.toContain("useLongRollbackCoordinator");
    expect(source).not.toContain(
      'from "./composables/useLongStructureTransactionsCoordinator"'
    );
    expect(source).not.toContain('from "./utils/shortManuscriptExport"');
    expect(lazyLongBookLifecycleSource).toContain(
      "import type {\n  LongBookBindingsUpdate,"
    );
    expect(lazyLongBookLifecycleSource).not.toContain(
      "import { useLongBookLifecycleCoordinator }"
    );
    expect(lazyLongBookLifecycleSource).toContain(
      'return import("./useLongBookLifecycleCoordinator")'
    );
    expect(lazyShortBookLifecycleSource).toContain(
      'from "./useShortBookLifecycleCoordinator"'
    );
    expect(lazyShortBookLifecycleSource).not.toContain(
      "import { useShortBookLifecycleCoordinator }"
    );
    expect(lazyShortBookLifecycleSource).toContain(
      'return import("./useShortBookLifecycleCoordinator")'
    );
    expect(lazyLongStructureTransactionsSource).toContain(
      'import type { LongWorldbuildingSyncBookOption } from "../utils/longWorldbuildingSync"'
    );
    expect(lazyLongStructureTransactionsSource).toContain(
      "import type {\n  LongStructureTransactionsCoordinator,"
    );
    expect(lazyLongStructureTransactionsSource).not.toContain(
      "import { useLongStructureTransactionsCoordinator }"
    );
    expect(lazyLongStructureTransactionsSource).toContain(
      'return import("./useLongStructureTransactionsCoordinator")'
    );
    expect(lazyLongStructureTransactionsSource).not.toContain(
      'from "../types/longStructureMutations"'
    );
    expect(longStructureTransactionsSource).toContain(
      'import("../types/longStructureMutations")'
    );
    expect(longStructureTransactionsSyncSource).toContain(
      'await import("../../utils/longWorldbuildingSync")'
    );
    expect(shortBookLifecycleSource).toContain(
      'from "./short-manuscript-export-transaction"'
    );
    expect(shortManuscriptExportTransactionSource).toContain(
      'from "../utils/shortManuscriptExport"'
    );
    expect(shortManuscriptExportSource).toContain(
      "export function createShortManuscriptExportInput("
    );
    expect(source).toContain(
      "const {\n  createLongBook,\n  openExistingLongBook,"
    );
    expect(source).toContain("async createInput(input) {");
    expectSourceToContain(source, 'import("./utils/longManuscriptExport"');
    expect(dialogCoordinatorSource).toContain(
      "book: options.shortLifecycle.activeBookTarget.value?.node ?? null"
    );
    expect(source).toContain("stopped.some((accepted) => !accepted)");
    expect(source).toContain("clearPersistence: options.clearPersistence");
    const cleanup = source.split("cleanupBeforeDraftRecovery: [")[1] ?? "";
    expect(cleanup.indexOf("disposeShortBookLifecycle")).toBeGreaterThan(
      cleanup.indexOf("disposeLazyApprovalNavigationCoordinator")
    );
    expect(
      cleanup.indexOf("disposeCatalogWorkspaceProjection")
    ).toBeGreaterThan(cleanup.indexOf("disposeLayout"));
    expect(cleanup.indexOf("disposeCatalogWorkspaceProjection")).toBeLessThan(
      cleanup.indexOf("disposeLazyApprovalNavigationCoordinator")
    );
    expect(cleanup.indexOf("disposeShortBookLifecycle")).toBeLessThan(
      cleanup.indexOf("disposeLongBookLifecycle")
    );
    expect(cleanup.indexOf("disposeLongBookLifecycle")).toBeLessThan(
      cleanup.indexOf("disposeShortConversation")
    );
    expect(cleanup.indexOf("disposeLongStructureTransactions")).toBeGreaterThan(
      cleanup.indexOf("disposeProposalCoordinator")
    );
    expect(cleanup.indexOf("disposeLongStructureTransactions")).toBeLessThan(
      cleanup.indexOf("disposeShortWorkspaceStructure")
    );
    expect(cleanup.indexOf("disposeLongStructureTransactions")).toBeLessThan(
      cleanup.indexOf("disposeWorkspaceResources")
    );
    expect(cleanup.indexOf("disposeLongStructureTransactions")).toBeLessThan(
      cleanup.indexOf("disposeLongWorkspaceSession")
    );
  });

  it("keeps large immutable catalog data shallow and reuses one projection", () => {
    expect(catalogStoreSource).toContain(
      "const snapshot = shallowRef<CatalogIndexSnapshot | null>(null)"
    );
    expect(catalogStoreSource).toContain(
      "const projection = shallowRef<CatalogWorkspaceProjection | null>(null)"
    );
    expect(catalogStoreSource).not.toContain("const projection = computed(");
    expect(catalogProjectionSource).toContain(
      "const projectedDocuments = pair.projection.index.workspaceDocumentById"
    );
    expect(catalogStoreSource).toContain("projection.value = nextProjection");
    expect(catalogStoreSource).toContain(
      "projectCatalogWorkspace(nextSnapshot)"
    );
  });

  it("indexes the visible tree and document collection for navigation", () => {
    expect(source).toContain(
      "const documentById = catalogDocumentLoader.documentsById"
    );
    expect(catalogLoaderSource).toContain("const documentsById = computed<");
    expect(resourceTreeSource).toContain(
      "createResourceTreeLookup(resourceTreeSections.value)"
    );
    expect(resourceSource).toContain(
      "tree.lookup.value.nodeById.get(resourceId)"
    );
    expect(resourceSource).toContain(
      "tree.lookup.value.resourceIdByDocumentId.get(documentId)"
    );
  });

  it("keeps high-frequency conversation refs below the three-pane boundary", () => {
    expect(source).toContain("conversationContext: writingConversationContext");
    expect(shortConversationSource).toContain(
      "const conversationContext = computed(() => {"
    );
    expect(source).toContain(
      "const writingEditorViewModel = computed(() => ({"
    );
    expect(layoutStoreSource).toContain(
      "const writingRightPaneViewModel = computed(() => ({"
    );
    expect(source).toContain(':conversation-controller="activeConversation"');
    expect(source).toContain(':editor="writingEditorViewModel"');
    expect(source).not.toContain("const writingWorkspaceViewModel");
    expect(source).not.toContain("const messages = computed(");
    expect(source).not.toContain("const composerDraft = computed(");
    expect(writingWorkspaceSource).toContain(
      ':messages="conversationController.messages.value"'
    );
    expect(writingWorkspaceSource).toContain(
      ':draft="conversationController.draft.value"'
    );
    const hotContext =
      shortConversationSource
        .split("const conversationContext = computed(() => {")[1]
        ?.split("let disposed = false")[0] ?? "";
    expect(hotContext).not.toContain("buildLibraryAttachments(");
    expect(hotContext).not.toContain("buildLibraryAgentWorkspaceContext(");
    expect(shortConversationSource).toContain(
      "const attachments = allAttachments"
    );
  });

  it("coalesces catalog reads and throttles noisy window-focus refreshes", () => {
    expect(catalogStoreSource).toContain("let snapshotLoadPromise:");
    expect(catalogStoreSource).toContain(
      "snapshotTrailingRefreshRequested = true"
    );
    expect(catalogStoreSource).toContain(
      "if (snapshotTrailingRefreshRequested)"
    );
    expect(catalogProjectionSource).toContain(
      "options.index.ensureSnapshot(() => api.index())"
    );
    expect(lifecycleSource).toContain("DEFAULT_FOCUS_REFRESH_INTERVAL_MS");
    expect(lifecycleSource).toContain("focusRefreshPromise");
    expect(lifecycleSource).toContain("trailingFocusRefreshRequested");
  });

  it("loads only Catalog metadata initially and fetches stamped bodies on demand", () => {
    expect(catalogProjectionSource).toContain("api.index()");
    expect(source).toContain("reader: () => window.deepwrite?.catalog");
    expect(catalogLoaderSource).toContain(
      "reader.readDocument(request.descriptor.input)"
    );
    expect(catalogLoaderSource).toContain("catalogDocumentReadDescriptor");
    expect(shortConversationSource).toContain(
      "await options.resource.ensureDocumentsLoaded("
    );
    expect(source).not.toContain('from "./utils/legacyDraftRecovery"');
    expect(catalogProjectionSource).toContain(
      'import("../utils/legacyDraftRecovery")'
    );
    expect(catalogProjectionSource).toContain(
      "const hasLegacyRecovery = hasDirtyLegacyDraftRecoveries("
    );
    expect(
      catalogProjectionSource.indexOf("if (hasLegacyRecovery)")
    ).toBeLessThan(catalogProjectionSource.indexOf("await api.snapshot()"));
    expect(
      catalogProjectionSource.indexOf("await api.snapshot()")
    ).toBeLessThan(
      catalogProjectionSource.indexOf("await loadLegacyRecoveryMigrator()")
    );
    expect(resourceSource).toContain(
      "catalog.projection.value !== next.reconciledProjection"
    );
  });
});
