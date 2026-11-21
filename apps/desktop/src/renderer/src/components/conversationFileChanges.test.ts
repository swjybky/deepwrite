import { describe, expect, it } from "vitest";
import type { AgentEditProposal } from "../types/conversation";
import type { LongWorkspaceProposalItem } from "../composables/useLongWorkspaceProposals";
import {
  ledgerEvent,
  mutationEvent,
  worldbuildingWriteEvent,
  type SystemEventEnvelope
} from "../composables/useLongWorkspaceProposals.test-support";
import type { ApprovalCardItem } from "./conversationToolPresentation";
import {
  FILE_CHANGE_PREVIEW_ROWS,
  fileChangeSummary,
  visibleFileChangeRows
} from "./conversationFileChanges";

let clock = 0;

function proposal(patch: Partial<AgentEditProposal> = {}): AgentEditProposal {
  clock += 1;
  const createdAt = new Date(Date.UTC(2026, 9, 28, 1, 0, clock)).toISOString();
  return {
    id: "run:book:draft:chapter_3",
    laneId: "run:book:draft:chapter_3",
    generation: 1,
    approvalMode: "request-approval",
    runId: "run",
    workspaceId: "book",
    stageId: "draft",
    documentId: "chapter_3",
    title: "第三章",
    summary: "调整结尾",
    status: "pending",
    toolCallIds: ["tool"],
    additions: 4,
    deletions: 1,
    hunks: [],
    createdAt,
    updatedAt: createdAt,
    ...patch
  };
}

function edit(
  value: AgentEditProposal,
  remoteDevice?: string
): ApprovalCardItem {
  return {
    id: `${remoteDevice ? "remote" : "edit"}:${value.id}`,
    type: "edit-proposal",
    createdAt: value.createdAt,
    toolCallIds: value.toolCallIds,
    canDiscard: !remoteDevice,
    proposal: value,
    ...(remoteDevice ? { remoteDevice } : {})
  };
}

function long(
  envelope: SystemEventEnvelope,
  patch: Partial<LongWorkspaceProposalItem> = {}
): ApprovalCardItem {
  const event = envelope as LongWorkspaceProposalItem["event"];
  return {
    id: `long:${event.id}`,
    type: "long-proposal",
    createdAt: event.timestamp,
    toolCallIds: [event.payload.toolCallId],
    item: { event, approvalMode: "request-approval", status: "ready", ...patch }
  };
}

function lane(name: string, generation: number, patch = {}) {
  const laneId = `run:book:draft:${name}`;
  return proposal({
    id: generation > 1 ? `${laneId}:generation:${generation}` : laneId,
    laneId,
    generation,
    documentId: name,
    ...patch
  });
}

