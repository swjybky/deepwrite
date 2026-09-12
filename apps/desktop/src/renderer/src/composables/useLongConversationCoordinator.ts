import { createConversationHistorySelection } from "./conversationHistorySelection";
import {
  withoutMaterialBindings,
  withoutMaterialBodies
} from "../utils/library-attachments/sending";
import {
  ATTACHED_CONTEXT_MAX_ITEMS,
  MATERIAL_KINDS,
  SKILL_KINDS,
  longLinkedResourceIsEnabledForStage,
  type AgentTeamRunMode,
  type CatalogIndexSnapshot,
  type CatalogSnapshot,
  type LongAgentProfile,
  type LongBookSummary,
  type LongFileId,
  type LongWorkspaceIndexSnapshot,
  type LongWorkspaceRuntimeContext,
  type ThinkingLevel,
  type UserPromptAttachment
} from "@deepwrite/contracts";
import { computed, nextTick, watch, type Ref } from "vue";
import type {
  AgentConversationController,
  AgentRunSettings
} from "./useAgentConversation";
import {
  MATERIAL_KIND_LABELS,
  MATERIAL_STAGE_KINDS,
  SKILL_KIND_LABELS
} from "../data/catalogWorkspace";
import type {
  ComposerReferenceOption,
  ConversationMessageRewriteRequest
} from "../types/conversation";
import type {
  LongForeshadowingFocus,
  LongWorkspaceRendererApi,
  LongWorkspaceSelection
} from "../types/longWorkspace";
import type { WorkspaceDocument } from "../types/workspace";
import type { LibraryAttachmentBuildResult } from "../utils/libraryAttachments";
import { createConversationHistoryRewriteDispatcher } from "./agent-conversation/history-rewrite-dispatcher";

type LongReadableAttachments = Pick<
  LibraryAttachmentBuildResult,
  "attachedSkills" | "attachedMaterials"
>;

interface LongConversationNotifications {
  info(message: string): void;
  warning(message: string): void;
  error(message: string): void;
}

export interface LongConversationFileContext {
  readonly bookId: string;
  readonly fileId: LongFileId;
}

interface LongMessageSendTarget {
  requestId: number;
  semanticSignature: string;
  bookId: string;
  selectionKey: string | null;
  preferredRole: LongWorkspaceSelection["preferredRole"] | null;
  activeRoot: LongWorkspaceRuntimeContext["activeRoot"];
  chapterCardId: string | null;
  fileId: LongFileId | null;
  agentId: LongAgentProfile["id"];
  conversationKey: string;
  conversation: AgentConversationController;
  sessionId: string;
  draft: string;
  selectedModelId: string;
  thinkingLevel: ThinkingLevel;
  webSearchEnabled: boolean;
  temperature: number;
  approvalMode: AgentRunSettings["approvalMode"];
  foreshadowingFocusSignature: string;
}

