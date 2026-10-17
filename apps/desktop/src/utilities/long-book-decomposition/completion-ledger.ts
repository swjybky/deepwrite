import {
  DECOMPOSITION_RECEIPT_MAX_BYTES,
  DecompositionReceiptSchema,
  type LongBookDecompositionJob
} from "@deepwrite/contracts";
import type { LongWorkspaceService } from "../long-workspace-service";
import {
  applyChapterDecisions,
  collectChapterBatchCommitTargets
} from "../long-project-store/commit-chapter-common";
import { readSecureTextFile } from "../long-project-store/io";
import { orderedChapterCards } from "../long-project-store/paths";
import type { ProjectTransactionFileOperation } from "../project-transaction";
import type { DecompositionJobStateStore } from "./job-state-store";
import { decompositionResourceId } from "./identity";
import { decompositionSha } from "./content-guard";

/** Journal the deterministic post-commit references before creating the native ledger.
 * A crash between the ledger transaction and receipt refresh can then be recovered
 * without treating our own status derivation as an unrelated user edit. */
export async function commitDecompositionLedger(
  job: LongBookDecompositionJob,
  state: DecompositionJobStateStore,
  longs: LongWorkspaceService
) {
  if (job.target?.kind !== "long") throw new Error("长篇目标未绑定。");
  const opened = await longs.catalog.open(job.target.bookId);
  const index = opened.book.workspaceIndex;
  const commitId = decompositionResourceId(
    "commit",
    job.id,
    `complete:${job.outputVersion}`
  );
  const existing = index.ledger.commits.find(({ id }) => id === commitId);
  const chapterCardIds = orderedChapterCards(index).map(({ id }) => id);
  const decisions = Object.fromEntries(
    index.plot.foreshadowing.flatMap(({ beats }) =>
      beats.map((beat) => [
        beat.id,
        { status: "committed" as const, note: beat.note }
      ])
    )
  );
  let completion = await state.completion(job.id);
  if (!existing) {
    const projected = structuredClone(index);
    applyChapterDecisions({
      index: projected,
      targets: collectChapterBatchCommitTargets(projected, chapterCardIds),
      commitId,
      placementDecisions: null,
      beatDecisions: decisions
    });
    const objects = new Map(
      projected.plot.foreshadowing.map((object) => [
        object.id,
        decompositionSha(JSON.stringify(object))
      ])
    );
    // Only ledger-derived changes need recovery overrides; the other refs
    // already live in job.json and their receipts.
    const postCommitRefs = Object.fromEntries(
      Object.entries(job.units)
        .filter(
          ([, unit]) =>
            unit.status === "done" &&
            unit.outputRefs.some(
              (ref) =>
                !ref.fileId &&
                objects.has(ref.resourceId) &&
                objects.get(ref.resourceId) !== ref.sha256
            )
        )
        .map(([id, unit]) => [
          id,
          unit.outputRefs.map((ref) =>
            !ref.fileId && objects.has(ref.resourceId)
              ? { ...ref, sha256: objects.get(ref.resourceId)! }
              : ref
          )
        ])
    );
    completion = { ...completion, commitId, postCommitRefs };
    await state.saveCompletion(job.id, completion);
    await longs.store.commitChapter(opened.projectDirectory, {
      mode: "text_files_batch",
      managedCommitId: commitId,
      chapterCardIds,
      checkpointChapterCardId: chapterCardIds.at(-1)!,
      foreshadowingBeatDecisions: decisions,
      commitMessage: `整书拆解完成：第 ${job.source.range.start}–${job.source.range.end} 章`
    });
  }
  if (completion.commitId !== commitId || !completion.postCommitRefs)
    throw new Error("账本提交恢复日志缺失，请检查任务与目标版本。");
  await longs.store.transactManaged(opened.projectDirectory, async (loaded) => {
    const operations: ProjectTransactionFileOperation[] = [];
    for (const [id, refs] of Object.entries(completion.postCommitRefs!)) {
      const unit = job.units[id];
      if (!unit) continue;
      for (const ref of refs.filter((ref) => !ref.fileId)) {
        const object = loaded.index.plot.foreshadowing.find(
          ({ id }) => id === ref.resourceId
        );
        if (object && decompositionSha(JSON.stringify(object)) !== ref.sha256)
          throw new Error(
            "decomposition.conflict: 账本完成后的伏笔对象已被编辑。"
          );
      }
      for (const receiptId of unit.receiptIds) {
        const file = loaded.index.writeReceipts?.find(
          ({ id }) => id === receiptId
        );
        if (!file) throw new Error("账本完成回执缺失。");
        const disk = await readSecureTextFile(
          opened.projectDirectory,
          file.path,
          DECOMPOSITION_RECEIPT_MAX_BYTES
        );
        const receipt = DecompositionReceiptSchema.parse(
          JSON.parse(disk.content)
        );
        const content = JSON.stringify({ ...receipt, refs });
        if (content !== disk.content)
          operations.push({
            path: file.path,
            content,
            expectedSha256: disk.sha256
          });
      }
      unit.outputRefs = refs;
    }
    return { operations, result: undefined };
  });
  await longs.catalog.openAtPath(opened.projectDirectory);
}
