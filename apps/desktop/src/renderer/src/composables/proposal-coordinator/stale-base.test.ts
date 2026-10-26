import { createShortWorkspaceContentRevision as revision } from "@deepwrite/contracts";
import { describe, expect, it } from "vitest";
import {
  expectedDiskRevision,
  resolveTextProposalAcceptBase,
  resolvedStaleBase,
  stagedStaleBase,
  staleRevisionAfterConflict,
  staleTextProposalPatch
} from "./stale-base";

const AGENT_BASE = "第一节原文。\n";
const USER_EDIT = "第一节原文。\n用户运行中补写的一句。\n";
const AGENT_VERSION = "第一节校对后的原文。\n";

describe("text proposal base checks", () => {
  it("accepts while the user's text still matches the agent's base", () => {
    expect(
      resolveTextProposalAcceptBase(
        { baseRevision: revision(AGENT_BASE) },
        AGENT_BASE
      )
    ).toEqual({ kind: "ready", overwrite: false });
  });

  it("holds the proposal once the user edited the target", () => {
    expect(
      resolveTextProposalAcceptBase(
        { baseRevision: revision(AGENT_BASE) },
        USER_EDIT
      )
    ).toEqual({ kind: "stale", currentRevision: revision(USER_EDIT) });
  });

  it("overwrites only the version the user confirmed", () => {
    const proposal = {
      baseRevision: revision(AGENT_BASE),
      staleBase: {
        detectedAt: "2026-10-19T01:00:00.000Z",
        currentRevision: revision(USER_EDIT)
      }
    };
    expect(resolveTextProposalAcceptBase(proposal, USER_EDIT)).toEqual({
      kind: "ready",
      overwrite: true
    });
    const typedMore = `${USER_EDIT}又写了一句。\n`;
    expect(resolveTextProposalAcceptBase(proposal, typedMore)).toEqual({
      kind: "stale",
      currentRevision: revision(typedMore)
    });
    // Reverting to the agent's base makes it an ordinary accept again.
    expect(resolveTextProposalAcceptBase(proposal, AGENT_BASE)).toEqual({
      kind: "ready",
      overwrite: false
    });
  });

  it("keeps last-writer-wins order between agents when the user did not edit", () => {
    const sibling = "第一节，前一个子智能体写入的完整正文。\n";
    const proposal = { baseRevision: revision(AGENT_BASE) };
    expect(
      resolveTextProposalAcceptBase(proposal, sibling, revision(sibling))
    ).toEqual({ kind: "ready", overwrite: false });
    const userAfterSibling = `${sibling}用户随后补写。\n`;
    expect(
      resolveTextProposalAcceptBase(
        proposal,
        userAfterSibling,
        revision(sibling)
      )
    ).toEqual({ kind: "stale", currentRevision: revision(userAfterSibling) });
  });

  it("checks loaded text on disk and leaves unloaded text to Core as before", () => {
    const proposal = { baseRevision: revision(AGENT_BASE) };
    expect(resolveTextProposalAcceptBase(proposal, undefined)).toEqual({
      kind: "ready",
      overwrite: false
    });
    expect(expectedDiskRevision(undefined)).toBeUndefined();
    expect(expectedDiskRevision(USER_EDIT)).toBe(revision(USER_EDIT));
  });

  it("flags staleness while staging and keeps the first detection time", () => {
    expect(
      stagedStaleBase(undefined, AGENT_BASE, revision(AGENT_BASE), "t1")
    ).toBeUndefined();
    const first = stagedStaleBase(
      undefined,
      USER_EDIT,
      revision(AGENT_BASE),
      "t1"
    );
    expect(first).toEqual({
      detectedAt: "t1",
      currentRevision: revision(USER_EDIT)
    });
    expect(
      stagedStaleBase(
        { staleBase: first! },
        USER_EDIT,
        revision(AGENT_BASE),
        "t2"
      )?.detectedAt
    ).toBe("t1");
    expect(
      stagedStaleBase(
        undefined,
        USER_EDIT,
        revision(AGENT_BASE),
        "t1",
        revision(USER_EDIT)
      )
    ).toBeUndefined();
  });

  it("rebuilds the diff to show what overwriting would change", () => {
    const patch = staleTextProposalPatch(
      { proposedText: AGENT_VERSION },
      USER_EDIT,
      revision(USER_EDIT),
      "t1"
    );
    expect(patch).toMatchObject({
      status: "pending",
      approvalMode: "request-approval",
      staleBase: { detectedAt: "t1", currentRevision: revision(USER_EDIT) },
      additions: 1,
      deletions: 2,
      truncated: false
    });
  });

  it("records the revision Core found when the reload did not move", () => {
    const error = {
      code: "catalog.conflict",
      message: "conflict",
      details: { expectedRevision: "a", actualRevision: revision(USER_EDIT) }
    };
    const proposal = { baseRevision: revision(AGENT_BASE) };
    expect(staleRevisionAfterConflict(error, AGENT_BASE, proposal)).toBe(
      revision(USER_EDIT)
    );
    expect(staleRevisionAfterConflict(error, USER_EDIT, proposal)).toBe(
      revision(USER_EDIT)
    );
  });

  it("records the user's decision only on stale proposals", () => {
    expect(resolvedStaleBase({}, "kept-user")).toEqual({});
    expect(
      resolvedStaleBase(
        { staleBase: { detectedAt: "t1", currentRevision: "r" } },
        "overwrote"
      )
    ).toEqual({
      staleBase: {
        detectedAt: "t1",
        currentRevision: "r",
        resolution: "overwrote"
      }
    });
  });
});