export interface LongConversationCoordinatorOptions {
  state: {
    activeBookId: Readonly<Ref<string | null>>;
    activeBookSummary: Readonly<Ref<LongBookSummary | null>>;
    workspaceIndex: Readonly<Ref<LongWorkspaceIndexSnapshot | null>>;
    selection: Readonly<Ref<LongWorkspaceSelection | null>>;
    fileContext: Readonly<Ref<LongConversationFileContext | null>>;
    activeRoot: Readonly<Ref<LongWorkspaceRuntimeContext["activeRoot"]>>;
    activeAgentProfile: Readonly<Ref<LongAgentProfile | null>>;
    activeRuntimeContext: Readonly<Ref<LongWorkspaceRuntimeContext | null>>;
    sendPreflightPending: Ref<boolean>;
    agentLoadError: Readonly<Ref<string | null>>;
  };
  runtime: {
    conversationKey(
      bookId: string,
      activeRoot: LongWorkspaceRuntimeContext["activeRoot"],
      chapterCardId?: string
    ): string;
    conversationForKey(key: string, scope: string): AgentConversationController;
    synchronizeSessionModelSelection(
      conversation: AgentConversationController
    ): void;
    synchronizeRunPreferences(
      scope: string,
      conversation: AgentConversationController
    ): void;
  };
  workspace: {
    ensureAgentSettingsLoaded(): Promise<boolean>;
    saveActiveEditorChanges(): Promise<boolean>;
    refreshActiveWorkspace(bookId: string): Promise<boolean>;
    captureForeshadowingFocus(): LongForeshadowingFocus;
    api(): LongWorkspaceRendererApi | undefined;
  };
  catalog: {
    indexSnapshot: Readonly<Ref<CatalogIndexSnapshot | null>>;
    documentsForProfile(
      summary: LongBookSummary,
      profile: LongAgentProfile
    ): readonly WorkspaceDocument[];
    ensureDocumentsLoaded(
      documents: readonly WorkspaceDocument[]
    ): Promise<boolean>;
    hydratedSnapshot(): CatalogSnapshot | null;
    buildAttachments(
      summary: LongBookSummary,
      snapshot: CatalogSnapshot,
      profile: LongAgentProfile
    ): LibraryAttachmentBuildResult;
    filterReadableAttachments(
      attachments: LibraryAttachmentBuildResult,
      profile: LongAgentProfile
    ): LongReadableAttachments;
  };
  settings: {
    permissionMode(): AgentRunSettings["approvalMode"];
    updatePermissionMode(mode: AgentRunSettings["approvalMode"]): void;
  };
  commands: {
    stopGeneration(): Promise<void>;
  };
  showConversation(): void;
  notifications: LongConversationNotifications;
}

function catalogAttachmentId(
  domain: "material" | "skill",
  libraryId: string,
  entryId: string
): string {
  return `${domain}:${libraryId}:${entryId}`;
}

function longSkillReferences(
  snapshot: CatalogIndexSnapshot | null,
  summary: LongBookSummary | null,
  profile: LongAgentProfile | null,
  activeRoot: LongWorkspaceRuntimeContext["activeRoot"]
): ComposerReferenceOption[] {
  if (!snapshot || !summary || !profile) return [];
  const readableKinds = new Set(profile.readAccess.skillKinds);
  const libraries = new Map(
    snapshot.skills.map((library) => [library.id, library])
  );
  const seenLibraries = new Set<string>();
  const references: ComposerReferenceOption[] = [];
  for (const selectedKind of SKILL_KINDS) {
    if (!readableKinds.has(selectedKind)) continue;
    for (const libraryId of summary.linkedSkillIdsByKind[selectedKind]) {
      if (
        !longLinkedResourceIsEnabledForStage(
          summary.linkedResourceStageScopes,
          "skill",
          libraryId,
          activeRoot
        )
      ) {
        continue;
      }
      if (seenLibraries.has(libraryId)) continue;
      seenLibraries.add(libraryId);
      const library = libraries.get(libraryId);
      if (!library || !readableKinds.has(library.skillKind)) continue;
      for (const entry of library.entries) {
        if (entry.contentBytes <= 0) continue;
        references.push({
          id: catalogAttachmentId("skill", library.id, entry.id),
          label: `${library.title} · ${entry.title}`,
          detail: `${SKILL_KIND_LABELS[library.skillKind]} · 当前长篇已绑定`
        });
        if (references.length >= ATTACHED_CONTEXT_MAX_ITEMS) {
          return references;
        }
      }
    }
  }
  return references;
}

