import { describe, expect, it } from "vitest";

import {
  LongCommitChapterInputSchema,
  LongDeleteLedgerCommitInputSchema,
  LongDeleteLedgerCommitResultSchema,
  LongLedgerCommitRecordSchema,
  LongWriteChapterInputSchema
} from "./index";

const chapterSummary = {
  timeline: "第一天雨夜收到旧信。",
  characterStates: "林岚开始怀疑寄信人。",
  factionStates: "守夜人尚未介入。",
  realmStates: "本章无境界变化。",
  foreshadowingStates: "蜡封线索已经种下。",
  continuityNotes: "下一章追查旧邮戳。"
};

const coverage = {
  character: { status: "changed" as const, note: "人物状态发生变化。" },
  plot: { status: "changed" as const, note: "来信事件已经发生。" },
  foreshadowing: {
    status: "changed" as const,
    note: "寄信人伏笔已经种下。"
  },
  world: { status: "unchanged" as const, note: "世界规则没有变化。" },
  knowledge: { status: "changed" as const, note: "林岚得知来信存在。" },
  openLoops: { status: "changed" as const, note: "寄信人身份仍未揭晓。" }
};

const chapterOutputs = {
  characterState: "林岚收到旧信，开始追查寄信人。",
  handoff: {
    summary: "下一章追查旧邮戳。",
    mustCarry: ["林岚持有不可燃烧的旧信。"],
    nextChapterConstraints: ["不能提前揭露寄信人身份。"],
    openLoops: ["loop_sender"]
  }
};

const record = {
  schemaVersion: 4 as const,
  id: "commit_first",
  bookId: "longbook_alpha",
  sequence: 1,
  chapterCardId: "chapter_one",
  committedAt: "2026-07-26T10:00:00.000Z",
  commitMessage: "提交第一章连续性记录",
  chapterSummary,
  committedThroughChapterId: "chapter_one",
  placementChanges: [
    {
      placementId: "placement_letter",
      after: { status: "committed" as const, commitId: "commit_first" },
      note: "正文明确写出林岚接过旧信。"
    }
  ],
  foreshadowingBeatChanges: [],
  foreshadowingThreadChanges: [
    { foreshadowingId: "foreshadow_letter", after: "open" as const }
  ],
  continuityFiles: [
    {
      fileId: "file_chapter_one:continuity:foreshadowing-changes",
      path: "long/continuity/chapters/chapter_one/foreshadowing-changes.md"
    }
  ],
  coverage,
  factChanges: [],
  knowledgeChanges: [],
  openLoopChanges: [],
  chapterOutputs
};

