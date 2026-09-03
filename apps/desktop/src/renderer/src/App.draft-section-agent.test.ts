import { describe, expect, it } from "vitest";
import source from "./WorkspaceShell.vue?raw";
import applyReviewSource from "./composables/proposal-coordinator/apply-review.ts?raw";
import draftSectionLaneSource from "./composables/proposal-coordinator/draft-section-lane.ts?raw";
import provisionalSource from "./composables/proposal-coordinator/provisional.ts?raw";
import queueSource from "./composables/proposal-coordinator/queue.ts?raw";
import proposalCoordinatorSource from "./composables/useProposalCoordinator.ts?raw";
import structureSource from "./composables/useShortWorkspaceStructureCoordinator.ts?raw";

describe("App agent chapter-file creation", () => {
  it("keeps shared draft conversations out of per-section cleanup", () => {
    expect(structureSource).toContain(
      "function legacyDraftSectionConversationKeys("
    );
    expect(structureSource).toContain(
      "`${workspaceId}:expert_draft_coordinator:${suffix}`"
    );
    expect(structureSource).toContain(
      "`${workspaceId}:expert_section_writer:${suffix}`"
    );
    expect(structureSource).toContain(
      "for (const key of legacyDraftSectionConversationKeys(bookId, sectionId))"
    );
    expect(structureSource).not.toContain(
      "function draftSectionConversationKeys("
    );
    expect(source).toContain("legacyDraftSectionConversationKeys,");
  });

  it("stages structural proposals and directly persists their chapters", () => {
    const coordinatorSource = [
      draftSectionLaneSource,
      provisionalSource,
      applyReviewSource,
      queueSource,
      proposalCoordinatorSource
    ].join("\n");
    expect(coordinatorSource).toContain(
      'mutationTarget?.kind === "expert-draft-section-creation"'
    );
    expect(coordinatorSource).toContain(
      'mutationTarget?.kind === "expert-draft-section-rename"'
    );
    expect(coordinatorSource).toContain(
      'mutationTarget?.kind === "expert-draft-section-deletion"'
    );
    expect(coordinatorSource).toContain("draftSectionCreationTarget: {");
    expect(coordinatorSource).toContain("draftSectionRenameTarget: {");
    expect(coordinatorSource).toContain("draftSectionDeletionTarget: {");
    expect(coordinatorSource).toContain("acceptDraftSectionCreationProposal(");
    expect(coordinatorSource).toContain("acceptDraftSectionRenameProposal(");
    expect(coordinatorSource).toContain("acceptDraftSectionDeletionProposal(");
    expect(coordinatorSource).toContain(
      "await currentApi.catalog.deleteDraftSection({"
    );
    expect(coordinatorSource).toContain(
      "await currentApi.catalog.createDraftSections({"
    );
    expect(coordinatorSource).toContain(
      "operationId: draftSectionCreationOperationId(proposal)"
    );
    expect(coordinatorSource).toContain(
      "clientSectionId: section.provisionalSectionId"
    );
    expect(coordinatorSource).toContain(
      "createdCount = created.sections.length"
    );
    expect(coordinatorSource).toContain("await loadCatalogSnapshot()");
    expect(coordinatorSource).toContain(
      "remapProvisionalExpertSectionFileProposals("
    );
    expect(coordinatorSource).toContain(
      "restoreAcceptedDraftSectionCreationMappings("
    );
    expect(coordinatorSource).toContain("realSectionId: createdMapping.get(");
    expect(coordinatorSource).toContain(
      "pauseDependentProvisionalFileProposals("
    );
    expect(coordinatorSource).toContain("provisionalExpertSection: true");
    expect(coordinatorSource).toContain("shortAgentDirectDocumentWrite({");
    expect(coordinatorSource).toContain("force: true");
    expect(coordinatorSource).toContain("options.priority(");
    expect(coordinatorSource).toContain("scheduleQueuedAgentEdits(");
    expect(coordinatorSource).toContain("agentEditCommitQueue");
    expect(coordinatorSource).toContain("decisionToken");
    expect(coordinatorSource).toContain("resolveProvisionalWriteStagingMode(");
    expect(coordinatorSource).toContain('stagingMode === "mapped-real"');
    expect(coordinatorSource).toContain("resolveAgentEditProposalGeneration(");
    expect(draftSectionLaneSource).toContain(
      'directory?.workspaceType === "script" || book?.bookType === "script"'
    );
    expect(proposalCoordinatorSource).toContain(
      'directory?.workspaceType === "script" || book?.bookType === "script"'
    );
    expect(draftSectionLaneSource).toContain(
      "title: `删除${draftUnit}：${mutationTarget.title}`"
    );
    expect(draftSectionLaneSource).toContain("及其正文与人物状态文件");
  });
});
