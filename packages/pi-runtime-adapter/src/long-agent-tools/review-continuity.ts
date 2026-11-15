import {
  LongCommitChapterInputSchema,
  LongLedgerCommitRecordSchema,
  longLedgerCommitChapterIds
} from "@deepwrite/contracts";
import type { LongToolContext } from "./context";
import { stableHash, textResult } from "./shared";

export async function proposeContinuityReview(
  ctx: LongToolContext,
  commitId: string,
  summary: string,
  signal?: AbortSignal
) {
  if (!ctx.writableRoots.has("continuity_ledger"))
    throw new Error("当前智能体无权复核连续性记录。");
  const index = await ctx.reloadIndex(signal);
  const commit = index.ledger.commits.find((c) => c.id === commitId);
  if (!commit) throw new Error("找不到需要复核的账本记录。");
  const recordFile = await ctx.readWholeDocument(commit.recordFile, signal);
  const record = LongLedgerCommitRecordSchema.parse(
    JSON.parse(recordFile.content)
  );
  const chapterIds = longLedgerCommitChapterIds(commit);
  const bodyFiles = chapterIds.map(
    (id) => index.chapters.find((c) => c.chapterCardId === id)!.body
  );
  const evidenceFiles = [
    ...bodyFiles,
    ...record.continuityFiles.map((f) => {
      const chapter = index.chapters.find(
        (c) => c.chapterCardId === commit.chapterCardId
      )!;
      return [
        chapter.characterState,
        chapter.handoff,
        chapter.foreshadowingChanges,
        ...(chapter.worldReveals ? [chapter.worldReveals] : []),
        ...chapter.characterContinuity.flatMap((c) => [
          c.currentState,
          c.history
        ])
      ].find((v) => v.id === f.fileId)!;
    })
  ];
  const versions = [
    {
      fileId: recordFile.file.id,
      expectedSha256: stableHash(recordFile.content)
    }
  ];
  for (const file of evidenceFiles) {
    if (!file) throw new Error("账本连续性文件索引不完整。");
    const current = await ctx.readWholeDocument(file, signal);
    const read = ctx.fullyReadDocuments.get(file.id);
    if (!read || stableHash(read.content) !== stableHash(current.content))
      throw new Error(
        `复核前须完整读取批次全部正文及末章连续性文件；尚未读取或已变化：${file.id}。`
      );
    versions.push({
      fileId: file.id,
      expectedSha256: stableHash(current.content)
    });
  }
  const input = LongCommitChapterInputSchema.parse({
    mode: "text_files_batch",
    bookId: ctx.workspace.bookId,
    chapterCardIds: chapterIds,
    checkpointChapterCardId: chapterIds.at(-1),
    commitMessage: summary,
    review: { commitId, versions }
  });
  return textResult(
    "已形成原账本的复核提案；接受后更新正文依据，不新增账本，也不修改正文。",
    {
      kind: "long-ledger-commit-proposal",
      bookId: ctx.workspace.bookId,
      agentId: ctx.profile.id,
      input,
      summary
    }
  );
}
