import type { ComputedRef, Ref, ShallowRef } from "vue";
import type {
  Book,
  CatalogIndexSnapshot,
  CatalogLibrary,
  CatalogLibraryEntry,
  DeepWriteApi,
  LongBookSummary,
  SystemEventEnvelope
} from "@deepwrite/contracts";
import type { CatalogWorkspaceProjection } from "../../data/catalogWorkspace";
import type { AgentEditProposal } from "../../types/conversation";
import type {
  EditorDraftState,
  WorkspaceDocument
} from "../../types/workspace";
import type { AgentEditProposalCommitSnapshot } from "../../utils/agentEditProposalRevisionLane";
import type { WorkspaceDocumentBaseline } from "../../utils/catalogSaveReconciliation";
import type { KeyedSerialTaskQueue } from "../../utils/keyedSerialTaskQueue";
import type { AgentConversationController } from "../useAgentConversation";
import type { LongWorkspaceProposalEvent } from "../useLongWorkspaceProposals";

export type WorkspaceEditorMutationEvent = Extract<
  SystemEventEnvelope,
  { type: "workspace.editor_mutation" }
>;
export type LibraryEditorMutationEvent = Extract<
  SystemEventEnvelope,
  { type: "library.editor_mutation" }
>;
export type LongWorldbuildingFileMutationEvent = Extract<
  SystemEventEnvelope,
  { type: "long.worldbuilding_file_proposal" }
>;
export type LongCharacterFileMutationEvent = Extract<
  SystemEventEnvelope,
  { type: "long.character_file_proposal" }
>;
export type LongPlotDesignMutationEvent = Extract<
  SystemEventEnvelope,
  { type: "long.mutation_proposal" }
>;
export type LongDraftMutationEvent = Extract<
  SystemEventEnvelope,
  { type: "long.chapter_write_proposal" }
>;

export interface QueuedAgentEdit {
  conversation: AgentConversationController;
  sessionId: string;
  runId: string;
  proposalId: string;
  workspaceId: string;
  automatic: boolean;
  expectedProposedRevision: string;
  decisionToken: string;
  snapshot: AgentEditProposalCommitSnapshot<AgentEditProposal>;
}

export interface ProposalCoordinatorNotifications {
  error(message: string): void;
  info(message: string): void;
  success(message: string): void;
  warning(message: string): void;
}

