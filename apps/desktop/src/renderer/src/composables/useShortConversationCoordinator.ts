import { createConversationHistorySelection } from "./conversationHistorySelection";
import {
  withoutMaterialBindings,
  withoutMaterialBodies
} from "../utils/library-attachments/sending";
import {
  ATTACHED_CONTEXT_MAX_ITEMS,
  resolveScriptWorkspaceStageReadAccess,
  resolveShortWorkspaceStageReadAccess,
  resolveScriptWorkspaceAgentIdForStage,
  resolveShortWorkspaceAgentIdForStage,
  type Book,
  type AgentTeamRunMode,
  type CatalogIndexSnapshot,
  type CatalogSnapshot,
  type GeneralPermissionMode,
  type LibraryAgentDomain,
  type LibraryAgentSettings,
  type MaterialKind,
  type SkillKind,
  type ThinkingLevel,
  type UserPromptAttachment,
  type WorkspaceAgentId,
  type WorkspaceAgentSettings
} from "@deepwrite/contracts";
import { computed, ref, watch, type ComputedRef, type Ref } from "vue";
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
  ConversationMessageRewriteRequest,
  EditorTextReference
} from "../types/conversation";
import type { WorkspaceDocument } from "../types/workspace";
import {
  agentConversationKeyForDocument,
  agentRunScopeForDocument
} from "../utils/agentRunPreferences";
import { buildLibraryAgentWorkspaceContext } from "../utils/libraryAgentContext";
import { buildLibraryAgentSkillAttachments } from "../utils/libraryAgentSkillAttachments";
import { buildLibraryAttachments } from "../utils/libraryAttachments";
import { scopeBookLibrariesToReadAccess } from "../utils/shortWorkspaceLibraryScope";
import { createConversationHistoryRewriteDispatcher } from "./agent-conversation/history-rewrite-dispatcher";

function composerStageLabel(
  descriptor: ShortConversationDocumentDescriptor
): string {
  if (descriptor.stageId === "character_design") return "人设";
  if (descriptor.stageId === "draft") return "正文";
  if (descriptor.stageId) return "剧情";
  if (descriptor.domain === "skill") return "技能库";
  if (descriptor.domain === "material") return "素材库";
  return "未选择阶段";
}

interface ShortConversationNotifications {
  info(message: string): void;
  warning(message: string): void;
  error(message: string): void;
}

interface ShortConversationQueuedEdit {
  conversation: AgentConversationController;
  sessionId: string;
}

interface ShortConversationDocumentDescriptor {
  id: string;
  domain: WorkspaceDocument["domain"];
  title: string;
  pathRoot: string;
  workspaceTitle?: string;
  workspaceType?: WorkspaceDocument["workspaceType"];
  workspaceId?: string;
  stageId?: string;
  shortAgentId?: WorkspaceAgentId;
  libraryId?: string;
  catalogEntryId?: string;
}

interface ShortConversationSendTarget {
  requestId: number;
  conversation: AgentConversationController;
  conversationKey: string;
  sessionId: string;
  selectedResourceId: string;
  activeCreationResourceId: string;
  documentId: string;
  workspaceId?: string;
  stageId?: string;
  draft: string;
}

export interface ShortConversationCoordinatorOptions {
  runtime: {
    conversationForKey(
      key: string,
      scope?: string
    ): AgentConversationController;
    synchronizeSessionModelSelection(source: AgentConversationController): void;
    synchronizeRunPreferences(
      scope: string,
      source: AgentConversationController
    ): void;
  };
  resource: {
    selectedResourceId: Ref<string>;
    activeCreationResourceId: Ref<string>;
    activeAgentDocument: Readonly<Ref<WorkspaceDocument>>;
    activePromptDocument: Readonly<Ref<WorkspaceDocument>>;
    liveWorkspaceDocuments: Readonly<Ref<WorkspaceDocument[]>>;
    pendingEditorReferences: Readonly<Ref<EditorTextReference[]>>;
    leftCollapsed: Readonly<Ref<boolean>>;
    rightCollapsed: Readonly<Ref<boolean>>;
    clearEditorSelectionReferences(): void;
    contextDocuments(): WorkspaceDocument[];
    ensureDocumentsLoaded(
      documents: readonly WorkspaceDocument[]
    ): Promise<boolean>;
    hydratedCatalogSnapshot(): CatalogSnapshot | null;
  };
  catalog: {
    snapshot: Readonly<Ref<CatalogIndexSnapshot | null>>;
    findBook(workspaceId: string): Book | undefined;
  };
  profiles: {
    workspaceAgents: Readonly<Ref<WorkspaceAgentSettings[]>>;
    libraryAgents: Readonly<Ref<LibraryAgentSettings>>;
  };
  edits: {
    acceptingDocumentIds: Readonly<Ref<Set<string>>>;
    acceptingWorkspaceIds: Readonly<Ref<Set<string>>>;
    hasQueued(): boolean;
    schedule(predicate: (queued: ShortConversationQueuedEdit) => boolean): void;
    resumeRecovered(
      conversations: readonly AgentConversationController[]
    ): void;
  };
  settings: {
    permissionMode(): GeneralPermissionMode;
    updatePermissionMode(mode: GeneralPermissionMode): void;
  };
  runtimeAvailable(): boolean;
  showConversation(): void;
  notifications: ShortConversationNotifications;
}

