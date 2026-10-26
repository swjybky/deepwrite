import { formatError } from "../i18n/errors";
import { createScopedTranslator } from "../i18n";
import { createLongWorldbuildingProposalLane } from "./proposal-coordinator/long-worldbuilding-lane";
import { createLibraryProposalStager } from "./proposal-coordinator/library-staging";
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
import type {
  AgentApprovalMode,
  AgentEditProposal
} from "../types/conversation";
import {
  replaceLongBookSummary,
  resolveLongWorkspaceApi
} from "../types/longWorkspace";
import type { EditorDraftState, WorkspaceDocument } from "../types/workspace";
import {
  agentEditProposalGenerationId,
  agentEditProposalId,
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
import { loadProposalDocument } from "./proposal-coordinator/document-content";
import {
  shortAgentCheckedDocumentWrite,
  shortAgentDirectDocumentWrite
} from "./proposal-coordinator/short-direct-write";
import {
  expectedDiskRevision,
  resolveTextProposalAcceptBase,
  resolvedStaleBase,
  stagedStaleBase,
  staleRevisionAfterConflict,
  staleTextProposalPatch
} from "./proposal-coordinator/stale-base";
import {
  holdStaleLongProposal as holdStaleLongProposalForUser,
  isLongDocumentChanged,
  withConfirmedDocumentHashes
} from "./proposal-coordinator/long-stale-base";
import { createAcceptedEditDiscardCoordinator } from "./accepted-edit-discard";
import type { AgentConversationController } from "./useAgentConversation";
import type { LongWorkspaceProposalEvent } from "./useLongWorkspaceProposals";

const t = createScopedTranslator("workspace");

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
    ensureDocumentLoaded(
      document: WorkspaceDocument
    ): Promise<WorkspaceDocument>;
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
  /**
   * Text the latest accepted agent write left in each document. A base moved
   * only by agent writes is not a user edit (see proposal-coordinator/stale-base.ts).
   */
  const agentWrittenRevisions = new Map<string, string>();
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
        formatError(error, t("proposalCoordinator.failedToApproveAgentEdits"))
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
    documents: () => documents.value,
    applyAcceptedDocumentLocally: applyAcceptedAgentDocumentLocally,
    isCatalogConflict,
    isWorkspaceAccepting: (workspaceId) =>
      acceptingAgentEditWorkspaceIds.value.has(workspaceId),
    setWorkspaceAccepting: setAgentEditWorkspaceAccepting,
    notifications: uiMessage,
    queueAgentEdit: (...args) => queueAgentEdit(...args)
  });

  function libraryMutationCountKey(proposal: AgentEditProposal): string {
    const target = proposal.libraryTarget!;
    return `${proposal.runId}\u0000${target.domain}\u0000${target.libraryId}\u0000${target.baseProjectRevision ?? "legacy"}`;
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
      const message = t(
        "proposalCoordinator.thePendingNewEntryIsMissingCompleteContentGenerate"
      );
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "error",
        statusMessage: message
      });
      uiMessage.error(message);
      return;
    }
    const currentApi = api();
    if (!currentApi) {
      const message = t("short.theDesktopFileServiceIsUnavailable");
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
      const message = t(
        "proposalCoordinator.theDestinationLibraryIsUnavailableOrReadOnlyThe"
      );
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
      const message = t(
        "proposalCoordinator.theLibraryDirectoryChangedNoEntryWasCreatedGenerate"
      );
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "conflict",
        statusMessage: message
      });
      uiMessage.warning(message);
      return;
    }
    if (acceptingAgentEditWorkspaceIds.value.has(proposal.workspaceId)) {
      uiMessage.info(
        t("proposalCoordinator.otherEditsToThisLibraryAreBeingSavedWait")
      );
      return;
    }

    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "accepting",
      statusMessage: automatic
        ? t(
            "proposalCoordinator.automaticallyApprovingAndCreatingTheLibraryEntry"
          )
        : t("proposalCoordinator.checkingTheLibraryVersionAndCreatingTheEntry")
    });
    setAgentEditWorkspaceAccepting(proposal.workspaceId, true);
    try {
      const commonInput = {
        libraryId: target.libraryId,
        ...(target.managementScope
          ? { managementScope: target.managementScope }
          : {}),
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
          ? t("proposalCoordinator.libraryEntryAutomaticallyApprovedAndCreated")
          : t("proposalCoordinator.createdAndSavedToLocalMarkdown")
      });
      if (createdDocument && !target.managementScope) {
        selectedResourceId.value = createdDocument.id;
        rightCollapsed.value = false;
      }
      uiMessage.success(
        automatic
          ? t(
              "proposalCoordinator.libraryEntryAutomaticallyApprovedAndCreated2"
            )
          : t("proposalCoordinator.libraryEntryCreated")
      );
    } catch (error: unknown) {
      const message = isCatalogConflict(error)
        ? t(
            "proposalCoordinator.theLibraryWasUpdatedExternallyNoEntryWasCreated"
          )
        : formatError(
            error,
            t(
              "catalogLibraryTransactionsCoordinator.failedToCreateLibraryEntry"
            )
          );
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
            t(
              "proposalCoordinator.linkedToTheNewlyCreatedChapterFileContentWill"
            )
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
      return t(
        "proposalCoordinator.anEarlierEditWasRejectedThisChangeIsBlocked"
      );
    }
    if (proposal?.status === "conflict") {
      return t(
        "proposalCoordinator.anEarlierEditHasConflictsThisSubsequentChangeIs"
      );
    }
    return undefined;
  }

  function awaitsPredecessor(
    existing: AgentEditProposal | undefined,
    coalescesExisting: boolean
  ): boolean {
    return Boolean(
      existing && !coalescesExisting && existing.status !== "accepted"
    );
  }

  /** One notice per lane when an automatic edit waits for the user's text. */
  function notifyAutomaticEditPaused(
    existing: AgentEditProposal | undefined,
    runApprovalMode: AgentApprovalMode,
    title: string
  ): void {
    if (existing?.staleBase || runApprovalMode !== "auto-approve") return;
    uiMessage.warning(
      t("proposalCoordinator.userEditedAgentTarget", { title })
    );
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
        statusMessage: t(
          "proposalCoordinator.anEarlierManuscriptEditWasRejectedThisSubsequentEdit"
        )
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
      const message = t(
        "proposalCoordinator.theTargetCharacterStructureIsUnavailableThisChangeCannot"
      );
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
      const message = t(
        "proposalCoordinator.characterCreationIsMissingAStableEntryIdOrdered"
      );
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "error",
        statusMessage: message
      });
      uiMessage.error(message);
      return;
    }
    conversation.updateEditProposal(request.runId, request.proposalId, {
      status: "accepting",
      statusMessage: automatic
        ? t("proposalCoordinator.automaticallySavingCharacterStructure")
        : t("proposalCoordinator.savingCharacterStructure")
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
      const createdDocument = createdItemId
        ? documents.value.find(
            (document) =>
              document.workspaceId === proposal.workspaceId &&
              document.catalogDocumentId === createdItemId
          )
        : undefined;
      if (createdItemId && !createdDocument) {
        throw new Error(
          t("proposalCoordinator.characterEntryCreatedButItsFileCouldNotBe")
        );
      }
      if (createdDocument) await loadProposalDocument(context, createdDocument);
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
          ? t(
              "proposalCoordinator.characterStructureChangesAutomaticallyApprovedAndSaved"
            )
          : t("proposalCoordinator.characterStructureChangesSavedLocally")
      });
      if (!automatic)
        uiMessage.success(
          t("proposalCoordinator.characterStructureChangesSaved")
        );
    } catch (error) {
      await loadCatalogSnapshot();
      const message = formatError(
        error,
        t("proposalCoordinator.failedToSaveCharacterStructureChanges")
      );
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

  async function stageAgentEditProposal(
    event: WorkspaceEditorMutationEvent
  ): Promise<void> {
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
        const message = t(
          "proposalCoordinator.theCurrentCharacterStructureIsNotListBasedThis"
        );
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
            ? t("proposalCoordinator.createCharacterEntry", {
                title: source.title
              })
            : source.type === "updateItem"
              ? t("proposalCoordinator.renameCharacter", {
                  previousItemTitle: previousItemTitle ?? "",
                  title: source.title
                })
              : source.type === "moveItem"
                ? t("proposalCoordinator.characterEntry", {
                    value:
                      source.direction === "up"
                        ? t("proposalCoordinator.moveUp")
                        : t("proposalCoordinator.moveDown"),
                    title: source.title
                  })
                : t("proposalCoordinator.deleteCharacterEntry", {
                    title: source.title
                  }),
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
        const message = t(
          "proposalCoordinator.theManuscriptDirectoryIsUnavailableChapterCreationWasNot"
        );
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
        title: t("proposalCoordinator.createBlankChapters", {
          length: mutationTarget.sections.length
        }),
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
        const message = t(
          "proposalCoordinator.theTargetChapterIsUnavailableRenamingWasNotSubmitted"
        );
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
        title: t("proposalCoordinator.renameChapter", {
          previousTitle: mutationTarget.previousTitle,
          title: mutationTarget.title
        }),
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
          ? t("workspaceResourceCoordinator.episode")
          : t("proposalCoordinator.chapter");
      if (!directory || !book || !section) {
        const message = t(
          "proposalCoordinator.theTargetIsUnavailableDeletingTheWasNotSubmitted",
          { draftUnit: draftUnit, draftUnit2: draftUnit }
        );
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
        title: t("proposalCoordinator.delete", {
          draftUnit: draftUnit,
          title: mutationTarget.title
        }),
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
    let target = liveWorkspaceDocuments.value.find((document) =>
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
    if (target && !target.readOnly && target.catalogContentLoaded === false) {
      try {
        target = await loadProposalDocument(context, target);
      } catch (error) {
        if (proposalQueue.isDisposed()) return;
        const message = formatError(
          error,
          t(
            "workspaceResourceCoordinator.failedToReadTheManuscriptSelectItAgainAnd"
          )
        );
        sourceConversation.markToolConflict(
          event.payload.runId,
          event.payload.toolCallId,
          message
        );
        uiMessage.error(message);
        return;
      }
      if (
        proposalQueue.isDisposed() ||
        !sourceConversation.acceptsRunEvent(
          event.payload.sessionId,
          event.payload.runId
        )
      )
        return;
    }
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
          const message = t(
            "proposalCoordinator.theTargetChapterHasNotBeenCreatedOrIs"
          );
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
        // A base taken from an unlanded predecessor is checked once it lands.
        const staleBase =
          noChanges || awaitsPredecessor(existing, identity.coalescesExisting)
            ? undefined
            : stagedStaleBase(
                existing,
                realTarget.content,
                applyBaseRevision,
                event.timestamp,
                agentWrittenRevisions.get(realTarget.id)
              );
        const proposal: AgentEditProposal = {
          id: identity.id,
          laneId,
          generation: identity.generation,
          approvalMode: staleBase ? "request-approval" : runApprovalMode,
          ...(staleBase ? { staleBase } : {}),
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
            ? {
                statusMessage: t(
                  "proposalCoordinator.theTextHasNotChangedNoSaveIsNeeded"
                )
              }
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
        if (staleBase) {
          notifyAutomaticEditPaused(
            existing,
            runApprovalMode,
            realTarget.title
          );
        } else if (!noChanges && runApprovalMode === "auto-approve") {
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
        const message = t(
          "proposalCoordinator.theTargetChapterHasNotBeenCreatedOrIs"
        );
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
        )?.title ?? t("proposalCoordinator.newChapter");
      const title =
        mutationTarget.fileKind === "characterState"
          ? t("proposalCoordinator.characterState", {
              sectionTitle: sectionTitle
            })
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
        ...(noChanges
          ? {
              statusMessage: t(
                "proposalCoordinator.theTextHasNotChangedNoSaveIsNeeded"
              )
            }
          : {}),
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
        const message = t(
          "proposalCoordinator.theTargetCharacterEntryHasNotBeenCreatedOr"
        );
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
      const baseText =
        existing?.proposedText ??
        creation.characterStructureTarget?.initialContent ??
        "";
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
        provisionalCharacterItemId: mutationTarget.itemId,
        discardSnapshot: textEditDiscardSnapshot(
          existing,
          identity.coalescesExisting,
          baseText,
          creationMutation.title
        )
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
      const message = t(
        "proposalCoordinator.theTargetManuscriptIsNotWritableThisAgentChange"
      );
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
    // A base taken from an unlanded predecessor is checked once it lands.
    const staleBase =
      noChanges || awaitsPredecessor(existing, identity.coalescesExisting)
        ? undefined
        : stagedStaleBase(
            existing,
            target.content,
            applyBaseRevision,
            event.timestamp,
            agentWrittenRevisions.get(target.id)
          );
    const proposal: AgentEditProposal = {
      id: identity.id,
      laneId,
      generation: identity.generation,
      approvalMode: staleBase ? "request-approval" : runApprovalMode,
      ...(staleBase ? { staleBase } : {}),
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
      ...(noChanges
        ? {
            statusMessage: t(
              "proposalCoordinator.theTextHasNotChangedNoSaveIsNeeded"
            )
          }
        : {}),
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
    if (staleBase) {
      notifyAutomaticEditPaused(existing, runApprovalMode, target.title);
    } else if (!noChanges && runApprovalMode === "auto-approve") {
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
      title: t("proposalCoordinator.plotDesignChanges"),
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
      const message = t(
        "proposalCoordinator.worldbuildingFileToolsMustProduceOneIndependentFileChange"
      );
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
      ...(noChanges
        ? {
            statusMessage: t(
              "proposalCoordinator.theTextHasNotChangedNoSaveIsNeeded"
            )
          }
        : {}),
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
      const message = t(
        "proposalCoordinator.characterFileToolsMustCreateOneCompleteCharacterOr"
      );
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
        ? t("proposalCoordinator.newCharacter", {
            characterName: primaryFile.characterName
          })
        : primaryFile.title,
      summary: event.payload.summary,
      status: noChanges ? "accepted" : "pending",
      ...(!noChanges ? { proposedText: primaryFile.afterText } : {}),
      toolCallIds: [event.payload.toolCallId],
      additions: diff.additions,
      deletions: diff.deletions,
      hunks: diff.hunks,
      ...(diff.truncated ? { truncated: true } : {}),
      ...(noChanges
        ? {
            statusMessage: t(
              "proposalCoordinator.theTextHasNotChangedNoSaveIsNeeded"
            )
          }
        : {}),
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
      title: t("proposalCoordinator.manuscript", {
        chapterTitle: file.chapterTitle
      }),
      summary: event.payload.summary,
      status: noChanges ? "accepted" : "pending",
      ...(noChanges ? {} : { proposedText: file.afterText }),
      toolCallIds: [event.payload.toolCallId],
      additions: diff.additions,
      deletions: diff.deletions,
      hunks: diff.hunks,
      ...(diff.truncated ? { truncated: true } : {}),
      ...(noChanges
        ? {
            statusMessage: t(
              "proposalCoordinator.theManuscriptHasNotChangedNoSaveIsNeeded"
            )
          }
        : {}),
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

  const stageLibraryEditProposal = createLibraryProposalStager(
    context,
    queueAgentEdit,
    () => proposalQueue.isDisposed(),
    drain
  );

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
      const message = t(
        "proposalCoordinator.thePendingChapterCreationIsMissingRequiredParametersGenerate"
      );
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "error",
        statusMessage: message
      });
      uiMessage.error(message);
      return;
    }
    const currentApi = api();
    if (!currentApi) {
      const message = t("short.theDesktopFileServiceIsUnavailable");
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
      const message = t(
        "proposalCoordinator.theManuscriptDirectoryIsUnavailableChaptersCannotBeCreated"
      );
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
        ? t(
            "proposalCoordinator.otherContentInThisProjectIsBeingSavedAutomatic"
          )
        : t("proposalCoordinator.otherEditsToThisProjectAreBeingSavedWait");
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
        ? t(
            "proposalCoordinator.automaticallyApprovingAndCreatingBlankChapterFiles"
          )
        : t("proposalCoordinator.creatingChapterFiles")
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
          t("proposalCoordinator.chaptersCreatedButTheNewChaptersCouldNotBe")
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
          ? t(
              "proposalCoordinator.automaticallyApprovedAndCreatedChaptersIncludingTheirSubmittedProse",
              { createdCount: createdCount }
            )
          : t(
              "proposalCoordinator.createdChaptersAndSavedTheirSubmittedProseAndCharacter",
              { createdCount: createdCount }
            )
      });
      if (!automatic) {
        uiMessage.success(
          t("proposalCoordinator.createdBlankChapterFiles", {
            createdCount: createdCount
          })
        );
      }
    } catch (error: unknown) {
      await loadCatalogSnapshot();
      const conflict = isCatalogConflict(error);
      const message = formatError(
        error,
        t("proposalCoordinator.failedToCreateBlankChapters")
      );
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: conflict ? "conflict" : "error",
        statusMessage: message
      });
      if (conflict) {
        conflictDependentProvisionalFileProposals(
          conversation,
          request.runId,
          target.sections.map((section) => section.provisionalSectionId),
          t(
            "proposalCoordinator.theAssociatedBlankChapterCouldNotBeCreatedRelated"
          )
        );
      } else {
        pauseDependentProvisionalFileProposals(
          conversation,
          request.runId,
          target.sections.map((section) => section.provisionalSectionId),
          t("proposalCoordinator.chapterCreationHasNotBeenConfirmedTheProseIs")
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
      const message = t(
        "proposalCoordinator.thePendingChapterRenameIsMissingRequiredParametersGenerate"
      );
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "error",
        statusMessage: message
      });
      uiMessage.error(message);
      return;
    }
    const currentApi = api();
    if (!currentApi) {
      const message = t("short.theDesktopFileServiceIsUnavailable");
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
      const message = t(
        "proposalCoordinator.theTargetChapterIsUnavailableAndCannotBeRenamed"
      );
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
      const message = t(
        "proposalCoordinator.theTargetChapterNoLongerExistsAndCannotBe"
      );
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "conflict",
        statusMessage: message
      });
      uiMessage.warning(message);
      return;
    }
    if (acceptingAgentEditWorkspaceIds.value.has(proposal.workspaceId)) {
      const message = automatic
        ? t(
            "proposalCoordinator.otherContentInThisProjectIsBeingSavedAutomatic2"
          )
        : t("proposalCoordinator.otherEditsToThisProjectAreBeingSavedWait");
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
        ? t("proposalCoordinator.automaticallyApprovingAndRenamingTheChapter")
        : t("proposalCoordinator.renamingTheChapter")
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
          ? t("proposalCoordinator.automaticallyApprovedAndRenamedChapterTo", {
              previousTitle: target.previousTitle,
              title: target.title
            })
          : t("proposalCoordinator.renamedChapterToAndSavedItLocally", {
              previousTitle: target.previousTitle,
              title: target.title
            })
      });
      if (!automatic) {
        uiMessage.success(
          t("proposalCoordinator.chapterRenamedTo", {
            title: target.title
          })
        );
      }
    } catch (error: unknown) {
      await loadCatalogSnapshot();
      const conflict = isCatalogConflict(error);
      const message = formatError(
        error,
        t("proposalCoordinator.failedToRenameChapter")
      );
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
        ? t("workspaceResourceCoordinator.episode")
        : t("proposalCoordinator.chapter");
    const target = proposal.draftSectionDeletionTarget;
    if (!target) {
      const message = t(
        "proposalCoordinator.thePendingDeletionIsMissingRequiredParametersGenerateIt",
        { draftUnit: draftUnit }
      );
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "error",
        statusMessage: message
      });
      uiMessage.error(message);
      return;
    }
    const currentApi = api();
    if (!currentApi) {
      const message = t("short.theDesktopFileServiceIsUnavailable");
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
      const message = t(
        "proposalCoordinator.theManuscriptDirectoryIsUnavailableTheCannotBeDeleted",
        { draftUnit: draftUnit }
      );
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
        statusMessage: t(
          "proposalCoordinator.noLongerExistsNoFurtherDeletionIsNeeded",
          { draftUnit: draftUnit, title: target.title }
        )
      });
      conflictDependentDeletedSectionProposals(
        conversation,
        request.runId,
        target.sectionId,
        t(
          "proposalCoordinator.theTargetWasDeletedRelatedProseChangesCannotBe",
          { draftUnit: draftUnit }
        ),
        request.proposalId
      );
      return;
    }
    if (directory.sections.length <= 1) {
      const message = t(
        "proposalCoordinator.atLeastOneMustRemainInTheManuscriptNothing",
        { draftUnit: draftUnit }
      );
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "conflict",
        statusMessage: message
      });
      uiMessage.warning(message);
      return;
    }
    if (acceptingAgentEditWorkspaceIds.value.has(proposal.workspaceId)) {
      const message = automatic
        ? t(
            "proposalCoordinator.otherContentInThisProjectIsBeingSavedAutomatic3"
          )
        : t("proposalCoordinator.otherEditsToThisProjectAreBeingSavedWait");
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
        ? t("proposalCoordinator.automaticallyApprovingAndDeleting", {
            draftUnit: draftUnit
          })
        : t("proposalCoordinator.deleting", { draftUnit: draftUnit })
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
        throw new Error(
          t("proposalCoordinator.noLongerExists", {
            draftUnit: draftUnit,
            title: target.title
          })
        );
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
        t(
          "proposalCoordinator.theTargetWasDeletedRelatedProseChangesCannotBe",
          { draftUnit: draftUnit }
        ),
        request.proposalId
      );
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "accepted",
        proposedText: undefined,
        statusMessage: automatic
          ? t(
              "proposalCoordinator.automaticallyApprovedAndDeletedAndItsManuscriptAndCharacter",
              { draftUnit: draftUnit, title: target.title }
            )
          : t(
              "proposalCoordinator.deletedAndItsManuscriptAndCharacterStateFiles",
              { draftUnit: draftUnit, title: target.title }
            )
      });
      if (!automatic) {
        uiMessage.success(
          t("proposalCoordinator.deletedAndItsCharacterStateFile", {
            draftUnit: draftUnit,
            title: target.title
          })
        );
      }
    } catch (error: unknown) {
      await loadCatalogSnapshot();
      const conflict = isCatalogConflict(error);
      const message = formatError(
        error,
        t("proposalCoordinator.failedToDelete", {
          draftUnit: draftUnit
        })
      );
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
      const message = t(
        "proposalCoordinator.theNovelPlotDesignServiceIsUnavailable"
      );
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "error",
        statusMessage: message
      });
      uiMessage.error(message);
      return;
    }
    if (acceptingAgentEditWorkspaceIds.value.has(proposal.workspaceId)) {
      const message = automatic
        ? t("proposalCoordinator.otherContentInThisBookIsBeingSavedAutomatic")
        : t("proposalCoordinator.otherEditsToThisBookAreBeingSavedWait");
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
        ? t(
            "proposalCoordinator.automaticallyApprovingCheckingImpactsAndSavingPlotDesign"
          )
        : t("proposalCoordinator.checkingImpactsAndSavingPlotDesign")
    });
    setAgentEditWorkspaceAccepting(proposal.workspaceId, true);
    let applied = false;
    let attemptedBatch: LongWorkspaceOperationBatch | undefined;
    try {
      if (activeLongBookId.value === target.bookId) {
        await nextTick();
        if (!(await saveActiveLongEditorChanges())) {
          throw new Error(
            t("proposalCoordinator.currentNovelEditsAreUnsavedPlotDesignWasNot")
          );
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
          t("catalogWorkspace.plotDesign")
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
          statusMessage: t(
            "proposalCoordinator.structuralAndRelatedImpactsHaveBeenLoadedReviewThe"
          ),
          notificationMessage: t(
            "proposalCoordinator.reviewThePlotDesignAndRelatedImpactsBeforeConfirming"
          ),
          removeQueued: removeQueuedAgentEdit,
          notify: uiMessage.info
        })
      ) {
        return;
      }
      const result = await api.applyOperations({
        bookId: target.bookId,
        batch: LongWorkspaceOperationBatchSchema.parse({
          ...withConfirmedDocumentHashes(batch, proposal),
          expectedImpact
        })
      });
      applied = true;
      longBooks.value = replaceLongBookSummary(longBooks.value, result.summary);
      const refreshed = await refreshLongProposalWorkspace(target.bookId);
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "accepted",
        proposedText: undefined,
        ...resolvedStaleBase(proposal, "overwrote"),
        statusMessage: refreshed
          ? t("proposalCoordinator.savedPlotDesign", {
              value: automatic
                ? t("proposalCoordinator.automaticallyApprovedAnd")
                : t("proposalCoordinator.acceptedAnd")
            })
          : t(
              "proposalCoordinator.plotDesignSavedButTheInterfaceRefreshFailedRefresh"
            )
      });
      if (!automatic) {
        uiMessage.success(t("proposalCoordinator.plotDesignAcceptedAndSaved"));
      }
    } catch (error: unknown) {
      if (!applied && isLongDocumentChanged(error)) {
        holdStaleLongProposal(conversation, request.runId, proposal, error);
        return;
      }
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
            t("catalogWorkspace.plotDesign")
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
            statusMessage: t(
              "proposalCoordinator.relatedImpactsChangedAndHaveBeenUpdatedBelowReview"
            ),
            notificationMessage: t(
              "proposalCoordinator.plotDesignImpactsChangedConfirmAgain"
            ),
            removeQueued: removeQueuedAgentEdit,
            notify: uiMessage.warning
          });
          return;
        } catch (previewError: unknown) {
          currentError = previewError;
        }
      }
      const message = formatError(
        currentError,
        t("proposalCoordinator.failedToSavePlotDesignTheCurrentStructureIs")
      );
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: applied ? "accepted" : "error",
        statusMessage: applied
          ? t("proposalCoordinator.plotDesignSavedButRefreshFailed", {
              message: message
            })
          : message
      });
      if (applied) {
        uiMessage.warning(
          t("proposalCoordinator.plotDesignSavedButRefreshFailed", {
            message: message
          })
        );
      } else {
        uiMessage.error(message);
      }
    } finally {
      setAgentEditWorkspaceAccepting(proposal.workspaceId, false);
    }
  }

  const { accept: acceptLongWorldbuildingFileProposal } =
    createLongWorldbuildingProposalLane({
      acceptingAgentEditWorkspaceIds,
      setAgentEditWorkspaceAccepting,
      activeLongBookId,
      longBooks,
      saveActiveLongEditorChanges,
      refreshLongProposalWorkspace,
      removeQueuedAgentEdit,
      uiMessage
    });

  async function acceptLongCharacterFileProposal(
    conversation: AgentConversationController,
    request: AgentEditReviewRequest,
    proposal: AgentEditProposal,
    automatic: boolean
  ): Promise<void> {
    const target = proposal.longCharacterTarget;
    const api = resolveLongWorkspaceApi();
    if (!target || !api) {
      const message = t(
        "proposalCoordinator.theNovelCharacterFileServiceIsUnavailable"
      );
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "error",
        statusMessage: message
      });
      uiMessage.error(message);
      return;
    }
    if (acceptingAgentEditWorkspaceIds.value.has(proposal.workspaceId)) {
      const message = automatic
        ? t("proposalCoordinator.otherContentInThisBookIsBeingSavedAutomatic2")
        : t("proposalCoordinator.otherEditsToThisBookAreBeingSavedWait");
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
          ? t(
              "proposalCoordinator.automaticallyApprovingAndCreatingCharacterProfiles"
            )
          : t("proposalCoordinator.creatingCharacterProfiles")
        : automatic
          ? t(
              "proposalCoordinator.automaticallyApprovingAndSavingCharacterProfiles"
            )
          : t("proposalCoordinator.savingCharacterProfiles")
    });
    setAgentEditWorkspaceAccepting(proposal.workspaceId, true);
    let applied = false;
    let attemptedBatch: LongWorkspaceOperationBatch | undefined;
    try {
      if (activeLongBookId.value === target.bookId) {
        await nextTick();
        if (!(await saveActiveLongEditorChanges())) {
          throw new Error(
            t(
              "proposalCoordinator.currentNovelEditsAreUnsavedCharacterProfilesWereNot"
            )
          );
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
          const message = t(
            "proposalCoordinator.someProfilesForThisCharacterAlreadyExistNoDuplicate"
          );
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
          const message = t(
            "proposalCoordinator.theTargetCharacterProfileNoLongerExistsTheseChanges"
          );
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
          t("proposalCoordinator.characterProfile")
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
          statusMessage: t(
            "proposalCoordinator.profileAndRelatedImpactsHaveBeenLoadedReviewThe"
          ),
          notificationMessage: t(
            "proposalCoordinator.reviewTheCharacterProfileAndRelatedImpactsBeforeConfirming"
          ),
          removeQueued: removeQueuedAgentEdit,
          notify: uiMessage.info
        })
      ) {
        return;
      }
      const result = await api.applyOperations({
        bookId: target.bookId,
        batch: LongWorkspaceOperationBatchSchema.parse({
          ...withConfirmedDocumentHashes(batch, proposal),
          expectedImpact
        })
      });
      applied = true;
      longBooks.value = replaceLongBookSummary(longBooks.value, result.summary);
      const refreshed = await refreshLongProposalWorkspace(target.bookId);
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "accepted",
        proposedText: undefined,
        ...resolvedStaleBase(proposal, "overwrote"),
        statusMessage: isCreation
          ? automatic
            ? t(
                "proposalCoordinator.characterAndBothProfilesAutomaticallyApprovedAndCreated"
              )
            : t(
                "proposalCoordinator.characterAndBothProfilesCreatedAndSavedToLocal"
              )
          : refreshed
            ? t("proposalCoordinator.savedToLocalMarkdown", {
                value: automatic
                  ? t("proposalCoordinator.automaticallyApprovedAnd")
                  : t("proposalCoordinator.acceptedAnd")
              })
            : t(
                "proposalCoordinator.savedToLocalMarkdownButTheInterfaceRefreshFailed"
              )
      });
      if (!automatic) {
        uiMessage.success(
          isCreation
            ? t("proposalCoordinator.characterProfilesCreated")
            : t("proposalCoordinator.characterProfilesAcceptedAndSaved")
        );
      }
    } catch (error: unknown) {
      if (!applied && isLongDocumentChanged(error)) {
        holdStaleLongProposal(conversation, request.runId, proposal, error);
        return;
      }
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
            t("proposalCoordinator.characterProfile")
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
            statusMessage: t(
              "proposalCoordinator.relatedImpactsChangedAndHaveBeenUpdatedBelowReview"
            ),
            notificationMessage: t(
              "proposalCoordinator.characterProfileImpactsChangedConfirmAgain"
            ),
            removeQueued: removeQueuedAgentEdit,
            notify: uiMessage.warning
          });
          return;
        } catch (previewError: unknown) {
          currentError = previewError;
        }
      }
      const message = formatError(
        currentError,
        t(
          "proposalCoordinator.failedToSaveCharacterProfilesTheOriginalFilesAre"
        )
      );
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: applied ? "accepted" : "error",
        statusMessage: applied
          ? t("proposalCoordinator.characterProfilesSavedButRefreshFailed", {
              message: message
            })
          : message
      });
      if (applied) {
        uiMessage.warning(
          t("proposalCoordinator.characterProfilesSavedButRefreshFailed", {
            message: message
          })
        );
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
      const message = t(
        "proposalCoordinator.theNovelManuscriptServiceIsUnavailable"
      );
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "error",
        statusMessage: message
      });
      uiMessage.error(message);
      return;
    }
    if (acceptingAgentEditWorkspaceIds.value.has(proposal.workspaceId)) {
      const message = automatic
        ? t("proposalCoordinator.otherContentInThisBookIsBeingSavedAutomatic3")
        : t("proposalCoordinator.otherEditsToThisBookAreBeingSavedWait");
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
        ? t("proposalCoordinator.automaticallyApprovingAndSavingChapterProse")
        : t("proposalCoordinator.savingChapterProse")
    });
    setAgentEditWorkspaceAccepting(proposal.workspaceId, true);
    let applied = false;
    let attemptedBatch: LongWorkspaceOperationBatch | undefined;
    try {
      if (activeLongBookId.value === target.bookId) {
        await nextTick();
        if (!(await saveActiveLongEditorChanges())) {
          throw new Error(
            t(
              "proposalCoordinator.currentNovelEditsAreUnsavedChapterProseWasNot"
            )
          );
        }
      }
      const latest = await api.getWorkspaceIndex({ bookId: target.bookId });
      const chapter = latest.workspaceIndex.chapters.find(
        ({ chapterCardId }) => chapterCardId === target.file.chapterCardId
      );
      if (!chapter || chapter.body.id !== target.file.fileId) {
        const message = t(
          "proposalCoordinator.theTargetChapterCardOrProseNoLongerExists"
        );
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
          t("proposalCoordinator.chapterProse")
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
          statusMessage: t(
            "proposalCoordinator.manuscriptAndRelatedImpactsHaveBeenLoadedReviewThe"
          ),
          notificationMessage: t(
            "proposalCoordinator.reviewTheChapterProseAndRelatedImpactsBeforeConfirming"
          ),
          removeQueued: removeQueuedAgentEdit,
          notify: uiMessage.info
        })
      ) {
        return;
      }
      const result = await api.applyOperations({
        bookId: target.bookId,
        batch: LongWorkspaceOperationBatchSchema.parse({
          ...withConfirmedDocumentHashes(batch, proposal),
          expectedImpact
        })
      });
      applied = true;
      longBooks.value = replaceLongBookSummary(longBooks.value, result.summary);
      const refreshed = await refreshLongProposalWorkspace(target.bookId);
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "accepted",
        proposedText: undefined,
        ...resolvedStaleBase(proposal, "overwrote"),
        statusMessage: refreshed
          ? t("proposalCoordinator.savedChapterProseToLocalMarkdown", {
              value: automatic
                ? t("proposalCoordinator.automaticallyApprovedAnd")
                : t("proposalCoordinator.acceptedAnd")
            })
          : t(
              "proposalCoordinator.chapterProseSavedButTheInterfaceRefreshFailedRefresh"
            )
      });
      if (!automatic) {
        uiMessage.success(
          t("proposalCoordinator.chapterProseAcceptedAndSaved")
        );
      }
    } catch (error: unknown) {
      if (!applied && isLongDocumentChanged(error)) {
        holdStaleLongProposal(conversation, request.runId, proposal, error);
        return;
      }
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
            t("proposalCoordinator.chapterProse")
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
            statusMessage: t(
              "proposalCoordinator.relatedImpactsChangedAndHaveBeenUpdatedBelowReview"
            ),
            notificationMessage: t(
              "proposalCoordinator.chapterProseImpactsChangedConfirmAgain"
            ),
            removeQueued: removeQueuedAgentEdit,
            notify: uiMessage.warning
          });
          return;
        } catch (previewError: unknown) {
          currentError = previewError;
        }
      }
      const message = formatError(
        currentError,
        t("proposalCoordinator.failedToSaveChapterProseTheOriginalFilesAre")
      );
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: applied ? "accepted" : "error",
        statusMessage: applied
          ? t("proposalCoordinator.chapterProseSavedButRefreshFailed", {
              message: message
            })
          : message
      });
      if (applied) {
        uiMessage.warning(
          t("proposalCoordinator.chapterProseSavedButRefreshFailed", {
            message: message
          })
        );
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
      uiMessage.error(
        t("proposalCoordinator.thePendingAgentChangeNoLongerExistsGenerateIt")
      );
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
      uiMessage.info(
        t("proposalCoordinator.waitForTheCurrentAgentTurnToFinishBefore")
      );
      return;
    }

    if (request.decision === "reject") {
      if (proposal.status === "accepting" || proposal.status === "accepted")
        return;
      removeQueuedAgentEdit(conversation, request.runId, request.proposalId);
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "rejected",
        proposedText: undefined,
        ...resolvedStaleBase(proposal, "kept-user"),
        statusMessage: proposal.longPlotDesignTarget
          ? t("proposalCoordinator.rejectedPlotDesignIsUnchanged")
          : proposal.longDraftTarget
            ? t("proposalCoordinator.rejectedChapterProseIsUnchanged")
            : t("proposalCoordinator.rejectedTheOriginalTextIsUnchanged")
      });
      if (proposal.draftSectionCreationTarget) {
        conflictDependentProvisionalFileProposals(
          conversation,
          request.runId,
          proposal.draftSectionCreationTarget.sections.map(
            (section) => section.provisionalSectionId
          ),
          t(
            "proposalCoordinator.creationOfTheEmptyChapterWasRejectedItsManuscript"
          )
        );
      }
      if (proposal.longWorldbuildingTarget?.file.operation === "create") {
        conflictDependentLongWorldbuildingProposals(
          conversation,
          proposal,
          t(
            "proposalCoordinator.creationOfTheEmptyWorldbuildingFileWasRejectedIts"
          )
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
          t(
            "proposalCoordinator.characterCreationWasRejectedTheAssociatedCharacterProfileCannot"
          )
        );
      }
      blockLaterAgentEditGenerations(conversation, proposal);
      uiMessage.info(
        proposal.longPlotDesignTarget
          ? t(
              "proposalCoordinator.plotDesignChangesRejectedTheCurrentStructureIsUnchanged"
            )
          : proposal.longDraftTarget
            ? t(
                "proposalCoordinator.chapterChangesRejectedTheManuscriptIsUnchanged"
              )
            : t(
                "proposalCoordinator.agentEditsRejectedTheOriginalTextIsUnchanged"
              )
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
        const message = t(
          "proposalCoordinator.anEarlierAgentEditCouldNotBeSavedThis"
        );
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
          statusMessage: t(
            "proposalCoordinator.waitingForEarlierEditsToFinishSaving"
          )
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
        const message = t(
          "proposalCoordinator.theTemporaryChapterAwaitingReviewHasAnInvalidFile"
        );
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
              ? t(
                  "proposalCoordinator.chapterCreationHasNotBeenConfirmedTheProseIs"
                )
              : t(
                  "proposalCoordinator.waitingForTheAssociatedChapterToBeCreated"
                )
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
            waitingMessage: t(
              "proposalCoordinator.chapterCreationHasNotBeenConfirmedTheProseIs"
            ),
            blockedMessage: t(
              "proposalCoordinator.theAssociatedBlankChapterCouldNotBeCreatedRelated"
            )
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
              statusMessage: t(
                "proposalCoordinator.waitingForTheAssociatedChapterToBeCreated"
              )
            });
            uiMessage.info(
              t("proposalCoordinator.otherEditsToThisProjectAreBeingSavedWait")
            );
            return;
          }
        }
      }
      const remapped = conversation.getEditProposal(
        request.runId,
        request.proposalId
      );
      if (!remapped) {
        uiMessage.error(
          t("proposalCoordinator.thePendingAgentChangeNoLongerExistsGenerateIt")
        );
        return;
      }
      proposal = remapped;
      if (proposal.provisionalExpertSection) {
        const message = t(
          "proposalCoordinator.theEmptyTargetChapterHasNotBeenSavedYet"
        );
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
              ? t(
                  "proposalCoordinator.characterCreationHasNotBeenConfirmedTheContentHas"
                )
              : t(
                  "proposalCoordinator.waitingForTheAssociatedCharacterEntryToBeCreated"
                )
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
            waitingMessage: t(
              "proposalCoordinator.characterCreationHasNotBeenConfirmedTheContentHas"
            ),
            blockedMessage: t(
              "proposalCoordinator.theAssociatedCharacterEntryCouldNotBeCreatedIts"
            )
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
        const message = t(
          "proposalCoordinator.theTargetCharacterEntryHasNotBeenSavedYet"
        );
        conversation.updateEditProposal(request.runId, request.proposalId, {
          status: "conflict",
          statusMessage: message
        });
        uiMessage.warning(message);
        return;
      }
    }

    const unloadedDocument = documents.value.find(
      (document) =>
        document.id === proposal.documentId &&
        document.catalogContentLoaded === false
    );
    if (unloadedDocument) {
      try {
        await loadProposalDocument(context, unloadedDocument);
      } catch (error) {
        const message = formatError(
          error,
          t(
            "workspaceResourceCoordinator.failedToReadTheManuscriptSelectItAgainAnd"
          )
        );
        conversation.updateEditProposal(request.runId, request.proposalId, {
          status: "error",
          statusMessage: message
        });
        uiMessage.error(message);
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
      const message = t(
        "proposalCoordinator.theTargetManuscriptIsNoLongerAvailableThisAgent"
      );
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
        const message = t(
          "proposalCoordinator.theLibraryDirectoryChangedDuringReviewTheAgentEdit"
        );
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
      // Editing stays open during runs, so user saves often overlap automatic
      // ones; wait in the queue and retry once the user's saves finish.
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "pending",
        statusMessage: automatic
          ? t("proposalCoordinator.waitingForYourSaveToFinish")
          : t("proposalCoordinator.otherEditsToThisProjectAreBeingSavedWait")
      });
      if (!automatic) {
        uiMessage.info(
          t("proposalCoordinator.otherEditsToThisProjectAreBeingSavedWait")
        );
      }
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
            ? t(
                "proposalCoordinator.theseEditsAreAlreadyInTheLocalMarkdownFile"
              )
            : t(
                "proposalCoordinator.theseEditsAreAlreadyInTheLocalMarkdownFile2"
              )
      });
      if (!automatic) {
        uiMessage.success(
          t("proposalCoordinator.theAgentEditsAreAlreadySavedInTheLocal")
        );
      }
      return;
    }

    if (typeof proposal.proposedText !== "string") {
      const message = t(
        "proposalCoordinator.thePendingChangesAreMissingTheCompleteRevisedText"
      );
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "error",
        statusMessage: message
      });
      uiMessage.error(message);
      return;
    }
    const liveContent =
      currentDraft?.dirty || persistedDocument.catalogContentLoaded !== false
        ? target.content
        : undefined;
    const acceptBase = resolveTextProposalAcceptBase(
      proposal,
      liveContent,
      agentWrittenRevisions.get(target.id)
    );
    if (acceptBase.kind === "stale") {
      holdStaleTextProposal(
        conversation,
        request.runId,
        proposal,
        liveContent,
        acceptBase.currentRevision
      );
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
        ? t(
            "proposalCoordinator.automaticallyApprovingAndSavingToLocalMarkdown"
          )
        : t("proposalCoordinator.savingToLocalMarkdown"),
      // Overwriting replaces the user's version; undo must restore it.
      ...(acceptBase.overwrite && liveContent !== undefined
        ? {
            discardSnapshot: {
              ...proposal.discardSnapshot,
              beforeText: liveContent,
              beforeTitle: target.title
            }
          }
        : {})
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
          throw new Error(t("short.theDesktopFileServiceIsUnavailable"));
        }
        const saved = await currentApi.catalog.saveDocument(
          shortAgentCheckedDocumentWrite(
            {
              bookId: persistedDocument.workspaceId,
              documentId: persistedDocument.catalogDocumentId,
              content: payload.content
            },
            expectedDiskRevision(
              persistedDocument.catalogContentLoaded === false
                ? undefined
                : persistedDocument.content
            )
          )
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
          throw new Error(t("short.theDesktopFileServiceIsUnavailable"));
        }
        const updated = await currentApi.catalog.updateLibrary({
          ...(proposal.libraryTarget.managementScope
            ? { managementScope: proposal.libraryTarget.managementScope }
            : {}),
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
          throw new Error(t("short.theDesktopFileServiceIsUnavailable"));
        }
        const library = findCatalogLibrary(
          persistedDocument.domain,
          persistedDocument.libraryId
        );
        if (!library) {
          throw new Error(t("short.theTargetLibraryNoLongerExists"));
        }
        const projectRevision = library.projectRevision;
        const saved = await currentApi.catalog.saveLibraryEntry({
          ...(proposal.libraryTarget.managementScope
            ? { managementScope: proposal.libraryTarget.managementScope }
            : {}),
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

      agentWrittenRevisions.set(
        target.id,
        createShortWorkspaceContentRevision(proposedText)
      );
      conversation.updateEditProposal(request.runId, request.proposalId, {
        status: "accepted",
        proposedText: undefined,
        ...(acceptBase.overwrite
          ? resolvedStaleBase(proposal, "overwrote")
          : {}),
        statusMessage: newerDraftPreserved
          ? t(
              "proposalCoordinator.savedTheReviewedAgentEditsNewerChangesMadeDuring",
              {
                value: automatic
                  ? t("proposalCoordinator.automaticallyApprovedAnd")
                  : t("proposalCoordinator.successfully")
              }
            )
          : persisted
            ? t("proposalCoordinator.savedToTheLocalFile", {
                value: automatic
                  ? t("proposalCoordinator.automaticallyApprovedAnd")
                  : t("proposalCoordinator.acceptedAnd")
              })
            : t(
                "proposalCoordinator.theCurrentWorkspaceThisPreviewHasNoCorrespondingLocal",
                {
                  value: automatic
                    ? t("proposalCoordinator.automaticallyApprovedAndWrittenTo")
                    : t("proposalCoordinator.acceptedInto")
                }
              )
      });
      if (!automatic) {
        uiMessage.success(
          persisted
            ? t("proposalCoordinator.agentEditsAcceptedAndSaved")
            : t("proposalCoordinator.agentEditsAccepted")
        );
      }
    } catch (error: unknown) {
      const conflict = isCatalogConflict(error);
      const bookId = persistedDocument.catalogDocumentId
        ? persistedDocument.workspaceId
        : undefined;
      if (conflict && bookId) {
        // The text changed between the check and Core's write: reload it and
        // let the user decide, exactly as if it had been stale beforehand.
        await refreshBookAfterSuccessfulDocumentSave(
          bookId,
          captureWorkspaceDocumentBaselines(documents.value, bookId)
        ).catch(() => false);
        const latest = liveWorkspaceDocuments.value.find(
          (document) => document.id === proposal.documentId
        );
        const latestContent =
          latest &&
          (editorDrafts.value[latest.id]?.dirty ||
            latest.catalogContentLoaded !== false)
            ? latest.content
            : undefined;
        holdStaleTextProposal(
          conversation,
          request.runId,
          proposal,
          latestContent,
          staleRevisionAfterConflict(error, latestContent, proposal)
        );
        return;
      }
      const message = conflict
        ? t(
            "proposalCoordinator.theLocalMarkdownFileWasUpdatedElsewhereTheAgent"
          )
        : formatError(
            error,
            t("proposalCoordinator.couldNotSaveTheAgentEditsTheOriginalText")
          );
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

  /** Long counterpart of holdStaleTextProposal; see long-stale-base.ts. */
  function holdStaleLongProposal(
    conversation: AgentConversationController,
    runId: string,
    proposal: AgentEditProposal,
    error: unknown
  ): void {
    holdStaleLongProposalForUser({
      conversation,
      runId,
      proposal,
      error,
      removeQueued: removeQueuedAgentEdit,
      warn: uiMessage.warning
    });
  }

  /**
   * Leaves a full-text proposal pending until the user keeps their version
   * (reject) or overwrites the revision recorded here (accept).
   */
  function holdStaleTextProposal(
    conversation: AgentConversationController,
    runId: string,
    proposal: AgentEditProposal,
    liveContent: string | undefined,
    currentRevision: string
  ): void {
    removeQueuedAgentEdit(conversation, runId, proposal.id);
    conversation.updateEditProposal(
      runId,
      proposal.id,
      staleTextProposalPatch(proposal, liveContent, currentRevision)
    );
    if (proposal.staleBase?.currentRevision !== currentRevision) {
      uiMessage.warning(
        t("proposalCoordinator.userEditedAgentTarget", {
          title: proposal.title
        })
      );
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
    ) => invokeWhileActive(() => stageAgentEditProposal(...args)),
    stageLibraryEditProposal: (
      ...args: Parameters<typeof stageLibraryEditProposal>
    ) => {
      if (!proposalQueue.isDisposed()) return stageLibraryEditProposal(...args);
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
