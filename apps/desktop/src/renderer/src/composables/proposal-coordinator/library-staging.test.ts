import { computed, shallowRef } from "vue";
import { describe, expect, it, vi } from "vitest";
import {
  createEnvelope,
  createShortWorkspaceContentRevision,
  type CreateLibraryEntryInput,
  type MaterialLibrary,
  type LibraryEditorMutationEventEnvelope
} from "@deepwrite/contracts";
import type { AgentEditProposal } from "../../types/conversation";
import type { WorkspaceDocument } from "../../types/workspace";
import type { ProposalCoordinatorContext } from "../useProposalCoordinator";
import { createLibraryProposalStager } from "./library-staging";
import { parseStoredLibraryTarget } from "../agent-conversation/library-target";
import {
  createFixture,
  NOW,
  RUN_ID,
  SESSION_ID
} from "../useProposalCoordinator.short-script.test-support";

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
      creationId: "pending:main:create",
      runtime: { provider: "test", model: "test", mode: "provider" },
      ...input
    },
    { id }
  ) as LibraryEditorMutationEventEnvelope;
}
function harness(
  autoApprove = false,
  options: { drainSaves?: () => Promise<void> } = {}
) {
  const proposals = new Map<string, AgentEditProposal>();
  const documents = shallowRef<WorkspaceDocument[]>([]);
  const warning = vi.fn();
  const conflict = vi.fn();
  const queue = vi.fn();
  const readDocument = vi.fn(async () => ({
    content: "已保存素材",
    projectRevision: 1
  }));
  let runActive = true;
  let approvalMode: "auto-approve" | "request-approval" | undefined =
    autoApprove ? "auto-approve" : "request-approval";
  const conversation = {
    acceptsRunEvent: (sessionId: string, runId: string) =>
      runActive && sessionId === "session" && runId === "run",
    approvalModeForRun: () => approvalMode,
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
    catalog: {
      findCatalogLibrary: () => ({ id: "library", title: "素材库" }),
      ensureDocumentLoaded: vi.fn(async (document: WorkspaceDocument) => {
        const loaded = await readDocument();
        const next = {
          ...document,
          content: loaded.content,
          catalogContentLoaded: true
        };
        documents.value = documents.value.map((item) =>
          item.id === document.id ? next : item
        );
        return next;
      })
    },
    editor: {
      documents,
      liveDocuments: computed(() => documents.value),
      rememberWorkspaceMutationEvent: () => true
    },
    conversations: { all: () => [conversation] }
  } as unknown as ProposalCoordinatorContext;
  const stage = createLibraryProposalStager(
    context,
    queue,
    () => false,
    options.drainSaves
  );
  return {
    stage,
    proposals,
    documents,
    warning,
    conflict,
    queue,
    readDocument,
    endRun: () => {
      runActive = false;
      approvalMode = undefined;
    }
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
  it("accepts independent entries from one batch in sequence and detects an intervening user save", async () => {
    const library: MaterialLibrary = {
      id: "library",
      title: "素材库",
      materialType: "short",
      materialKind: "character",
      parentGenre: "",
      subGenre: "",
      overview: "",
      entries: [],
      projectRevision: 4,
      createdAt: NOW,
      updatedAt: NOW
    };
    const createLibraryEntry = vi.fn(
      async (input: CreateLibraryEntryInput) => ({
        id: "entry-" + input.title,
        title: input.title,
        stageId: "character" as const,
        body: input.content,
        createdAt: NOW,
        updatedAt: NOW
      })
    );
    const { coordinator, conversation } = createFixture("short", {
      approvalMode: "request-approval",
      configure(context) {
        const api = context.api()!;
        context.api = () => ({
          ...api,
          catalog: { ...api.catalog, createLibraryEntry }
        });
        context.catalog.findCatalogLibrary = () => library;
        context.catalog.applyCreatedLibraryEntry = async (
          _domain,
          _id,
          _entry,
          revision
        ) => {
          library.projectRevision = revision;
        };
      }
    });
    try {
      for (const title of ["甲", "乙", "丙"])
        await coordinator.stageLibraryEditProposal(
          event(
            {
              sessionId: SESSION_ID,
              runId: RUN_ID,
              toolCallId: "batch",
              creationId: title,
              title,
              baseProjectRevision: 4
            },
            "event-" + title
          )
        );
      const proposals = conversation.listEditProposals(RUN_ID);
      expect(new Set(proposals.map((p) => p.documentId)).size).toBe(3);
      for (const proposal of proposals) {
        if (proposal.title === "丙")
          library.projectRevision = library.projectRevision! + 1;
        await coordinator.reviewAgentEdit({
          runId: RUN_ID,
          proposalId: proposal.id,
          decision: "accept"
        });
        await coordinator.drain();
      }
      expect(
        createLibraryEntry.mock.calls.map(([input]) => [
          input.title,
          input.baseProjectRevision,
          input.managementScope
        ])
      ).toEqual([
        ["甲", 4, scope],
        ["乙", 5, scope]
      ]);
      expect(
        conversation.listEditProposals(RUN_ID).map((p) => p.status)
      ).toEqual(["accepted", "accepted", "conflict"]);
    } finally {
      await coordinator.dispose();
    }
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
    expect(test.readDocument).toHaveBeenCalledOnce();
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

  it("retains and auto-queues a proposal when the run ends during drainSaves or readDocument", async () => {
    let drainStarted = false;
    let releaseSaves!: () => void;
    const drainSaves = () => {
      drainStarted = true;
      return new Promise<void>((resolve) => {
        releaseSaves = resolve;
      });
    };
    const test = harness(true, { drainSaves });
    let releaseRead!: () => void;
    test.readDocument.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseRead = () =>
            resolve({ content: "已保存素材", projectRevision: 1 });
        })
    );
    test.documents.value = [document("", false)];

    const staging = test.stage(
      event({
        operation: "edit",
        creationId: undefined,
        entryId: "entry",
        documentId: "doc",
        baseRevision: revision("已保存素材"),
        text: "改进素材"
      })
    );
    test.endRun();
    await vi.waitFor(() => expect(drainStarted).toBe(true));
    releaseSaves();
    await vi.waitFor(() => expect(test.readDocument).toHaveBeenCalledOnce());
    releaseRead();
    await staging;

    expect(test.proposals.size).toBe(1);
    expect([...test.proposals.values()][0]).toMatchObject({
      approvalMode: "auto-approve",
      status: "pending"
    });
    expect(test.queue).toHaveBeenCalledOnce();
  });
});