function descriptorFor(
  document: WorkspaceDocument
): ShortConversationDocumentDescriptor {
  return {
    id: document.id,
    domain: document.domain,
    title: document.title,
    pathRoot: document.path[0] ?? "",
    ...(document.workspaceTitle
      ? { workspaceTitle: document.workspaceTitle }
      : {}),
    ...(document.workspaceType
      ? { workspaceType: document.workspaceType }
      : {}),
    ...(document.workspaceId ? { workspaceId: document.workspaceId } : {}),
    ...(document.stageId ? { stageId: document.stageId } : {}),
    ...(document.shortAgentId ? { shortAgentId: document.shortAgentId } : {}),
    ...(document.libraryId ? { libraryId: document.libraryId } : {}),
    ...(document.catalogEntryId
      ? { catalogEntryId: document.catalogEntryId }
      : {})
  };
}

function descriptorSignature(
  descriptor: ShortConversationDocumentDescriptor
): string {
  return [
    descriptor.id,
    descriptor.domain,
    descriptor.title,
    descriptor.pathRoot,
    descriptor.workspaceTitle ?? "",
    descriptor.workspaceType ?? "",
    descriptor.workspaceId ?? "",
    descriptor.stageId ?? "",
    descriptor.shortAgentId ?? "",
    descriptor.libraryId ?? "",
    descriptor.catalogEntryId ?? ""
  ].join("\u0000");
}

function stableDocumentDescriptor(
  source: Readonly<Ref<WorkspaceDocument>>
): ComputedRef<ShortConversationDocumentDescriptor> {
  let previous: ShortConversationDocumentDescriptor | undefined;
  let previousSignature = "";
  return computed(() => {
    const next = descriptorFor(source.value);
    const signature = descriptorSignature(next);
    if (previous && signature === previousSignature) return previous;
    previous = next;
    previousSignature = signature;
    return next;
  });
}

function catalogDocumentId(
  domain: "material" | "skill",
  libraryId: string,
  entryId: string
): string {
  return ["catalog", `${domain}-entry`, libraryId, entryId]
    .map((part) => encodeURIComponent(part))
    .join(":");
}

function creationSkillReferences(
  snapshot: CatalogIndexSnapshot | null,
  book: Book | undefined,
  allowedKinds: readonly SkillKind[]
): ComposerReferenceOption[] {
  if (!snapshot || !book || allowedKinds.length === 0) return [];
  const allowed = new Set(allowedKinds);
  const libraries = new Map(
    snapshot.skills.map((library) => [library.id, library])
  );
  const seenLibraries = new Set<string>();
  const references: ComposerReferenceOption[] = [];
  for (const boundIds of Object.values(book.linkedSkillIdsByKind)) {
    for (const libraryId of boundIds) {
      if (seenLibraries.has(libraryId)) continue;
      seenLibraries.add(libraryId);
      const library = libraries.get(libraryId);
      if (!library || !allowed.has(library.skillKind)) continue;
      for (const entry of library.entries) {
        if (entry.contentBytes <= 0) continue;
        references.push({
          id: catalogDocumentId("skill", library.id, entry.id),
          label: `${library.title} · ${entry.title}`,
          detail: `${SKILL_KIND_LABELS[library.skillKind]} · 当前书籍已绑定`
        });
        if (references.length >= ATTACHED_CONTEXT_MAX_ITEMS) return references;
      }
    }
  }
  return references;
}

