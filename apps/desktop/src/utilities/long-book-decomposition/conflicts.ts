import {
  DECOMPOSITION_RECEIPT_MAX_BYTES,
  DecompositionReceiptSchema,
  type LongBookDecompositionJob,
  type DecompositionContentRef,
  type DecompositionReceipt
} from "@deepwrite/contracts";
import type { LongWorkspaceService } from "../long-workspace-service";
import type { FolderCatalogStore } from "../folder-catalog-store";
import { readSecureTextFile } from "../long-project-store/io";
import type { ProjectTransactionFileOperation } from "../project-transaction";
import { decompositionReceiptId } from "./identity";
import { decompositionSha } from "./content-guard";
import type { DecompositionRecordsReader } from "./records-reader";
import { requeueDecompositionUnit } from "./unit-retry";

export async function resolveDecompositionConflict(
  job: LongBookDecompositionJob,
  unitId: string,
  choice: "keep-user" | "regenerate",
  longs: LongWorkspaceService,
  catalog: FolderCatalogStore,
  reader: DecompositionRecordsReader,
  persist: () => Promise<void>
) {
  const unit = job.units[unitId];
  if (
    !unit ||
    unit.status !== "conflict" ||
    job.status === "running" ||
    !job.target
  )
    throw new Error("当前单元没有可处理的内容冲突。");
  const projects =
    job.target.kind === "long"
      ? [job.target.bookId]
      : Object.values(job.target.libraryIds);
  if (unit.outputRefs.some(({ projectId }) => !projects.includes(projectId)))
    throw new Error("复用的来源记录不能在当前任务中覆盖，请回到原目标修复。");
  if (job.phase === "done" && choice === "regenerate")
    throw new Error("已完成账本的拆解请建立新任务生成，避免改动原账本快照。");
  const inputRevision = unit.conflictResolution
    ? unit.inputRevision
    : `${unit.inputRevision.split(":resolved:")[0]}:resolved:${Date.now()}`;
  const savedAt = new Date().toISOString();
  const receipt: DecompositionReceipt = {
    ...{
      id: decompositionReceiptId(
        job.id,
        job.outputVersion,
        unitId,
        inputRevision
      ),
      jobId: job.id,
      outputVersion: job.outputVersion,
      unitId,
      inputRevision,
      savedAt
    },
    refs: structuredClone(unit.outputRefs)
  };
  if (choice === "keep-user") {
    const projectIds = [
      ...new Set(receipt.refs.map(({ projectId }) => projectId))
    ];
    unit.inputRevision = inputRevision;
    unit.conflictResolution = "keep-user";
    unit.requiredReceiptIds = projectIds.map((_, index) =>
      index ? `${receipt.id}_${index}` : receipt.id
    );
    await persist();
    if (job.target.kind === "long") {
      const target = job.target;
      // Kept edits become the newest version; later writes must ask again.
      const revision = target.baseRevision + 1;
      const opened = await longs.catalog.open(target.bookId);
      await longs.store.transactManaged(
        opened.projectDirectory,
        async (loaded) => {
          const existing = loaded.index.writeReceipts?.find(
            ({ id }) => id === receipt.id
          );
          if (existing) {
            Object.assign(
              receipt,
              DecompositionReceiptSchema.parse(
                JSON.parse(
                  (
                    await readSecureTextFile(
                      opened.projectDirectory,
                      existing.path,
                      DECOMPOSITION_RECEIPT_MAX_BYTES
                    )
                  ).content
                )
              )
            );
            return { operations: [], result: undefined };
          }
          const operations: ProjectTransactionFileOperation[] = [];
          const objects = [
            ...loaded.index.characters,
            ...loaded.index.worldbuilding,
            ...loaded.index.plot.volumes,
            ...loaded.index.plot.arcs,
            ...loaded.index.plot.storyPlots,
            ...loaded.index.plot.foreshadowing
          ];
          for (const ref of receipt.refs) {
            if (ref.fileId) {
              const file = loaded.files.get(ref.fileId)?.reference;
              if (!file) throw new Error("用户文档已移除。");
              const disk = await readSecureTextFile(
                opened.projectDirectory,
                file.path,
                32 * 1024 * 1024
              );
              ref.sha256 = decompositionSha(disk.content);
              operations.push({
                action: "check",
                path: file.path,
                expectedSha256: disk.sha256
              });
            } else {
              const object = objects.find(({ id }) => id === ref.resourceId);
              if (!object) throw new Error("用户对象已移除。");
              ref.sha256 = decompositionSha(JSON.stringify(object));
            }
            ref.revision = revision;
            ref.userOwned = true;
          }
          const file = {
            id: receipt.id,
            path: `long/analysis/receipts/${receipt.id}.md`,
            updatedAt: savedAt
          };
          loaded.index.writeReceipts = [
            ...(loaded.index.writeReceipts ?? []),
            file
          ];
          return {
            operations: [
              ...operations,
              {
                path: file.path,
                content: JSON.stringify(
                  DecompositionReceiptSchema.parse(receipt)
                ),
                expectedSha256: null
              }
            ],
            result: undefined
          };
        }
      );
      target.baseRevision = revision;
    } else {
      const refs: DecompositionContentRef[] = [];
      for (const [number, projectId] of projectIds.entries()) {
        const result = await catalog.adoptManagedReceipt(projectId, {
          ...receipt,
          id: unit.requiredReceiptIds[number]!,
          refs: receipt.refs.filter((ref) => ref.projectId === projectId)
        });
        refs.push(...result.refs);
      }
      receipt.refs = refs;
    }
    unit.status = "done";
    unit.receiptIds = unit.requiredReceiptIds;
    unit.outputRefs = receipt.refs;
  } else {
    const refs: DecompositionContentRef[] = [];
    for (const { userOwned: _kept, ...ref } of unit.outputRefs) {
      try {
        refs.push({ ...ref, sha256: await reader.currentHash(job, ref) });
      } catch {
        continue;
      }
    }
    unit.outputRefs = refs;
    requeueDecompositionUnit(job, unitId);
    unit.regenerateApproved = true;
    delete unit.requiredReceiptIds;
    if (unitId.startsWith("reading:")) {
      const chunk = Object.values(job.units).find(({ dependencies }) =>
        dependencies.includes(unitId)
      );
      if (chunk) {
        chunk.status = "pending";
        chunk.inputRevision += `:resolved:${Date.now()}`;
      }
    }
  }
  unit.inputRevision = inputRevision;
  delete unit.attemptId;
  delete unit.lastError;
  delete unit.conflictResolution;
  job.status = job.phase === "done" ? "completed" : "idle";
}
