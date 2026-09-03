import { nextTick, type ComputedRef, type Ref, type ShallowRef } from "vue";
import {
  LongWorkspaceOperationBatchSchema,
  MaterialStageIdSchema,
  SkillStageIdSchema,
  catalogDraftBodyDocumentId,
  catalogDraftCharacterStateDocumentId,
  createShortWorkspaceContentRevision,
  isProvisionalExpertDraftSectionId,
  parseCatalogDraftDocumentId,
  type Book,
  type CatalogIndexSnapshot,
  type CatalogLibrary,
  type CatalogLibraryEntry,
  type CharacterStructureMutation,
  type DeepWriteApi,
  type LongBookSummary,
  type LongWorkspaceOperationBatch,
  type SystemEventEnvelope
} from "@deepwrite/contracts";
import type { CatalogWorkspaceProjection } from "../data/catalogWorkspace";
import type { AgentEditProposal } from "../types/conversation";
import {
  replaceLongBookSummary,
  resolveLongWorkspaceApi
} from "../types/longWorkspace";
import type { EditorDraftState, WorkspaceDocument } from "../types/workspace";
import {
  agentEditProposalGenerationId,
  agentEditProposalId,
  classifyAgentEditAcceptance,
  expectedMutationBaseRevision,
  latestAgentEditProposalInLane,
  resolveAgentEditProposalGeneration,
  resolveAgentEditorMutationText
} from "../utils/agentEditReview";
import { buildAgentTextDiff } from "../utils/agentTextDiff";
import {
  captureWorkspaceDocumentBaselines,
  type WorkspaceDocumentBaseline
} from "../utils/catalogSaveReconciliation";
import { draftCharacterStateTitle } from "../utils/draftFileTitles";
import { findLongWorldbuildingFile } from "../utils/longWorldbuildingFiles";
import { resolveProvisionalWriteStagingMode } from "../utils/provisionalExpertSectionStaging";
import { textEditDiscardSnapshot } from "../utils/acceptedEditDiscard";
import {
  longCharacterBatchForFiles,
  longWorldbuildingBatchForFile
} from "./proposal-coordinator/long-file-proposal-batches";
import {
  holdLongProposalForManualReview,
  isLongImpactMismatch,
  moveLongProposalToManualReview,
  previewLongProposalImpact
} from "./proposal-coordinator/long-impact-approval";
import { createPlotStructureProposalLane } from "./proposal-coordinator/plot-structure-lane";
import { createProposalQueue } from "./proposal-coordinator/queue";
import {
  createdDraftSectionsAreVisible,
  saveCreatedCharacterContent,
  saveCreatedDraftSectionContents
} from "./proposal-coordinator/creation-content";
import { reconcileCreationDependencyAfterAttempt } from "./proposal-coordinator/creation-dependency";
import { shortAgentDirectDocumentWrite } from "./proposal-coordinator/short-direct-write";
import { createAcceptedEditDiscardCoordinator } from "./accepted-edit-discard";
import type { AgentConversationController } from "./useAgentConversation";
import type { LongWorkspaceProposalEvent } from "./useLongWorkspaceProposals";

type LongChapterWriteProposalEvent = Extract<
  SystemEventEnvelope,
  { type: "long.chapter_write_proposal" }
>;

export type { QueuedAgentEdit } from "./proposal-coordinator/types";

export interface ProposalCoordinatorNotifications {
  error(message: string): void;
  info(message: string): void;
  success(message: string): void;
  warning(message: string): void;
}

export interface ProposalCoordinatorContext {
  api(): DeepWriteApi | undefined;
  notifications: ProposalCoordinatorNotifications;
  catalog: {
    snapshot: ShallowRef<CatalogIndexSnapshot | null>;
    projection: ShallowRef<CatalogWorkspaceProjection | null>;
    catalogBook(bookId: string): Book | undefined;
    findCatalogLibrary(
      domain: "material" | "skill",
      libraryId: string
    ): CatalogLibrary | undefined;
    loadSnapshot(): Promise<unknown>;
    applyAcceptedDocumentLocally(
      payload: { id: string; title: string; content: string },
      savedProjectRevision: number | undefined,
      draftAtAccept: EditorDraftState | undefined
    ): void;
    applyCreatedLibraryEntry(
      domain: "material" | "skill",
      libraryId: string,
      created: CatalogLibraryEntry,
      projectRevision: number | undefined
    ): Promise<void>;
    applySavedLibraryEntry(
      domain: "material" | "skill",
      libraryId: string,
      saved: CatalogLibraryEntry,
      projectRevision: number | undefined
    ): Promise<number | undefined>;
    applyUpdatedLibrary(
      domain: "material" | "skill",
      updated: CatalogLibrary
    ): Promise<void>;
    isConflict(error: unknown): boolean;
    refreshBookAfterSave(
      workspaceId: string,
      expectedDocuments: ReadonlyMap<string, WorkspaceDocumentBaseline>,
      minimumProjectRevision?: number
    ): Promise<boolean>;
  };
  editor: {
    documents: ShallowRef<WorkspaceDocument[]>;
    drafts: Ref<Record<string, EditorDraftState>>;
    liveDocuments: ComputedRef<WorkspaceDocument[]>;
    selectedDraftFileKinds: Ref<Record<string, "body" | "character-state">>;
    selectedExpertSectionIds: Ref<Record<string, string>>;
    acceptingWorkspaceIds: Ref<Set<string>>;
    savingDocumentIds: Ref<Set<string>>;
    rememberWorkspaceMutationEvent(eventId: string): boolean;
    setDocumentAccepting(documentId: string, accepting: boolean): void;
    setWorkspaceAccepting(workspaceId: string, accepting: boolean): void;
  };
  conversations: {
    active: ComputedRef<AgentConversationController>;
    activeLong: ComputedRef<AgentConversationController | null>;
    byKey: Map<string, AgentConversationController>;
    all(): AgentConversationController[];
    remove(
      key: string,
      options?: { dispose?: boolean; clearPersistence?: boolean }
    ): AgentConversationController | undefined;
    legacyDraftSectionKeys(workspaceId: string, sectionId: string): string[];
    forLongProposal(
      event: LongWorkspaceProposalEvent | LongChapterWriteProposalEvent
    ): AgentConversationController | undefined;
  };
  longWorkspace: {
    activeBookId: Ref<string | null>;
    books: ShallowRef<readonly LongBookSummary[]>;
    refreshWorkspaceAfterProposal(bookId: string): Promise<boolean>;
    saveActiveEditorChanges(): Promise<boolean>;
  };
  navigation: {
    selectedResourceId: Ref<string>;
    activeCreationResourceId: Ref<string>;
    rightCollapsed: Ref<boolean>;
  };
}

