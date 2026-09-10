import { describe, expect, it } from "vitest";
import appSource from "../WorkspaceShell.vue?raw";
import catalogProjectionSource from "./useCatalogWorkspaceProjectionCoordinator.ts?raw";
import lazySource from "./useLazyProposalCoordinator.ts?raw";
import longImpactApprovalSource from "./proposal-coordinator/long-impact-approval.ts?raw";
import plotStructureLaneSource from "./proposal-coordinator/plot-structure-lane.ts?raw";
import worldbuildingLaneSource from "./proposal-coordinator/long-worldbuilding-lane.ts?raw";
import queueSource from "./proposal-coordinator/queue.ts?raw";
import source from "./useProposalCoordinator.ts?raw";

describe("useProposalCoordinator extraction boundary", () => {
  it("keeps App as wiring while proposal implementations live in the coordinator", () => {
    expect(appSource).toContain(
      'import { useLazyProposalCoordinator } from "./composables/useLazyProposalCoordinator"'
    );
    expect(appSource).toContain("} = useLazyProposalCoordinator({");
    expect(appSource).toContain("catalog: {");
    expect(appSource).toContain("editor: {");
    expect(appSource).toContain("conversations: {");
    expect(appSource).toContain(
      "conversationStore.removeController(key, options)"
    );
    expect(appSource).toContain("longWorkspace: {");
    expect(appSource).toContain("navigation: {");

    expect(appSource).not.toContain("type WorkspaceEditorMutationEvent");
    expect(appSource).not.toContain("function stageAgentEditProposal(");
    expect(appSource).not.toContain("function stageLibraryEditProposal(");
    expect(appSource).not.toContain("function applyAgentEdit(");
    expect(appSource).not.toContain("function scheduleQueuedAgentEdits(");
    expect(appSource).not.toContain("agentEditCommitQueue");
    expect(appSource).not.toContain("acceptedDraftSectionCreationRevisions");
  });

  it("loads the coordinator on demand and serializes calls made while loading", () => {
    expect(lazySource).toContain(
      'import type {\n  ProposalCoordinator,\n  ProposalCoordinatorContext\n} from "./useProposalCoordinator"'
    );
    expect(lazySource).not.toContain(
      'import { useProposalCoordinator } from "./useProposalCoordinator"'
    );
    expect(lazySource).toContain('import("./useProposalCoordinator")');
    expect(lazySource).toContain(
      "let invocationTail: Promise<void> = Promise.resolve()"
    );
    expect(lazySource).toContain(
      "const result = invocationTail.then(async () =>"
    );
    expect(lazySource).toContain("invocationTail = result.then(");
    expect(lazySource).toContain("pendingInvocationCount > 0");
    expect(appSource).not.toContain(
      "function resumeRecoveredAutomaticAgentEditsIfNeeded("
    );
    expect(catalogProjectionSource).toContain(
      "function resumeRecoveredAutomaticEditsIfNeeded("
    );
    expect(catalogProjectionSource).toContain(
      'proposal.approvalMode === "auto-approve"'
    );
    expect(catalogProjectionSource).toContain('proposal.status === "pending"');
  });

  it("keeps the eager conversation queue check safe before lazy coordinator wiring", () => {
    const bridgeDeclaration = appSource.indexOf(
      "const proposalEditQueueBridge = {"
    );
    const conversationWiring = appSource.indexOf(
      "} = useShortConversationCoordinator({"
    );
    const coordinatorWiring = appSource.indexOf(
      "} = useLazyProposalCoordinator({"
    );
    const bridgeBinding = appSource.indexOf(
      "proposalEditQueueBridge.hasQueued = hasQueuedAgentEdits;"
    );

    expect(bridgeDeclaration).toBeGreaterThanOrEqual(0);
    expect(bridgeDeclaration).toBeLessThan(conversationWiring);
    expect(appSource).toContain(
      "hasQueued: () => proposalEditQueueBridge.hasQueued()"
    );
    expect(bridgeBinding).toBeGreaterThan(coordinatorWiring);
  });

  it("uses an explicit typed context and injected runtime services", () => {
    expect(source).toContain("export interface ProposalCoordinatorContext");
    expect(source).toContain("api(): DeepWriteApi | undefined");
    expect(source).toContain("notifications: ProposalCoordinatorNotifications");
    expect(source).toContain(
      "snapshot: ShallowRef<CatalogIndexSnapshot | null>"
    );
    expect(source).toContain("documents: ShallowRef<WorkspaceDocument[]>");
    expect(source).toContain(
      "active: ComputedRef<AgentConversationController>"
    );
    expect(source).toContain("const currentApi = api()");
    expect(source).not.toContain("window.deepwrite");
    expect(source).not.toContain("@ts-nocheck");
    expect(source).not.toMatch(/\[key:\s*string\]\s*:\s*any/u);
    expect(source).not.toContain("Record<string, any>");
    expect(source).toContain("remove: removeConversation");
    expect(source).toContain("removeConversation(conversationKey)");
    expect(source).not.toContain("conversations.delete(conversationKey)");
  });

  it("keeps proposal decisions private and workspace writes ordered", () => {
    expect(source).toContain("const proposalQueue = createProposalQueue({");
    expect(queueSource).toContain(
      "const queuedAgentEdits = new Map<string, QueuedAgentEdit>()"
    );
    expect(queueSource).toContain(
      "const deferredAgentEditKeys = new Set<string>()"
    );
    expect(queueSource).toContain(
      "const agentEditCommitQueue = createKeyedSerialTaskQueue<string>()"
    );
    expect(queueSource).toContain("stageAgentEditProposalRevision(");
    expect(queueSource).toContain("beginAgentEditProposalCommit(");
    expect(source).not.toContain("expectedMutationDurableRevision(");
    expect(source).toContain("shortAgentDirectDocumentWrite({");
    expect(queueSource).toContain(
      ".enqueue(workspaceId, () => drainWorkspace(workspaceId))"
    );
    expect(source).not.toContain(
      'if (proposal.plotStructureTarget?.mutation.type === "create") return 0'
    );
    expect(source).not.toContain(
      "if (proposal.draftSectionCreationTarget) return 0"
    );
    expect(source).not.toContain(
      'if (proposal.characterStructureTarget?.mutation.type === "createItem")'
    );
    expect(source).not.toContain(
      "if (proposal.provisionalExpertSection) return 1"
    );
    expect(queueSource).toContain("function hasQueuedAgentEdits(): boolean");
    expect(queueSource).toContain("activeAgentEditCommitTasks.add(task)");
    expect(queueSource).toContain("async function drain(): Promise<void>");
    expect(queueSource).toContain("function dispose(): Promise<void>");
    expect(source).not.toContain("queue: {");
  });

  it("exposes every App and template entry point after the move", () => {
    for (const method of [
      "resumeRecoveredAutomaticAgentEdits",
      "hasQueuedAgentEdits",
      "reviewAgentEdit",
      "reviewLongAgentEdit",
      "scheduleQueuedAgentEdits",
      "stageAgentEditProposal",
      "stageLibraryEditProposal",
      "stageLongCharacterEditProposal",
      "stageLongDraftEditProposal",
      "stageLongPlotDesignEditProposal",
      "stageLongWorldbuildingEditProposal",
      "drain",
      "dispose"
    ]) {
      expect(source).toContain(method);
      expect(appSource).toContain(method);
    }
  });

  it("retains the critical short, library, and long persistence paths", () => {
    expect(source).toContain("async function acceptLongDraftProposal(");
    expect(longImpactApprovalSource).toContain("await api.previewOperations(");
    expect(source).toContain("await api.applyOperations(");
    expect(longImpactApprovalSource).toContain(
      "longWorkspaceOperationsRequireImpactConfirmation"
    );
    expect(longImpactApprovalSource).toContain("input.removeQueued(");
    expect(source).toContain("removeQueued: removeQueuedAgentEdit");
    expect(source).toContain("async function acceptLibraryCreationProposal(");
    expect(source).toContain("currentApi.catalog.createLibraryEntry({");
    expect(source).toContain(
      "async function acceptDraftSectionCreationProposal("
    );
    expect(source).toContain("currentApi.catalog.createDraftSections({");
    expect(source).toContain("createPlotStructureProposalLane({");
    expect(source).toContain("plotStructureProposalLane.stage(");
    expect(source).toContain("plotStructureProposalLane.accept(");
    expect(plotStructureLaneSource).toContain(
      "await api.catalog.mutatePlotStructure({"
    );
    expect(plotStructureLaneSource).toContain(
      "await api.catalog.saveDocument({"
    );
    expect(source).toContain("async function acceptLongPlotDesignProposal(");
    expect(source).toContain("async function acceptLongCharacterFileProposal(");
    expect(worldbuildingLaneSource).toContain(
      "async function acceptLongWorldbuildingFileProposal("
    );
  });
});