export interface AgentEditReviewRequest {
  runId: string;
  proposalId: string;
  decision: "accept" | "reject";
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
      event: LongWorkspaceProposalEvent | LongDraftMutationEvent
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

type Conv = AgentConversationController;
type Prop = AgentEditProposal;
type Req = AgentEditReviewRequest;

export interface ProposalLaneContext {
  api: ProposalCoordinatorContext["api"];
  uiMessage: ProposalCoordinatorNotifications;
  catalogSnapshot: ProposalCoordinatorContext["catalog"]["snapshot"];
  catalogProjection: ProposalCoordinatorContext["catalog"]["projection"];
  catalogBook: ProposalCoordinatorContext["catalog"]["catalogBook"];
  findCatalogLibrary: ProposalCoordinatorContext["catalog"]["findCatalogLibrary"];
  loadCatalogSnapshot: ProposalCoordinatorContext["catalog"]["loadSnapshot"];
  applyAcceptedAgentDocumentLocally: ProposalCoordinatorContext["catalog"]["applyAcceptedDocumentLocally"];
  applyCreatedLibraryEntry: ProposalCoordinatorContext["catalog"]["applyCreatedLibraryEntry"];
  applySavedLibraryEntry: ProposalCoordinatorContext["catalog"]["applySavedLibraryEntry"];
  applyUpdatedCatalogLibrary: ProposalCoordinatorContext["catalog"]["applyUpdatedLibrary"];
  isCatalogConflict: ProposalCoordinatorContext["catalog"]["isConflict"];
  refreshBookAfterSuccessfulDocumentSave: ProposalCoordinatorContext["catalog"]["refreshBookAfterSave"];
  documents: ProposalCoordinatorContext["editor"]["documents"];
  editorDrafts: ProposalCoordinatorContext["editor"]["drafts"];
  liveWorkspaceDocuments: ProposalCoordinatorContext["editor"]["liveDocuments"];
  selectedDraftFileKinds: ProposalCoordinatorContext["editor"]["selectedDraftFileKinds"];
  selectedExpertSectionIds: ProposalCoordinatorContext["editor"]["selectedExpertSectionIds"];
  acceptingAgentEditWorkspaceIds: ProposalCoordinatorContext["editor"]["acceptingWorkspaceIds"];
  savingDocumentIds: ProposalCoordinatorContext["editor"]["savingDocumentIds"];
  rememberWorkspaceMutationEvent: ProposalCoordinatorContext["editor"]["rememberWorkspaceMutationEvent"];
  setAgentEditDocumentAccepting: ProposalCoordinatorContext["editor"]["setDocumentAccepting"];
  setAgentEditWorkspaceAccepting: ProposalCoordinatorContext["editor"]["setWorkspaceAccepting"];
  activeConversation: ProposalCoordinatorContext["conversations"]["active"];
  activeLongConversation: ProposalCoordinatorContext["conversations"]["activeLong"];
  conversations: ProposalCoordinatorContext["conversations"]["byKey"];
  allConversations: ProposalCoordinatorContext["conversations"]["all"];
  removeConversation: ProposalCoordinatorContext["conversations"]["remove"];
  legacyDraftSectionConversationKeys: ProposalCoordinatorContext["conversations"]["legacyDraftSectionKeys"];
  longConversationForProposalEvent: ProposalCoordinatorContext["conversations"]["forLongProposal"];
  activeLongBookId: ProposalCoordinatorContext["longWorkspace"]["activeBookId"];
  longBooks: ProposalCoordinatorContext["longWorkspace"]["books"];
  refreshLongProposalWorkspace: ProposalCoordinatorContext["longWorkspace"]["refreshWorkspaceAfterProposal"];
  saveActiveLongEditorChanges: ProposalCoordinatorContext["longWorkspace"]["saveActiveEditorChanges"];
  selectedResourceId: ProposalCoordinatorContext["navigation"]["selectedResourceId"];
  activeCreationResourceId: ProposalCoordinatorContext["navigation"]["activeCreationResourceId"];
  rightCollapsed: ProposalCoordinatorContext["navigation"]["rightCollapsed"];
  queuedAgentEdits: Map<string, QueuedAgentEdit>;
  agentEditCommitQueue: KeyedSerialTaskQueue<string>;
  activeCoordinatorInvocations: Set<Promise<void>>;
  activeAgentEditCommitTasks: Set<Promise<void>>;
  acceptedLibraryMutationCounts: Map<string, number>;
  acceptedProvisionalExpertSectionIds: Map<string, Map<string, string>>;
  queueAgentEdit(
    conversation: Conv,
    sessionId: string,
    runId: string,
    proposalId: string,
    automatic: boolean,
    scheduleImmediately: boolean
  ): void;
  canReviewAgentEditDuringRun(proposal: Prop): boolean;
  removeQueuedAgentEdit(
    conversation: Conv,
    runId: string,
    proposalId: string
  ): void;
  blockLaterAgentEditGenerations(conversation: Conv, rejected: Prop): void;
  latestProposalForLane(
    conversation: Conv,
    runId: string,
    laneId: string
  ): Prop | undefined;
  autoApproveEditPriority(
    conversation: Conv,
    runId: string,
    proposalId: string
  ): number;
  scheduleQueuedAgentEdits(matches: (queued: QueuedAgentEdit) => boolean): void;
  hasQueuedAgentEdits(): boolean;
  invokeWhileActive(operation: () => Promise<void>): Promise<void>;
  drain(): Promise<void>;
  dispose(): Promise<void>;
  blockedAgentEditLaneMessage(proposal: Prop | undefined): string | undefined;
  isShortOrScriptAgentEdit(proposal: Prop): boolean;
  rememberProvisionalExpertSectionMapping(
    runId: string,
    workspaceId: string,
    provisionalSectionId: string,
    realSectionId: string
  ): void;
  resolveProvisionalExpertSectionId(
    runId: string,
    workspaceId: string,
    sectionId: string
  ): string;
  findPendingDraftSectionCreationForProvisional(
    conversation: Conv,
    runId: string,
    provisionalSectionId: string
  ): Prop | undefined;
  remapProvisionalExpertSectionFileProposals(
    conversation: Conv,
    runId: string,
    workspaceId: string,
    mapping: ReadonlyMap<string, string>
  ): void;
  restoreAcceptedDraftSectionCreationMappings(conversation: Conv): void;
  pauseDependentProvisionalFileProposals(
    conversation: Conv,
    runId: string,
    provisionalSectionIds: readonly string[],
    message: string
  ): void;
  conflictDependentProvisionalFileProposals(
    conversation: Conv,
    runId: string,
    provisionalSectionIds: readonly string[],
    message: string
  ): void;
  acceptLibraryCreationProposal(
    conversation: Conv,
    request: Req,
    proposal: Prop,
    automatic: boolean
  ): Promise<void>;
  stageLibraryEditProposal(event: LibraryEditorMutationEvent): void;
  currentLibraryProjectRevisionMatches(
    proposal: Prop,
    currentRevision: number | undefined
  ): boolean;
  rememberAcceptedLibraryMutation(proposal: Prop): void;
  libraryMutationCountKey(proposal: Prop): string;
  acceptDraftSectionCreationProposal(
    conversation: Conv,
    request: Req,
    proposal: Prop,
    automatic: boolean,
    reserved?: boolean
  ): Promise<void>;
  acceptDraftSectionRenameProposal(
    conversation: Conv,
    request: Req,
    proposal: Prop,
    automatic: boolean,
    reserved?: boolean
  ): Promise<void>;
  acceptDraftSectionDeletionProposal(
    conversation: Conv,
    request: Req,
    proposal: Prop,
    automatic: boolean,
    reserved?: boolean
  ): Promise<void>;
  conflictDependentDeletedSectionProposals(
    conversation: Conv,
    runId: string,
    sectionId: string,
    message: string
  ): void;
  draftSectionCreationOperationId(proposal: Prop): string;
  acceptCharacterStructureProposal(
    conversation: Conv,
    request: Req,
    proposal: Prop,
    automatic: boolean,
    reserved?: boolean
  ): Promise<void>;
  findPendingCharacterCreationForProvisional(
    conversation: Conv,
    runId: string,
    itemId: string
  ): Prop | undefined;
  stageCharacterStructureProposal(
    event: WorkspaceEditorMutationEvent,
    sourceConversation: Conv,
    runApprovalMode: NonNullable<AgentEditProposal["approvalMode"]>
  ): boolean;
  stageDraftSectionDirectoryProposal(
    event: WorkspaceEditorMutationEvent,
    sourceConversation: Conv,
    runApprovalMode: NonNullable<AgentEditProposal["approvalMode"]>
  ): boolean;
  stageLongWorldbuildingEditProposal(
    event: LongWorldbuildingFileMutationEvent
  ): void;
  acceptLongWorldbuildingFileProposal(
    conversation: Conv,
    request: Req,
    proposal: Prop,
    automatic: boolean
  ): Promise<void>;
  conflictDependentLongWorldbuildingProposals(
    conversation: Conv,
    proposal: Prop,
    message: string
  ): void;
  longWorldbuildingBatchForFile(
    event: LongWorldbuildingFileMutationEvent
  ): import("@deepwrite/contracts").LongWorkspaceOperationBatch | undefined;
  stageLongCharacterEditProposal(event: LongCharacterFileMutationEvent): void;
  acceptLongCharacterFileProposal(
    conversation: Conv,
    request: Req,
    proposal: Prop,
    automatic: boolean
  ): Promise<void>;
  conflictDependentLongCharacterProposals(
    conversation: Conv,
    proposal: Prop,
    message: string
  ): void;
  longCharacterBatchForFiles(
    event: LongCharacterFileMutationEvent
  ): import("@deepwrite/contracts").LongWorkspaceOperationBatch | undefined;
  stageLongPlotDesignEditProposal(event: LongPlotDesignMutationEvent): void;
  acceptLongPlotDesignProposal(
    conversation: Conv,
    request: Req,
    proposal: Prop,
    automatic: boolean
  ): Promise<void>;
  longPlotDesignProposalText(
    batch: import("@deepwrite/contracts").LongWorkspaceOperationBatch
  ): string;
  stageLongDraftEditProposal(event: LongDraftMutationEvent): void;
  acceptLongDraftProposal(
    conversation: Conv,
    request: Req,
    proposal: Prop,
    automatic: boolean
  ): Promise<void>;
  applyAgentEdit(
    conversation: Conv,
    request: Req,
    automatic?: boolean,
    reservation?: { decisionToken: string; expectedProposedRevision: string }
  ): Promise<void>;
  reviewAgentEdit(request: Req): Promise<void>;
  reviewLongAgentEdit(request: Req): Promise<void>;
  stageAgentEditProposal(event: WorkspaceEditorMutationEvent): void;
  resumeRecoveredAutomaticAgentEdits(
    conversationsToScan?: readonly Conv[]
  ): void;
}
