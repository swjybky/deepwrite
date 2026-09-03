import {
  agentConversationSource,
  agentRunPreferencesSource,
  appSource,
  describe,
  dialogCoordinatorSource,
  editorSource,
  expect,
  it,
  leftSidebarSource,
  longConversationSource,
  longStructureTransactionsSource,
  longWorkspaceModuleSource,
  longWorkspaceRefreshSource,
  longWorkspaceResourceTreeSource,
  presentationCoordinatorSource,
  proposalRuntimeSource,
  proposalSource,
  resourceTreeCoordinatorSource,
  sectionSource,
  treeNodeSource,
  workspaceDialogLayerSource,
  workspaceSystemEventRoutesSource,
  workspaceTypeSource
} from "./LongWorkspace.test-support";

describe("long-form renderer vertical slice: agents-writing-and-navigation", () => {
  it("projects long-form navigation into the same recursive tree used by short books", () => {
    expect(longWorkspaceResourceTreeSource).toContain(
      "function projectLongWorkspaceNavigation("
    );
    expect(longWorkspaceResourceTreeSource).toContain(
      "longWorkspaceSelection: selection"
    );
    expect(resourceTreeCoordinatorSource).toContain(
      "children: projectLongWorkspaceNavigation(book, workspaceIndex)"
    );
    expect(longWorkspaceResourceTreeSource).toContain(
      "reconcileLongWorkspaceSelection(book, index, selection)"
    );
    expect(longWorkspaceResourceTreeSource).toContain(
      "[...book.navigation.worldbuilding]"
    );
    expect(
      longWorkspaceResourceTreeSource.indexOf(
        "[...book.navigation.worldbuilding]"
      )
    ).toBeLessThan(
      longWorkspaceResourceTreeSource.indexOf("...(worldRevealSelection")
    );
    expect(resourceTreeCoordinatorSource).toContain("selectableBranch: true");
    expect(resourceTreeCoordinatorSource).toContain('badge: "长篇"');
    expect(resourceTreeCoordinatorSource).not.toContain(
      "badge: `长篇 · ${book.genre}`"
    );
    expect(longStructureTransactionsSource).toContain(
      "node.longWorkspaceSelection"
    );
    expect(leftSidebarSource).toContain("<SidebarResourceList");
    expect(leftSidebarSource).not.toContain('<slot name="long-workspace" />');
    expect(treeNodeSource).toContain("<TreeNodeItem");
    expect(treeNodeSource).toContain(':depth="depth + 1"');
    for (const label of [
      "世界观",
      "人物设计",
      "剧情设计",
      "正文",
      "连续性账本"
    ]) {
      expect(longWorkspaceResourceTreeSource).toContain(label);
    }
    expect(longWorkspaceModuleSource).toContain('class="long-agent-column"');
    expect(longWorkspaceModuleSource).toContain(
      'class="pane-resizer pane-resizer-right"'
    );
    expect(appSource).toContain(':left-collapsed="leftCollapsed"');
    expect(appSource).toContain(':right-pane="writingRightPaneViewModel"');
    expect(appSource).toContain(
      '@toggle-left="leftCollapsed = !leftCollapsed"'
    );
    expect(appSource).toContain(
      '@toggle-right="rightCollapsed = !rightCollapsed"'
    );
    expect(appSource).toContain(
      "@resize-start=\"startPaneResize('right', $event)\""
    );
    expect(longWorkspaceModuleSource).toContain(
      "paneLayout === 'editor-agent' || !rightPane.collapsed"
    );
  });

  it("wires left-tree collection actions through the existing structure pipeline", () => {
    expect(workspaceTypeSource).toContain("longTreeCollection?:");
    expect(workspaceTypeSource).toContain("longTreeItem?:");
    for (const kind of [
      "worldbuilding-item",
      "character",
      "volume",
      "plot-point",
      "chapter-card"
    ]) {
      expect(workspaceTypeSource).toContain(`"${kind}"`);
    }
    expect(leftSidebarSource).toContain("createLongTreeItem");
    expect(leftSidebarSource).toContain("longTreeItemAction");
    expect(sectionSource).toContain("createLongTreeItem");
    expect(sectionSource).toContain("longTreeItemAction");
    expect(appSource).toContain(
      '@create-long-tree-item="handleCreateLongTreeItem"'
    );
    expect(appSource).toContain(
      '@long-tree-item-action="handleLongTreeItemAction"'
    );
    expect(longStructureTransactionsSource).toContain(
      "openLongWorldbuildingItemCreateForCategoryInternal"
    );
    expect(longStructureTransactionsSource).toContain(
      "builder.reorderWorldbuildingItem("
    );
    expect(longStructureTransactionsSource).toContain(
      "builder.deleteWorldbuildingItem("
    );
    expect(longStructureTransactionsSource).toContain(
      "details.orderedIds[currentIndex + 1] ??\n          details.orderedIds[currentIndex - 1]"
    );
    expect(longStructureTransactionsSource).toContain(
      "details.parentResourceId"
    );
    expect(longStructureTransactionsSource).toContain(
      "selectCreatedLongTreeResource("
    );
    expect(longStructureTransactionsSource).toContain(
      "captureNavigationSelection()"
    );
    expect(resourceTreeCoordinatorSource).toContain(
      "synchronizeSelectedLongResourceForLayout("
    );
    expect(appSource).toContain(
      ':long-tree-actions-disabled="longBookActionPending"'
    );
    expect(dialogCoordinatorSource).toContain("itemLabel: treeDeletion.label");
    expect(workspaceDialogLayerSource).toContain(
      ':item-label="module.itemLabel"'
    );
  });

  it("uses dedicated long agent context and approval surfaces", () => {
    expect(presentationCoordinatorSource).toContain(
      "const activeLongRuntimeContext"
    );
    expect(appSource).toContain(
      "activeRuntimeContext: activeLongRuntimeContext"
    );
    expect(appSource).not.toContain(
      "const activeLongRuntimeContext = computed"
    );
    expect(longConversationSource).toContain(
      "target.conversation.sendLongMessage("
    );
    expect(longConversationSource).toContain(
      "options.catalog.buildAttachments("
    );
    expect(longConversationSource).toContain(
      "options.catalog.filterReadableAttachments("
    );
    expect(longConversationSource).toContain("profile.readAccess.skillKinds");
    expect(longConversationSource).toContain(
      "profile.readAccess.materialKinds"
    );
    expect(appSource).not.toContain("<LongProposalReview");
    expect(agentConversationSource).toContain("<LongProposalReview");
    expect(agentConversationSource).toContain("embedded");
    expect(longWorkspaceModuleSource).toContain(
      ':long-proposal-items="proposalItems"'
    );
    expect(appSource).toContain('@review-edit="reviewLongAgentEdit"');
    expect(proposalSource).toContain("long.mutation_proposal");
    expect(proposalSource).not.toContain("long.chapter_write_proposal");
    expect(appSource).toContain("stageLongDraftEditProposal,");
    expect(workspaceSystemEventRoutesSource).toContain(
      "dependencies.stageLongDraftEditProposal(event);"
    );
    expect(proposalSource).toContain("long.ledger_commit_proposal");
    expect(proposalSource).toContain("查看具体影响");
    expect(proposalSource).toContain("删除实体");
    expect(proposalSource).toContain("实体完整前后快照");
    expect(proposalSource).toContain("snapshotText(change.before)");
    expect(proposalSource).toContain("snapshotText(change.after)");
    expect(proposalSource).not.toContain(".slice(0, 80)");
    expect(proposalSource).toContain("long.continuity_file_proposal");
    expect(proposalSource).not.toContain("查看提交内容");
    expect(proposalSource).not.toContain("本章六类连续性摘要");
    expect(proposalSource).toContain('item.approvalMode === "auto-approve"');
    expect(proposalSource).toContain("自动保存中");
    expect(proposalRuntimeSource).toContain(
      "approvalModeForEvent: proposalApprovalMode"
    );
    expect(proposalRuntimeSource).toContain(
      "prepareAutoApprove: prepareAutomaticProposal"
    );
    const approvalModeResolver =
      proposalRuntimeSource
        .split("function proposalApprovalMode(")[1]
        ?.split("async function refreshWorkspaceAfterProposal")[0] ?? "";
    expect(approvalModeResolver).toContain(
      "conversationForProposalEvent(event)?.approvalModeForRun("
    );
    expect(approvalModeResolver).not.toContain("continuity_ledger");
    expect(appSource).not.toContain("function longAgentRunApprovalMode(");
    expect(longConversationSource).toContain(
      "target.conversation.selectApprovalMode(target.approvalMode);"
    );
    expect(appSource).toContain(
      "permissionMode: () => generalSettings.value.permissionMode"
    );
    expect(editorSource).not.toContain("LongLedgerCommitRecordSchema");
    expect(editorSource).not.toContain("本章连续性摘要");
    expect(editorSource).not.toContain("伏笔线状态推导");
    expect(editorSource).not.toContain("查看原始审计记录");
    expect(proposalSource).not.toContain("workspace.editor_mutation");
  });

  it("keeps saves ordered and pauses long-agent sends while refreshing", () => {
    expect(longWorkspaceRefreshSource).toContain(
      "createLongWorkspaceRefreshClock()"
    );
    expect(longWorkspaceRefreshSource).toContain(
      "isCurrent(bookId, requestId)"
    );
    expect(appSource).toContain("activeLongWorkspaceContextReady");
    expect(longWorkspaceRefreshSource).toContain(
      "state.refreshStatus.value = {"
    );
    expect(appSource).toContain("retryActiveLongWorkspaceRefresh");
    expect(longWorkspaceModuleSource).toContain("长篇智能体已暂停发送");
    expect(longWorkspaceModuleSource).toContain('v-if="refreshStatus?.error"');
    expect(appSource).not.toContain(
      'activeLongWorkspaceRefreshStatus.pending\n                    ? "正在同步保存后的最新工作区索引…"'
    );
    const sendLongMessageSource =
      longConversationSource
        .split("function sendLongMessage(")[1]
        ?.split("function synchronizeActiveRunPreferences")[0] ?? "";
    expect(sendLongMessageSource).toContain("await nextTick()");
    expect(
      sendLongMessageSource.match(/confirmSendTarget\(target\)/gu)?.length
    ).toBeGreaterThanOrEqual(4);
    expect(
      sendLongMessageSource.indexOf("saveActiveEditorChanges()")
    ).toBeLessThan(sendLongMessageSource.indexOf("refreshActiveWorkspace("));
    expect(
      sendLongMessageSource.indexOf("refreshActiveWorkspace(")
    ).toBeLessThan(sendLongMessageSource.indexOf("activeRuntimeContext.value"));
    expect(sendLongMessageSource).toContain(
      "target.conversation.sendLongMessage("
    );
    const sendTargetSource =
      longConversationSource
        .split("interface LongMessageSendTarget")[1]
        ?.split("export interface LongConversationCoordinatorOptions")[0] ?? "";
    for (const field of [
      "bookId:",
      "selectionKey:",
      "preferredRole:",
      "activeRoot:",
      "chapterCardId:",
      "fileId:",
      "agentId:",
      "conversation:",
      "sessionId:",
      "draft:"
    ]) {
      expect(sendTargetSource).toContain(field);
    }
    expect(appSource).toContain(':editor-locked="longEditorLocked"');
    expect(appSource).not.toContain("const longEditorLocked = computed(");
    expect(longWorkspaceModuleSource).toContain(':locked="editorLocked"');
    expect(presentationCoordinatorSource).toContain(
      "function agentRunScopeHasWriteBarrier(scope: string)"
    );
    expect(presentationCoordinatorSource).toContain(
      "conversation.hasPendingEditReview.value"
    );
    expect(presentationCoordinatorSource).toContain(
      "正在保存并准备发送，编辑暂时锁定"
    );
    expect(presentationCoordinatorSource).not.toContain("版本冲突");
    expect(editorSource).toContain("lockedReason?: string");
    expect(editorSource).toContain(':disabled="locked"');
    const approveSource =
      proposalRuntimeSource
        .split("async function approveProposal(")[1]
        ?.split("function rejectProposal(")[0] ?? "";
    expect(
      approveSource.indexOf("state.proposalApprovalPending.value = true")
    ).toBeLessThan(
      approveSource.indexOf("await context.workspace.saveActiveEditorChanges()")
    );
    expect(approveSource.indexOf("await nextTick()")).toBeLessThan(
      approveSource.indexOf("await context.workspace.saveActiveEditorChanges()")
    );
  });

  it("shares plot-design and draft history across chapters while preserving other isolation", () => {
    expect(proposalRuntimeSource).toContain(
      'activeRoot: LongWorkspaceRuntimeContext["activeRoot"]'
    );
    expect(proposalRuntimeSource).toContain(
      'activeRoot === "continuity_ledger" ? chapterCardId : undefined'
    );
    expect(proposalRuntimeSource).toContain(
      'conversationChapterCardId ?? "__book__"'
    );
    expect(presentationCoordinatorSource).toContain(
      "options.long.selection.value?.chapterCardId"
    );
    expect(proposalRuntimeSource).toContain(
      "const prefix = `long:${encodeURIComponent(event.payload.bookId)}:`"
    );
    expect(agentRunPreferencesSource).toContain(
      "resolveShortWorkspaceConversationLaneIdForStage(document.stageId)"
    );
    expect(agentRunPreferencesSource).toContain(
      "resolveScriptWorkspaceConversationLaneIdForStage(document.stageId)"
    );
    expect(agentRunPreferencesSource).not.toContain("longConversationKey");
  });

  it("does not expose the removed long-form rollback surface", () => {
    expect(editorSource).not.toContain("回滚最后提交");
    expect(appSource).not.toContain("openLongRollbackDialog");
    expect(appSource).not.toContain("useLazyLongRollbackCoordinator");
    expect(workspaceDialogLayerSource).not.toContain("LongRollbackDialog");
  });
});
