import continuityTreeSource from "../utils/longWorkspaceContinuityTree.ts?raw";
import continuitySelectionSource from "../types/longContinuitySelection.ts?raw";
import {
  appSource,
  bindingsSource,
  conversationStoreSource,
  describe,
  editorSessionSource,
  editorSource,
  expect,
  it,
  lazyLongStructureTransactionsSource,
  legacySyncSource,
  longBookLifecycleSource,
  longStructureTransactionsSource,
  longWorkspaceDraftTreeSource,
  longWorkspaceModuleSource,
  longWorkspaceRefreshSource,
  longWorkspaceSessionSource,
  longWorkspaceStoreSource,
  longWorkspaceTypeSource,
  presentationCoordinatorSource,
  proposalRuntimeSource,
  removalSource,
  resourceTreeCoordinatorSource,
  sectionSource,
  structureSource,
  workspaceDialogLayerSource
} from "./LongWorkspace.test-support";

describe("long-form renderer vertical slice: bindings-and-structure", () => {
  it("keeps refresh and agent-run write barriers without revision or rollback state", () => {
    const editorLockSource =
      presentationCoordinatorSource
        .split("const longEditorLocked = computed(")[1]
        ?.split("const longEditorLockedReason = computed(")[0] ?? "";
    expect(editorLockSource).toContain(
      "options.long.refreshStatus.value?.pending"
    );
    expect(editorLockSource).toContain("acceptingWorkspaceIds.value.has");
    expect(presentationCoordinatorSource).toContain(
      "function agentRunScopeHasWriteBarrier(scope: string)"
    );
    expect(longWorkspaceRefreshSource).toContain(
      "createLongWorkspaceRefreshClock"
    );
    expect(longWorkspaceStoreSource).not.toContain("revisionRequirement");
    expect(longWorkspaceModuleSource).not.toContain("版本冲突");
  });

  it("provides a continuity review entry without replacing chapter authoring", () => {
    expect(longWorkspaceDraftTreeSource).toContain(
      "createLongChapterSelection"
    );
    expect(continuityTreeSource).toContain("createLongContinuitySelection");
    expect(continuityTreeSource).toContain('title: "待处理章节"');
    expect(continuitySelectionSource).toContain("没有候选时不生成伏笔记录");
    expect(continuitySelectionSource).toContain('root: "continuity_ledger"');
    expect(longWorkspaceTypeSource).toContain("chapterCardId: chapter.id");
    expect(longWorkspaceTypeSource).toContain("正文仍可继续修改");
    expect(editorSource).not.toContain("回滚最后提交");
    expect(editorSource).toContain(
      "本章已有连续性记录；记录仅供参考，不限制正文修改"
    );
    expect(editorSource).toContain("currentIsCommittedEditableDocument");
    expect(editorSource).toContain("章卡已有连续性记录；仍可编辑、移动或删除");
    expect(editorSource).toContain("删除时会同时清理该章正文与记录");
    expect(presentationCoordinatorSource).toContain(
      "chapter.commitId !== null ||"
    );
  });

  it("exposes selective legacy sync and isolated book removal", () => {
    expect(sectionSource).toContain('"choose-open-book"');
    expect(sectionSource).toContain('id: "choose-import-book"');
    expect(workspaceDialogLayerSource).toContain("<BookTransferDialog");
    expect(appSource).toContain(
      '@select-book-transfer="handleBookTransferSelect"'
    );
    expect(longBookLifecycleSource).toContain("api.importPortable()");
    expect(longBookLifecycleSource).toContain("api.chooseLegacySyncSource()");
    expect(longBookLifecycleSource).toContain("api.applyLegacySync({");
    expect(longBookLifecycleSource).not.toContain("api.exportPortable({");
    expect(longBookLifecycleSource).toContain(
      "state.activeBookId.value === bookId &&"
    );
    expect(workspaceDialogLayerSource).toContain("<LongLegacySyncDialog");
    expect(workspaceDialogLayerSource).toContain("<LongBookRemovalDialog");
    expect(appSource).toContain('@confirm-legacy-sync="confirmLegacySync"');
    expect(appSource).toContain(
      '@confirm-long-removal="confirmLongBookRemoval"'
    );
    expect(legacySyncSource).toContain("现有内容不会删除或覆盖");
    expect(removalSource).toContain("整个长篇项目文件夹");
    expect(appSource).toContain("stopBookAgentRuns: stopLongBookAgentRuns");
    expect(longBookLifecycleSource).toContain(
      "await workflow.stopBookAgentRuns(target.bookId)"
    );
    expect(proposalRuntimeSource).toContain(
      "context.conversations.remove(key, { clearPersistence: true })"
    );
    expect(conversationStoreSource).toContain("controller.dispose(");
    expect(conversationStoreSource).toContain(
      "{ clearPersistence: options.clearPersistence }"
    );
    expect(proposalRuntimeSource).toContain(
      "workspaceProposals.discardBook(bookId)"
    );
    expect(proposalRuntimeSource).toContain(
      "context.removeAgentRunPreferences(`long:${bookId}`)"
    );
    expect(appSource).toContain("longCatalogDiagnostics");
    expect(resourceTreeCoordinatorSource).toContain("不可用长篇 ·");
    expect(resourceTreeCoordinatorSource).toContain("unavailable: true");
    expect(sectionSource).toContain('id: "refresh-long-books"');
    expect(longWorkspaceSessionSource).toContain(
      "export interface LoadLongBookListOptions"
    );
    expect(longWorkspaceStoreSource).toContain(
      "requestBookListGeneration !== bookListGeneration"
    );
    expect(longBookLifecycleSource).toContain(
      "await catalog.loadBookList({ force: true })"
    );
    expect(longWorkspaceSessionSource).toContain("catalogRetryAttempts < 2");
  });

  it("updates long resource bindings through the isolated command", () => {
    expect(workspaceDialogLayerSource).toContain("<LongBookBindingsDialog");
    expect(appSource).toContain(
      '@submit-long-bindings="updateLongBookBindings"'
    );
    expect(longBookLifecycleSource).toContain("api.updateBindings({");
    expect(longBookLifecycleSource).not.toContain("expectedProjectRevision");
    expect(appSource).not.toContain("synchronizeProjectRevisions");
    expect(editorSessionSource).not.toContain("synchronizeProjectRevisions");
    expect(bindingsSource).toContain("<PopupSelect");
    expect(bindingsSource).toContain("create-short-binding-panel");
    expect(bindingsSource).toContain("create-short-kind-grid");
    expect(bindingsSource).toContain("生效阶段");
    expect(bindingsSource).toContain("<LongBindingStageScopes");
    expect(longBookLifecycleSource).toContain("linkedResourceStageScopes:");
    expect(bindingsSource).toContain("Catalog 中缺失");
    expect(bindingsSource).not.toContain('library.materialType === "long"');
    expect(bindingsSource).not.toContain('library.skillType === "long"');
    expect(bindingsSource).not.toContain("catalog.updateBook");
  });

  it("applies manual structure changes directly after an internal impact check", () => {
    expect(workspaceDialogLayerSource).toContain("<LongStructureDialog");
    expect(appSource).toContain("useLazyLongStructureTransactionsCoordinator");
    expect(appSource).not.toContain(
      'from "./composables/useLongStructureTransactionsCoordinator"'
    );
    expect(lazyLongStructureTransactionsSource).toContain(
      'const MIGRATION_EVIDENCE_CATEGORY_PREFIX = "world_migration-evidence-"'
    );
    expect(lazyLongStructureTransactionsSource).toContain(
      "({ id }) => !id.startsWith(MIGRATION_EVIDENCE_CATEGORY_PREFIX)"
    );
    expect(longStructureTransactionsSource).toContain(
      "async function handleLongStructureMutation("
    );
    expect(longStructureTransactionsSource).toContain(
      "async function handleLongWorldbuildingSync("
    );
    expect(longStructureTransactionsSource).toContain(
      "buildLongWorldbuildingSyncBatch"
    );
    expect(workspaceDialogLayerSource).toContain(
      "emit('syncLongWorldbuilding', payload, completion)"
    );
    expect(appSource).toContain(
      '@sync-long-worldbuilding="handleLongWorldbuildingSync"'
    );
    expect(longStructureTransactionsSource).toContain(
      "const impact = previewLongWorkspaceOperations("
    );
    expect(longStructureTransactionsSource).toContain(
      "const preview = await previewWithTimeout("
    );
    expect(longStructureTransactionsSource).toContain(
      "workspaceApi.previewOperations({"
    );
    expect(longStructureTransactionsSource).toContain(
      "const applyResult = await workspaceApi.applyOperations({"
    );
    expect(longStructureTransactionsSource).toContain(
      "preview.preview.confirmation"
    );
    expect(longStructureTransactionsSource).not.toContain(
      "longWorkspaceProposals.enqueueManualMutation({"
    );
    expect(structureSource).toContain(
      "completion: LongStructureMutationCompletion"
    );
    expect(structureSource).toContain("builder.createWorldbuilding");
    expect(structureSource).toContain("builder.updateWorldbuilding");
    expect(structureSource).toContain("加载其他书籍世界观");
    expect(structureSource).not.toContain("<LongPlotStructureManager");
    expect(structureSource).toContain('@click="openCreate"');
    expect(structureSource).toContain('@click="openEdit(row)"');
    expect(structureSource).toContain('@click="openDelete(row)"');
  });

  it("keeps every lazy long-structure mutation bound to its originating book and index", () => {
    const lazyMutationLoads = longStructureTransactionsSource.match(
      /await loadLongStructureMutationModule\(\)/g
    );
    expect(lazyMutationLoads).toHaveLength(12);

    const targetGuard = longStructureTransactionsSource.slice(
      longStructureTransactionsSource.indexOf(
        "function captureLongStructureMutationTarget("
      ),
      longStructureTransactionsSource.indexOf("function acquireMutation(")
    );
    expect(targetGuard).toContain("activeLongBookId.value !== expectedBookId");
    expect(targetGuard).toContain("summary?.id !== expectedBookId");
    expect(targetGuard).toContain("current.index !== target.index");
    expect(targetGuard).not.toContain("current.revision");

    const applyMutation = longStructureTransactionsSource.slice(
      longStructureTransactionsSource.indexOf(
        "async function executeLongStructureMutation("
      ),
      longStructureTransactionsSource.indexOf("function useLongWorkspaceApi(")
    );
    expect(applyMutation).toContain(
      "const expectedBookId = lease.target.bookId"
    );
    expect(applyMutation).toContain(
      "captureLongStructureMutationTarget(expectedBookId)"
    );
    expect(applyMutation).toContain("bookId: expectedBookId");

    const importGuard = applyMutation.indexOf(
      "assertCurrentLongStructureMutationTarget(latestTarget, lease)"
    );
    const preview = applyMutation.indexOf(
      "const preview = await previewWithTimeout("
    );
    const previewGuard = applyMutation.indexOf(
      "assertCurrentLongStructureMutationTarget(latestTarget, lease)",
      importGuard + 1
    );
    const previewValidation = applyMutation.indexOf(
      "preview.bookId !== expectedBookId"
    );
    const applyGuard = applyMutation.indexOf(
      "assertCurrentLongStructureMutationTarget(latestTarget, lease)",
      previewGuard + 1
    );
    const apply = applyMutation.indexOf(
      "const applyResult = await workspaceApi.applyOperations("
    );
    expect(importGuard).toBeGreaterThan(-1);
    expect(preview).toBeGreaterThan(importGuard);
    expect(previewGuard).toBeGreaterThan(preview);
    expect(previewValidation).toBeGreaterThan(previewGuard);
    expect(applyGuard).toBeGreaterThan(previewValidation);
    expect(apply).toBeGreaterThan(applyGuard);

    expect(longWorkspaceStoreSource).toContain("const volumeCreateTarget");
    expect(longWorkspaceStoreSource).toContain(
      "shallowRef<LongVolumeCreateTarget | null>(null)"
    );
    expect(longWorkspaceStoreSource).toContain('source: "book-line" | "draft"');
    expect(longStructureTransactionsSource).toContain(
      "longVolumeCreate.value !== target"
    );
    expect(longStructureTransactionsSource).toContain(
      "longPlotPointCreate.value !== target"
    );
    expect(longStructureTransactionsSource).toContain(
      "longChapterCardCreate.value !== target"
    );
    expect(longStructureTransactionsSource).toContain(
      "longCharacterCreate.value !== target"
    );
    expect(longStructureTransactionsSource).toContain(
      "longWorldbuildingItemCreate.value !== target"
    );
    expect(longStructureTransactionsSource).toContain(
      "() => longDraftSectionDelete.value === pending"
    );
  });
});