export function useProposalCoordinator(context: ProposalCoordinatorContext) {
  const acceptedEditDiscard = createAcceptedEditDiscardCoordinator(context);
  const { api, notifications: uiMessage } = context;
  const {
    snapshot: catalogSnapshot,
    projection: catalogProjection,
    catalogBook,
    findCatalogLibrary,
    loadSnapshot: loadCatalogSnapshot,
    applyAcceptedDocumentLocally: applyAcceptedAgentDocumentLocally,
    applyCreatedLibraryEntry,
    applySavedLibraryEntry,
    applyUpdatedLibrary: applyUpdatedCatalogLibrary,
    isConflict: isCatalogConflict,
    refreshBookAfterSave: refreshBookAfterSuccessfulDocumentSave
  } = context.catalog;
  const {
    documents,
    drafts: editorDrafts,
    liveDocuments: liveWorkspaceDocuments,
    selectedDraftFileKinds,
    selectedExpertSectionIds,
    acceptingWorkspaceIds: acceptingAgentEditWorkspaceIds,
    savingDocumentIds,
    rememberWorkspaceMutationEvent,
    setDocumentAccepting: setAgentEditDocumentAccepting,
    setWorkspaceAccepting: setAgentEditWorkspaceAccepting
  } = context.editor;
  const {
    active: activeConversation,
    activeLong: activeLongConversation,
    all: allConversations,
    remove: removeConversation,
    legacyDraftSectionKeys: legacyDraftSectionConversationKeys,
    forLongProposal: longConversationForProposalEvent
  } = context.conversations;
  const {
    activeBookId: activeLongBookId,
    books: longBooks,
    refreshWorkspaceAfterProposal: refreshLongProposalWorkspace,
    saveActiveEditorChanges: saveActiveLongEditorChanges
  } = context.longWorkspace;
  const { selectedResourceId, activeCreationResourceId, rightCollapsed } =
    context.navigation;
  const proposalQueue = createProposalQueue({
    apply: (queued) =>
      applyAgentEdit(
        queued.conversation,
        {
          runId: queued.runId,
          proposalId: queued.proposalId,
          decision: "accept"
        },
        queued.automatic,
        {
          decisionToken: queued.decisionToken,
          expectedProposedRevision: queued.expectedProposedRevision
        }
      ),
    priority: autoApproveEditPriority,
    reportUnexpectedError: (error) => {
      uiMessage.error(
        error instanceof Error ? error.message : "批准智能体修改失败。"
      );
    }
  });
  const {
    removeQueuedAgentEdit,
    queueAgentEdit,
    scheduleQueuedAgentEdits,
    hasQueuedAgentEdits,
    invokeWhileActive,
    drain,
    dispose
  } = proposalQueue;
  const acceptedLibraryMutationCounts = new Map<string, number>();
  const acceptedProvisionalExpertSectionIds = new Map<
    string,
    Map<string, string>
  >();

  type WorkspaceEditorMutationEvent = Extract<
    SystemEventEnvelope,
    { type: "workspace.editor_mutation" }
  >;
  type LibraryEditorMutationEvent = Extract<
    SystemEventEnvelope,
    { type: "library.editor_mutation" }
  >;
  type LongWorldbuildingFileMutationEvent = Extract<
    SystemEventEnvelope,
    { type: "long.worldbuilding_file_proposal" }
  >;
  type LongCharacterFileMutationEvent = Extract<
    SystemEventEnvelope,
    { type: "long.character_file_proposal" }
  >;
  type LongPlotDesignMutationEvent = Extract<
    SystemEventEnvelope,
    { type: "long.mutation_proposal" }
  >;
  type LongDraftMutationEvent = Extract<
    SystemEventEnvelope,
    { type: "long.chapter_write_proposal" }
  >;

  interface AgentEditReviewRequest {
    runId: string;
    proposalId: string;
    decision: "accept" | "reject";
  }

  const plotStructureProposalLane = createPlotStructureProposalLane({
    api,
    catalogBook,
    loadCatalogSnapshot,
    isCatalogConflict,
    isWorkspaceAccepting: (workspaceId) =>
      acceptingAgentEditWorkspaceIds.value.has(workspaceId),
    setWorkspaceAccepting: setAgentEditWorkspaceAccepting,
    notifications: uiMessage,
    queueAgentEdit: (...args) => queueAgentEdit(...args)
  });

  function libraryMutationCountKey(proposal: AgentEditProposal): string {
    const target = proposal.libraryTarget!;
    return `${proposal.runId}\u0000${target.domain}\u0000${target.libraryId}`;
  }

  function currentLibraryProjectRevisionMatches(
    proposal: AgentEditProposal,
    currentRevision: number | undefined
  ): boolean {
    const baseRevision = proposal.libraryTarget?.baseProjectRevision;
    if (baseRevision === undefined || currentRevision === undefined) {
      return baseRevision === currentRevision;
    }
    const acceptedCount =
      acceptedLibraryMutationCounts.get(libraryMutationCountKey(proposal)) ?? 0;
    return currentRevision === baseRevision + acceptedCount;
  }

  function rememberAcceptedLibraryMutation(proposal: AgentEditProposal): void {
    const key = libraryMutationCountKey(proposal);
    acceptedLibraryMutationCounts.set(
      key,
      (acceptedLibraryMutationCounts.get(key) ?? 0) + 1
    );
    while (acceptedLibraryMutationCounts.size > 2_000) {
      const oldest = acceptedLibraryMutationCounts.keys().next().value as
        string | undefined;
      if (!oldest) break;
      acceptedLibraryMutationCounts.delete(oldest);
    }
  }

  async function acceptLibraryCreationProposal(
    conversation: AgentConversationController,
    request: AgentEditReviewRequest,
    proposal: AgentEditProposal,
    automatic: boolean
  ): Promise<void> {
    const target = proposal.libraryTarget;
    if (
      !target ||
      target.operation !== "create" ||
      typeof proposal.proposedText !== "string"
    ) {
      const message = "待审阅的新条目缺少完整内容，请重新生成。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "error",
        statusMessage: message
      });
      uiMessage.error(message);
      return;
    }
    const currentApi = api();
    if (!currentApi) {
      const message = "桌面文件服务当前不可用。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "error",
        statusMessage: message
      });
      uiMessage.error(message);
      return;
    }
    const library = findCatalogLibrary(target.domain, target.libraryId);
    const readOnly =
      !library ||
      (target.domain === "skill" &&
        "isBuiltin" in library &&
        library.isBuiltin);
    if (readOnly) {
      const message = "目标资料库已不可用或只读，无法创建条目。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "conflict",
        statusMessage: message
      });
      uiMessage.warning(message);
      return;
    }
    if (
      !currentLibraryProjectRevisionMatches(proposal, library.projectRevision)
    ) {
      const message = "资料库目录已发生变化，未创建条目，请重新生成。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "conflict",
        statusMessage: message
      });
      uiMessage.warning(message);
      return;
    }
    if (acceptingAgentEditWorkspaceIds.value.has(proposal.workspaceId)) {
      uiMessage.info("同一资料库正在保存其他修改，请稍候再接受");
      return;
    }

    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "accepting",
      statusMessage: automatic
        ? "正在自动批准并创建资料库条目…"
        : "正在校验资料库版本并创建条目…"
    });
    setAgentEditWorkspaceAccepting(proposal.workspaceId, true);
    try {
      const commonInput = {
        libraryId: target.libraryId,
        title: proposal.title,
        content: proposal.proposedText,
        ...(library.projectRevision === undefined
          ? {}
          : { baseProjectRevision: library.projectRevision })
      };
      const created =
        target.domain === "material"
          ? await currentApi.catalog.createLibraryEntry({
              ...commonInput,
              domain: "material",
              stageId: MaterialStageIdSchema.parse(target.stageId)
            })
          : await currentApi.catalog.createLibraryEntry({
              ...commonInput,
              domain: "skill",
              stageId: SkillStageIdSchema.parse(target.stageId)
            });
      const nextProjectRevision =
        library.projectRevision === undefined
          ? undefined
          : library.projectRevision + 1;
      await applyCreatedLibraryEntry(
        target.domain,
        target.libraryId,
        created,
        nextProjectRevision
      );
      rememberAcceptedLibraryMutation(proposal);
      const createdDocument = documents.value.find(
        (document) =>
          document.domain === target.domain &&
          document.libraryId === target.libraryId &&
          document.catalogEntryId === created.id
      );
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "accepted",
        proposedText: undefined,
        ...(createdDocument ? { documentId: createdDocument.id } : {}),
        libraryTarget: {
          ...target,
          entryId: created.id
        },
        statusMessage: automatic
          ? "已自动批准并创建资料库条目。"
          : "已创建并保存到本地 Markdown。"
      });
      if (createdDocument) {
        selectedResourceId.value = createdDocument.id;
        rightCollapsed.value = false;
      }
      uiMessage.success(
        automatic ? "已自动批准并创建资料库条目" : "已创建资料库条目"
      );
    } catch (error: unknown) {
      const message = isCatalogConflict(error)
        ? "资料库已在外部更新，未创建条目；请重新生成。"
        : error instanceof Error
          ? error.message
          : "创建资料库条目失败。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: isCatalogConflict(error) ? "conflict" : "error",
        statusMessage: message
      });
      if (isCatalogConflict(error)) {
        await loadCatalogSnapshot();
        uiMessage.warning(message);
      } else {
        uiMessage.error(message);
      }
    } finally {
      setAgentEditWorkspaceAccepting(proposal.workspaceId, false);
    }
  }

  function provisionalExpertSectionMapKey(
    runId: string,
    workspaceId: string
  ): string {
    return `${runId}\u0000${workspaceId}`;
  }

  function rememberProvisionalExpertSectionMapping(
    runId: string,
    workspaceId: string,
    provisionalSectionId: string,
    realSectionId: string
  ): void {
    const key = provisionalExpertSectionMapKey(runId, workspaceId);
    const map =
      acceptedProvisionalExpertSectionIds.get(key) ?? new Map<string, string>();
    map.set(provisionalSectionId, realSectionId);
    acceptedProvisionalExpertSectionIds.set(key, map);
    while (acceptedProvisionalExpertSectionIds.size > 2_000) {
      const oldest = acceptedProvisionalExpertSectionIds.keys().next().value as
        string | undefined;
      if (!oldest) break;
      acceptedProvisionalExpertSectionIds.delete(oldest);
    }
  }

  function resolveProvisionalExpertSectionId(
    runId: string,
    workspaceId: string,
    sectionId: string
  ): string {
    if (!isProvisionalExpertDraftSectionId(sectionId)) return sectionId;
    return (
      acceptedProvisionalExpertSectionIds
        .get(provisionalExpertSectionMapKey(runId, workspaceId))
        ?.get(sectionId) ?? sectionId
    );
  }

  function findPendingDraftSectionCreationForProvisional(
    conversation: AgentConversationController,
    runId: string,
    provisionalSectionId: string
  ): AgentEditProposal | undefined {
    return conversation
      .listEditProposals(runId)
      .find((proposal) =>
        Boolean(
          proposal.draftSectionCreationTarget?.sections.some(
            (section) => section.provisionalSectionId === provisionalSectionId
          ) &&
          (proposal.status === "pending" ||
            proposal.status === "accepting" ||
            proposal.status === "error")
        )
      );
  }

  function findPendingCharacterCreationForProvisional(
    conversation: AgentConversationController,
    runId: string,
    itemId: string
  ): AgentEditProposal | undefined {
    return conversation.listEditProposals(runId).find((proposal) => {
      const mutation = proposal.characterStructureTarget?.mutation;
      return Boolean(
        mutation?.type === "createItem" &&
        mutation.itemId === itemId &&
        (proposal.status === "pending" ||
          proposal.status === "accepting" ||
          proposal.status === "error")
      );
    });
  }

  function remapProvisionalExpertSectionFileProposals(
    conversation: AgentConversationController,
    runId: string,
    workspaceId: string,
    mapping: ReadonlyMap<string, string>
  ): void {
    for (const proposal of conversation.listEditProposals(runId)) {
      if (!proposal.provisionalExpertSection) continue;
      if (
        proposal.status !== "pending" &&
        proposal.status !== "accepting" &&
        proposal.status !== "error"
      ) {
        continue;
      }
      for (const [provisionalSectionId, realSectionId] of mapping) {
        const provisionalBodyId =
          catalogDraftBodyDocumentId(provisionalSectionId);
        const provisionalStateId =
          catalogDraftCharacterStateDocumentId(provisionalSectionId);
        const fileKind =
          proposal.documentId === provisionalBodyId
            ? ("body" as const)
            : proposal.documentId === provisionalStateId
              ? ("character-state" as const)
              : undefined;
        if (!fileKind) continue;
        const realDocument = liveWorkspaceDocuments.value.find(
          (document) =>
            document.workspaceId === workspaceId &&
            document.stageId === "draft" &&
            document.expertSectionId === realSectionId &&
            document.draftFileKind === fileKind
        );
        if (!realDocument) continue;
        conversation.updateEditProposal(runId, proposal.id, {
          documentId: realDocument.id,
          title: realDocument.title,
          provisionalExpertSection: false,
          baseRevision: proposal.predecessorProposalId
            ? (proposal.baseRevision ??
              createShortWorkspaceContentRevision(realDocument.content))
            : createShortWorkspaceContentRevision(realDocument.content),
          statusMessage:
            proposal.statusMessage ??
            "已关联到新创建的章节文件，接受后将写入正文。"
        });
        break;
      }
    }
  }

  function restoreAcceptedDraftSectionCreationMappings(
    conversation: AgentConversationController
  ): void {
    for (const message of conversation.messages.value) {
      for (const proposal of message.editProposals ?? []) {
        if (
          proposal.status !== "accepted" ||
          !proposal.draftSectionCreationTarget
        ) {
          continue;
        }
        const mapping = new Map<string, string>();
        for (const section of proposal.draftSectionCreationTarget.sections) {
          if (!section.realSectionId) continue;
          mapping.set(section.provisionalSectionId, section.realSectionId);
          rememberProvisionalExpertSectionMapping(
            proposal.runId,
            proposal.workspaceId,
            section.provisionalSectionId,
            section.realSectionId
          );
        }
        if (mapping.size === 0) continue;
        remapProvisionalExpertSectionFileProposals(
          conversation,
          proposal.runId,
          proposal.workspaceId,
          mapping
        );
      }
    }
  }

  function pauseDependentProvisionalFileProposals(
    conversation: AgentConversationController,
    runId: string,
    provisionalSectionIds: readonly string[],
    message: string
  ): void {
    const provisionalSet = new Set(provisionalSectionIds);
    for (const proposal of conversation.listEditProposals(runId)) {
      if (!proposal.provisionalExpertSection) continue;
      const parsed = parseCatalogDraftDocumentId(proposal.documentId);
      if (
        !parsed ||
        !provisionalSet.has(parsed.sectionId) ||
        (proposal.status !== "pending" &&
          proposal.status !== "accepting" &&
          proposal.status !== "error")
      ) {
        continue;
      }
      conversation.updateEditProposal(runId, proposal.id, {
        status: "pending",
        statusMessage: message
      });
    }
  }

  function conflictDependentProvisionalFileProposals(
    conversation: AgentConversationController,
    runId: string,
    provisionalSectionIds: readonly string[],
    message: string
  ): void {
    const provisionalSet = new Set(provisionalSectionIds);
    for (const proposal of conversation.listEditProposals(runId)) {
      if (!proposal.provisionalExpertSection) continue;
      if (
        proposal.status !== "pending" &&
        proposal.status !== "accepting" &&
        proposal.status !== "error"
      ) {
        continue;
      }
      const matches = [...provisionalSet].some((sectionId) => {
        const bodyId = catalogDraftBodyDocumentId(sectionId);
        const stateId = catalogDraftCharacterStateDocumentId(sectionId);
        return (
          proposal.documentId === bodyId || proposal.documentId === stateId
        );
      });
      if (!matches) continue;
      removeQueuedAgentEdit(conversation, runId, proposal.id);
      conversation.updateEditProposal(runId, proposal.id, {
        status: "conflict",
        statusMessage: message,
        proposedText: undefined
      });
    }
  }

  function autoApproveEditPriority(
    conversation: AgentConversationController,
    runId: string,
    proposalId: string
  ): number {
    const proposal = conversation.getEditProposal(runId, proposalId);
    if (!proposal) return 2;
    if (proposal.longWorldbuildingTarget?.file.operation === "create") return 0;
    if (
      proposal.longCharacterTarget?.files.every(
        ({ operation }) => operation === "create"
      )
    )
      return 0;
    if (proposal.longWorldbuildingTarget) {
      return proposal.predecessorProposalId ? 1 : 2;
    }
    if (
      proposal.longCharacterTarget &&
      proposal.longCharacterTarget.files.some(
        ({ operation }) => operation !== "create"
      )
    ) {
      return proposal.predecessorProposalId ? 1 : 2;
    }
    if (proposal.longPlotDesignTarget) {
      return 2;
    }
    if (proposal.longDraftTarget) {
      return proposal.predecessorProposalId ? 1 : 2;
    }
    return 2;
  }

  function draftSectionCreationOperationId(
    proposal: AgentEditProposal
  ): string {
    return [
      "agent-draft-sections",
      proposal.proposedRevision,
      proposal.runId.slice(-120),
      proposal.id.slice(-240)
    ].join(":");
  }

  function latestProposalForLane(
    conversation: AgentConversationController,
    runId: string,
    laneId: string
  ): AgentEditProposal | undefined {
    return latestAgentEditProposalInLane(
      conversation.listEditProposals(runId),
      laneId
    );
  }

  function blockedAgentEditLaneMessage(
    proposal: AgentEditProposal | undefined
  ): string | undefined {
    if (proposal?.status === "rejected") {
      return "前序修改已被拒绝；为避免把被拒内容随后续全文重新带回，本次变更已阻断。";
    }
    if (proposal?.status === "conflict") {
      return "前序修改存在冲突，本次后续变更已阻断，未覆盖当前文稿。";
    }
    return undefined;
  }

  function isShortOrScriptAgentEdit(proposal: AgentEditProposal): boolean {
    if (proposal.libraryTarget) return false;
    const book = catalogBook(proposal.workspaceId);
    return book?.bookType === "short" || book?.bookType === "script";
  }

  function canReviewAgentEditDuringRun(proposal: AgentEditProposal): boolean {
    return (
      Boolean(proposal.libraryTarget) ||
      Boolean(proposal.longWorldbuildingTarget) ||
      Boolean(proposal.longCharacterTarget) ||
      Boolean(proposal.longPlotDesignTarget) ||
      Boolean(proposal.longDraftTarget) ||
      isShortOrScriptAgentEdit(proposal)
    );
  }

  function blockLaterAgentEditGenerations(
    conversation: AgentConversationController,
    rejected: AgentEditProposal
  ): void {
    const laneId = rejected.laneId ?? rejected.id;
    const generation = rejected.generation ?? 1;
    for (const candidate of conversation.listEditProposals(rejected.runId)) {
      if (
        candidate.id === rejected.id ||
        (candidate.laneId ?? candidate.id) !== laneId ||
        (candidate.generation ?? 1) <= generation ||
        (candidate.status !== "pending" && candidate.status !== "error")
      ) {
        continue;
      }
      removeQueuedAgentEdit(conversation, candidate.runId, candidate.id);
      conversation.updateEditProposal(candidate.runId, candidate.id, {
        status: "conflict",
        proposedText: undefined,
        statusMessage:
          "前序正文修改已被拒绝；这项后续修改继承了被拒内容，因此未写入本地文件。"
      });
    }
  }

  async function acceptCharacterStructureProposal(
    conversation: AgentConversationController,
    request: AgentEditReviewRequest,
    proposal: AgentEditProposal,
    automatic: boolean,
    reserved = false
  ): Promise<void> {
    if (
      (proposal.status === "accepting" && !reserved) ||
      proposal.status === "accepted" ||
      proposal.status === "rejected" ||
      proposal.status === "conflict"
    )
      return;
    const target = proposal.characterStructureTarget;
    const book = catalogBook(proposal.workspaceId);
    const currentApi = api();
    if (!target || !book || !currentApi) {
      const message = "人物结构目标已不可用，无法应用本次变更。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "conflict",
        statusMessage: message
      });
      uiMessage.warning(message);
      return;
    }
    const createdItemId =
      target.mutation.type === "createItem"
        ? target.mutation.itemId
        : undefined;
    if (target.mutation.type === "createItem" && !createdItemId) {
      const message = "人物创建缺少稳定条目 id，无法完成顺序写入。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "error",
        statusMessage: message
      });
      uiMessage.error(message);
      return;
    }
    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "accepting",
      statusMessage: automatic ? "正在自动保存人物结构…" : "正在保存人物结构…"
    });
    setAgentEditWorkspaceAccepting(proposal.workspaceId, true);
    try {
      const updatedBook = await currentApi.catalog.mutateCharacterStructure({
        bookId: proposal.workspaceId,
        baseProjectRevision: book.projectRevision ?? 0,
        force: true,
        mutation: target.mutation
      });
      if (
        target.mutation.type === "createItem" &&
        target.initialContent?.trim()
      ) {
        await saveCreatedCharacterContent(currentApi.catalog, {
          bookId: proposal.workspaceId,
          itemId: createdItemId!,
          currentContent:
            updatedBook.documents.find(({ id }) => id === createdItemId)
              ?.content ?? "",
          content: target.initialContent
        });
      }
      await loadCatalogSnapshot();
      if (
        createdItemId &&
        !liveWorkspaceDocuments.value.some(
          (document) =>
            document.workspaceId === proposal.workspaceId &&
            document.catalogDocumentId === createdItemId
        )
      ) {
        throw new Error(
          "人物条目已创建，但刷新工作区后仍无法定位人物文件；请重试以完成正文映射。"
        );
      }
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "accepted",
        proposedText: undefined,
        ...(updatedBook.projectRevision === undefined
          ? {}
          : {
              discardSnapshot: {
                ...proposal.discardSnapshot,
                appliedProjectRevision: updatedBook.projectRevision
              }
            }),
        statusMessage: automatic
          ? "已自动批准并保存人物结构变更。"
          : "人物结构变更已保存到本地。"
      });
      if (!automatic) uiMessage.success("人物结构变更已保存");
    } catch (error) {
      await loadCatalogSnapshot();
      const message =
        error instanceof Error ? error.message : "人物结构变更保存失败。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: isCatalogConflict(error) ? "conflict" : "error",
        statusMessage: message
      });
      uiMessage.error(message);
    } finally {
      setAgentEditWorkspaceAccepting(proposal.workspaceId, false);
    }
  }

  function resumeRecoveredAutomaticAgentEdits(
    conversationsToScan: readonly AgentConversationController[] = allConversations()
  ): void {
    if (!catalogSnapshot.value) return;
    for (const conversation of conversationsToScan) {
      restoreAcceptedDraftSectionCreationMappings(conversation);
    }
    for (const conversation of conversationsToScan) {
      for (const message of conversation.messages.value) {
        for (const proposal of message.editProposals ?? []) {
          if (
            proposal.approvalMode !== "auto-approve" ||
            proposal.status !== "pending" ||
            !canReviewAgentEditDuringRun(proposal)
          ) {
            continue;
          }
          queueAgentEdit(
            conversation,
            conversation.sessionId.value,
            proposal.runId,
            proposal.id,
            true,
            true
          );
        }
      }
    }
  }

  function stageAgentEditProposal(event: WorkspaceEditorMutationEvent): void {
    if (!rememberWorkspaceMutationEvent(event.id)) return;
    const sourceConversation = allConversations().find((conversation) =>
      conversation.acceptsRunEvent(event.payload.sessionId, event.payload.runId)
    );
    if (!sourceConversation) return;
    const runApprovalMode =
      sourceConversation.approvalModeForRun(
        event.payload.sessionId,
        event.payload.runId
      ) ?? "request-approval";

    const mutationTarget = event.payload.mutationTarget;
    if (
      plotStructureProposalLane.stage(
        event,
        sourceConversation,
        runApprovalMode
      )
    ) {
      return;
    }
    if (mutationTarget?.kind === "character-structure") {
      const book = catalogBook(event.payload.workspaceId);
      if (!book || book.characterStructure.format !== "list") {
        const message = "当前人物结构不是条目样式，本次条目操作未进入审阅。";
        sourceConversation.markToolConflict(
          event.payload.runId,
          event.payload.toolCallId,
          message
        );
        uiMessage.warning(message);
        return;
      }
      const source = mutationTarget.mutation;
      const currentUpdatedItem =
        source.type === "updateItem"
          ? book.characterStructure.items.find(({ id }) => id === source.itemId)
          : undefined;
      const previousItemTitle =
        currentUpdatedItem?.title ??
        (source.type === "updateItem" ? source.previousTitle : undefined);
      const mutation: CharacterStructureMutation =
        source.type === "createItem"
          ? {
              type: "createItem",
              title: source.title,
              itemId: source.provisionalItemId
            }
          : source.type === "updateItem"
            ? { type: "updateItem", itemId: source.itemId, title: source.title }
            : source.type === "moveItem"
              ? {
                  type: "moveItem",
                  itemId: source.itemId,
                  direction: source.direction
                }
              : { type: "deleteItem", itemId: source.itemId };
      const documentId = `character-structure:${event.payload.toolCallId}`;
      const proposalId = agentEditProposalId(
        event.payload.runId,
        event.payload.workspaceId,
        "character_design",
        documentId
      );
      if (sourceConversation.getEditProposal(event.payload.runId, proposalId))
        return;
      const beforeText =
        source.type === "deleteItem"
          ? source.deletedText
          : source.type === "updateItem"
            ? previousItemTitle!
            : "";
      const afterText =
        source.type === "deleteItem"
          ? ""
          : source.type === "updateItem"
            ? source.title
            : source.type === "createItem"
              ? source.title
              : event.payload.text;
      const diff = buildAgentTextDiff(beforeText, afterText);
      const proposal: AgentEditProposal = {
        id: proposalId,
        laneId: proposalId,
        generation: 1,
        approvalMode: runApprovalMode,
        sourceBaseRevision: event.payload.baseRevision,
        runId: event.payload.runId,
        workspaceId: event.payload.workspaceId,
        stageId: "character_design",
        documentId,
        title:
          source.type === "createItem"
            ? `创建人物条目：${source.title}`
            : source.type === "updateItem"
              ? `修改人物名称：${previousItemTitle} → ${source.title}`
              : source.type === "moveItem"
                ? `${source.direction === "up" ? "上移" : "下移"}人物条目：${source.title}`
                : `删除人物条目：${source.title}`,
        summary: event.payload.summary,
        status: "pending",
        baseRevision: event.payload.baseRevision,
        proposedRevision: createShortWorkspaceContentRevision(afterText),
        proposedText: afterText,
        toolCallIds: [event.payload.toolCallId],
        additions: diff.additions,
        deletions: diff.deletions,
        hunks: diff.hunks,
        ...(diff.truncated ? { truncated: true } : {}),
        createdAt: event.timestamp,
        updatedAt: event.timestamp,
        ...(source.type === "updateItem"
          ? {
              discardSnapshot: {
                beforeText: previousItemTitle!,
                beforeTitle: previousItemTitle!
              }
            }
          : {}),
        characterStructureTarget: {
          mutation,
          ...(mutationTarget.initialContent
            ? { initialContent: mutationTarget.initialContent }
            : {})
        }
      };
      sourceConversation.upsertEditProposal(event.payload.runId, proposal);
      if (runApprovalMode === "auto-approve") {
        queueAgentEdit(
          sourceConversation,
          event.payload.sessionId,
          event.payload.runId,
          proposalId,
          true,
          true
        );
      }
      return;
    }
    if (mutationTarget?.kind === "expert-draft-section-creation") {
      const directory = catalogProjection.value?.draftDirectories.find(
        (candidate) => candidate.workspaceId === event.payload.workspaceId
      );
      const book = catalogBook(event.payload.workspaceId);
      if (!directory || !book) {
        const message = "目标正文目录已不可用，本次章节创建未进入审阅。";
        sourceConversation.markToolConflict(
          event.payload.runId,
          event.payload.toolCallId,
          message
        );
        uiMessage.warning(message);
        return;
      }

      const documentId = `draft-section-creation:${event.payload.toolCallId}`;
      const proposalId = agentEditProposalId(
        event.payload.runId,
        event.payload.workspaceId,
        "draft",
        documentId
      );
      const existing = sourceConversation.getEditProposal(
        event.payload.runId,
        proposalId
      );
      if (existing?.toolCallIds.includes(event.payload.toolCallId)) return;

      const proposedText = event.payload.text;
      const diff = buildAgentTextDiff("", proposedText);
      const proposal: AgentEditProposal = {
        id: proposalId,
        laneId: proposalId,
        generation: 1,
        approvalMode: runApprovalMode,
        sourceBaseRevision: event.payload.baseRevision,
        runId: event.payload.runId,
        workspaceId: event.payload.workspaceId,
        stageId: "draft",
        documentId,
        title: `创建 ${mutationTarget.sections.length} 个空白章节`,
        summary: event.payload.summary,
        status: "pending",
        baseRevision: event.payload.baseRevision,
        proposedRevision: createShortWorkspaceContentRevision(proposedText),
        proposedText,
        toolCallIds: [event.payload.toolCallId],
        additions: diff.additions,
        deletions: diff.deletions,
        hunks: diff.hunks,
        ...(diff.truncated ? { truncated: true } : {}),
        createdAt: event.timestamp,
        updatedAt: event.timestamp,
        draftSectionCreationTarget: {
          sections: mutationTarget.sections.map((section) => ({
            title: section.title,
            wordCountRequirement: section.wordCountRequirement,
            provisionalSectionId: section.provisionalSectionId,
            ...(section.bodyContent === undefined
              ? {}
              : { bodyContent: section.bodyContent }),
            ...(section.characterStateContent === undefined
              ? {}
              : { characterStateContent: section.characterStateContent })
          })),
          ...(mutationTarget.afterSectionId
            ? { afterSectionId: mutationTarget.afterSectionId }
            : {})
        }
      };
      sourceConversation.upsertEditProposal(event.payload.runId, proposal);
      if (runApprovalMode === "auto-approve") {
        queueAgentEdit(
          sourceConversation,
          event.payload.sessionId,
          event.payload.runId,
          proposalId,
          true,
          true
        );
      }
      return;
    }

    if (mutationTarget?.kind === "expert-draft-section-rename") {
      const directory = catalogProjection.value?.draftDirectories.find(
        (candidate) => candidate.workspaceId === event.payload.workspaceId
      );
      const book = catalogBook(event.payload.workspaceId);
      const section = directory?.sections.find(
        (candidate) => candidate.id === mutationTarget.sectionId
      );
      if (!directory || !book || !section) {
        const message = "目标章节已不可用，本次章节改名未进入审阅。";
        sourceConversation.markToolConflict(
          event.payload.runId,
          event.payload.toolCallId,
          message
        );
        uiMessage.warning(message);
        return;
      }
      const documentId = `draft-section-rename:${event.payload.toolCallId}`;
      const proposalId = agentEditProposalId(
        event.payload.runId,
        event.payload.workspaceId,
        "draft",
        documentId
      );
      const existing = sourceConversation.getEditProposal(
        event.payload.runId,
        proposalId
      );
      if (existing?.toolCallIds.includes(event.payload.toolCallId)) return;

      const proposedText = event.payload.text;
      const diff = buildAgentTextDiff(
        mutationTarget.previousTitle,
        mutationTarget.title
      );
      const proposal: AgentEditProposal = {
        id: proposalId,
        laneId: proposalId,
        generation: 1,
        approvalMode: runApprovalMode,
        sourceBaseRevision: event.payload.baseRevision,
        runId: event.payload.runId,
        workspaceId: event.payload.workspaceId,
        stageId: "draft",
        documentId,
        title: `修改章节名称：${mutationTarget.previousTitle} → ${mutationTarget.title}`,
        summary: event.payload.summary,
        status: "pending",
        baseRevision: event.payload.baseRevision,
        proposedRevision: createShortWorkspaceContentRevision(proposedText),
        proposedText,
        toolCallIds: [event.payload.toolCallId],
        additions: diff.additions,
        deletions: diff.deletions,
        hunks: diff.hunks,
        ...(diff.truncated ? { truncated: true } : {}),
        createdAt: event.timestamp,
        updatedAt: event.timestamp,
        draftSectionRenameTarget: {
          sectionId: mutationTarget.sectionId,
          previousTitle: mutationTarget.previousTitle,
          title: mutationTarget.title
        }
      };
      sourceConversation.upsertEditProposal(event.payload.runId, proposal);
      if (runApprovalMode === "auto-approve") {
        queueAgentEdit(
          sourceConversation,
          event.payload.sessionId,
          event.payload.runId,
          proposalId,
          true,
          true
        );
      }
      return;
    }

    if (mutationTarget?.kind === "expert-draft-section-deletion") {
      const directory = catalogProjection.value?.draftDirectories.find(
        (candidate) => candidate.workspaceId === event.payload.workspaceId
      );
      const book = catalogBook(event.payload.workspaceId);
      const section = directory?.sections.find(
        (candidate) => candidate.id === mutationTarget.sectionId
      );
      const draftUnit =
        directory?.workspaceType === "script" || book?.bookType === "script"
          ? "剧集"
          : "章节";
      if (!directory || !book || !section) {
        const message = `目标${draftUnit}已不可用，本次${draftUnit}删除未进入审阅。`;
        sourceConversation.markToolConflict(
          event.payload.runId,
          event.payload.toolCallId,
          message
        );
        uiMessage.warning(message);
        return;
      }
      const documentId = `draft-section-deletion:${event.payload.toolCallId}`;
      const proposalId = agentEditProposalId(
        event.payload.runId,
        event.payload.workspaceId,
        "draft",
        documentId
      );
      const existing = sourceConversation.getEditProposal(
        event.payload.runId,
        proposalId
      );
      if (existing?.toolCallIds.includes(event.payload.toolCallId)) return;

      const proposedText = event.payload.text;
      const diff = buildAgentTextDiff(mutationTarget.title, "");
      const proposal: AgentEditProposal = {
        id: proposalId,
        laneId: proposalId,
        generation: 1,
        approvalMode: runApprovalMode,
        sourceBaseRevision: event.payload.baseRevision,
        runId: event.payload.runId,
        workspaceId: event.payload.workspaceId,
        stageId: "draft",
        documentId,
        title: `删除${draftUnit}：${mutationTarget.title}`,
        summary: event.payload.summary,
        status: "pending",
        baseRevision: event.payload.baseRevision,
        proposedRevision: createShortWorkspaceContentRevision(proposedText),
        proposedText,
        toolCallIds: [event.payload.toolCallId],
        additions: diff.additions,
        deletions: diff.deletions,
        hunks: diff.hunks,
        ...(diff.truncated ? { truncated: true } : {}),
        createdAt: event.timestamp,
        updatedAt: event.timestamp,
        draftSectionDeletionTarget: {
          sectionId: mutationTarget.sectionId,
          title: mutationTarget.title
        }
      };
      sourceConversation.upsertEditProposal(event.payload.runId, proposal);
      if (runApprovalMode === "auto-approve") {
        queueAgentEdit(
          sourceConversation,
          event.payload.sessionId,
          event.payload.runId,
          proposalId,
          true,
          true
        );
      }
      return;
    }

    const expectedDraftFileKind =
      mutationTarget?.kind === "expert-draft-file" &&
      mutationTarget.fileKind === "characterState"
        ? "character-state"
        : mutationTarget?.kind === "expert-draft-file"
          ? mutationTarget.fileKind
          : undefined;
    const target = liveWorkspaceDocuments.value.find((document) =>
      mutationTarget?.kind === "character-file"
        ? document.catalogDocumentId === mutationTarget.documentId &&
          document.workspaceId === event.payload.workspaceId &&
          document.stageId === "character_design"
        : mutationTarget?.kind === "expert-draft-file"
          ? document.id === mutationTarget.documentId &&
            document.workspaceId === event.payload.workspaceId &&
            document.stageId === "draft" &&
            document.expertSectionId === mutationTarget.sectionId &&
            document.draftFileKind === expectedDraftFileKind
          : document.workspaceId === event.payload.workspaceId &&
            document.stageId === event.payload.stageId &&
            document.draftFileKind === undefined
    );
    if (
      (!target || target.readOnly) &&
      mutationTarget?.kind === "expert-draft-file" &&
      isProvisionalExpertDraftSectionId(mutationTarget.sectionId)
    ) {
      const creation = findPendingDraftSectionCreationForProvisional(
        sourceConversation,
        event.payload.runId,
        mutationTarget.sectionId
      );
      const realSectionId = resolveProvisionalExpertSectionId(
        event.payload.runId,
        event.payload.workspaceId,
        mutationTarget.sectionId
      );
      const stagingMode = resolveProvisionalWriteStagingMode({
        hasPendingCreation: Boolean(creation),
        provisionalSectionId: mutationTarget.sectionId,
        resolvedSectionId: realSectionId
      });

      // Mid-run accept already landed the chapter: keep staging on the same
      // provisional-keyed proposal id, but validate/write against the real file.
      if (stagingMode === "mapped-real") {
        const realTarget = liveWorkspaceDocuments.value.find(
          (document) =>
            document.workspaceId === event.payload.workspaceId &&
            document.stageId === "draft" &&
            document.expertSectionId === realSectionId &&
            document.draftFileKind === expectedDraftFileKind
        );
        if (!realTarget || realTarget.readOnly) {
          const message =
            "目标章节尚未创建或已失效，本次智能体变更未进入审阅。";
          sourceConversation.markToolConflict(
            event.payload.runId,
            event.payload.toolCallId,
            message
          );
          uiMessage.warning(message);
          return;
        }

        const laneId = agentEditProposalId(
          event.payload.runId,
          event.payload.workspaceId,
          event.payload.stageId,
          mutationTarget.documentId
        );
        const existing = latestProposalForLane(
          sourceConversation,
          event.payload.runId,
          laneId
        );
        if (existing?.toolCallIds.includes(event.payload.toolCallId)) {
          return;
        }
        const blockedMessage = blockedAgentEditLaneMessage(existing);
        if (blockedMessage) {
          sourceConversation.markToolConflict(
            event.payload.runId,
            event.payload.toolCallId,
            blockedMessage
          );
          return;
        }
        const currentRevision = createShortWorkspaceContentRevision(
          realTarget.content
        );

        const resolvedMutation = resolveAgentEditorMutationText(
          existing?.proposedText !== undefined
            ? existing.proposedText
            : realTarget.content,
          event.payload
        );
        if ("error" in resolvedMutation) {
          if (existing) {
            sourceConversation.updateEditProposal(
              event.payload.runId,
              existing.id,
              {
                status: "conflict",
                statusMessage: resolvedMutation.error,
                updatedAt: event.timestamp
              }
            );
          }
          sourceConversation.markToolConflict(
            event.payload.runId,
            event.payload.toolCallId,
            resolvedMutation.error
          );
          uiMessage.warning(resolvedMutation.error);
          return;
        }
        const proposedText = resolvedMutation.text;
        const proposedRevision =
          createShortWorkspaceContentRevision(proposedText);
        const diff = buildAgentTextDiff(realTarget.content, proposedText);
        const identity = resolveAgentEditProposalGeneration(laneId, existing);
        const applyBaseRevision = identity.coalescesExisting
          ? (existing!.baseRevision ?? event.payload.baseRevision)
          : (existing?.proposedRevision ?? event.payload.baseRevision);
        const noChanges =
          proposedRevision === currentRevision &&
          (!existing ||
            existing.status === "accepted" ||
            identity.coalescesExisting);
        const proposal: AgentEditProposal = {
          id: identity.id,
          laneId,
          generation: identity.generation,
          approvalMode: runApprovalMode,
          sourceBaseRevision: event.payload.baseRevision,
          ...(identity.predecessorProposalId
            ? { predecessorProposalId: identity.predecessorProposalId }
            : {}),
          runId: event.payload.runId,
          workspaceId: event.payload.workspaceId,
          stageId: event.payload.stageId,
          documentId: realTarget.id,
          title: realTarget.title,
          summary: event.payload.summary,
          status: noChanges ? "accepted" : "pending",
          baseRevision: applyBaseRevision,
          proposedRevision,
          ...(noChanges ? {} : { proposedText }),
          toolCallIds: [
            ...new Set([
              ...(identity.coalescesExisting
                ? (existing?.toolCallIds ?? [])
                : []),
              event.payload.toolCallId
            ])
          ],
          additions: diff.additions,
          deletions: diff.deletions,
          hunks: diff.hunks,
          ...(diff.truncated ? { truncated: true } : {}),
          ...(noChanges
            ? { statusMessage: "文本没有实际变化，无需保存。" }
            : {}),
          createdAt:
            identity.coalescesExisting && existing
              ? existing.createdAt
              : event.timestamp,
          updatedAt: event.timestamp,
          discardSnapshot: textEditDiscardSnapshot(
            existing,
            identity.coalescesExisting,
            realTarget.content,
            realTarget.title
          ),
          provisionalExpertSection: false
        };
        sourceConversation.upsertEditProposal(event.payload.runId, proposal);
        if (!noChanges && runApprovalMode === "auto-approve") {
          queueAgentEdit(
            sourceConversation,
            event.payload.sessionId,
            event.payload.runId,
            proposal.id,
            true,
            true
          );
        }
        return;
      }

      if (stagingMode === "unavailable" || !creation) {
        const message = "目标章节尚未创建或已失效，本次智能体变更未进入审阅。";
        sourceConversation.markToolConflict(
          event.payload.runId,
          event.payload.toolCallId,
          message
        );
        uiMessage.warning(message);
        return;
      }
      const laneId = agentEditProposalId(
        event.payload.runId,
        event.payload.workspaceId,
        event.payload.stageId,
        mutationTarget.documentId
      );
      const existing = latestProposalForLane(
        sourceConversation,
        event.payload.runId,
        laneId
      );
      if (existing?.toolCallIds.includes(event.payload.toolCallId)) {
        return;
      }
      const blockedMessage = blockedAgentEditLaneMessage(existing);
      if (blockedMessage) {
        sourceConversation.markToolConflict(
          event.payload.runId,
          event.payload.toolCallId,
          blockedMessage
        );
        return;
      }
      const baseText = existing?.proposedText ?? "";
      const resolvedMutation = resolveAgentEditorMutationText(
        baseText,
        event.payload
      );
      if ("error" in resolvedMutation) {
        if (existing) {
          sourceConversation.updateEditProposal(
            event.payload.runId,
            existing.id,
            {
              status: "conflict",
              statusMessage: resolvedMutation.error,
              updatedAt: event.timestamp
            }
          );
        }
        sourceConversation.markToolConflict(
          event.payload.runId,
          event.payload.toolCallId,
          resolvedMutation.error
        );
        uiMessage.warning(resolvedMutation.error);
        return;
      }
      const proposedText = resolvedMutation.text;
      const proposedRevision =
        createShortWorkspaceContentRevision(proposedText);
      const diff = buildAgentTextDiff(baseText, proposedText);
      const identity = resolveAgentEditProposalGeneration(laneId, existing);
      const applyBaseRevision = identity.coalescesExisting
        ? (existing!.baseRevision ?? event.payload.baseRevision)
        : (existing?.proposedRevision ?? event.payload.baseRevision);
      const noChanges =
        proposedRevision === createShortWorkspaceContentRevision("") &&
        (!existing ||
          existing.status === "accepted" ||
          identity.coalescesExisting);
      const sectionTitle =
        creation.draftSectionCreationTarget?.sections.find(
          (section) => section.provisionalSectionId === mutationTarget.sectionId
        )?.title ?? "新章节";
      const title =
        mutationTarget.fileKind === "characterState"
          ? `${sectionTitle} · 人物状态`
          : sectionTitle;
      const proposal: AgentEditProposal = {
        id: identity.id,
        laneId,
        generation: identity.generation,
        approvalMode: runApprovalMode,
        sourceBaseRevision: event.payload.baseRevision,
        ...(identity.predecessorProposalId
          ? { predecessorProposalId: identity.predecessorProposalId }
          : {}),
        runId: event.payload.runId,
        workspaceId: event.payload.workspaceId,
        stageId: event.payload.stageId,
        documentId: mutationTarget.documentId,
        title,
        summary: event.payload.summary,
        status: noChanges ? "accepted" : "pending",
        baseRevision: applyBaseRevision,
        proposedRevision,
        ...(noChanges ? {} : { proposedText }),
        toolCallIds: [
          ...new Set([
            ...(identity.coalescesExisting
              ? (existing?.toolCallIds ?? [])
              : []),
            event.payload.toolCallId
          ])
        ],
        additions: diff.additions,
        deletions: diff.deletions,
        hunks: diff.hunks,
        ...(diff.truncated ? { truncated: true } : {}),
        ...(noChanges ? { statusMessage: "文本没有实际变化，无需保存。" } : {}),
        createdAt:
          identity.coalescesExisting && existing
            ? existing.createdAt
            : event.timestamp,
        updatedAt: event.timestamp,
        provisionalExpertSection: true
      };
      sourceConversation.upsertEditProposal(event.payload.runId, proposal);
      if (!noChanges && runApprovalMode === "auto-approve") {
        queueAgentEdit(
          sourceConversation,
          event.payload.sessionId,
          event.payload.runId,
          proposal.id,
          true,
          true
        );
      }
      return;
    }

    if (
      (!target || target.readOnly) &&
      mutationTarget?.kind === "character-file" &&
      mutationTarget.itemId
    ) {
      const creation = findPendingCharacterCreationForProvisional(
        sourceConversation,
        event.payload.runId,
        mutationTarget.itemId
      );
      const creationMutation = creation?.characterStructureTarget?.mutation;
      if (!creation || creationMutation?.type !== "createItem") {
        const message =
          "目标人物条目尚未创建或已失效，本次智能体变更未进入审阅。";
        sourceConversation.markToolConflict(
          event.payload.runId,
          event.payload.toolCallId,
          message
        );
        uiMessage.warning(message);
        return;
      }
      const futureDocumentId = [
        "catalog",
        "book-document",
        encodeURIComponent(event.payload.workspaceId),
        encodeURIComponent(mutationTarget.itemId)
      ].join(":");
      const laneId = agentEditProposalId(
        event.payload.runId,
        event.payload.workspaceId,
        event.payload.stageId,
        futureDocumentId
      );
      const existing = latestProposalForLane(
        sourceConversation,
        event.payload.runId,
        laneId
      );
      if (existing?.toolCallIds.includes(event.payload.toolCallId)) return;
      const blockedMessage = blockedAgentEditLaneMessage(existing);
      if (blockedMessage) {
        sourceConversation.markToolConflict(
          event.payload.runId,
          event.payload.toolCallId,
          blockedMessage
        );
        return;
      }
      const baseText = existing?.proposedText ?? "";
      const resolvedMutation = resolveAgentEditorMutationText(
        baseText,
        event.payload
      );
      if ("error" in resolvedMutation) {
        sourceConversation.markToolConflict(
          event.payload.runId,
          event.payload.toolCallId,
          resolvedMutation.error
        );
        uiMessage.warning(resolvedMutation.error);
        return;
      }
      const proposedText = resolvedMutation.text;
      const proposedRevision =
        createShortWorkspaceContentRevision(proposedText);
      const diff = buildAgentTextDiff(baseText, proposedText);
      const identity = resolveAgentEditProposalGeneration(laneId, existing);
      const proposal: AgentEditProposal = {
        id: identity.id,
        laneId,
        generation: identity.generation,
        approvalMode: runApprovalMode,
        sourceBaseRevision: event.payload.baseRevision,
        ...(identity.predecessorProposalId
          ? { predecessorProposalId: identity.predecessorProposalId }
          : {}),
        runId: event.payload.runId,
        workspaceId: event.payload.workspaceId,
        stageId: event.payload.stageId,
        documentId: futureDocumentId,
        title: creationMutation.title,
        summary: event.payload.summary,
        status: "pending",
        baseRevision: identity.coalescesExisting
          ? (existing!.baseRevision ?? event.payload.baseRevision)
          : (existing?.proposedRevision ?? event.payload.baseRevision),
        proposedRevision,
        proposedText,
        toolCallIds: [
          ...new Set([
            ...(identity.coalescesExisting
              ? (existing?.toolCallIds ?? [])
              : []),
            event.payload.toolCallId
          ])
        ],
        additions: diff.additions,
        deletions: diff.deletions,
        hunks: diff.hunks,
        ...(diff.truncated ? { truncated: true } : {}),
        createdAt:
          identity.coalescesExisting && existing
            ? existing.createdAt
            : event.timestamp,
        updatedAt: event.timestamp,
        provisionalCharacterItemId: mutationTarget.itemId
      };
      sourceConversation.upsertEditProposal(event.payload.runId, proposal);
      if (runApprovalMode === "auto-approve") {
        queueAgentEdit(
          sourceConversation,
          event.payload.sessionId,
          event.payload.runId,
          proposal.id,
          true,
          true
        );
      }
      return;
    }

    if (!target || target.readOnly) {
      const message = "目标文稿不可写，本次智能体变更未进入审阅。";
      sourceConversation.markToolConflict(
        event.payload.runId,
        event.payload.toolCallId,
        message
      );
      uiMessage.warning(message);
      return;
    }

    const laneId = agentEditProposalId(
      event.payload.runId,
      event.payload.workspaceId,
      event.payload.stageId,
      target.id
    );
    const existing = latestProposalForLane(
      sourceConversation,
      event.payload.runId,
      laneId
    );
    if (existing?.toolCallIds.includes(event.payload.toolCallId)) {
      return;
    }
    const blockedMessage = blockedAgentEditLaneMessage(existing);
    if (blockedMessage) {
      sourceConversation.markToolConflict(
        event.payload.runId,
        event.payload.toolCallId,
        blockedMessage
      );
      return;
    }
    const currentRevision = createShortWorkspaceContentRevision(target.content);
    const resolvedMutation = resolveAgentEditorMutationText(
      event.payload.mutationTarget && existing?.proposedText !== undefined
        ? existing.proposedText
        : target.content,
      event.payload
    );
    if ("error" in resolvedMutation) {
      if (
        existing &&
        (existing.status === "pending" || existing.status === "error")
      ) {
        sourceConversation.updateEditProposal(
          event.payload.runId,
          existing.id,
          {
            status: "conflict",
            statusMessage: resolvedMutation.error,
            updatedAt: event.timestamp
          }
        );
      }
      sourceConversation.markToolConflict(
        event.payload.runId,
        event.payload.toolCallId,
        resolvedMutation.error
      );
      uiMessage.warning(resolvedMutation.error);
      return;
    }
    const proposedText = resolvedMutation.text;
    const proposedRevision = createShortWorkspaceContentRevision(proposedText);

    const diff = buildAgentTextDiff(target.content, proposedText);
    const identity = resolveAgentEditProposalGeneration(laneId, existing);
    const applyBaseRevision = identity.coalescesExisting
      ? (existing!.baseRevision ?? event.payload.baseRevision)
      : (existing?.proposedRevision ?? event.payload.baseRevision);
    const noChanges =
      proposedRevision === currentRevision &&
      (!existing ||
        existing.status === "accepted" ||
        identity.coalescesExisting);
    const proposal: AgentEditProposal = {
      id: identity.id,
      laneId,
      generation: identity.generation,
      approvalMode: runApprovalMode,
      sourceBaseRevision: event.payload.baseRevision,
      ...(identity.predecessorProposalId
        ? { predecessorProposalId: identity.predecessorProposalId }
        : {}),
      runId: event.payload.runId,
      workspaceId: event.payload.workspaceId,
      stageId: event.payload.stageId,
      documentId: target.id,
      title: target.title,
      summary: event.payload.summary,
      status: noChanges ? "accepted" : "pending",
      baseRevision: applyBaseRevision,
      proposedRevision,
      ...(noChanges ? {} : { proposedText }),
      toolCallIds: [
        ...new Set([
          ...(identity.coalescesExisting ? (existing?.toolCallIds ?? []) : []),
          event.payload.toolCallId
        ])
      ],
      additions: diff.additions,
      deletions: diff.deletions,
      hunks: diff.hunks,
      ...(diff.truncated ? { truncated: true } : {}),
      ...(noChanges ? { statusMessage: "文本没有实际变化，无需保存。" } : {}),
      createdAt:
        identity.coalescesExisting && existing
          ? existing.createdAt
          : event.timestamp,
      updatedAt: event.timestamp,
      discardSnapshot: textEditDiscardSnapshot(
        existing,
        identity.coalescesExisting,
        target.content,
        target.title
      )
    };
    sourceConversation.upsertEditProposal(event.payload.runId, proposal);
    if (!noChanges && runApprovalMode === "auto-approve") {
      queueAgentEdit(
        sourceConversation,
        event.payload.sessionId,
        event.payload.runId,
        proposal.id,
        true,
        true
      );
    }
  }

  function longPlotDesignProposalText(
    batch: LongWorkspaceOperationBatch
  ): string {
    return JSON.stringify(
      {
        structureOperations: batch.operations,
        documentWrites: batch.documentWrites
      },
      null,
      2
    );
  }

  function stageLongPlotDesignEditProposal(
    event: LongPlotDesignMutationEvent
  ): void {
    if (!rememberWorkspaceMutationEvent(event.id)) return;
    const sourceConversation = longConversationForProposalEvent(event);
    if (!sourceConversation) return;
    const runApprovalMode =
      sourceConversation.approvalModeForRun(
        event.payload.sessionId,
        event.payload.runId
      ) ?? "request-approval";
    const workspaceId = `long:${event.payload.bookId}`;
    const laneId = agentEditProposalId(
      event.payload.runId,
      workspaceId,
      "long-plot-design",
      "plot-design"
    );
    const existing = latestProposalForLane(
      sourceConversation,
      event.payload.runId,
      laneId
    );
    if (existing?.toolCallIds.includes(event.payload.toolCallId)) return;
    const blockedMessage = blockedAgentEditLaneMessage(existing);
    if (blockedMessage) {
      sourceConversation.markToolConflict(
        event.payload.runId,
        event.payload.toolCallId,
        blockedMessage
      );
      return;
    }
    const generation = existing ? (existing.generation ?? 1) + 1 : 1;
    const proposalId = agentEditProposalGenerationId(laneId, generation);
    const proposalText = longPlotDesignProposalText(event.payload.batch);
    const diff = buildAgentTextDiff("", proposalText);
    const proposal: AgentEditProposal = {
      id: proposalId,
      laneId,
      generation,
      approvalMode: runApprovalMode,
      ...(existing ? { predecessorProposalId: existing.id } : {}),
      runId: event.payload.runId,
      workspaceId,
      stageId: "long-plot-design",
      documentId: "plot-design",
      title: "剧情设计变更",
      summary: event.payload.summary,
      status: "pending",
      proposedText: proposalText,
      toolCallIds: [event.payload.toolCallId],
      additions: diff.additions,
      deletions: diff.deletions,
      hunks: diff.hunks,
      ...(diff.truncated ? { truncated: true } : {}),
      createdAt: event.timestamp,
      updatedAt: event.timestamp,
      longPlotDesignTarget: {
        bookId: event.payload.bookId,
        batch: LongWorkspaceOperationBatchSchema.parse(event.payload.batch)
      }
    };
    sourceConversation.upsertEditProposal(event.payload.runId, proposal);
    if (runApprovalMode === "auto-approve") {
      queueAgentEdit(
        sourceConversation,
        event.payload.sessionId,
        event.payload.runId,
        proposal.id,
        true,
        true
      );
    }
  }

  function stageLongWorldbuildingEditProposal(
    event: LongWorldbuildingFileMutationEvent
  ): void {
    if (!rememberWorkspaceMutationEvent(event.id)) return;
    const sourceConversation = longConversationForProposalEvent(event);
    if (!sourceConversation) return;
    const file = event.payload.files[0];
    const batch = longWorldbuildingBatchForFile(event);
    if (!file || !batch) {
      const message =
        "世界观文件工具必须一次只形成一个独立文件变更，本次结果未进入审批。";
      sourceConversation.markToolConflict(
        event.payload.runId,
        event.payload.toolCallId,
        message
      );
      uiMessage.warning(message);
      return;
    }
    const runApprovalMode =
      sourceConversation.approvalModeForRun(
        event.payload.sessionId,
        event.payload.runId
      ) ?? "request-approval";
    const workspaceId = `long:${event.payload.bookId}`;
    const laneDocumentId =
      file.operation === "create" ? `create:${file.fileId}` : file.fileId;
    const laneId = agentEditProposalId(
      event.payload.runId,
      workspaceId,
      "long-worldbuilding",
      laneDocumentId
    );
    const existing = latestProposalForLane(
      sourceConversation,
      event.payload.runId,
      laneId
    );
    if (existing?.toolCallIds.includes(event.payload.toolCallId)) return;
    const blockedMessage = blockedAgentEditLaneMessage(existing);
    if (blockedMessage) {
      sourceConversation.markToolConflict(
        event.payload.runId,
        event.payload.toolCallId,
        blockedMessage
      );
      return;
    }
    const creationPredecessor =
      file.operation === "create"
        ? undefined
        : sourceConversation
            .listEditProposals(event.payload.runId)
            .find(
              (proposal) =>
                proposal.longWorldbuildingTarget?.file.fileId === file.fileId &&
                proposal.longWorldbuildingTarget.file.operation === "create" &&
                proposal.status !== "rejected" &&
                proposal.status !== "conflict"
            );
    const generation = existing ? (existing.generation ?? 1) + 1 : 1;
    const proposalId = agentEditProposalGenerationId(laneId, generation);
    const predecessorProposalId = existing?.id ?? creationPredecessor?.id;
    const diff = buildAgentTextDiff(file.beforeText, file.afterText);
    const noChanges =
      file.operation !== "create" && file.beforeText === file.afterText;
    const proposal: AgentEditProposal = {
      id: proposalId,
      laneId,
      generation,
      approvalMode: runApprovalMode,
      ...(predecessorProposalId ? { predecessorProposalId } : {}),
      runId: event.payload.runId,
      workspaceId,
      stageId: "long-worldbuilding",
      documentId: file.fileId,
      title: file.title,
      summary: event.payload.summary,
      status: noChanges ? "accepted" : "pending",
      ...(noChanges ? {} : { proposedText: file.afterText }),
      toolCallIds: [event.payload.toolCallId],
      additions: diff.additions,
      deletions: diff.deletions,
      hunks: diff.hunks,
      ...(diff.truncated ? { truncated: true } : {}),
      ...(noChanges ? { statusMessage: "文本没有实际变化，无需保存。" } : {}),
      createdAt: event.timestamp,
      updatedAt: event.timestamp,
      longWorldbuildingTarget: {
        bookId: event.payload.bookId,
        batch,
        file
      }
    };
    sourceConversation.upsertEditProposal(event.payload.runId, proposal);
    if (!noChanges && runApprovalMode === "auto-approve") {
      queueAgentEdit(
        sourceConversation,
        event.payload.sessionId,
        event.payload.runId,
        proposal.id,
        true,
        true
      );
    }
  }

  function stageLongCharacterEditProposal(
    event: LongCharacterFileMutationEvent
  ): void {
    if (!rememberWorkspaceMutationEvent(event.id)) return;
    const sourceConversation = longConversationForProposalEvent(event);
    if (!sourceConversation) return;
    const files = event.payload.files;
    const batch = longCharacterBatchForFiles(event);
    if (!files.length || !batch) {
      const message =
        "人物文件工具必须形成一名人物的完整创建变更，或一次只修改一份人物档案；本次结果未进入审批。";
      sourceConversation.markToolConflict(
        event.payload.runId,
        event.payload.toolCallId,
        message
      );
      uiMessage.warning(message);
      return;
    }
    const isCreation = files.every(({ operation }) => operation === "create");
    const primaryFile = files[0]!;
    const runApprovalMode =
      sourceConversation.approvalModeForRun(
        event.payload.sessionId,
        event.payload.runId
      ) ?? "request-approval";
    const workspaceId = `long:${event.payload.bookId}`;
    const laneDocumentId = isCreation
      ? `create:${primaryFile.characterId}`
      : primaryFile.fileId;
    const laneId = agentEditProposalId(
      event.payload.runId,
      workspaceId,
      "long-character",
      laneDocumentId
    );
    const existing = latestProposalForLane(
      sourceConversation,
      event.payload.runId,
      laneId
    );
    if (existing?.toolCallIds.includes(event.payload.toolCallId)) return;
    const blockedMessage = blockedAgentEditLaneMessage(existing);
    if (blockedMessage) {
      sourceConversation.markToolConflict(
        event.payload.runId,
        event.payload.toolCallId,
        blockedMessage
      );
      return;
    }
    const creationPredecessor = isCreation
      ? undefined
      : sourceConversation
          .listEditProposals(event.payload.runId)
          .find(
            (proposal) =>
              proposal.longCharacterTarget?.files.some(
                (file) =>
                  file.fileId === primaryFile.fileId &&
                  file.operation === "create"
              ) &&
              proposal.status !== "rejected" &&
              proposal.status !== "conflict"
          );
    const generation = existing ? (existing.generation ?? 1) + 1 : 1;
    const proposalId = agentEditProposalGenerationId(laneId, generation);
    const predecessorProposalId = existing?.id ?? creationPredecessor?.id;
    const diff = buildAgentTextDiff(
      isCreation ? "" : primaryFile.beforeText,
      primaryFile.afterText
    );
    const noChanges =
      !isCreation && primaryFile.beforeText === primaryFile.afterText;
    const proposal: AgentEditProposal = {
      id: proposalId,
      laneId,
      generation,
      approvalMode: runApprovalMode,
      ...(predecessorProposalId ? { predecessorProposalId } : {}),
      runId: event.payload.runId,
      workspaceId,
      stageId: "long-character",
      documentId: laneDocumentId,
      title: isCreation
        ? `${primaryFile.characterName} / 新建人物`
        : primaryFile.title,
      summary: event.payload.summary,
      status: noChanges ? "accepted" : "pending",
      ...(!noChanges ? { proposedText: primaryFile.afterText } : {}),
      toolCallIds: [event.payload.toolCallId],
      additions: diff.additions,
      deletions: diff.deletions,
      hunks: diff.hunks,
      ...(diff.truncated ? { truncated: true } : {}),
      ...(noChanges ? { statusMessage: "文本没有实际变化，无需保存。" } : {}),
      createdAt: event.timestamp,
      updatedAt: event.timestamp,
      longCharacterTarget: {
        bookId: event.payload.bookId,
        batch,
        files
      }
    };
    sourceConversation.upsertEditProposal(event.payload.runId, proposal);
    if (!noChanges && runApprovalMode === "auto-approve") {
      queueAgentEdit(
        sourceConversation,
        event.payload.sessionId,
        event.payload.runId,
        proposal.id,
        true,
        true
      );
    }
  }

  function stageLongDraftEditProposal(event: LongDraftMutationEvent): void {
    if (!rememberWorkspaceMutationEvent(event.id)) return;
    const sourceConversation = longConversationForProposalEvent(event);
    if (!sourceConversation) return;
    const file = event.payload.file;
    const runApprovalMode =
      sourceConversation.approvalModeForRun(
        event.payload.sessionId,
        event.payload.runId
      ) ?? "request-approval";
    const workspaceId = `long:${event.payload.bookId}`;
    const laneId = agentEditProposalId(
      event.payload.runId,
      workspaceId,
      "long-draft",
      file.fileId
    );
    const existing = latestProposalForLane(
      sourceConversation,
      event.payload.runId,
      laneId
    );
    if (existing?.toolCallIds.includes(event.payload.toolCallId)) return;
    const blockedMessage = blockedAgentEditLaneMessage(existing);
    if (blockedMessage) {
      sourceConversation.markToolConflict(
        event.payload.runId,
        event.payload.toolCallId,
        blockedMessage
      );
      return;
    }
    const generation = existing ? (existing.generation ?? 1) + 1 : 1;
    const proposalId = agentEditProposalGenerationId(laneId, generation);
    const diff = buildAgentTextDiff(file.beforeText, file.afterText);
    const noChanges = file.beforeText === file.afterText;
    const proposal: AgentEditProposal = {
      id: proposalId,
      laneId,
      generation,
      approvalMode: runApprovalMode,
      ...(existing ? { predecessorProposalId: existing.id } : {}),
      runId: event.payload.runId,
      workspaceId,
      stageId: "long-draft",
      documentId: file.fileId,
      title: `${file.chapterTitle} / 正文`,
      summary: event.payload.summary,
      status: noChanges ? "accepted" : "pending",
      ...(noChanges ? {} : { proposedText: file.afterText }),
      toolCallIds: [event.payload.toolCallId],
      additions: diff.additions,
      deletions: diff.deletions,
      hunks: diff.hunks,
      ...(diff.truncated ? { truncated: true } : {}),
      ...(noChanges ? { statusMessage: "正文没有实际变化，无需保存。" } : {}),
      createdAt: event.timestamp,
      updatedAt: event.timestamp,
      longDraftTarget: {
        bookId: event.payload.bookId,
        batch: event.payload.batch,
        file
      }
    };
    sourceConversation.upsertEditProposal(event.payload.runId, proposal);
    if (!noChanges && runApprovalMode === "auto-approve") {
      queueAgentEdit(
        sourceConversation,
        event.payload.sessionId,
        event.payload.runId,
        proposal.id,
        true,
        true
      );
    }
  }

  function stageLibraryEditProposal(event: LibraryEditorMutationEvent): void {
    if (!rememberWorkspaceMutationEvent(event.id)) return;
    const sourceConversation = allConversations().find((conversation) =>
      conversation.acceptsRunEvent(event.payload.sessionId, event.payload.runId)
    );
    if (!sourceConversation) return;
    const runApprovalMode =
      sourceConversation.approvalModeForRun(
        event.payload.sessionId,
        event.payload.runId
      ) ?? "request-approval";

    const library = findCatalogLibrary(
      event.payload.domain,
      event.payload.libraryId
    );
    const libraryReadOnly =
      !library ||
      (event.payload.domain === "skill" &&
        "isBuiltin" in library &&
        library.isBuiltin);
    let target: WorkspaceDocument | undefined;
    if (event.payload.operation === "edit") {
      const editPayload = event.payload;
      target = liveWorkspaceDocuments.value.find(
        (document) =>
          document.id === editPayload.documentId &&
          document.domain === editPayload.domain &&
          document.libraryId === editPayload.libraryId &&
          document.catalogEntryId === editPayload.entryId
      );
    } else if (event.payload.operation === "edit-overview") {
      const overviewPayload = event.payload;
      target = liveWorkspaceDocuments.value.find(
        (document) =>
          document.id === overviewPayload.documentId &&
          document.domain === overviewPayload.domain &&
          document.libraryId === overviewPayload.libraryId &&
          document.catalogLibraryField === "overview"
      );
    }
    if (
      libraryReadOnly ||
      (event.payload.operation !== "create" && (!target || target.readOnly))
    ) {
      const message = "目标资料库或条目不可写，本次智能体变更未进入审阅。";
      sourceConversation.markToolConflict(
        event.payload.runId,
        event.payload.toolCallId,
        message
      );
      uiMessage.warning(message);
      return;
    }

    const scopeId = `library:${event.payload.domain}:${event.payload.libraryId}`;
    const documentId =
      event.payload.operation !== "create"
        ? event.payload.documentId
        : `library-create:${event.payload.toolCallId}`;
    const proposalId = agentEditProposalId(
      event.payload.runId,
      scopeId,
      "library",
      documentId
    );
    const existing = sourceConversation.getEditProposal(
      event.payload.runId,
      proposalId
    );
    if (existing?.toolCallIds.includes(event.payload.toolCallId)) return;

    const currentText = target?.content ?? "";
    const currentRevision = createShortWorkspaceContentRevision(currentText);
    const expectedBaseRevision = expectedMutationBaseRevision(
      existing,
      currentText
    );
    if (
      event.payload.baseRevision !== expectedBaseRevision ||
      (existing !== undefined && currentRevision !== existing.baseRevision)
    ) {
      const message =
        "资料库内容版本已变化，本次智能体变更未进入审阅，也没有覆盖你的最新编辑。";
      if (existing) {
        sourceConversation.updateEditProposal(event.payload.runId, proposalId, {
          status: "conflict",
          statusMessage: message,
          updatedAt: event.timestamp
        });
      }
      sourceConversation.markToolConflict(
        event.payload.runId,
        event.payload.toolCallId,
        message
      );
      uiMessage.warning(message);
      return;
    }

    const proposedText = event.payload.text;
    const proposedRevision = createShortWorkspaceContentRevision(proposedText);
    const diff = buildAgentTextDiff(currentText, proposedText);
    const noChanges =
      event.payload.operation !== "create" &&
      proposedRevision === (existing?.baseRevision ?? currentRevision) &&
      event.payload.title === target?.title;
    const proposal: AgentEditProposal = {
      id: proposalId,
      approvalMode: runApprovalMode,
      runId: event.payload.runId,
      workspaceId: scopeId,
      stageId: "library",
      documentId,
      title: event.payload.title,
      summary: event.payload.summary,
      status: noChanges ? "accepted" : "pending",
      baseRevision: existing?.baseRevision ?? event.payload.baseRevision,
      proposedRevision,
      ...(noChanges ? {} : { proposedText }),
      toolCallIds: [
        ...new Set([...(existing?.toolCallIds ?? []), event.payload.toolCallId])
      ],
      additions: diff.additions,
      deletions: diff.deletions,
      hunks: diff.hunks,
      ...(diff.truncated ? { truncated: true } : {}),
      ...(noChanges
        ? { statusMessage: "资料库内容没有实际变化，无需保存。" }
        : {}),
      createdAt: existing?.createdAt ?? event.timestamp,
      updatedAt: event.timestamp,
      ...(event.payload.operation === "create"
        ? {}
        : {
            discardSnapshot: textEditDiscardSnapshot(
              existing,
              existing?.status === "pending" || existing?.status === "error",
              currentText,
              target?.title ?? event.payload.title
            )
          }),
      libraryTarget: {
        operation: event.payload.operation,
        domain: event.payload.domain,
        libraryId: event.payload.libraryId,
        ...(event.payload.operation === "edit-overview"
          ? {}
          : { stageId: event.payload.stageId }),
        ...(event.payload.baseProjectRevision === undefined
          ? {}
          : { baseProjectRevision: event.payload.baseProjectRevision }),
        ...(event.payload.operation === "edit"
          ? { entryId: event.payload.entryId }
          : {})
      }
    };
    sourceConversation.upsertEditProposal(event.payload.runId, proposal);
    if (!noChanges && runApprovalMode === "auto-approve") {
      queueAgentEdit(
        sourceConversation,
        event.payload.sessionId,
        event.payload.runId,
        proposalId,
        true,
        true
      );
    }
  }

  async function acceptDraftSectionCreationProposal(
    conversation: AgentConversationController,
    request: AgentEditReviewRequest,
    proposal: AgentEditProposal,
    automatic: boolean,
    reserved = false
  ): Promise<void> {
    if (
      (proposal.status === "accepting" && !reserved) ||
      proposal.status === "accepted" ||
      proposal.status === "rejected" ||
      proposal.status === "conflict"
    ) {
      return;
    }
    const target = proposal.draftSectionCreationTarget;
    if (!target || target.sections.length === 0) {
      const message = "待审阅的章节创建缺少完整参数，请重新生成。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "error",
        statusMessage: message
      });
      uiMessage.error(message);
      return;
    }
    const currentApi = api();
    if (!currentApi) {
      const message = "桌面文件服务当前不可用。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "error",
        statusMessage: message
      });
      uiMessage.error(message);
      return;
    }
    const directory = catalogProjection.value?.draftDirectories.find(
      (candidate) => candidate.workspaceId === proposal.workspaceId
    );
    const book = catalogBook(proposal.workspaceId);
    if (!directory || !book) {
      const message = "目标正文目录已不可用，无法创建章节。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "conflict",
        statusMessage: message
      });
      uiMessage.warning(message);
      return;
    }
    const resolvedAfterSectionId = target.afterSectionId
      ? resolveProvisionalExpertSectionId(
          request.runId,
          proposal.workspaceId,
          target.afterSectionId
        )
      : undefined;
    if (acceptingAgentEditWorkspaceIds.value.has(proposal.workspaceId)) {
      const message = automatic
        ? "检测到作品正在保存其他内容，实时自动建章已暂停，请稍后人工重试。"
        : "同一作品正在保存其他修改，请稍候再接受";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: automatic ? "error" : "pending",
        statusMessage: message
      });
      uiMessage.info(message);
      return;
    }

    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "accepting",
      statusMessage: automatic
        ? "正在自动批准并创建空白章节文件…"
        : "正在创建章节文件…"
    });
    setAgentEditWorkspaceAccepting(proposal.workspaceId, true);
    let lastCreatedSectionId: string | undefined;
    const createdMapping = new Map<string, string>();
    try {
      const created = await currentApi.catalog.createDraftSections({
        operationId: draftSectionCreationOperationId(proposal),
        bookId: proposal.workspaceId,
        ...(resolvedAfterSectionId
          ? { afterSectionId: resolvedAfterSectionId }
          : {}),
        force: true,
        sections: target.sections.map((section) => ({
          clientSectionId: section.provisionalSectionId,
          title: section.title,
          ...(section.wordCountRequirement
            ? { wordCountRequirement: section.wordCountRequirement }
            : {})
        }))
      });
      const createdCount = created.sections.length;
      for (const result of created.sections) {
        lastCreatedSectionId = result.section.id;
        createdMapping.set(result.clientSectionId, result.section.id);
        rememberProvisionalExpertSectionMapping(
          request.runId,
          proposal.workspaceId,
          result.clientSectionId,
          result.section.id
        );
      }
      await saveCreatedDraftSectionContents(currentApi.catalog, {
        bookId: proposal.workspaceId,
        requested: target.sections,
        created: created.sections
      });
      await loadCatalogSnapshot();
      const refreshedDirectory = catalogProjection.value?.draftDirectories.find(
        (candidate) => candidate.workspaceId === proposal.workspaceId
      );
      if (
        !createdDraftSectionsAreVisible(refreshedDirectory, created.sections)
      ) {
        throw new Error(
          "章节已创建，但刷新工作区后仍无法定位新章节；请重试以完成正文映射。"
        );
      }
      remapProvisionalExpertSectionFileProposals(
        conversation,
        request.runId,
        proposal.workspaceId,
        createdMapping
      );
      if (refreshedDirectory && !automatic) {
        selectedResourceId.value = refreshedDirectory.id;
        activeCreationResourceId.value = refreshedDirectory.id;
        if (lastCreatedSectionId) {
          selectedExpertSectionIds.value = {
            ...selectedExpertSectionIds.value,
            [refreshedDirectory.id]: lastCreatedSectionId
          };
          selectedDraftFileKinds.value = {
            ...selectedDraftFileKinds.value,
            [refreshedDirectory.id]: "body"
          };
        }
      }
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "accepted",
        proposedText: undefined,
        draftSectionCreationTarget: {
          ...target,
          sections: target.sections.map((section) => ({
            ...section,
            ...(createdMapping.get(section.provisionalSectionId)
              ? {
                  realSectionId: createdMapping.get(
                    section.provisionalSectionId
                  )!
                }
              : {})
          }))
        },
        statusMessage: automatic
          ? `已自动批准并创建 ${createdCount} 个章节；随创建提交的正文与人物状态已一并保存。`
          : `已创建 ${createdCount} 个章节，并保存随创建提交的正文与人物状态。`
      });
      if (!automatic) {
        uiMessage.success(`已创建 ${createdCount} 个空白章节文件`);
      }
    } catch (error: unknown) {
      await loadCatalogSnapshot();
      const conflict = isCatalogConflict(error);
      const message =
        error instanceof Error ? error.message : "创建空白章节失败。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: conflict ? "conflict" : "error",
        statusMessage: message
      });
      if (conflict) {
        conflictDependentProvisionalFileProposals(
          conversation,
          request.runId,
          target.sections.map((section) => section.provisionalSectionId),
          "关联的空白章节确认未能创建，相关正文写入已取消。"
        );
      } else {
        pauseDependentProvisionalFileProposals(
          conversation,
          request.runId,
          target.sections.map((section) => section.provisionalSectionId),
          "章节创建结果尚未确认，正文内容已保留；请先重试章节创建。"
        );
      }
      uiMessage.error(message);
    } finally {
      setAgentEditWorkspaceAccepting(proposal.workspaceId, false);
    }
  }

  async function acceptDraftSectionRenameProposal(
    conversation: AgentConversationController,
    request: AgentEditReviewRequest,
    proposal: AgentEditProposal,
    automatic: boolean,
    reserved = false
  ): Promise<void> {
    if (
      (proposal.status === "accepting" && !reserved) ||
      proposal.status === "accepted" ||
      proposal.status === "rejected" ||
      proposal.status === "conflict"
    ) {
      return;
    }
    const target = proposal.draftSectionRenameTarget;
    if (!target) {
      const message = "待审阅的章节改名缺少完整参数，请重新生成。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "error",
        statusMessage: message
      });
      uiMessage.error(message);
      return;
    }
    const currentApi = api();
    if (!currentApi) {
      const message = "桌面文件服务当前不可用。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "error",
        statusMessage: message
      });
      uiMessage.error(message);
      return;
    }
    const directory = catalogProjection.value?.draftDirectories.find(
      (candidate) => candidate.workspaceId === proposal.workspaceId
    );
    const book = catalogBook(proposal.workspaceId);
    const bodyDocument = liveWorkspaceDocuments.value.find(
      (document) =>
        document.workspaceId === proposal.workspaceId &&
        document.stageId === "draft" &&
        document.expertSectionId === target.sectionId &&
        document.draftFileKind === "body" &&
        document.catalogDocumentId
    );
    if (!directory || !book || !bodyDocument?.catalogDocumentId) {
      const message = "目标章节已不可用，无法修改名称。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "conflict",
        statusMessage: message
      });
      uiMessage.warning(message);
      return;
    }
    const section = directory.sections.find(
      (candidate) => candidate.id === target.sectionId
    );
    if (!section) {
      const message = "目标章节已不存在，无法修改名称。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "conflict",
        statusMessage: message
      });
      uiMessage.warning(message);
      return;
    }
    if (acceptingAgentEditWorkspaceIds.value.has(proposal.workspaceId)) {
      const message = automatic
        ? "检测到作品正在保存其他内容，实时自动改名已暂停，请稍后人工重试。"
        : "同一作品正在保存其他修改，请稍候再接受";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: automatic ? "error" : "pending",
        statusMessage: message
      });
      uiMessage.info(message);
      return;
    }

    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "accepting",
      statusMessage: automatic
        ? "正在自动批准并修改章节名称…"
        : "正在修改章节名称…"
    });
    setAgentEditWorkspaceAccepting(proposal.workspaceId, true);
    try {
      // Core reads the current file while applying the title change. The
      // renderer projection may be stale and must never be written back.
      const saved = await currentApi.catalog.saveDocument(
        shortAgentDirectDocumentWrite({
          bookId: proposal.workspaceId,
          documentId: bodyDocument.catalogDocumentId,
          title: target.title,
          content: "",
          preserveCurrentContent: true
        })
      );
      applyAcceptedAgentDocumentLocally(
        {
          id: bodyDocument.id,
          title: saved.title,
          content: saved.content
        },
        saved.projectRevision,
        undefined
      );
      const expectedDocuments = captureWorkspaceDocumentBaselines(
        documents.value,
        proposal.workspaceId
      );
      await refreshBookAfterSuccessfulDocumentSave(
        proposal.workspaceId,
        expectedDocuments,
        saved.projectRevision
      );
      const draft = editorDrafts.value[bodyDocument.id];
      if (draft) {
        editorDrafts.value = {
          ...editorDrafts.value,
          [bodyDocument.id]: {
            ...draft,
            title: saved.title
          }
        };
      }
      const characterStateDocument = liveWorkspaceDocuments.value.find(
        (document) =>
          document.workspaceId === proposal.workspaceId &&
          document.stageId === "draft" &&
          document.expertSectionId === target.sectionId &&
          document.draftFileKind === "character-state"
      );
      const characterDraft = characterStateDocument
        ? editorDrafts.value[characterStateDocument.id]
        : undefined;
      if (characterStateDocument && characterDraft) {
        editorDrafts.value = {
          ...editorDrafts.value,
          [characterStateDocument.id]: {
            ...characterDraft,
            title: draftCharacterStateTitle(saved.title)
          }
        };
      }
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "accepted",
        proposedText: undefined,
        statusMessage: automatic
          ? `已自动批准并将章节「${target.previousTitle}」改名为「${target.title}」。`
          : `已将章节「${target.previousTitle}」改名为「${target.title}」并保存到本机。`
      });
      if (!automatic) {
        uiMessage.success(`已将章节改名为「${target.title}」`);
      }
    } catch (error: unknown) {
      await loadCatalogSnapshot();
      const conflict = isCatalogConflict(error);
      const message =
        error instanceof Error ? error.message : "修改章节名称失败。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: conflict ? "conflict" : "error",
        statusMessage: message
      });
      uiMessage.error(message);
    } finally {
      setAgentEditWorkspaceAccepting(proposal.workspaceId, false);
    }
  }

  function conflictDependentDeletedSectionProposals(
    conversation: AgentConversationController,
    runId: string,
    sectionId: string,
    message: string,
    exceptProposalId?: string
  ): void {
    const bodyId = catalogDraftBodyDocumentId(sectionId);
    const stateId = catalogDraftCharacterStateDocumentId(sectionId);
    for (const candidate of conversation.listEditProposals(runId)) {
      if (exceptProposalId && candidate.id === exceptProposalId) continue;
      if (
        candidate.status !== "pending" &&
        candidate.status !== "error" &&
        candidate.status !== "accepting"
      ) {
        continue;
      }
      const targetsDeletedSection =
        candidate.documentId === bodyId ||
        candidate.documentId === stateId ||
        candidate.draftSectionRenameTarget?.sectionId === sectionId ||
        (candidate.draftSectionDeletionTarget?.sectionId === sectionId &&
          candidate.id !== exceptProposalId);
      if (!targetsDeletedSection) continue;
      removeQueuedAgentEdit(conversation, runId, candidate.id);
      conversation.updateEditProposal(runId, candidate.id, {
        status: "conflict",
        proposedText: undefined,
        statusMessage: message
      });
    }
  }

  async function acceptDraftSectionDeletionProposal(
    conversation: AgentConversationController,
    request: AgentEditReviewRequest,
    proposal: AgentEditProposal,
    automatic: boolean,
    reserved = false
  ): Promise<void> {
    if (
      (proposal.status === "accepting" && !reserved) ||
      proposal.status === "accepted" ||
      proposal.status === "rejected" ||
      proposal.status === "conflict"
    ) {
      return;
    }
    const draftUnit =
      catalogBook(proposal.workspaceId)?.bookType === "script"
        ? "剧集"
        : "章节";
    const target = proposal.draftSectionDeletionTarget;
    if (!target) {
      const message = `待审阅的${draftUnit}删除缺少完整参数，请重新生成。`;
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "error",
        statusMessage: message
      });
      uiMessage.error(message);
      return;
    }
    const currentApi = api();
    if (!currentApi) {
      const message = "桌面文件服务当前不可用。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "error",
        statusMessage: message
      });
      uiMessage.error(message);
      return;
    }
    const directory = catalogProjection.value?.draftDirectories.find(
      (candidate) => candidate.workspaceId === proposal.workspaceId
    );
    const book = catalogBook(proposal.workspaceId);
    if (!directory || !book) {
      const message = `目标正文目录已不可用，无法删除${draftUnit}。`;
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "conflict",
        statusMessage: message
      });
      uiMessage.warning(message);
      return;
    }
    const section = directory.sections.find(
      (candidate) => candidate.id === target.sectionId
    );
    if (!section) {
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "accepted",
        proposedText: undefined,
        statusMessage: `${draftUnit}「${target.title}」已不存在，无需重复删除。`
      });
      conflictDependentDeletedSectionProposals(
        conversation,
        request.runId,
        target.sectionId,
        `目标${draftUnit}已删除，相关正文变更无法落盘。`,
        request.proposalId
      );
      return;
    }
    if (directory.sections.length <= 1) {
      const message = `正文至少需要保留一个${draftUnit}，未删除。`;
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "conflict",
        statusMessage: message
      });
      uiMessage.warning(message);
      return;
    }
    if (acceptingAgentEditWorkspaceIds.value.has(proposal.workspaceId)) {
      const message = automatic
        ? "检测到作品正在保存其他内容，实时自动删除已暂停，请稍后人工重试。"
        : "同一作品正在保存其他修改，请稍候再接受";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: automatic ? "error" : "pending",
        statusMessage: message
      });
      uiMessage.info(message);
      return;
    }

    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "accepting",
      statusMessage: automatic
        ? `正在自动批准并删除${draftUnit}…`
        : `正在删除${draftUnit}…`
    });
    setAgentEditWorkspaceAccepting(proposal.workspaceId, true);
    try {
      const removedIndex = directory.sections.findIndex(
        (candidate) => candidate.id === target.sectionId
      );
      const fallbackSections = directory.sections.filter(
        (candidate) => candidate.id !== target.sectionId
      );
      const fallbackSection =
        fallbackSections[Math.min(removedIndex, fallbackSections.length - 1)];
      const deleted = await currentApi.catalog.deleteDraftSection({
        bookId: proposal.workspaceId,
        sectionId: target.sectionId,
        force: true
      });
      if (!deleted.deleted) {
        throw new Error(`${draftUnit}「${target.title}」已经不存在。`);
      }
      const nextDrafts = { ...editorDrafts.value };
      delete nextDrafts[section.bodyDocumentId];
      delete nextDrafts[section.characterStateDocumentId];
      editorDrafts.value = nextDrafts;
      for (const conversationKey of legacyDraftSectionConversationKeys(
        proposal.workspaceId,
        target.sectionId
      )) {
        removeConversation(conversationKey);
      }
      await loadCatalogSnapshot();
      if (!automatic) {
        selectedResourceId.value = directory.id;
        activeCreationResourceId.value = directory.id;
        if (fallbackSection) {
          selectedExpertSectionIds.value = {
            ...selectedExpertSectionIds.value,
            [directory.id]: fallbackSection.id
          };
        }
        selectedDraftFileKinds.value = {
          ...selectedDraftFileKinds.value,
          [directory.id]: "body"
        };
      }
      conflictDependentDeletedSectionProposals(
        conversation,
        request.runId,
        target.sectionId,
        `目标${draftUnit}已删除，相关正文变更无法落盘。`,
        request.proposalId
      );
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "accepted",
        proposedText: undefined,
        statusMessage: automatic
          ? `已自动批准并删除${draftUnit}「${target.title}」及其正文与人物状态文件。`
          : `已删除${draftUnit}「${target.title}」及其正文与人物状态文件。`
      });
      if (!automatic) {
        uiMessage.success(
          `已删除${draftUnit}“${target.title}”及对应人物状态文件`
        );
      }
    } catch (error: unknown) {
      await loadCatalogSnapshot();
      const conflict = isCatalogConflict(error);
      const message =
        error instanceof Error ? error.message : `删除${draftUnit}失败。`;
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: conflict ? "conflict" : "error",
        statusMessage: message
      });
      uiMessage.error(message);
    } finally {
      setAgentEditWorkspaceAccepting(proposal.workspaceId, false);
    }
  }

  function conflictDependentLongWorldbuildingProposals(
    conversation: AgentConversationController,
    proposal: AgentEditProposal,
    message: string
  ): void {
    for (const candidate of conversation.listEditProposals(proposal.runId)) {
      if (
        candidate.predecessorProposalId !== proposal.id ||
        !candidate.longWorldbuildingTarget ||
        (candidate.status !== "pending" && candidate.status !== "error")
      ) {
        continue;
      }
      removeQueuedAgentEdit(conversation, candidate.runId, candidate.id);
      conversation.updateEditProposal(candidate.runId, candidate.id, {
        status: "conflict",
        proposedText: undefined,
        statusMessage: message
      });
    }
  }

  function conflictDependentLongCharacterProposals(
    conversation: AgentConversationController,
    proposal: AgentEditProposal,
    message: string
  ): void {
    const createdFileIds = new Set(
      proposal.longCharacterTarget?.files
        .filter(({ operation }) => operation === "create")
        .map(({ fileId }) => fileId) ?? []
    );
    if (!createdFileIds.size) return;
    for (const candidate of conversation.listEditProposals(proposal.runId)) {
      if (
        candidate.predecessorProposalId !== proposal.id ||
        !candidate.longCharacterTarget?.files.some(({ fileId }) =>
          createdFileIds.has(fileId)
        ) ||
        (candidate.status !== "pending" && candidate.status !== "error")
      ) {
        continue;
      }
      removeQueuedAgentEdit(conversation, candidate.runId, candidate.id);
      conversation.updateEditProposal(candidate.runId, candidate.id, {
        status: "conflict",
        proposedText: undefined,
        statusMessage: message
      });
    }
  }

  async function acceptLongPlotDesignProposal(
    conversation: AgentConversationController,
    request: AgentEditReviewRequest,
    proposal: AgentEditProposal,
    automatic: boolean
  ): Promise<void> {
    const target = proposal.longPlotDesignTarget;
    const api = resolveLongWorkspaceApi();
    if (!target || !api) {
      const message = "长篇剧情设计服务当前不可用。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "error",
        statusMessage: message
      });
      uiMessage.error(message);
      return;
    }
    if (acceptingAgentEditWorkspaceIds.value.has(proposal.workspaceId)) {
      const message = automatic
        ? "检测到本书正在保存其他内容，剧情设计实时自动落盘已暂停，请稍后重试。"
        : "同一本书正在保存其他修改，请稍候再接受";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: automatic ? "error" : "pending",
        statusMessage: message
      });
      uiMessage.info(message);
      return;
    }

    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "accepting",
      statusMessage: automatic
        ? "正在自动批准、校验影响并保存剧情设计…"
        : "正在校验影响并保存剧情设计…"
    });
    setAgentEditWorkspaceAccepting(proposal.workspaceId, true);
    let applied = false;
    let attemptedBatch: LongWorkspaceOperationBatch | undefined;
    try {
      if (activeLongBookId.value === target.bookId) {
        await nextTick();
        if (!(await saveActiveLongEditorChanges())) {
          throw new Error("当前长篇编辑内容尚未保存，未覆盖剧情设计。");
        }
      }
      const batch = LongWorkspaceOperationBatchSchema.parse(target.batch);
      attemptedBatch = batch;
      let expectedImpact = target.expectedImpact;
      if (!expectedImpact) {
        expectedImpact = await previewLongProposalImpact(
          api,
          target.bookId,
          batch,
          "剧情设计"
        );
      }
      if (
        holdLongProposalForManualReview({
          automatic,
          hadExpectedImpact: Boolean(target.expectedImpact),
          batch,
          confirmation: expectedImpact,
          conversation,
          runId: request.runId,
          proposalId: request.proposalId,
          patch: {
            longPlotDesignTarget: { ...target, batch, expectedImpact }
          },
          statusMessage:
            "已读取本次结构与关联影响，请核对下方影响后再次确认保存。",
          notificationMessage: "请核对剧情设计及关联影响后再次确认保存",
          removeQueued: removeQueuedAgentEdit,
          notify: uiMessage.info
        })
      ) {
        return;
      }
      const result = await api.applyOperations({
        bookId: target.bookId,
        batch: LongWorkspaceOperationBatchSchema.parse({
          ...batch,
          expectedImpact
        })
      });
      applied = true;
      longBooks.value = replaceLongBookSummary(longBooks.value, result.summary);
      const refreshed = await refreshLongProposalWorkspace(target.bookId);
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "accepted",
        proposedText: undefined,
        statusMessage: refreshed
          ? `${automatic ? "已自动批准并" : "已接受并"}保存剧情设计。`
          : "剧情设计已保存，但界面刷新失败；请手动刷新长篇工作区。"
      });
      if (!automatic) {
        uiMessage.success("已接受并保存剧情设计");
      }
    } catch (error: unknown) {
      let currentError = error;
      if (
        !applied &&
        target.expectedImpact &&
        attemptedBatch &&
        isLongImpactMismatch(error)
      ) {
        try {
          const expectedImpact = await previewLongProposalImpact(
            api,
            target.bookId,
            attemptedBatch,
            "剧情设计"
          );
          moveLongProposalToManualReview({
            conversation,
            runId: request.runId,
            proposalId: request.proposalId,
            patch: {
              longPlotDesignTarget: {
                ...target,
                batch: attemptedBatch,
                expectedImpact
              }
            },
            statusMessage:
              "关联影响已变化，已更新下方影响；请重新核对并再次确认保存。",
            notificationMessage: "剧情设计的关联影响已变化，请重新确认",
            removeQueued: removeQueuedAgentEdit,
            notify: uiMessage.warning
          });
          return;
        } catch (previewError: unknown) {
          currentError = previewError;
        }
      }
      const message =
        currentError instanceof Error
          ? currentError.message
          : "保存剧情设计失败，当前结构保持不变。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: applied ? "accepted" : "error",
        statusMessage: applied
          ? `剧情设计已经保存，但刷新失败：${message}`
          : message
      });
      if (applied) {
        uiMessage.warning(`剧情设计已经保存，但刷新失败：${message}`);
      } else {
        uiMessage.error(message);
      }
    } finally {
      setAgentEditWorkspaceAccepting(proposal.workspaceId, false);
    }
  }

  async function acceptLongWorldbuildingFileProposal(
    conversation: AgentConversationController,
    request: AgentEditReviewRequest,
    proposal: AgentEditProposal,
    automatic: boolean
  ): Promise<void> {
    const target = proposal.longWorldbuildingTarget;
    const api = resolveLongWorkspaceApi();
    if (!target || !api) {
      const message = "长篇世界观文件服务当前不可用。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "error",
        statusMessage: message
      });
      uiMessage.error(message);
      return;
    }
    if (acceptingAgentEditWorkspaceIds.value.has(proposal.workspaceId)) {
      const message = automatic
        ? "检测到本书正在保存其他内容，实时自动落盘已暂停，请稍后重试。"
        : "同一本书正在保存其他修改，请稍候再接受";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: automatic ? "error" : "pending",
        statusMessage: message
      });
      uiMessage.info(message);
      return;
    }

    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "accepting",
      statusMessage:
        target.file.operation === "create"
          ? automatic
            ? "正在自动批准并创建世界观文件…"
            : "正在创建世界观文件…"
          : automatic
            ? "正在自动批准并保存世界观文件…"
            : "正在保存世界观文件…"
    });
    setAgentEditWorkspaceAccepting(proposal.workspaceId, true);
    let applied = false;
    let attemptedBatch: LongWorkspaceOperationBatch | undefined;
    try {
      if (activeLongBookId.value === target.bookId) {
        await nextTick();
        if (!(await saveActiveLongEditorChanges())) {
          throw new Error("当前长篇编辑内容尚未保存，未覆盖世界观文件。");
        }
      }
      const latest = await api.getWorkspaceIndex({
        bookId: target.bookId
      });
      const currentFile = findLongWorldbuildingFile(
        latest.workspaceIndex.worldbuilding,
        target.file.fileId
      );
      if (target.file.operation === "create") {
        if (currentFile) {
          const message = "世界观目录已存在同一文件，未重复创建。";
          conversation.updateEditProposal(request.runId, request.proposalId, {
            status: "conflict",
            statusMessage: message
          });
          uiMessage.warning(message);
          return;
        }
      } else if (!currentFile) {
        const message = "目标世界观文件已经不存在，无法保存本次修改。";
        conversation.updateEditProposal(request.runId, request.proposalId, {
          status: "conflict",
          statusMessage: message
        });
        await refreshLongProposalWorkspace(target.bookId);
        uiMessage.warning(message);
        return;
      }

      const batch = target.expectedImpact
        ? LongWorkspaceOperationBatchSchema.parse(target.batch)
        : LongWorkspaceOperationBatchSchema.parse({
            ...target.batch,
            operations: (() => {
              const nextOrderByCategory = new Map<string, number>();
              return target.batch.operations.map((operation) => {
                if (operation.type !== "worldbuildingItem.create") {
                  return operation;
                }
                const category = latest.workspaceIndex.worldbuilding.find(
                  ({ id }) => id === operation.categoryId
                );
                if (!category || category.format !== "list") {
                  throw new Error(
                    "世界观文件的目标分类已不存在或不再是列表型。"
                  );
                }
                const nextOrder =
                  (nextOrderByCategory.get(category.id) ??
                    category.items.length) + 1;
                nextOrderByCategory.set(category.id, nextOrder);
                return {
                  ...operation,
                  item: { ...operation.item, order: nextOrder }
                };
              });
            })()
          });
      attemptedBatch = batch;
      let expectedImpact = target.expectedImpact;
      if (!expectedImpact) {
        expectedImpact = await previewLongProposalImpact(
          api,
          target.bookId,
          batch,
          "世界观文件"
        );
      }
      if (
        holdLongProposalForManualReview({
          automatic,
          hadExpectedImpact: Boolean(target.expectedImpact),
          batch,
          confirmation: expectedImpact,
          conversation,
          runId: request.runId,
          proposalId: request.proposalId,
          patch: {
            longWorldbuildingTarget: { ...target, batch, expectedImpact }
          },
          statusMessage:
            "已读取本次文件与关联影响，请核对下方影响后再次确认保存。",
          notificationMessage: "请核对世界观文件及关联影响后再次确认保存",
          removeQueued: removeQueuedAgentEdit,
          notify: uiMessage.info
        })
      ) {
        return;
      }
      const result = await api.applyOperations({
        bookId: target.bookId,
        batch: LongWorkspaceOperationBatchSchema.parse({
          ...batch,
          expectedImpact
        })
      });
      applied = true;
      longBooks.value = replaceLongBookSummary(longBooks.value, result.summary);
      const refreshed = await refreshLongProposalWorkspace(target.bookId);
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "accepted",
        proposedText: undefined,
        statusMessage:
          target.file.operation === "create"
            ? automatic
              ? "已自动批准并创建世界观文件。"
              : "已创建世界观文件并保存到本地 Markdown。"
            : refreshed
              ? `${automatic ? "已自动批准并" : "已接受并"}保存到本地 Markdown。`
              : "已保存到本地 Markdown，但界面刷新失败；请手动刷新长篇工作区。"
      });
      if (!automatic) {
        uiMessage.success(
          target.file.operation === "create"
            ? "已创建世界观文件"
            : "已接受并保存世界观文件"
        );
      }
    } catch (error: unknown) {
      let currentError = error;
      if (
        !applied &&
        target.expectedImpact &&
        attemptedBatch &&
        isLongImpactMismatch(error)
      ) {
        try {
          const expectedImpact = await previewLongProposalImpact(
            api,
            target.bookId,
            attemptedBatch,
            "世界观文件"
          );
          moveLongProposalToManualReview({
            conversation,
            runId: request.runId,
            proposalId: request.proposalId,
            patch: {
              longWorldbuildingTarget: {
                ...target,
                batch: attemptedBatch,
                expectedImpact
              }
            },
            statusMessage:
              "关联影响已变化，已更新下方影响；请重新核对并再次确认保存。",
            notificationMessage: "世界观文件的关联影响已变化，请重新确认",
            removeQueued: removeQueuedAgentEdit,
            notify: uiMessage.warning
          });
          return;
        } catch (previewError: unknown) {
          currentError = previewError;
        }
      }
      const message =
        currentError instanceof Error
          ? currentError.message
          : "保存世界观文件失败，原文件保持不变。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: applied ? "accepted" : "error",
        statusMessage: applied
          ? `世界观文件已经保存，但刷新失败：${message}`
          : message
      });
      if (applied) {
        uiMessage.warning(`世界观文件已经保存，但刷新失败：${message}`);
      } else {
        uiMessage.error(message);
      }
    } finally {
      setAgentEditWorkspaceAccepting(proposal.workspaceId, false);
    }
  }

  async function acceptLongCharacterFileProposal(
    conversation: AgentConversationController,
    request: AgentEditReviewRequest,
    proposal: AgentEditProposal,
    automatic: boolean
  ): Promise<void> {
    const target = proposal.longCharacterTarget;
    const api = resolveLongWorkspaceApi();
    if (!target || !api) {
      const message = "长篇人物文件服务当前不可用。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "error",
        statusMessage: message
      });
      uiMessage.error(message);
      return;
    }
    if (acceptingAgentEditWorkspaceIds.value.has(proposal.workspaceId)) {
      const message = automatic
        ? "检测到本书正在保存其他内容，实时自动落盘已暂停，请稍后重试。"
        : "同一本书正在保存其他修改，请稍候再接受";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: automatic ? "error" : "pending",
        statusMessage: message
      });
      uiMessage.info(message);
      return;
    }

    const isCreation = target.files.every(
      ({ operation }) => operation === "create"
    );
    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "accepting",
      statusMessage: isCreation
        ? automatic
          ? "正在自动批准并创建人物档案…"
          : "正在创建人物档案…"
        : automatic
          ? "正在自动批准并保存人物档案…"
          : "正在保存人物档案…"
    });
    setAgentEditWorkspaceAccepting(proposal.workspaceId, true);
    let applied = false;
    let attemptedBatch: LongWorkspaceOperationBatch | undefined;
    try {
      if (activeLongBookId.value === target.bookId) {
        await nextTick();
        if (!(await saveActiveLongEditorChanges())) {
          throw new Error("当前长篇编辑内容尚未保存，未覆盖人物档案。");
        }
      }
      const latest = await api.getWorkspaceIndex({ bookId: target.bookId });
      const currentFiles = new Map([
        ...(latest.workspaceIndex.characterOverview
          ? [
              [
                latest.workspaceIndex.characterOverview.id,
                latest.workspaceIndex.characterOverview
              ] as const
            ]
          : []),
        ...latest.workspaceIndex.characterFiles.flatMap((entry) => [
          [entry.coreProfile.id, entry.coreProfile] as const,
          [entry.relationships.id, entry.relationships] as const
        ])
      ]);
      if (isCreation) {
        if (target.files.some((file) => currentFiles.has(file.fileId))) {
          const message = "人物目录已存在同一人物的部分档案，未重复创建。";
          conversation.updateEditProposal(request.runId, request.proposalId, {
            status: "conflict",
            statusMessage: message
          });
          uiMessage.warning(message);
          return;
        }
      } else {
        const missing = target.files.find(
          (file) => !currentFiles.has(file.fileId)
        );
        if (missing) {
          const message = "目标人物档案已经不存在，无法保存本次修改。";
          conversation.updateEditProposal(request.runId, request.proposalId, {
            status: "conflict",
            statusMessage: message
          });
          await refreshLongProposalWorkspace(target.bookId);
          uiMessage.warning(message);
          return;
        }
      }

      const batch = target.expectedImpact
        ? LongWorkspaceOperationBatchSchema.parse(target.batch)
        : LongWorkspaceOperationBatchSchema.parse({
            ...target.batch,
            operations: (() => {
              const nextOrderByGroup = new Map<string, number>();
              return target.batch.operations.map((operation) => {
                if (operation.type !== "character.create") return operation;
                const group = operation.character.group;
                const nextOrder =
                  (nextOrderByGroup.get(group) ??
                    latest.workspaceIndex.characters.filter(
                      (character) => character.group === group
                    ).length) + 1;
                nextOrderByGroup.set(group, nextOrder);
                return {
                  ...operation,
                  character: { ...operation.character, order: nextOrder }
                };
              });
            })()
          });
      attemptedBatch = batch;
      let expectedImpact = target.expectedImpact;
      if (!expectedImpact) {
        expectedImpact = await previewLongProposalImpact(
          api,
          target.bookId,
          batch,
          "人物档案"
        );
      }
      if (
        holdLongProposalForManualReview({
          automatic,
          hadExpectedImpact: Boolean(target.expectedImpact),
          batch,
          confirmation: expectedImpact,
          conversation,
          runId: request.runId,
          proposalId: request.proposalId,
          patch: {
            longCharacterTarget: { ...target, batch, expectedImpact }
          },
          statusMessage:
            "已读取本次档案与关联影响，请核对下方影响后再次确认保存。",
          notificationMessage: "请核对人物档案及关联影响后再次确认保存",
          removeQueued: removeQueuedAgentEdit,
          notify: uiMessage.info
        })
      ) {
        return;
      }
      const result = await api.applyOperations({
        bookId: target.bookId,
        batch: LongWorkspaceOperationBatchSchema.parse({
          ...batch,
          expectedImpact
        })
      });
      applied = true;
      longBooks.value = replaceLongBookSummary(longBooks.value, result.summary);
      const refreshed = await refreshLongProposalWorkspace(target.bookId);
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "accepted",
        proposedText: undefined,
        statusMessage: isCreation
          ? automatic
            ? "已自动批准并创建人物及两份档案。"
            : "已创建人物及两份档案并保存到本地 Markdown。"
          : refreshed
            ? `${automatic ? "已自动批准并" : "已接受并"}保存到本地 Markdown。`
            : "已保存到本地 Markdown，但界面刷新失败；请手动刷新长篇工作区。"
      });
      if (!automatic) {
        uiMessage.success(
          isCreation ? "已创建人物档案" : "已接受并保存人物档案"
        );
      }
    } catch (error: unknown) {
      let currentError = error;
      if (
        !applied &&
        target.expectedImpact &&
        attemptedBatch &&
        isLongImpactMismatch(error)
      ) {
        try {
          const expectedImpact = await previewLongProposalImpact(
            api,
            target.bookId,
            attemptedBatch,
            "人物档案"
          );
          moveLongProposalToManualReview({
            conversation,
            runId: request.runId,
            proposalId: request.proposalId,
            patch: {
              longCharacterTarget: {
                ...target,
                batch: attemptedBatch,
                expectedImpact
              }
            },
            statusMessage:
              "关联影响已变化，已更新下方影响；请重新核对并再次确认保存。",
            notificationMessage: "人物档案的关联影响已变化，请重新确认",
            removeQueued: removeQueuedAgentEdit,
            notify: uiMessage.warning
          });
          return;
        } catch (previewError: unknown) {
          currentError = previewError;
        }
      }
      const message =
        currentError instanceof Error
          ? currentError.message
          : "保存人物档案失败，原文件保持不变。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: applied ? "accepted" : "error",
        statusMessage: applied
          ? `人物档案已经保存，但刷新失败：${message}`
          : message
      });
      if (applied) {
        uiMessage.warning(`人物档案已经保存，但刷新失败：${message}`);
      } else {
        uiMessage.error(message);
      }
    } finally {
      setAgentEditWorkspaceAccepting(proposal.workspaceId, false);
    }
  }

  async function acceptLongDraftProposal(
    conversation: AgentConversationController,
    request: AgentEditReviewRequest,
    proposal: AgentEditProposal,
    automatic: boolean
  ): Promise<void> {
    const target = proposal.longDraftTarget;
    const api = resolveLongWorkspaceApi();
    if (!target || !api) {
      const message = "长篇正文服务当前不可用。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "error",
        statusMessage: message
      });
      uiMessage.error(message);
      return;
    }
    if (acceptingAgentEditWorkspaceIds.value.has(proposal.workspaceId)) {
      const message = automatic
        ? "检测到本书正在保存其他内容，正文实时自动落盘已暂停，请稍后重试。"
        : "同一本书正在保存其他修改，请稍候再接受";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: automatic ? "error" : "pending",
        statusMessage: message
      });
      uiMessage.info(message);
      return;
    }

    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "accepting",
      statusMessage: automatic
        ? "正在自动批准并保存章节正文…"
        : "正在保存章节正文…"
    });
    setAgentEditWorkspaceAccepting(proposal.workspaceId, true);
    let applied = false;
    let attemptedBatch: LongWorkspaceOperationBatch | undefined;
    try {
      if (activeLongBookId.value === target.bookId) {
        await nextTick();
        if (!(await saveActiveLongEditorChanges())) {
          throw new Error("当前长篇编辑内容尚未保存，未覆盖章节正文。");
        }
      }
      const latest = await api.getWorkspaceIndex({ bookId: target.bookId });
      const chapter = latest.workspaceIndex.chapters.find(
        ({ chapterCardId }) => chapterCardId === target.file.chapterCardId
      );
      if (!chapter || chapter.body.id !== target.file.fileId) {
        const message = "目标章卡或章节正文已经不存在，未保存本次修改。";
        conversation.updateEditProposal(request.runId, request.proposalId, {
          status: "conflict",
          statusMessage: message
        });
        uiMessage.warning(message);
        return;
      }
      const batch = LongWorkspaceOperationBatchSchema.parse(target.batch);
      attemptedBatch = batch;
      let expectedImpact = target.expectedImpact;
      if (!expectedImpact) {
        expectedImpact = await previewLongProposalImpact(
          api,
          target.bookId,
          batch,
          "章节正文"
        );
      }
      if (
        holdLongProposalForManualReview({
          automatic,
          hadExpectedImpact: Boolean(target.expectedImpact),
          batch,
          confirmation: expectedImpact,
          conversation,
          runId: request.runId,
          proposalId: request.proposalId,
          patch: {
            longDraftTarget: { ...target, batch, expectedImpact }
          },
          statusMessage:
            "已读取本次正文与关联影响，请核对下方影响后再次确认保存。",
          notificationMessage: "请核对章节正文及关联影响后再次确认保存",
          removeQueued: removeQueuedAgentEdit,
          notify: uiMessage.info
        })
      ) {
        return;
      }
      const result = await api.applyOperations({
        bookId: target.bookId,
        batch: LongWorkspaceOperationBatchSchema.parse({
          ...batch,
          expectedImpact
        })
      });
      applied = true;
      longBooks.value = replaceLongBookSummary(longBooks.value, result.summary);
      const refreshed = await refreshLongProposalWorkspace(target.bookId);
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "accepted",
        proposedText: undefined,
        statusMessage: refreshed
          ? `${automatic ? "已自动批准并" : "已接受并"}保存章节正文到本地 Markdown。`
          : "章节正文已保存，但界面刷新失败；请手动刷新长篇工作区。"
      });
      if (!automatic) {
        uiMessage.success("已接受并保存章节正文");
      }
    } catch (error: unknown) {
      let currentError = error;
      if (
        !applied &&
        target.expectedImpact &&
        attemptedBatch &&
        isLongImpactMismatch(error)
      ) {
        try {
          const expectedImpact = await previewLongProposalImpact(
            api,
            target.bookId,
            attemptedBatch,
            "章节正文"
          );
          moveLongProposalToManualReview({
            conversation,
            runId: request.runId,
            proposalId: request.proposalId,
            patch: {
              longDraftTarget: {
                ...target,
                batch: attemptedBatch,
                expectedImpact
              }
            },
            statusMessage:
              "关联影响已变化，已更新下方影响；请重新核对并再次确认保存。",
            notificationMessage: "章节正文的关联影响已变化，请重新确认",
            removeQueued: removeQueuedAgentEdit,
            notify: uiMessage.warning
          });
          return;
        } catch (previewError: unknown) {
          currentError = previewError;
        }
      }
      const message =
        currentError instanceof Error
          ? currentError.message
          : "保存章节正文失败，原文件保持不变。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: applied ? "accepted" : "error",
        statusMessage: applied
          ? `章节正文已经保存，但刷新失败：${message}`
          : message
      });
      if (applied) {
        uiMessage.warning(`章节正文已经保存，但刷新失败：${message}`);
      } else {
        uiMessage.error(message);
      }
    } finally {
      setAgentEditWorkspaceAccepting(proposal.workspaceId, false);
    }
  }

  async function applyAgentEdit(
    conversation: AgentConversationController,
    request: AgentEditReviewRequest,
    automatic = false,
    reservation?: {
      decisionToken: string;
      expectedProposedRevision: string;
    }
  ): Promise<void> {
    let proposal = conversation.getEditProposal(
      request.runId,
      request.proposalId
    );
    if (!proposal) {
      uiMessage.error("待审阅的智能体变更已不存在，请重新生成修改。");
      return;
    }
    const reserved = Boolean(
      reservation &&
      proposal.status === "accepting" &&
      proposal.decisionToken === reservation.decisionToken &&
      (proposal.proposedRevision ?? proposal.id) ===
        reservation.expectedProposedRevision
    );
    if (reservation && !reserved) {
      return;
    }
    if (conversation.isBusy.value && !canReviewAgentEditDuringRun(proposal)) {
      uiMessage.info("请等待本轮智能体完成后再审阅文稿变更");
      return;
    }

    if (request.decision === "reject") {
      if (proposal.status === "accepting" || proposal.status === "accepted")
        return;
      removeQueuedAgentEdit(conversation, request.runId, request.proposalId);
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "rejected",
        proposedText: undefined,
        statusMessage: proposal.longPlotDesignTarget
          ? "已拒绝，剧情设计保持不变。"
          : proposal.longDraftTarget
            ? "已拒绝，章节正文保持不变。"
            : "已拒绝，原文保持不变。"
      });
      if (proposal.draftSectionCreationTarget) {
        conflictDependentProvisionalFileProposals(
          conversation,
          request.runId,
          proposal.draftSectionCreationTarget.sections.map(
            (section) => section.provisionalSectionId
          ),
          "空白章节创建已被拒绝，相关正文写入无法落盘。"
        );
      }
      if (proposal.longWorldbuildingTarget?.file.operation === "create") {
        conflictDependentLongWorldbuildingProposals(
          conversation,
          proposal,
          "空白世界观文件创建已被拒绝，相关正文写入无法落盘。"
        );
      }
      if (
        proposal.longCharacterTarget?.files.every(
          ({ operation }) => operation === "create"
        )
      ) {
        conflictDependentLongCharacterProposals(
          conversation,
          proposal,
          "人物创建已被拒绝，相关人物档案写入无法落盘。"
        );
      }
      blockLaterAgentEditGenerations(conversation, proposal);
      uiMessage.info(
        proposal.longPlotDesignTarget
          ? "已拒绝剧情设计变更，当前结构未改变"
          : proposal.longDraftTarget
            ? "已拒绝章节正文变更，当前正文未改变"
            : "已拒绝智能体修改，原文未改变"
      );
      return;
    }

    if (
      (proposal.status === "accepting" && !reserved) ||
      proposal.status === "accepted" ||
      proposal.status === "rejected" ||
      proposal.status === "conflict"
    ) {
      return;
    }

    if (proposal.predecessorProposalId) {
      const predecessor = conversation.getEditProposal(
        request.runId,
        proposal.predecessorProposalId
      );
      if (
        !predecessor ||
        predecessor.status === "rejected" ||
        predecessor.status === "conflict" ||
        predecessor.status === "error"
      ) {
        const message =
          "前序智能体修改未能落盘，当前这项依赖已阻断，没有覆盖当前文稿。";
        conversation.updateEditProposal(request.runId, request.proposalId, {
          status: "conflict",
          proposedText: undefined,
          statusMessage: message
        });
        return;
      }
      if (predecessor.status !== "accepted") {
        conversation.updateEditProposal(request.runId, request.proposalId, {
          status: "pending",
          statusMessage: "正在等待前序修改完成落盘…"
        });
        return;
      }
    }

    if (proposal.libraryTarget?.operation === "create") {
      await acceptLibraryCreationProposal(
        conversation,
        request,
        proposal,
        automatic
      );
      return;
    }

    if (proposal.longWorldbuildingTarget) {
      await acceptLongWorldbuildingFileProposal(
        conversation,
        request,
        proposal,
        automatic
      );
      return;
    }

    if (proposal.longCharacterTarget) {
      await acceptLongCharacterFileProposal(
        conversation,
        request,
        proposal,
        automatic
      );
      return;
    }

    if (proposal.longPlotDesignTarget) {
      await acceptLongPlotDesignProposal(
        conversation,
        request,
        proposal,
        automatic
      );
      return;
    }

    if (proposal.longDraftTarget) {
      await acceptLongDraftProposal(conversation, request, proposal, automatic);
      return;
    }

    if (proposal.characterStructureTarget) {
      await acceptCharacterStructureProposal(
        conversation,
        request,
        proposal,
        automatic,
        reserved
      );
      return;
    }

    if (proposal.plotStructureTarget) {
      await plotStructureProposalLane.accept(
        conversation,
        request,
        proposal,
        automatic,
        reserved
      );
      return;
    }

    if (proposal.draftSectionCreationTarget) {
      await acceptDraftSectionCreationProposal(
        conversation,
        request,
        proposal,
        automatic,
        reserved
      );
      return;
    }

    if (proposal.draftSectionRenameTarget) {
      await acceptDraftSectionRenameProposal(
        conversation,
        request,
        proposal,
        automatic,
        reserved
      );
      return;
    }

    if (proposal.draftSectionDeletionTarget) {
      await acceptDraftSectionDeletionProposal(
        conversation,
        request,
        proposal,
        automatic,
        reserved
      );
      return;
    }

    if (proposal.provisionalExpertSection) {
      const parsedDocumentId = parseCatalogDraftDocumentId(proposal.documentId);
      if (!parsedDocumentId) {
        const message = "待审阅的临时章节文件标识无效，请重新生成。";
        conversation.updateEditProposal(request.runId, request.proposalId, {
          status: "error",
          statusMessage: message
        });
        uiMessage.warning(message);
        return;
      }
      const provisionalSectionId = parsedDocumentId.sectionId;
      const creation = findPendingDraftSectionCreationForProvisional(
        conversation,
        request.runId,
        provisionalSectionId
      );
      if (creation?.status === "error" || creation?.status === "accepting") {
        conversation.updateEditProposal(request.runId, request.proposalId, {
          status: "pending",
          statusMessage:
            creation.status === "error"
              ? "章节创建结果尚未确认，正文内容已保留；请先重试章节创建。"
              : "正在等待关联章节创建完成…"
        });
        return;
      }
      if (creation) {
        await acceptDraftSectionCreationProposal(
          conversation,
          {
            runId: request.runId,
            proposalId: creation.id,
            decision: "accept"
          },
          creation,
          automatic
        );
        if (
          reconcileCreationDependencyAfterAttempt({
            conversation,
            runId: request.runId,
            proposalId: request.proposalId,
            creationProposalId: creation.id,
            waitingMessage:
              "章节创建结果尚未确认，正文内容已保留；请先重试章节创建。",
            blockedMessage: "关联的空白章节确认未能创建，相关正文写入已取消。"
          })
        ) {
          return;
        }
      } else {
        const realSectionId = resolveProvisionalExpertSectionId(
          request.runId,
          proposal.workspaceId,
          provisionalSectionId
        );
        if (realSectionId !== provisionalSectionId) {
          remapProvisionalExpertSectionFileProposals(
            conversation,
            request.runId,
            proposal.workspaceId,
            new Map([[provisionalSectionId, realSectionId]])
          );
        } else {
          const inFlight = conversation
            .listEditProposals(request.runId)
            .find(
              (candidate) =>
                candidate.draftSectionCreationTarget?.sections.some(
                  (section) =>
                    section.provisionalSectionId === provisionalSectionId
                ) && candidate.status === "accepting"
            );
          if (inFlight) {
            conversation.updateEditProposal(request.runId, request.proposalId, {
              status: "pending",
              statusMessage: "正在等待关联章节创建完成…"
            });
            uiMessage.info("同一作品正在保存其他修改，请稍候再接受");
            return;
          }
        }
      }
      const remapped = conversation.getEditProposal(
        request.runId,
        request.proposalId
      );
      if (!remapped) {
        uiMessage.error("待审阅的智能体变更已不存在，请重新生成修改。");
        return;
      }
      proposal = remapped;
      if (proposal.provisionalExpertSection) {
        const message =
          "目标空白章节尚未落盘，无法写入正文。请先接受章节创建，或重新生成。";
        conversation.updateEditProposal(request.runId, request.proposalId, {
          status: "conflict",
          statusMessage: message
        });
        uiMessage.warning(message);
        return;
      }
    }

    if (proposal.provisionalCharacterItemId) {
      const creation = findPendingCharacterCreationForProvisional(
        conversation,
        request.runId,
        proposal.provisionalCharacterItemId
      );
      if (creation?.status === "error" || creation?.status === "accepting") {
        conversation.updateEditProposal(request.runId, request.proposalId, {
          status: "pending",
          statusMessage:
            creation.status === "error"
              ? "人物条目创建结果尚未确认，正文内容已保留；请先重试创建操作。"
              : "正在等待关联人物条目创建完成…"
        });
        return;
      }
      if (creation) {
        await acceptCharacterStructureProposal(
          conversation,
          {
            runId: request.runId,
            proposalId: creation.id,
            decision: "accept"
          },
          creation,
          automatic
        );
        if (
          reconcileCreationDependencyAfterAttempt({
            conversation,
            runId: request.runId,
            proposalId: request.proposalId,
            creationProposalId: creation.id,
            waitingMessage:
              "人物条目创建结果尚未确认，正文内容已保留；请先重试创建操作。",
            blockedMessage: "关联人物条目未能创建，相关正文写入已取消。"
          })
        ) {
          return;
        }
      }
      const createdTarget = liveWorkspaceDocuments.value.find(
        (document) =>
          document.workspaceId === proposal.workspaceId &&
          document.catalogDocumentId === proposal.provisionalCharacterItemId
      );
      if (!createdTarget) {
        const message =
          "目标人物条目尚未落盘，无法写入正文。请先接受人物条目创建，或重新生成。";
        conversation.updateEditProposal(request.runId, request.proposalId, {
          status: "conflict",
          statusMessage: message
        });
        uiMessage.warning(message);
        return;
      }
    }

    const target = liveWorkspaceDocuments.value.find(
      (document) => document.id === proposal.documentId
    );
    const persistedDocument = documents.value.find(
      (document) => document.id === proposal.documentId
    );
    if (!target || !persistedDocument || target.readOnly) {
      const message = "目标文稿已不可用，无法接受这项智能体修改。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "error",
        statusMessage: message
      });
      uiMessage.error(message);
      return;
    }

    if (proposal.libraryTarget) {
      const library = findCatalogLibrary(
        proposal.libraryTarget.domain,
        proposal.libraryTarget.libraryId
      );
      if (
        !library ||
        !currentLibraryProjectRevisionMatches(proposal, library.projectRevision)
      ) {
        const message = "资料库目录已在审阅期间发生变化，未接受智能体修改。";
        conversation.updateEditProposal(request.runId, request.proposalId, {
          status: "conflict",
          statusMessage: message
        });
        uiMessage.warning(message);
        return;
      }
    }

    if (
      acceptingAgentEditWorkspaceIds.value.has(proposal.workspaceId) ||
      documents.value.some(
        (document) =>
          (document.workspaceId === proposal.workspaceId ||
            (proposal.libraryTarget !== undefined &&
              document.domain === proposal.libraryTarget.domain &&
              document.libraryId === proposal.libraryTarget.libraryId)) &&
          savingDocumentIds.value.has(document.id)
      )
    ) {
      const message = automatic
        ? "检测到作品正在保存其他内容，实时自动落盘已暂停，请稍后人工重试。"
        : "同一作品正在保存其他修改，请稍候再接受";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: automatic ? "error" : "pending",
        statusMessage: message
      });
      uiMessage.info(message);
      return;
    }

    const currentDraft = editorDrafts.value[target.id];
    if (
      typeof proposal.proposedText === "string" &&
      persistedDocument.content === proposal.proposedText &&
      (!proposal.libraryTarget || persistedDocument.title === proposal.title)
    ) {
      const staleRecoveryDraft = Boolean(
        currentDraft &&
        currentDraft.title === persistedDocument.title &&
        (currentDraft.content === persistedDocument.content ||
          currentDraft.content === proposal.proposedText)
      );
      if (staleRecoveryDraft) {
        const nextDrafts = { ...editorDrafts.value };
        delete nextDrafts[target.id];
        editorDrafts.value = nextDrafts;
      }
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "accepted",
        proposedText: undefined,
        statusMessage:
          currentDraft && !staleRecoveryDraft
            ? "修改已在本地 Markdown 中；检测到另一份未保存草稿，已为你保留。"
            : "修改已经存在于本地 Markdown 中。"
      });
      if (!automatic) {
        uiMessage.success("智能体修改已经保存在本地文稿中");
      }
      return;
    }

    if (typeof proposal.proposedText !== "string") {
      const message = "待审阅变更缺少完整修改稿，请重新生成修改。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "error",
        statusMessage: message
      });
      uiMessage.error(message);
      return;
    }
    if (
      proposal.libraryTarget &&
      classifyAgentEditAcceptance(proposal, target.content) === "conflict"
    ) {
      const message =
        "资料库内容已在审阅期间发生变化，未接受智能体修改，也没有覆盖最新内容。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "conflict",
        statusMessage: message
      });
      uiMessage.warning(message);
      return;
    }

    const proposedText = proposal.proposedText;
    const payload = {
      id: target.id,
      title: proposal.title,
      content: proposedText
    };
    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "accepting",
      statusMessage: automatic
        ? "正在自动批准并保存到本地 Markdown…"
        : "正在保存到本地 Markdown…"
    });
    setAgentEditDocumentAccepting(target.id, true);
    setAgentEditWorkspaceAccepting(proposal.workspaceId, true);
    const draftAtAccept = currentDraft;
    const currentApi = api();

    try {
      let persisted = false;
      let newerDraftPreserved = false;
      if (
        persistedDocument.workspaceId &&
        persistedDocument.catalogDocumentId
      ) {
        if (!currentApi) {
          throw new Error("桌面文件服务当前不可用。");
        }
        const saved = await currentApi.catalog.saveDocument(
          shortAgentDirectDocumentWrite({
            bookId: persistedDocument.workspaceId,
            documentId: persistedDocument.catalogDocumentId,
            content: payload.content
          })
        );
        const normalizedPayload = {
          id: payload.id,
          title: saved.title,
          content: saved.content
        };
        applyAcceptedAgentDocumentLocally(
          normalizedPayload,
          saved.projectRevision,
          draftAtAccept
        );
        const expectedDocuments = captureWorkspaceDocumentBaselines(
          documents.value,
          persistedDocument.workspaceId
        );
        await refreshBookAfterSuccessfulDocumentSave(
          persistedDocument.workspaceId,
          expectedDocuments,
          saved.projectRevision
        );
        newerDraftPreserved = Boolean(editorDrafts.value[payload.id]);
        persisted = true;
      } else if (
        proposal.libraryTarget?.operation === "edit-overview" &&
        persistedDocument.catalogLibraryField === "overview" &&
        persistedDocument.libraryId &&
        (persistedDocument.domain === "material" ||
          persistedDocument.domain === "skill")
      ) {
        if (!currentApi) {
          throw new Error("桌面文件服务当前不可用。");
        }
        const updated = await currentApi.catalog.updateLibrary({
          domain: persistedDocument.domain,
          libraryId: persistedDocument.libraryId,
          overview: payload.content,
          ...(persistedDocument.catalogProjectRevision === undefined
            ? {}
            : {
                baseProjectRevision:
                  findCatalogLibrary(
                    persistedDocument.domain,
                    persistedDocument.libraryId
                  )?.projectRevision ?? persistedDocument.catalogProjectRevision
              })
        });
        const normalizedPayload = {
          id: payload.id,
          title: persistedDocument.title,
          content: updated.overview
        };
        await applyUpdatedCatalogLibrary(persistedDocument.domain, updated);
        applyAcceptedAgentDocumentLocally(
          normalizedPayload,
          updated.projectRevision,
          draftAtAccept
        );
        rememberAcceptedLibraryMutation(proposal);
        newerDraftPreserved = Boolean(editorDrafts.value[payload.id]);
        persisted = true;
      } else if (
        proposal.libraryTarget?.operation === "edit" &&
        persistedDocument.catalogEntryId &&
        persistedDocument.libraryId &&
        (persistedDocument.domain === "material" ||
          persistedDocument.domain === "skill")
      ) {
        if (!currentApi) {
          throw new Error("桌面文件服务当前不可用。");
        }
        const library = findCatalogLibrary(
          persistedDocument.domain,
          persistedDocument.libraryId
        );
        if (!library) {
          throw new Error("目标资料库已不存在。");
        }
        const projectRevision = library.projectRevision;
        const saved = await currentApi.catalog.saveLibraryEntry({
          domain: persistedDocument.domain,
          libraryId: persistedDocument.libraryId,
          entryId: persistedDocument.catalogEntryId,
          title: payload.title,
          content: payload.content,
          baseRevision:
            currentDraft?.baseRevision ??
            createShortWorkspaceContentRevision(persistedDocument.content),
          ...(projectRevision === undefined
            ? {}
            : { baseProjectRevision: projectRevision })
        });
        const savedProjectRevision =
          projectRevision === undefined ? undefined : projectRevision + 1;
        const normalizedPayload = {
          id: payload.id,
          title: saved.title,
          content: saved.body
        };
        const synchronizedProjectRevision = await applySavedLibraryEntry(
          persistedDocument.domain,
          persistedDocument.libraryId,
          saved,
          savedProjectRevision
        );
        applyAcceptedAgentDocumentLocally(
          normalizedPayload,
          synchronizedProjectRevision,
          draftAtAccept
        );
        rememberAcceptedLibraryMutation(proposal);
        newerDraftPreserved = Boolean(editorDrafts.value[payload.id]);
        persisted = true;
      } else {
        applyAcceptedAgentDocumentLocally(payload, undefined, draftAtAccept);
        newerDraftPreserved = Boolean(editorDrafts.value[payload.id]);
      }

      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "accepted",
        proposedText: undefined,
        statusMessage: newerDraftPreserved
          ? `${automatic ? "已自动批准并" : "已"}保存审阅时的智能体修改；保存期间出现的更新草稿已保留。`
          : persisted
            ? `${automatic ? "已自动批准并" : "已接受并"}保存到本地文件。`
            : `${automatic ? "已自动批准并写入" : "已接受到"}当前工作区；该预览资源没有对应的本地文件。`
      });
      if (!automatic) {
        uiMessage.success(
          persisted ? "已接受并保存智能体修改" : "已接受智能体修改"
        );
      }
    } catch (error: unknown) {
      const conflict = isCatalogConflict(error);
      const message = conflict
        ? "本地 Markdown 已在其他位置更新，未保存智能体修改；请基于最新文稿重新生成。"
        : error instanceof Error
          ? error.message
          : "保存智能体修改失败，原文保持不变。";
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: conflict ? "conflict" : "error",
        statusMessage: message
      });
      if (conflict) {
        await loadCatalogSnapshot();
        uiMessage.warning(message);
      } else {
        uiMessage.error(message);
      }
    } finally {
      setAgentEditDocumentAccepting(target.id, false);
      setAgentEditWorkspaceAccepting(proposal.workspaceId, false);
    }
  }

  async function reviewAgentEdit(
    request: AgentEditReviewRequest
  ): Promise<void> {
    const conversation = activeConversation.value;
    const proposal = conversation.getEditProposal(
      request.runId,
      request.proposalId
    );
    if (
      request.decision === "accept" &&
      proposal &&
      canReviewAgentEditDuringRun(proposal)
    ) {
      queueAgentEdit(
        conversation,
        conversation.sessionId.value,
        request.runId,
        request.proposalId,
        false,
        true
      );
      return;
    }
    await applyAgentEdit(conversation, request);
  }

  async function reviewLongAgentEdit(
    request: AgentEditReviewRequest
  ): Promise<void> {
    const conversation = activeLongConversation.value;
    if (!conversation) return;
    const proposal = conversation.getEditProposal(
      request.runId,
      request.proposalId
    );
    if (
      request.decision === "accept" &&
      proposal &&
      canReviewAgentEditDuringRun(proposal)
    ) {
      queueAgentEdit(
        conversation,
        conversation.sessionId.value,
        request.runId,
        request.proposalId,
        false,
        true
      );
      return;
    }
    await applyAgentEdit(conversation, request);
  }

  return {
    resumeRecoveredAutomaticAgentEdits: (
      ...args: Parameters<typeof resumeRecoveredAutomaticAgentEdits>
    ) => {
      if (!proposalQueue.isDisposed()) {
        resumeRecoveredAutomaticAgentEdits(...args);
      }
    },
    hasQueuedAgentEdits,
    reviewAgentEdit: (...args: Parameters<typeof reviewAgentEdit>) =>
      invokeWhileActive(() => reviewAgentEdit(...args)),
    reviewLongAgentEdit: (...args: Parameters<typeof reviewLongAgentEdit>) =>
      invokeWhileActive(() => reviewLongAgentEdit(...args)),
    discardAgentEdit: (
      ...args: Parameters<typeof acceptedEditDiscard.discardAgentEdit>
    ) => invokeWhileActive(() => acceptedEditDiscard.discardAgentEdit(...args)),
    scheduleQueuedAgentEdits: (
      ...args: Parameters<typeof scheduleQueuedAgentEdits>
    ) => {
      if (!proposalQueue.isDisposed()) scheduleQueuedAgentEdits(...args);
    },
    stageAgentEditProposal: (
      ...args: Parameters<typeof stageAgentEditProposal>
    ) => {
      if (!proposalQueue.isDisposed()) stageAgentEditProposal(...args);
    },
    stageLibraryEditProposal: (
      ...args: Parameters<typeof stageLibraryEditProposal>
    ) => {
      if (!proposalQueue.isDisposed()) stageLibraryEditProposal(...args);
    },
    stageLongCharacterEditProposal: (
      ...args: Parameters<typeof stageLongCharacterEditProposal>
    ) => {
      if (!proposalQueue.isDisposed()) {
        stageLongCharacterEditProposal(...args);
      }
    },
    stageLongDraftEditProposal: (
      ...args: Parameters<typeof stageLongDraftEditProposal>
    ) => {
      if (!proposalQueue.isDisposed()) stageLongDraftEditProposal(...args);
    },
    stageLongPlotDesignEditProposal: (
      ...args: Parameters<typeof stageLongPlotDesignEditProposal>
    ) => {
      if (!proposalQueue.isDisposed()) {
        stageLongPlotDesignEditProposal(...args);
      }
    },
    stageLongWorldbuildingEditProposal: (
      ...args: Parameters<typeof stageLongWorldbuildingEditProposal>
    ) => {
      if (!proposalQueue.isDisposed()) {
        stageLongWorldbuildingEditProposal(...args);
      }
    },
    drain,
    dispose
  };
}

export type ProposalCoordinator = ReturnType<typeof useProposalCoordinator>;