describe("long ledger contracts", () => {
  it("validates deletion commands and reports every chapter in the removed record", () => {
    expect(
      LongDeleteLedgerCommitInputSchema.parse({
        bookId: "longbook_alpha",
        commitId: "commit_first"
      })
    ).toEqual({ bookId: "longbook_alpha", commitId: "commit_first" });
    expect(
      LongDeleteLedgerCommitResultSchema.parse({
        bookId: "longbook_alpha",
        deletedCommitId: "commit_first",
        chapterCardIds: ["chapter_one", "chapter_two"]
      })
    ).toMatchObject({
      deletedCommitId: "commit_first",
      chapterCardIds: ["chapter_one", "chapter_two"]
    });
    expect(
      LongDeleteLedgerCommitInputSchema.safeParse({
        bookId: "longbook_alpha",
        commitId: ""
      }).success
    ).toBe(false);
    expect(
      LongDeleteLedgerCommitResultSchema.safeParse({
        bookId: "longbook_alpha",
        deletedCommitId: "commit_first",
        chapterCardIds: []
      }).success
    ).toBe(false);
  });

  it("stores semantic audit records without rollback state", () => {
    const parsed = LongLedgerCommitRecordSchema.parse(record);
    expect(parsed.id).toBe("commit_first");
    expect(parsed.placementChanges[0]).toEqual({
      placementId: "placement_letter",
      after: { status: "committed", commitId: "commit_first" },
      note: "正文明确写出林岚接过旧信。"
    });
    expect(parsed.continuityFiles[0]).toEqual({
      fileId: "file_chapter_one:continuity:foreshadowing-changes",
      path: "long/continuity/chapters/chapter_one/foreshadowing-changes.md"
    });
    expect(parsed).not.toHaveProperty("fileChanges");
    expect(parsed).not.toHaveProperty("reversible");
  });

  it("rejects removed rollback and version fields", () => {
    for (const obsolete of [
      { reversible: true },
      { sourceWorkspaceRevision: 3 },
      { committedProjectRevision: 4 },
      { previousChapterCommitId: null },
      { fileChanges: [] }
    ]) {
      expect(
        LongLedgerCommitRecordSchema.safeParse({ ...record, ...obsolete })
          .success
      ).toBe(false);
    }
    expect(
      LongLedgerCommitRecordSchema.safeParse({
        ...record,
        continuityFiles: [
          {
            ...record.continuityFiles[0],
            revision: "v1:1:1234abcd"
          }
        ]
      }).success
    ).toBe(false);
  });

  it("accepts direct chapter writes without base versions", () => {
    expect(
      LongWriteChapterInputSchema.parse({
        bookId: "longbook_alpha",
        chapterCardId: "chapter_one",
        body: { content: "第一章正文" },
        characterState: { content: "林岚持有旧信。" },
        handoff: { content: "下一章追查邮戳。" }
      })
    ).toMatchObject({
      body: { content: "第一章正文" },
      handoff: { content: "下一章追查邮戳。" }
    });
  });

  it("accepts structured commits without file or workspace versions", () => {
    const input = LongCommitChapterInputSchema.parse({
      bookId: "longbook_alpha",
      chapterCardId: "chapter_one",
      commitMessage: "确认雨夜来信章连续性",
      chapterSummary,
      placementDecisions: {},
      foreshadowingBeatDecisions: {},
      fileUpdates: [
        {
          fileId: "file_character_alice:current-state",
          content: "林岚持有旧信。"
        }
      ],
      coverage,
      factMutations: [],
      knowledgeMutations: [],
      openLoopMutations: [],
      chapterOutputs
    });
    expect(input.mode).toBe("structured");
    if (input.mode !== "structured") throw new Error("Expected structured.");
    expect(input.fileUpdates[0]).toEqual({
      fileId: "file_character_alice:current-state",
      content: "林岚持有旧信。",
      mode: "replace"
    });
  });

  it("accepts minimal text-file commits and rejects retired fields", () => {
    const input = {
      mode: "text_files" as const,
      bookId: "longbook_alpha",
      chapterCardId: "chapter_one",
      foreshadowingBeatDecisions: {},
      commitMessage: "提交第一章连续性文本文件"
    };
    expect(LongCommitChapterInputSchema.parse(input)).toEqual(input);
    expect(
      LongCommitChapterInputSchema.safeParse({
        ...input,
        chapterFileRevisions: { body: "v1:0:00000000" }
      }).success
    ).toBe(false);
  });

  it("accepts one ordered batch with a final checkpoint", () => {
    const input = LongCommitChapterInputSchema.parse({
      mode: "text_files_batch",
      bookId: "longbook_alpha",
      chapterCardIds: ["chapter_one", "chapter_two"],
      checkpointChapterCardId: "chapter_two",
      foreshadowingBeatDecisions: {},
      commitMessage: "一起提交前两章"
    });
    expect(input).toMatchObject({
      mode: "text_files_batch",
      chapterCardIds: ["chapter_one", "chapter_two"],
      checkpointChapterCardId: "chapter_two"
    });
    expect(
      LongCommitChapterInputSchema.safeParse({
        ...input,
        checkpointChapterCardId: "chapter_one"
      }).success
    ).toBe(false);

    expect(
      LongLedgerCommitRecordSchema.parse({
        ...record,
        schemaVersion: 5,
        chapterCardId: "chapter_two",
        chapterCardIds: ["chapter_one", "chapter_two"],
        checkpointChapterCardId: "chapter_two"
      })
    ).toMatchObject({
      schemaVersion: 5,
      chapterCardIds: ["chapter_one", "chapter_two"]
    });
  });

  it("validates decision ownership and semantic change sources", () => {
    expect(
      LongLedgerCommitRecordSchema.safeParse({
        ...record,
        placementChanges: [
          {
            ...record.placementChanges[0],
            after: { status: "committed", commitId: "commit_other" }
          }
        ]
      }).success
    ).toBe(false);

    const fact = {
      factId: "fact_alice-location",
      domain: "character" as const,
      subjectId: "character_alice",
      field: "location",
      value: "林岚家",
      sourceCommitId: "commit_first",
      sourceChapterCardId: "chapter_one",
      evidence: "正文写明林岚在家中接过旧信。"
    };
    expect(
      LongLedgerCommitRecordSchema.parse({
        ...record,
        factChanges: [{ after: fact }]
      }).factChanges[0]?.after
    ).toEqual(fact);
  });
});
