import { computed, shallowRef } from "vue";
import { describe, expect, it, vi } from "vitest";
import {
  createEnvelope,
  createShortWorkspaceContentRevision,
  type LibraryEditorMutationEventEnvelope
} from "@deepwrite/contracts";
import type { AgentEditProposal } from "../../types/conversation";
import type { WorkspaceDocument } from "../../types/workspace";
import type { ProposalCoordinatorContext } from "../useProposalCoordinator";
import { createLibraryProposalStager } from "./library-staging";
import { parseStoredLibraryTarget } from "../agent-conversation/library-target";

const revision = createShortWorkspaceContentRevision;
const scope = { bookId: "book", bookType: "short" as const };
function event(
  input: Partial<LibraryEditorMutationEventEnvelope["payload"]> = {},
  id = "event-1"
): LibraryEditorMutationEventEnvelope {
  return createEnvelope(
    "library.editor_mutation",
    {
      sessionId: "session",
      runId: "run",
      toolCallId: id,
      operation: "create",
      domain: "material",
      libraryId: "library",
      stageId: "character",
      title: "新素材",
      text: "第一版",
      baseRevision: revision(""),
      summary: "创建素材",
      managementScope: scope,
      creationId: "pending:child:create",
      runtime: { provider: "test", model: "test", mode: "provider" },
      ...input
    },
    { id }
  ) as LibraryEditorMutationEventEnvelope;
}
function harness(autoApprove = false) {
  const proposals = new Map<string, AgentEditProposal>();
  const documents = shallowRef<WorkspaceDocument[]>([]);
  const warning = vi.fn();
  const conflict = vi.fn();
  const queue = vi.fn();
  const readDocument = vi.fn(async () => ({
    content: "已保存素材",
    projectRevision: 1
  }));
  const conversation = {
    acceptsRunEvent: () => true,
    approvalModeForRun: () =>
      autoApprove ? "auto-approve" : "request-approval",
    getEditProposal: (_run: string, id: string) => proposals.get(id),
    upsertEditProposal: (_run: string, proposal: AgentEditProposal) =>
      proposals.set(proposal.id, proposal),
    updateEditProposal: (
      _run: string,
      id: string,
      patch: Partial<AgentEditProposal>
    ) => Object.assign(proposals.get(id)!, patch),
    markToolConflict: conflict
  };
  const context = {
    api: () => ({ catalog: { readDocument } }),
    notifications: { warning },
    catalog: { findCatalogLibrary: () => ({ id: "library", title: "素材库" }) },
    editor: {
      documents,
      liveDocuments: computed(() => documents.value),
      rememberWorkspaceMutationEvent: () => true
    },
    conversations: { all: () => [conversation] }
  } as unknown as ProposalCoordinatorContext;
  const stage = createLibraryProposalStager(context, queue, () => false);
  return {
    stage,
    proposals,
    documents,
    warning,
    conflict,
    queue,
    readDocument
  };
}
function document(content: string, loaded = true): WorkspaceDocument {
  return {
    id: "doc",
    domain: "material",
    libraryId: "library",
    catalogEntryId: "entry",
    title: "新素材",
    content,
    eyebrow: "素材",
    path: [],
    catalogContentLoaded: loaded
  };
}

describe("library proposals in the originating writing conversation", () => {
  it("coalesces edits of an unpersisted creation and retains the binding scope", async () => {
    const test = harness();
    await test.stage(event());
    await test.stage(
      event({ text: "第二版", baseRevision: revision("第一版") }, "event-2")
    );
    expect(test.proposals.size).toBe(1);
    const proposal = [...test.proposals.values()][0]!;
    expect(proposal.proposedText).toBe("第二版");
    expect(proposal.toolCallIds).toEqual(["event-1", "event-2"]);
    expect(proposal.libraryTarget?.managementScope).toEqual(scope);
    expect(
      parseStoredLibraryTarget(proposal.libraryTarget)?.managementScope
    ).toEqual(scope);
    expect(test.queue).not.toHaveBeenCalled();
  });
  it("converts a follow-up creation edit to an edit of the already saved entry", async () => {
    const test = harness(true);
    await test.stage(event());
    const proposal = [...test.proposals.values()][0]!;
    proposal.status = "accepted";
    proposal.documentId = "doc";
    proposal.libraryTarget!.entryId = "entry";
    test.documents.value = [document("第一版")];
    await test.stage(
      event({ text: "第二版", baseRevision: revision("第一版") }, "event-2")
    );
    const next = [...test.proposals.values()][0]!;
    expect(next.libraryTarget).toMatchObject({
      operation: "edit",
      entryId: "entry",
      managementScope: scope
    });
    expect(next.documentId).toBe("doc");
    expect(test.queue).toHaveBeenCalledTimes(2);
  });
  it("hydrates unopened library bodies without switching the active work", async () => {
    const test = harness();
    test.documents.value = [document("", false)];
    await test.stage(
      event({
        operation: "edit",
        creationId: undefined,
        entryId: "entry",
        documentId: "doc",
        baseRevision: revision("已保存素材"),
        text: "改进素材"
      })
    );
    expect(test.readDocument).toHaveBeenCalledWith({
      projectId: "library",
      target: "document",
      documentId: "entry"
    });
    expect(test.proposals.size).toBe(1);
    expect(test.documents.value[0]?.content).toBe("已保存素材");
  });
  it("reports a conflict without replacing a newer draft", async () => {
    const test = harness();
    test.documents.value = [document("用户新内容")];
    await test.stage(
      event({
        operation: "edit",
        creationId: undefined,
        entryId: "entry",
        documentId: "doc",
        baseRevision: revision("旧内容"),
        text: "智能体内容"
      })
    );
    expect(test.proposals.size).toBe(0);
    expect(test.conflict).toHaveBeenCalledOnce();
    expect(test.documents.value[0]?.content).toBe("用户新内容");
  });
});