describe("conversation file change summary", () => {
  it("folds every write to one file into a single row", () => {
    const summary = fileChangeSummary([
      edit(lane("chapter_4", 1, { status: "accepted", additions: 47 })),
      edit(lane("chapter_3", 1, { status: "accepted" })),
      edit(lane("chapter_4", 2, { status: "accepted", additions: 12 })),
      edit(lane("chapter_4", 3, { status: "pending", additions: 2 }))
    ]);

    expect(summary.rows.map(({ key }) => key)).toEqual([
      "edit:run:book:draft:chapter_4",
      "edit:run:book:draft:chapter_3"
    ]);
    const chapter4 = summary.rows[0]!;
    expect(chapter4.writes).toHaveLength(3);
    expect(chapter4.additions).toBe(61);
    // The latest generation decides unless an earlier write still needs action.
    expect(chapter4.status).toBe("action");
    expect(summary.fileCount).toBe(2);
    expect(summary.counts).toMatchObject({ action: 1, accepted: 1 });
  });

  it("issue #79：前序人工审批优先于后代自动等待", () => {
    const first = lane("plot_touch", 1);
    const second = lane("plot_touch", 2, {
      approvalMode: "auto-approve",
      predecessorProposalId: first.id
    });
    const third = lane("plot_touch", 3, {
      approvalMode: "auto-approve",
      predecessorProposalId: second.id
    });
    const fourth = lane("plot_touch", 4, {
      approvalMode: "auto-approve",
      predecessorProposalId: third.id
    });

    const summary = fileChangeSummary([
      edit(first),
      edit(second),
      edit(third),
      edit(fourth)
    ]);

    expect(summary.rows[0]?.status).toBe("action");
    expect(summary.counts.action).toBe(1);
    expect(summary.counts.progress).toBe(0);
  });

  it("keeps row order when statuses change", () => {
    const before = fileChangeSummary([
      edit(lane("a", 1, { status: "accepted" })),
      edit(lane("b", 1)),
      edit(lane("c", 1, { status: "accepted" }))
    ]);
    const after = fileChangeSummary([
      edit(lane("a", 1, { status: "accepted" })),
      edit(lane("b", 1, { status: "accepted" })),
      edit(lane("c", 1, { status: "accepted" }))
    ]);
    expect(after.rows.map(({ key }) => key)).toEqual(
      before.rows.map(({ key }) => key)
    );
    expect(after.counts.action).toBe(0);
  });

  it("separates user decisions from work that settles by itself", () => {
    const stale = {
      detectedAt: "2026-10-28T01:00:00.000Z",
      currentRevision: "v1:1:0"
    };
    const summary = fileChangeSummary([
      edit(lane("review", 1)),
      edit(lane("autosave", 1, { approvalMode: "auto-approve" })),
      edit(lane("edited", 1, { staleBase: stale })),
      edit(lane("failed", 1, { status: "error" })),
      edit(lane("saving", 1, { status: "accepting" })),
      edit(lane("rejected", 1, { status: "rejected" }))
    ]);
    expect(summary.rows.map(({ status, danger }) => [status, danger])).toEqual([
      ["action", false],
      ["progress", false],
      ["action", true],
      ["action", true],
      ["progress", false],
      ["rejected", false]
    ]);
    expect(summary.danger).toBe(true);
  });

  it("reports restored edits as discarded and failed restores as actions", () => {
    const discardState = (status: "discarded" | "discarding" | "error") => ({
      status,
      message: "",
      updatedAt: "2026-10-28T01:00:00.000Z"
    });
    const summary = fileChangeSummary([
      edit(
        lane("a", 1, {
          status: "accepted",
          discardState: discardState("discarded")
        })
      ),
      edit(
        lane("b", 1, {
          status: "accepted",
          discardState: discardState("discarding")
        })
      ),
      edit(
        lane("c", 1, {
          status: "accepted",
          discardState: discardState("error")
        })
      )
    ]);
    expect(summary.rows.map(({ status }) => status)).toEqual([
      "discarded",
      "progress",
      "action"
    ]);
  });

  it("shows proposals from another device read-only", () => {
    const remote = proposal({ id: "remote_one", status: "pending", hunks: [] });
    const summary = fileChangeSummary([edit(remote, "手机")]);
    expect(summary.rows[0]).toMatchObject({
      key: "remote:remote_one",
      status: "remote",
      additions: 4
    });
    expect(summary.counts.action).toBe(0);
  });

  it("marks structure changes and omits their line counts", () => {
    const summary = fileChangeSummary([
      edit(
        lane("new_sections", 1, {
          status: "accepted",
          additions: 0,
          deletions: 0,
          draftSectionCreationTarget: {
            sections: [
              {
                title: "第五章",
                wordCountRequirement: "",
                provisionalSectionId: "p1"
              },
              {
                title: "第六章",
                wordCountRequirement: "",
                provisionalSectionId: "p2"
              }
            ]
          }
        })
      ),
      edit(
        lane("removed", 1, {
          additions: 0,
          deletions: 0,
          draftSectionDeletionTarget: { sectionId: "s6", title: "第六章" }
        })
      )
    ]);
    expect(summary.rows[0]).toMatchObject({
      kind: "structure",
      fileCount: 2,
      creates: true
    });
    expect(summary.rows[0]!.additions).toBeUndefined();
    expect(summary.rows[1]).toMatchObject({ deletes: true, status: "action" });
    expect(summary.structureOnly).toBe(true);
  });

  it("keeps one row per long proposal event with its file diff", () => {
    const summary = fileChangeSummary([
      long(worldbuildingWriteEvent(), { status: "accepted" }),
      long(mutationEvent()),
      long(ledgerEvent(), { status: "waiting", blockedByError: true })
    ]);
    expect(summary.rows.map(({ kind }) => kind)).toEqual([
      "text",
      "structure",
      "ledger"
    ]);
    expect(summary.rows[0]).toMatchObject({
      status: "accepted",
      additions: 1,
      deletions: 0
    });
    expect(summary.rows[1]!.status).toBe("action");
    expect(summary.rows[2]).toMatchObject({ status: "action", danger: true });
    expect(summary.structureOnly).toBe(false);
  });

  it("previews long settled lists but never hides rows awaiting the user", () => {
    const settled = Array.from({ length: 10 }, (_, index) =>
      edit(lane(`file_${index}`, 1, { status: "accepted" }))
    );
    expect(
      visibleFileChangeRows(fileChangeSummary(settled), false)
    ).toHaveLength(FILE_CHANGE_PREVIEW_ROWS);
    expect(
      visibleFileChangeRows(fileChangeSummary(settled), true)
    ).toHaveLength(10);
    const withPending = [...settled, edit(lane("pending", 1))];
    expect(
      visibleFileChangeRows(fileChangeSummary(withPending), false)
    ).toHaveLength(11);
    expect(
      visibleFileChangeRows(fileChangeSummary(settled.slice(0, 8)), false)
    ).toHaveLength(8);
  });
});