function longMaterialReferences(
  snapshot: CatalogIndexSnapshot | null,
  summary: LongBookSummary | null,
  profile: LongAgentProfile | null,
  activeRoot: LongWorkspaceRuntimeContext["activeRoot"]
): ComposerReferenceOption[] {
  if (!snapshot || !summary || !profile) return [];
  const readableKinds = new Set(profile.readAccess.materialKinds);
  const libraries = new Map(
    snapshot.materials.map((library) => [library.id, library])
  );
  const seenLibraries = new Set<string>();
  const references: ComposerReferenceOption[] = [];
  for (const selectedKind of MATERIAL_KINDS) {
    if (!readableKinds.has(selectedKind)) continue;
    for (const libraryId of summary.linkedMaterialIdsByKind[selectedKind]) {
      if (
        !longLinkedResourceIsEnabledForStage(
          summary.linkedResourceStageScopes,
          "material",
          libraryId,
          activeRoot
        )
      ) {
        continue;
      }
      if (seenLibraries.has(libraryId)) continue;
      seenLibraries.add(libraryId);
      const library = libraries.get(libraryId);
      if (!library) continue;
      for (const entry of library.entries) {
        const entryKind = MATERIAL_STAGE_KINDS[entry.stageId];
        if (entryKind !== selectedKind || entry.contentBytes <= 0) continue;
        references.push({
          id: catalogAttachmentId("material", library.id, entry.id),
          label: `${library.title} · ${entry.title}`,
          detail: `${MATERIAL_KIND_LABELS[entryKind]} · 当前长篇已绑定`
        });
        if (references.length >= ATTACHED_CONTEXT_MAX_ITEMS) {
          return references;
        }
      }
    }
  }
  return references;
}

function activeFileId(
  bookId: string | null,
  selection: LongWorkspaceSelection | null,
  fileContext: LongConversationFileContext | null
): LongFileId | null {
  if (
    !bookId ||
    fileContext?.bookId !== bookId ||
    !selection?.files.some(({ file }) => file.id === fileContext.fileId)
  ) {
    return null;
  }
  return fileContext.fileId;
}

function semanticSelectionSignature(input: {
  bookId: string | null;
  selection: LongWorkspaceSelection | null;
  fileId: LongFileId | null;
  activeRoot: LongWorkspaceRuntimeContext["activeRoot"];
  agentId: LongAgentProfile["id"] | null;
  conversationKey: string | null;
}): string {
  const { selection } = input;
  return [
    input.bookId ?? "",
    selection?.key ?? "",
    selection?.root ?? input.activeRoot,
    selection?.preferredRole ?? "",
    selection?.preferredFileId ?? "",
    selection?.chapterCardId ?? "",
    selection?.worldbuildingItemId ?? "",
    selection?.characterId ?? "",
    selection?.plotPointId ?? "",
    input.fileId ?? "",
    input.agentId ?? "",
    input.conversationKey ?? ""
  ].join("\u0000");
}