function creationMaterialReferences(
  snapshot: CatalogIndexSnapshot | null,
  book: Book | undefined,
  allowedKinds: readonly MaterialKind[]
): ComposerReferenceOption[] {
  if (!snapshot || !book || allowedKinds.length === 0) return [];
  const allowed = new Set(allowedKinds);
  const libraries = new Map(
    snapshot.materials.map((library) => [library.id, library])
  );
  const references: ComposerReferenceOption[] = [];
  const seenEntries = new Set<string>();
  for (const [boundKind, libraryIds] of Object.entries(
    book.linkedMaterialIdsByKind
  ) as [MaterialKind, string[]][]) {
    if (!allowed.has(boundKind)) continue;
    for (const libraryId of libraryIds) {
      const library = libraries.get(libraryId);
      if (!library) continue;
      for (const entry of library.entries) {
        const entryKind = MATERIAL_STAGE_KINDS[entry.stageId];
        const entryKey = `${library.id}\u0000${entry.id}`;
        if (
          entryKind !== boundKind ||
          entry.contentBytes <= 0 ||
          seenEntries.has(entryKey)
        ) {
          continue;
        }
        seenEntries.add(entryKey);
        references.push({
          id: catalogDocumentId("material", library.id, entry.id),
          label: `${library.title} · ${entry.title}`,
          detail: `${MATERIAL_KIND_LABELS[entryKind]} · 当前书籍已绑定`
        });
        if (references.length >= ATTACHED_CONTEXT_MAX_ITEMS) return references;
      }
    }
  }
  return references;
}

function libraryEntryReferences(
  snapshot: CatalogIndexSnapshot | null,
  descriptor: ShortConversationDocumentDescriptor,
  domain: LibraryAgentDomain | undefined
): ComposerReferenceOption[] {
  if (!snapshot || !domain || !descriptor.libraryId) return [];
  const libraries =
    domain === "material" ? snapshot.materials : snapshot.skills;
  const groups =
    domain === "material" ? snapshot.materialGroups : snapshot.skillGroups;
  const current = libraries.find(({ id }) => id === descriptor.libraryId);
  if (!current) return [];
  const group = groups.find((candidate) =>
    Object.values(candidate.members).includes(current.id)
  );
  const memberIds = group
    ? [
        current.id,
        ...Object.values(group.members).filter(
          (id): id is string => Boolean(id) && id !== current.id
        )
      ]
    : [current.id];
  const references: ComposerReferenceOption[] = [];
  for (const libraryId of memberIds) {
    const library = libraries.find(({ id }) => id === libraryId);
    if (!library) continue;
    for (const entry of library.entries) {
      if (library.id === current.id && entry.id === descriptor.catalogEntryId) {
        continue;
      }
      references.push({
        id: catalogDocumentId(domain, library.id, entry.id),
        label: entry.title,
        detail:
          library.id === current.id
            ? group
              ? `当前${domain === "skill" ? "技能" : "素材"}库 · ${group.title}`
              : `当前${domain === "skill" ? "技能" : "素材"}库`
            : `分组 · ${library.title}`
      });
    }
  }
  return references;
}

