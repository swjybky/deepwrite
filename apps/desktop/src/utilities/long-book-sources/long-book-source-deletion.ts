import { randomUUID } from "node:crypto";
import { lstat, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { LongBookAnalysisSavedSourceIdSchema } from "@deepwrite/contracts";
import { secureDirectory } from "../long-project-store/io";
import { DecompositionJobStateStore } from "../long-book-decomposition/job-state-store";
import { isNodeError } from "@deepwrite/shared/node";

async function assertSourceUnreferenced(
  workspaceDirectory: string,
  sourceId: string
): Promise<void> {
  const jobs = new DecompositionJobStateStore(workspaceDirectory);
  try {
    await lstat(jobs.root);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return;
    throw error;
  }
  await secureDirectory(jobs.root, "整书拆解任务目录");
  if ((await jobs.list()).some((job) => job.source.sourceId === sourceId))
    throw new Error(
      "此书籍仍被整书拆解任务引用，请先删除对应任务记录；已写入的作品和素材会保留。"
    );
}

export async function deleteLongBookSourceSnapshot(
  workspaceDirectory: string,
  directory: string,
  rawSourceId: string
): Promise<string> {
  const sourceId = LongBookAnalysisSavedSourceIdSchema.parse(rawSourceId);
  const target = join(directory, sourceId);
  try {
    await secureDirectory(directory, "长篇拆书来源目录");
    await secureDirectory(target, "长篇拆书来源");
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return sourceId;
    throw error;
  }
  await assertSourceUnreferenced(workspaceDirectory, sourceId);
  // Hide the whole snapshot atomically before clearing its revisions and receipts.
  const removed = join(directory, `.deleted-${sourceId}-${randomUUID()}`);
  await rename(target, removed);
  await rm(removed, { recursive: true, force: true });
  return sourceId;
}