/** Owns the active long-form conversation commands and send preflight. */
export function useLongConversationCoordinator(
  options: LongConversationCoordinatorOptions
) {
  const activeConversationKey = computed<string | null>(() => {
    const summary = options.state.activeBookSummary.value;
    const profile = options.state.activeAgentProfile.value;
    if (!summary || !profile) return null;
    void profile;
    return options.runtime.conversationKey(
      summary.id,
      options.state.activeRoot.value,
      options.state.selection.value?.chapterCardId
    );
  });
  const activeConversationScope = computed<string | null>(() => {
    const bookId = options.state.activeBookSummary.value?.id;
    return bookId ? `long:${bookId}` : null;
  });
  const activeConversation = computed<AgentConversationController | null>(
    () => {
      const key = activeConversationKey.value;
      const scope = activeConversationScope.value;
      return key && scope
        ? options.runtime.conversationForKey(key, scope)
        : null;
    }
  );
  const resendLongMessage = createConversationHistoryRewriteDispatcher({
    conversation: () => activeConversation.value,
    dispatch: (request) => sendLongMessage([], undefined, request)
  });
  const availableSkillReferences = computed(() =>
    longSkillReferences(
      options.catalog.indexSnapshot.value,
      options.state.activeBookSummary.value,
      options.state.activeAgentProfile.value,
      options.state.activeRoot.value
    )
  );
  const availableMaterialReferences = computed(() =>
    longMaterialReferences(
      options.catalog.indexSnapshot.value,
      options.state.activeBookSummary.value,
      options.state.activeAgentProfile.value,
      options.state.activeRoot.value
    )
  );
  const activeSemanticSignature = computed(() => {
    const summary = options.state.activeBookSummary.value;
    const profile = options.state.activeAgentProfile.value;
    const selection = options.state.selection.value;
    return semanticSelectionSignature({
      bookId: summary?.id ?? null,
      selection,
      fileId: activeFileId(
        summary?.id ?? null,
        selection,
        options.state.fileContext.value
      ),
      activeRoot: options.state.activeRoot.value,
      agentId: profile?.id ?? null,
      conversationKey: activeConversationKey.value
    });
  });

  let disposed = false;
  let sendRequestId = 0;
  let activeSend: Promise<void> | null = null;
  let activeSendConversation: AgentConversationController | null = null;

  function invalidateSendTarget(): void {
    sendRequestId += 1;
  }

  const stopSemanticInvalidation = watch(
    activeSemanticSignature,
    invalidateSendTarget,
    {
      flush: "sync"
    }
  );
  const stopConversationError = watch(
    () => activeConversation.value?.conversationError.value ?? null,
    (message) => {
      if (!disposed && message) options.notifications.error(message);
    }
  );

  const stopWebSearchSync = watch(
    () => activeConversation.value?.webSearchEnabled.value ?? false,
    () => {
      if (disposed) return;
      const conversation = activeConversation.value;
      if (!conversation) return;
      invalidateSendTarget();
      options.runtime.synchronizeSessionModelSelection(conversation);
      synchronizeActiveRunPreferences(conversation);
    },
    { flush: "sync" }
  );

  function currentSemanticSignature(): string {
    return activeSemanticSignature.value;
  }

  function currentForeshadowingFocusSignature(): string {
    if (
      options.state.activeRoot.value !== "plot_design" ||
      options.state.selection.value?.key !== "plot-design:foreshadowing"
    ) {
      return "";
    }
    const focus = options.workspace.captureForeshadowingFocus();
    return `${focus.threadId ?? ""}\u0000${focus.beatId ?? ""}`;
  }

  function captureSendTarget(): LongMessageSendTarget | null {
    const bookId = options.state.activeBookId.value;
    const summary = options.state.activeBookSummary.value;
    const profile = options.state.activeAgentProfile.value;
    const conversation = activeConversation.value;
    const conversationKey = activeConversationKey.value;
    const runtimeContext = options.state.activeRuntimeContext.value;
    const selection = options.state.selection.value;
    const fileId = activeFileId(
      bookId,
      selection,
      options.state.fileContext.value
    );
    if (
      !bookId ||
      summary?.id !== bookId ||
      !profile ||
      !conversation ||
      !conversationKey ||
      !runtimeContext ||
      runtimeContext.bookId !== bookId ||
      runtimeContext.activeRoot !== options.state.activeRoot.value ||
      runtimeContext.activeAgentId !== profile.id ||
      (runtimeContext.activeChapterCardId ?? null) !==
        (selection?.chapterCardId ?? null) ||
      (runtimeContext.activeFileId ?? null) !== fileId
    ) {
      return null;
    }
    return {
      requestId: ++sendRequestId,
      semanticSignature: currentSemanticSignature(),
      bookId,
      selectionKey: selection?.key ?? null,
      preferredRole: selection?.preferredRole ?? null,
      activeRoot: runtimeContext.activeRoot,
      chapterCardId: runtimeContext.activeChapterCardId ?? null,
      fileId,
      agentId: profile.id,
      conversationKey,
      conversation,
      sessionId: conversation.sessionId.value,
      draft: conversation.draft.value,
      selectedModelId: conversation.selectedModelId.value,
      thinkingLevel: conversation.thinkingLevel.value,
      webSearchEnabled: conversation.webSearchEnabled.value,
      temperature: conversation.temperature.value,
      approvalMode: options.settings.permissionMode(),
      foreshadowingFocusSignature: currentForeshadowingFocusSignature()
    };
  }

  function sendTargetIsCurrent(
    target: LongMessageSendTarget,
    matchOptions: { includeDraft?: boolean } = {}
  ): boolean {
    if (
      disposed ||
      target.requestId !== sendRequestId ||
      currentSemanticSignature() !== target.semanticSignature
    ) {
      return false;
    }
    const selection = options.state.selection.value;
    return (
      options.state.activeBookId.value === target.bookId &&
      options.state.activeBookSummary.value?.id === target.bookId &&
      activeConversationKey.value === target.conversationKey &&
      activeConversation.value === target.conversation &&
      (selection?.key ?? null) === target.selectionKey &&
      (selection?.preferredRole ?? null) === target.preferredRole &&
      options.state.activeRoot.value === target.activeRoot &&
      (selection?.chapterCardId ?? null) === target.chapterCardId &&
      activeFileId(
        target.bookId,
        selection,
        options.state.fileContext.value
      ) === target.fileId &&
      options.state.activeAgentProfile.value?.id === target.agentId &&
      target.conversation.sessionId.value === target.sessionId &&
      target.conversation.selectedModelId.value === target.selectedModelId &&
      target.conversation.thinkingLevel.value === target.thinkingLevel &&
      target.conversation.webSearchEnabled.value === target.webSearchEnabled &&
      target.conversation.temperature.value === target.temperature &&
      options.settings.permissionMode() === target.approvalMode &&
      currentForeshadowingFocusSignature() ===
        target.foreshadowingFocusSignature &&
      (matchOptions.includeDraft === false ||
        target.conversation.draft.value === target.draft)
    );
  }

  function confirmSendTarget(target: LongMessageSendTarget): boolean {
    if (sendTargetIsCurrent(target)) return true;
    if (!disposed) {
      options.notifications.info(
        "长篇上下文、会话、模型设置或输入内容已切换，本次发送已取消。"
      );
    }
    return false;
  }

  function preflightBlocks(action: string): boolean {
    if (!activeSend && !options.state.sendPreflightPending.value) return false;
    options.notifications.info(`正在保存并准备发送，请稍后再${action}。`);
    return true;
  }

  function updateDraft(value: string): void {
    if (disposed) return;
    invalidateSendTarget();
    const conversation = activeConversation.value;
    if (conversation) conversation.draft.value = value;
  }

  function newConversation(): void {
    if (disposed || preflightBlocks("新建对话")) {
      return;
    }
    const conversation = activeConversation.value;
    if (!conversation) return;
    if (conversation.isBusy.value) {
      options.notifications.warning("请先停止当前长篇回复，再新建对话。");
      return;
    }
    invalidateSendTarget();
    conversation.newConversation();
    options.showConversation();
  }

  const selectConversation = createConversationHistorySelection({
    prepare() {
      if (disposed || preflightBlocks("切换对话")) return false;
      invalidateSendTarget();
      return true;
    },
    current: () => activeConversation.value,
    warning: (message) => options.notifications.warning(message),
    busyMessage: "请先停止当前回复，再切换历史对话。",
    unavailableMessage: "这条长篇历史对话已不可用。"
  });

  function useSuggestion(value: string): void {
    if (disposed) return;
    invalidateSendTarget();
    activeConversation.value?.useSuggestion(value);
  }

  function sendLongMessage(
    request: UserPromptAttachment[] | ConversationMessageRewriteRequest = [],
    rewriteCompletion?: (started: boolean) => void,
    rewriteRequest?: ConversationMessageRewriteRequest
  ): Promise<void> {
    if (!Array.isArray(request)) {
      const rewrite = resendLongMessage(request);
      void rewrite.then(
        (started) => rewriteCompletion?.(started),
        () => rewriteCompletion?.(false)
      );
      return rewrite.then(() => undefined);
    }
    const promptAttachments = request;
    if (disposed) return Promise.resolve();
    if (activeSend || options.state.sendPreflightPending.value) {
      options.notifications.info("正在准备上一条长篇消息，请稍候。");
      return Promise.resolve();
    }
    const target = captureSendTarget();
    if (!target) {
      options.notifications.warning("长篇工作区上下文尚未就绪，请稍后重试。");
      return Promise.resolve();
    }
    if (rewriteRequest && !target.conversation.canRewriteHistory.value) {
      options.notifications.info(
        "请先等待当前回复、审批和长篇修改保存全部完成。"
      );
      return Promise.resolve();
    }
    options.state.sendPreflightPending.value = true;
    const operation = (async () => {
      try {
        await nextTick();
        if (!confirmSendTarget(target)) return;

        const settingsLoaded =
          await options.workspace.ensureAgentSettingsLoaded();
        if (!confirmSendTarget(target)) return;
        if (!settingsLoaded) {
          options.notifications.warning(
            options.state.agentLoadError.value ??
              "长篇智能体设置尚未加载，请重试。"
          );
          return;
        }

        const saved = await options.workspace.saveActiveEditorChanges();
        if (!confirmSendTarget(target)) return;
        if (!saved) return;

        const refreshed = await options.workspace.refreshActiveWorkspace(
          target.bookId
        );
        if (!confirmSendTarget(target)) return;
        if (!refreshed) return;

        const baseRuntimeContext = options.state.activeRuntimeContext.value;
        if (
          !baseRuntimeContext ||
          baseRuntimeContext.bookId !== target.bookId ||
          baseRuntimeContext.activeRoot !== target.activeRoot ||
          baseRuntimeContext.activeAgentId !== target.agentId ||
          (baseRuntimeContext.activeChapterCardId ?? null) !==
            target.chapterCardId ||
          (baseRuntimeContext.activeFileId ?? null) !== target.fileId
        ) {
          options.notifications.info("长篇上下文已切换，本次发送已取消。");
          return;
        }

        let runtimeContext = baseRuntimeContext;
        if (target.activeRoot === "worldbuilding" && target.fileId) {
          const api = options.workspace.api();
          if (!api) {
            options.notifications.warning("当前环境未连接长篇工作区。");
            return;
          }
          try {
            const { buildLongWorldbuildingFocusSnapshot } =
              await import("../utils/longWorldbuildingAgentContext");
            if (!confirmSendTarget(target)) return;
            const worldbuildingFocus =
              await buildLongWorldbuildingFocusSnapshot({
                bookId: target.bookId,
                selection: options.state.selection.value,
                activeFileId: target.fileId,
                readDocument: (input) => api.readDocument(input)
              });
            if (!confirmSendTarget(target)) return;
            if (worldbuildingFocus) {
              runtimeContext = { ...baseRuntimeContext, worldbuildingFocus };
            }
          } catch (error: unknown) {
            if (!sendTargetIsCurrent(target)) return;
            options.notifications.warning(
              error instanceof Error
                ? `当前世界观阶段读取失败：${error.message}`
                : "当前世界观阶段读取失败，请重试。"
            );
            return;
          }
        }

        if (target.activeRoot === "character_design" && target.fileId) {
          const api = options.workspace.api();
          if (!api) {
            options.notifications.warning("当前环境未连接长篇工作区。");
            return;
          }
          try {
            const { buildLongCharacterFocusSnapshot } =
              await import("../utils/longCharacterAgentContext");
            if (!confirmSendTarget(target)) return;
            const characterFocus = await buildLongCharacterFocusSnapshot({
              bookId: target.bookId,
              selection: options.state.selection.value,
              activeFileId: target.fileId,
              characterOverviewFile:
                options.state.workspaceIndex.value?.characterOverview ?? null,
              readDocument: (input) => api.readDocument(input)
            });
            if (!confirmSendTarget(target)) return;
            if (characterFocus) {
              runtimeContext = { ...baseRuntimeContext, characterFocus };
            }
          } catch (error: unknown) {
            if (!sendTargetIsCurrent(target)) return;
            options.notifications.warning(
              error instanceof Error
                ? `当前人物阶段读取失败：${error.message}`
                : "当前人物阶段读取失败，请重试。"
            );
            return;
          }
        }

        if (target.activeRoot === "plot_design") {
          const { buildLongPlotFocusSnapshot } =
            await import("../utils/longPlotAgentContext");
          if (!confirmSendTarget(target)) return;
          const plotFocus = buildLongPlotFocusSnapshot({
            selection: options.state.selection.value,
            navigation: baseRuntimeContext.navigation,
            foreshadowing:
              options.state.workspaceIndex.value?.plot.foreshadowing ?? [],
            foreshadowingFocus: options.workspace.captureForeshadowingFocus()
          });
          if (plotFocus) {
            runtimeContext = { ...baseRuntimeContext, plotFocus };
          }
        }

        const api = options.workspace.api();
        if (api) {
          try {
            const agentsMd = await api.readAgentsMd({ bookId: target.bookId });
            if (!confirmSendTarget(target)) return;
            const content = agentsMd.content.trim();
            if (content) {
              runtimeContext = { ...runtimeContext, agentsMd: content };
            }
            if (agentsMd.truncated) {
              options.notifications.warning(
                "长篇上下文过长，本轮只注入了截断后的 AGENTS.md。"
              );
            }
          } catch (error: unknown) {
            if (!confirmSendTarget(target)) return;
            options.notifications.warning(
              error instanceof Error
                ? `长篇上下文未注入：${error.message}`
                : "长篇上下文未注入，本轮仍会发送。"
            );
          }
        }

        const summary = options.state.activeBookSummary.value;
        const profile = options.state.activeAgentProfile.value;
        if (!summary || summary.id !== target.bookId || !profile) {
          options.notifications.info("长篇资源上下文已切换，本次发送已取消。");
          return;
        }
        const documentsLoaded = await options.catalog.ensureDocumentsLoaded(
          withoutMaterialBodies(
            options.catalog.documentsForProfile(summary, profile)
          )
        );
        if (!confirmSendTarget(target)) return;
        if (!documentsLoaded) return;

        const contextSnapshot = options.catalog.hydratedSnapshot();
        const attachmentResult = contextSnapshot
          ? options.catalog.buildAttachments(
              withoutMaterialBindings(summary),
              contextSnapshot,
              profile
            )
          : null;
        const readableAttachments = attachmentResult
          ? options.catalog.filterReadableAttachments(attachmentResult, profile)
          : { attachedSkills: [], attachedMaterials: [] };
        if (
          attachmentResult &&
          !attachmentResult.complete &&
          attachmentResult.diagnostics.length
        ) {
          const first = attachmentResult.diagnostics[0]!;
          options.notifications.warning(
            attachmentResult.diagnostics.length === 1
              ? first.message
              : `${first.message}（另有 ${attachmentResult.diagnostics.length - 1} 项长篇资源提示）`
          );
        }
        if (!confirmSendTarget(target)) return;

        target.conversation.selectApprovalMode(target.approvalMode);
        if (rewriteRequest) {
          const rewriteStarted = await target.conversation.resendLongMessage(
            rewriteRequest,
            runtimeContext,
            readableAttachments
          );
          if (!rewriteStarted) return;
        } else {
          await target.conversation.sendLongMessage(
            runtimeContext,
            readableAttachments,
            promptAttachments
          );
        }
        sendTargetIsCurrent(target, { includeDraft: false });
      } catch (error: unknown) {
        if (!sendTargetIsCurrent(target, { includeDraft: false })) return;
        options.notifications.error(
          error instanceof Error
            ? error.message
            : "发送长篇消息失败，请稍后重试。"
        );
      }
    })().finally(() => {
      if (activeSend === operation) {
        activeSend = null;
        activeSendConversation = null;
        options.state.sendPreflightPending.value = false;
      }
    });
    activeSend = operation;
    activeSendConversation = target.conversation;
    return operation;
  }

  function synchronizeActiveRunPreferences(
    conversation: AgentConversationController
  ): void {
    const scope = activeConversationScope.value;
    if (scope) options.runtime.synchronizeRunPreferences(scope, conversation);
  }

  function modelPreferenceBlocked(): boolean {
    return preflightBlocks("修改模型设置");
  }

  function selectModel(modelId: string): void {
    if (disposed || modelPreferenceBlocked()) return;
    const conversation = activeConversation.value;
    if (!conversation) return;
    invalidateSendTarget();
    conversation.selectModel(modelId);
    options.runtime.synchronizeSessionModelSelection(conversation);
    synchronizeActiveRunPreferences(conversation);
  }

  function selectThinking(level: ThinkingLevel): void {
    if (disposed || modelPreferenceBlocked()) return;
    const conversation = activeConversation.value;
    if (!conversation) return;
    invalidateSendTarget();
    conversation.selectThinkingLevel(level);
    options.runtime.synchronizeSessionModelSelection(conversation);
    synchronizeActiveRunPreferences(conversation);
  }

  function selectWebSearch(enabled: boolean): void {
    if (disposed || modelPreferenceBlocked()) return;
    const conversation = activeConversation.value;
    if (!conversation) return;
    invalidateSendTarget();
    conversation.selectWebSearchEnabled(enabled);
    options.runtime.synchronizeSessionModelSelection(conversation);
    synchronizeActiveRunPreferences(conversation);
  }

  function selectTemperature(value: number): void {
    if (disposed || modelPreferenceBlocked()) return;
    const conversation = activeConversation.value;
    if (!conversation) return;
    invalidateSendTarget();
    conversation.selectTemperature(value);
    synchronizeActiveRunPreferences(conversation);
  }

  function selectApprovalMode(mode: AgentRunSettings["approvalMode"]): void {
    if (disposed || modelPreferenceBlocked()) return;
    const conversation = activeConversation.value;
    if (!conversation) return;
    invalidateSendTarget();
    options.settings.updatePermissionMode(mode);
    conversation.selectApprovalMode(mode);
    synchronizeActiveRunPreferences(conversation);
  }

  function selectAgentTeamMode(mode: AgentTeamRunMode): void {
    if (disposed || modelPreferenceBlocked()) return;
    const conversation = activeConversation.value;
    if (!conversation) return;
    invalidateSendTarget();
    conversation.selectAgentTeamMode(mode);
    synchronizeActiveRunPreferences(conversation);
  }

  async function stopGeneration(): Promise<void> {
    if (disposed) return;
    await options.commands.stopGeneration();
  }

  async function drain(): Promise<void> {
    const pending = activeSend;
    if (pending) await pending;
  }

  async function dispose(): Promise<void> {
    if (disposed) return;
    const pending = activeSend;
    const conversation = activeSendConversation;
    disposed = true;
    invalidateSendTarget();
    stopSemanticInvalidation();
    stopConversationError();
    stopWebSearchSync();
    if (pending && conversation?.isBusy.value) {
      try {
        await conversation.stopGeneration();
      } catch {
        // Disposal is best-effort; the pending send is still drained below.
      }
    }
    await drain();
    options.state.sendPreflightPending.value = false;
  }

  return {
    activeConversation,
    activeConversationKey,
    availableMaterialReferences,
    availableSkillReferences,
    dispose,
    drain,
    newConversation,
    selectAgentTeamMode,
    selectApprovalMode,
    selectConversation,
    selectModel,
    selectTemperature,
    selectThinking,
    selectWebSearch,
    resendLongMessage,
    sendLongMessage,
    sendPreflightPending: options.state.sendPreflightPending,
    stopGeneration,
    updateDraft,
    useSuggestion
  };
}

export type LongConversationCoordinator = ReturnType<
  typeof useLongConversationCoordinator
>;
