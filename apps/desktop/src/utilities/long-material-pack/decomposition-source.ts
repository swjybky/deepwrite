import { access } from "node:fs/promises";
import {
  decompositionAssetProse,
  type LongBookDecompositionJob,
  type LongMaterialSource
} from "@deepwrite/contracts";
import { DecompositionJobStateStore } from "../long-book-decomposition/job-state-store";
import { DecompositionRecordStore } from "../long-book-decomposition/record-store";

/** The newest whole-book decomposition that wrote this long book, if any. */
export async function findDecompositionJob(
  workspaceDirectory: string,
  bookId: string
): Promise<
  | { job: LongBookDecompositionJob; store: DecompositionJobStateStore }
  | undefined
> {
  const store = new DecompositionJobStateStore(workspaceDirectory);
  try {
    await access(store.root);
  } catch {
    return undefined;
  }
  let jobs: LongBookDecompositionJob[];
  try {
    jobs = await store.list();
  } catch {
    return undefined;
  }
  const job = jobs.find(
    ({ target }) => target?.kind === "long" && target.bookId === bookId
  );
  return job ? { job, store } : undefined;
}

export function decompositionCompleted(job: LongBookDecompositionJob) {
  return job.status === "completed" || job.phase === "done";
}

/**
 * Continuation-mode books keep the style profile and non-world topics only in
 * task records; the conversion brings them back as material.
 */
export async function readDecompositionMaterial(
  workspaceDirectory: string,
  bookId: string
): Promise<Pick<LongMaterialSource, "decomposition">> {
  const found = await findDecompositionJob(workspaceDirectory, bookId);
  if (!found) return {};
  const { job, store } = found;
  const records = new DecompositionRecordStore((id) => store.directory(id));
  const read = async (unitId: string) => {
    if (job.units[unitId]?.status !== "done") return undefined;
    try {
      const { data } = await records.record(job, unitId);
      return data.kind === "asset" ? data.asset : undefined;
    } catch {
      return undefined;
    }
  };
  const style = await read("style:profile");
  const topics = [];
  for (const [unitId, unit] of Object.entries(job.units)) {
    if (!unit.topic || unit.topic.domain === "world") continue;
    const asset = await read(unitId);
    if (asset?.kind !== "topic") continue;
    const kind =
      asset.domain === "style"
        ? "draft"
        : asset.domain === "plot"
          ? "plot"
          : "character";
    topics.push({
      key: unitId,
      kind: kind as "draft" | "plot" | "character",
      stageId:
        kind === "draft"
          ? ("draft_excerpt" as const)
          : kind === "plot"
            ? ("pacing" as const)
            : ("character" as const),
      title: asset.title,
      content: decompositionAssetProse(asset)
    });
  }
  return {
    decomposition: {
      completed: decompositionCompleted(job),
      ...(style?.kind === "style"
        ? { style: { content: style.content, excerpts: style.excerpts } }
        : {}),
      topics
    }
  };
}