/** Owns short/script conversation presentation and command preflight. */
export function useShortConversationCoordinator(
  options: ShortConversationCoordinatorOptions
) {
  const sendPreflightPending = ref(false);
  const activeDescriptor = stableDocumentDescriptor(
    options.resource.activeAgentDocument
  );
  const activeConversationKey = computed(() =>
    agentConversationKeyForDocument(options.resource.activeAgentDocument.value)
  );
  const activeConversationScope = computed(() =>
    agentRunScopeForDocument(options.resource.activeAgentDocument.value)
  );
  const activeConversation = computed(() =>
    options.runtime.conversationForKey(
      activeConversationKey.value,
      activeConversationScope.value
    )
  );
  const resendMessage = createConversationHistoryRewriteDispatcher({
    conversation: () => activeConversation.value,
    dispatch: (request) => sendMessage([], request)
  });
  const activeAgentId = computed<WorkspaceAgentId | undefined>(() => {
    const descriptor = activeDescriptor.value;
    if (!descriptor.stageId) return undefined;
    if (descriptor.workspaceType === "short") {
      return (
        descriptor.shortAgentId ??
        resolveShortWorkspaceAgentIdForStage(descriptor.stageId)
      );
    }
    if (descriptor.workspaceType === "script") {
      return (
        descriptor.shortAgentId ??
        resolveScriptWorkspaceAgentIdForStage(descriptor.stageId)
      );
    }
    return undefined;
  });
  const activeLibraryDomain = computed<LibraryAgentDomain | undefined>(() => {
    const domain = activeDescriptor.value.domain;
    return domain === "material" || domain === "skill" ? domain : undefined;
  });
  const activeShortAgentProfile = computed(() => {
    const descriptor = activeDescriptor.value;
    const agentId = activeAgentId.value;
    return agentId
      ? options.profiles.workspaceAgents.value
          .find(
            ({ workspaceType }) => workspaceType === descriptor.workspaceType
          )
          ?.agents.find(({ id }) => id === agentId)
      : undefined;
  });
  const effectiveShortReadAccess = computed(() => {
    const profile = activeShortAgentProfile.value;
    const descriptor = activeDescriptor.value;
    if (!profile) return undefined;
    if (!descriptor.stageId) {
      return profile.readAccess;
    }
    const stage =
      descriptor.workspaceType === "script"
        ? resolveScriptWorkspaceStageReadAccess(descriptor.stageId)
        : resolveShortWorkspaceStageReadAccess(descriptor.stageId);
    return {
      material: profile.readAccess.material.filter((kind) =>
        stage.material.includes(kind)
      ),
      skill: profile.readAccess.skill.filter((kind) =>
        stage.skill.includes(kind)
      )
    };
  });
  const activeLibraryAgentProfile = computed(() => {
    const domain = activeLibraryDomain.value;
    return domain
      ? options.profiles.libraryAgents.value.agents.find(
          (agent) => agent.domain === domain
        )
      : undefined;
  });
  const availableSkillReferences = computed<ComposerReferenceOption[]>(() => {
    if (activeLibraryDomain.value) {
      return (activeLibraryAgentProfile.value?.readAccess.skills ?? [])
        .slice(0, ATTACHED_CONTEXT_MAX_ITEMS)
        .map((skill) => ({
          id: `library-agent-skill:${skill.id}`,
          label: skill.name,
          detail: "按需加载的方法"
        }));
    }
    const workspaceId = activeDescriptor.value.workspaceId;
    return creationSkillReferences(
      options.catalog.snapshot.value,
      workspaceId ? options.catalog.findBook(workspaceId) : undefined,
      effectiveShortReadAccess.value?.skill ?? []
    );
  });
  const availableMaterialReferences = computed<ComposerReferenceOption[]>(
    () => {
      if (activeLibraryDomain.value) {
        return libraryEntryReferences(
          options.catalog.snapshot.value,
          activeDescriptor.value,
          activeLibraryDomain.value
        );
      }
      const workspaceId = activeDescriptor.value.workspaceId;
      return creationMaterialReferences(
        options.catalog.snapshot.value,
        workspaceId ? options.catalog.findBook(workspaceId) : undefined,
        effectiveShortReadAccess.value?.material ?? []
      );
    }
  );
  const conversationContext = computed(() => {
    const descriptor = activeDescriptor.value;
    const agentId = activeAgentId.value;
    return {
      runtimeAvailable: options.runtimeAvailable(),
      allowLiveEditReview: true,
      contextTitle: descriptor.title,
      bookTitle:
        descriptor.workspaceTitle || descriptor.pathRoot || "未选择资源",
      stageLabel: composerStageLabel(descriptor),
      agentLabel:
        activeShortAgentProfile.value?.label ??
        activeLibraryAgentProfile.value?.label ??
        "智能体对话",
      agentId,
      agentWorkspaceType:
        descriptor.workspaceType === "script"
          ? ("script" as const)
          : ("short" as const),
      libraryDomain: activeLibraryDomain.value,
      librarySkills: activeLibraryAgentProfile.value?.readAccess.skills.map(
        (skill) => ({
          name: skill.name
        })
      ),
      welcomeShortcuts: activeShortAgentProfile.value?.welcomeShortcuts,
      availableSkills: availableSkillReferences.value,
      availableMaterials: availableMaterialReferences.value,
      editorReferences: options.resource.pendingEditorReferences.value,
      leftCollapsed: options.resource.leftCollapsed.value,
      rightCollapsed: options.resource.rightCollapsed.value,
      canRewriteHistory:
        activeConversation.value.canRewriteHistory.value &&
        !sendPreflightPending.value &&
        options.edits.acceptingDocumentIds.value.size === 0 &&
        options.edits.acceptingWorkspaceIds.value.size === 0 &&
        !options.edits.hasQueued(),
      submitEditedMessage: resendMessage
    };
  });

  let disposed = false;
  let sendRequestId = 0;
  let activeSend: Promise<void> | null = null;
  let activeSendConversation: AgentConversationController | null = null;

  function invalidateSendTarget(): void {
    sendRequestId += 1;
  }

  const stopResourceInvalidation = watch(
    [
      options.resource.selectedResourceId,
      options.resource.activeCreationResourceId
    ],
    invalidateSendTarget,
    { flush: "sync" }
  );

  const stopConversationError = watch(
    () => activeConversation.value.conversationError.value,
    (message) => {
      if (!disposed && message) options.notifications.error(message);
    }
  );

  const stopWebSearchSync = watch(
    () => activeConversation.value.webSearchEnabled.value,
    () => {
      if (disposed) return;
      const conversation = activeConversation.value;
      options.runtime.synchronizeSessionModelSelection(conversation);
      synchronizeActiveRunPreferences(conversation);
    },
    { flush: "sync" }
  );

  function captureSendTarget(): ShortConversationSendTarget {
    const conversation = activeConversation.value;
    const document = options.resource.activeAgentDocument.value;
    return {
      requestId: ++sendRequestId,
      conversation,
      conversationKey: activeConversationKey.value,
      sessionId: conversation.sessionId.value,
      selectedResourceId: options.resource.selectedResourceId.value,
      activeCreationResourceId: options.resource.activeCreationResourceId.value,
      documentId: document.id,
      ...(document.workspaceId ? { workspaceId: document.workspaceId } : {}),
      ...(document.stageId ? { stageId: document.stageId } : {}),
      draft: conversation.draft.value
    };
  }

  function sendTargetIsCurrent(
    target: ShortConversationSendTarget,
    options_: { includeDraft?: boolean } = {}
  ): boolean {
    if (disposed || target.requestId !== sendRequestId) return false;
    const document = options.resource.activeAgentDocument.value;
    return (
      activeConversation.value === target.conversation &&
      activeConversationKey.value === target.conversationKey &&
      target.conversation.sessionId.value === target.sessionId &&
      options.resource.selectedResourceId.value === target.selectedResourceId &&
      options.resource.activeCreationResourceId.value ===
        target.activeCreationResourceId &&
      document.id === target.documentId &&
      document.workspaceId === target.workspaceId &&
      document.stageId === target.stageId &&
      (options_.includeDraft === false ||
        target.conversation.draft.value === target.draft)
    );
  }

  function notifyCanceledSend(): void {
    if (disposed) return;
    options.notifications.info(
      "当前资源、会话或输入内容已切换，本次发送已取消。"
    );
  }

  function updateDraft(value: string): void {
    activeConversation.value.draft.value = value;
  }

  function newConversation(): void {
    invalidateSendTarget();
    const conversation = activeConversation.value;
    if (conversation.isBusy.value) {
      options.notifications.warning("请先停止当前回复，再新建对话。");
      return;
    }
    if (
      options.edits.acceptingDocumentIds.value.size > 0 ||
      options.edits.acceptingWorkspaceIds.value.size > 0 ||
      options.edits.hasQueued()
    ) {
      options.notifications.info("请等待智能体修改保存完成后再新建对话");
      return;
    }
    options.showConversation();
    conversation.newConversation();
    options.resource.clearEditorSelectionReferences();
  }

  const selectConversation = createConversationHistorySelection({
    prepare() {
      invalidateSendTarget();
      if (
        options.edits.acceptingDocumentIds.value.size > 0 ||
        options.edits.acceptingWorkspaceIds.value.size > 0 ||
        options.edits.hasQueued()
      ) {
        options.notifications.info("请等待智能体修改保存完成后再切换对话");
        return false;
      }
      return !disposed;
    },
    current: () => activeConversation.value,
    warning: (message) => options.notifications.warning(message),
    busyMessage: "请先停止当前回复，再切换历史对话",
    unavailableMessage: "这条历史对话已不可用，请重新打开历史列表",
    selected(conversation) {
      options.resource.clearEditorSelectionReferences();
      queueMicrotask(() => {
        if (!disposed) options.edits.resumeRecovered([conversation]);
      });
    }
  });

  function useSuggestion(value: string): void {
    activeConversation.value.useSuggestion(value);
  }

  function sendMessage(
    promptAttachments: UserPromptAttachment[] = [],
    rewriteRequest?: ConversationMessageRewriteRequest
  ): Promise<void> {
    if (disposed) return Promise.resolve();
    if (activeSend) {
      options.notifications.info("正在准备上一条消息，请稍候。");
      return Promise.resolve();
    }
    if (
      rewriteRequest &&
      (!activeConversation.value.canRewriteHistory.value ||
        options.edits.acceptingDocumentIds.value.size > 0 ||
        options.edits.acceptingWorkspaceIds.value.size > 0 ||
        options.edits.hasQueued())
    ) {
      options.notifications.info("请先等待当前回复、审批和修改保存全部完成。");
      return Promise.resolve();
    }
    const target = captureSendTarget();
    sendPreflightPending.value = true;
    const operation = (async () => {
      try {
        const readAccess = effectiveShortReadAccess.value;
        const contextDocuments = options.resource
          .contextDocuments()
          .filter((document) => {
            if (!readAccess) return true;
            if (document.domain === "material") {
              return (
                document.materialKind !== undefined &&
                readAccess.material.includes(document.materialKind)
              );
            }
            if (document.domain === "skill") {
              return (
                document.skillKind !== undefined &&
                readAccess.skill.includes(document.skillKind)
              );
            }
            return true;
          });
        const contextReady = await options.resource.ensureDocumentsLoaded(
          options.resource.activeAgentDocument.value.domain === "creation"
            ? withoutMaterialBodies(contextDocuments)
            : contextDocuments
        );
        if (!sendTargetIsCurrent(target)) {
          notifyCanceledSend();
          return;
        }
        if (!contextReady) return;

        const contextSnapshot = options.resource.hydratedCatalogSnapshot();
        const liveDocuments = options.resource.liveWorkspaceDocuments.value;
        const agentDocument = options.resource.activeAgentDocument.value;
        const workspaceId =
          options.resource.activePromptDocument.value.workspaceId;
        const workspaceBook = workspaceId
          ? options.catalog.findBook(workspaceId)
          : undefined;
        const allAttachments =
          contextSnapshot &&
          agentDocument.domain === "creation" &&
          workspaceBook &&
          readAccess
            ? buildLibraryAttachments(
                contextSnapshot,
                withoutMaterialBindings(
                  scopeBookLibrariesToReadAccess(workspaceBook, readAccess)
                )
              )
            : null;
        const attachments = allAttachments
          ? {
              ...allAttachments,
              attachedSkills: allAttachments.attachedSkills.filter(
                (item) =>
                  item.kind !== undefined &&
                  (readAccess?.skill.includes(item.kind) ?? false)
              ),
              attachedMaterials: allAttachments.attachedMaterials.filter(
                (item) =>
                  item.kind !== undefined &&
                  (readAccess?.material.includes(item.kind) ?? false)
              )
            }
          : null;
        const libraryProfile = activeLibraryAgentProfile.value;
        const librarySkillAttachments = libraryProfile
          ? buildLibraryAgentSkillAttachments(libraryProfile.readAccess.skills)
          : null;
        const libraryAgentContext = buildLibraryAgentWorkspaceContext(
          contextSnapshot,
          agentDocument,
          liveDocuments
        );
        if (!sendTargetIsCurrent(target)) {
          notifyCanceledSend();
          return;
        }
        if (
          (agentDocument.domain === "material" ||
            agentDocument.domain === "skill") &&
          !libraryAgentContext
        ) {
          options.notifications.warning(
            "当前资料库上下文尚未就绪，请重新选择条目后再发送。"
          );
          return;
        }
        const attachmentDiagnostics = attachments?.diagnostics ?? [];
        if (attachmentDiagnostics.length) {
          const first = attachmentDiagnostics[0]!;
          options.notifications.warning(
            attachmentDiagnostics.length === 1
              ? first.message
              : `${first.message}（另有 ${attachmentDiagnostics.length - 1} 项资料库提示）`
          );
        }
        const skillDiagnostics = librarySkillAttachments?.diagnostics ?? [];
        if (skillDiagnostics.length) {
          const first = skillDiagnostics[0]!;
          options.notifications.warning(
            skillDiagnostics.length === 1
              ? first.message
              : `${first.message}（另有 ${skillDiagnostics.length - 1} 项可用技能提示）`
          );
        }
        target.conversation.selectApprovalMode(
          options.settings.permissionMode()
        );
        const workspaceAttachments = {
          ...(attachments
            ? {
                attachedSkills: attachments.attachedSkills,
                attachedMaterials: attachments.attachedMaterials
              }
            : librarySkillAttachments
              ? { attachedSkills: librarySkillAttachments.attachedSkills }
              : {}),
          ...(libraryAgentContext
            ? { libraryWorkspace: libraryAgentContext }
            : {})
        };
        let rewriteStarted = true;
        if (rewriteRequest) {
          rewriteStarted = await target.conversation.resendMessage(
            rewriteRequest,
            agentDocument,
            liveDocuments,
            workspaceAttachments
          );
        } else {
          await target.conversation.sendMessage(
            agentDocument,
            liveDocuments,
            workspaceAttachments,
            promptAttachments
          );
        }
        if (!rewriteStarted) return;
        if (!sendTargetIsCurrent(target, { includeDraft: false })) return;
        options.edits.schedule(
          (queued) =>
            queued.conversation === target.conversation &&
            queued.sessionId === target.sessionId
        );
      } catch (error: unknown) {
        if (!disposed && sendTargetIsCurrent(target, { includeDraft: false })) {
          options.notifications.error(
            error instanceof Error
              ? error.message
              : "发送消息失败，请稍后重试。"
          );
        }
      }
    })().finally(() => {
      if (activeSend === operation) {
        activeSend = null;
        activeSendConversation = null;
        sendPreflightPending.value = false;
      }
    });
    activeSend = operation;
    activeSendConversation = target.conversation;
    return operation;
  }

  async function stopGeneration(): Promise<void> {
    const conversation = activeConversation.value;
    try {
      if (await conversation.stopGeneration()) {
        options.notifications.info("已停止生成");
      }
    } catch (error: unknown) {
      if (!disposed) {
        options.notifications.error(
          error instanceof Error ? error.message : "停止生成失败，请稍后重试。"
        );
      }
    }
  }

  function synchronizeActiveRunPreferences(
    conversation = activeConversation.value
  ): void {
    options.runtime.synchronizeRunPreferences(
      activeConversationScope.value,
      conversation
    );
  }

  function selectModel(modelId: string): void {
    const conversation = activeConversation.value;
    conversation.selectModel(modelId);
    options.runtime.synchronizeSessionModelSelection(conversation);
    synchronizeActiveRunPreferences(conversation);
  }

  function selectThinking(level: ThinkingLevel): void {
    const conversation = activeConversation.value;
    conversation.selectThinkingLevel(level);
    options.runtime.synchronizeSessionModelSelection(conversation);
    synchronizeActiveRunPreferences(conversation);
  }

  function selectWebSearch(enabled: boolean): void {
    const conversation = activeConversation.value;
    conversation.selectWebSearchEnabled(enabled);
    options.runtime.synchronizeSessionModelSelection(conversation);
    synchronizeActiveRunPreferences(conversation);
  }

  function selectTemperature(value: number): void {
    activeConversation.value.selectTemperature(value);
    synchronizeActiveRunPreferences();
  }

  function selectApprovalMode(mode: AgentRunSettings["approvalMode"]): void {
    options.settings.updatePermissionMode(mode);
    activeConversation.value.selectApprovalMode(mode);
    synchronizeActiveRunPreferences();
  }

  function selectAgentTeamMode(mode: AgentTeamRunMode): void {
    const conversation = activeConversation.value;
    conversation.selectAgentTeamMode(mode);
    synchronizeActiveRunPreferences(conversation);
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
    stopResourceInvalidation();
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
  }

  return {
    activeConversation,
    activeConversationKey,
    conversationContext,
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
    resendMessage,
    sendMessage,
    sendPreflightPending,
    stopGeneration,
    updateDraft,
    useSuggestion
  };
}

export type ShortConversationCoordinator = ReturnType<
  typeof useShortConversationCoordinator
>;
