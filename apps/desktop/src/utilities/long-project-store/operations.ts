import { createHash } from "node:crypto";
import {
  LONG_WORKSPACE_INDEX_PATH,
  LongProjectManifestSchema,
  LongWorkspaceOperationBatchSchema,
  LongWorkspaceOperationError,
  applyLongWorkspaceOperations,
  previewLongWorkspaceOperations,
  type LongDocumentWriteProposal,
  type LongWorkspaceFileReference,
  type LongWorkspaceImpactPreview,
  type LongWorkspaceOperationBatch
} from "@deepwrite/contracts";
import type { ProjectTransactionFileOperation } from "../project-transaction";
import { loadIndexedFile } from "./cache";
import {
  assertDirectlyMutableDocument,
  validatePortableAndCanonicalPaths
} from "./integrity";
import {
  commitLongProjectTransaction,
  secureDirectory,
  serializeJson
} from "./io";
import { loadProject } from "./load-project";
import { buildLedgerRecordEditOperations } from "./operation-ledger-record-edits";
import {
  indexedFileSlots,
  requireIndexedFileReference,
  updateChapterBodyStatus
} from "./paths";
import type { LongProjectStoreContext } from "./store-context";
import {
  MANIFEST_PATH,
  MAX_LEDGER_RECORD_BYTES,
  MIGRATION_EVIDENCE_WORLD_ID_PREFIX,
  type ApplyLongWorkspaceOperationsInput,
  type ApplyLongWorkspaceOperationsResult,
  type LoadedLongProject
} from "./types";

export async function previewWorkspaceOperations(
  ctx: LongProjectStoreContext,
  projectDirectory: string,
  batchInput: LongWorkspaceOperationBatch
): Promise<LongWorkspaceImpactPreview> {
  const canonical = await secureDirectory(projectDirectory, "长篇项目目录");
  const requestedBatch = LongWorkspaceOperationBatchSchema.parse(batchInput);
  return await ctx.runExclusive(canonical, async () => {
    const loaded = await loadProject(ctx, canonical);
    const batch = await materializeWorldbuildingConversionBatch(
      loaded,
      requestedBatch
    );
    return previewLongWorkspaceOperations(loaded.index, batch);
  });
}

export async function applyWorkspaceOperations(
  ctx: LongProjectStoreContext,
  projectDirectory: string,
  input: ApplyLongWorkspaceOperationsInput
): Promise<ApplyLongWorkspaceOperationsResult> {
  const canonical = await secureDirectory(projectDirectory, "长篇项目目录");
  const requestedBatch = LongWorkspaceOperationBatchSchema.parse(input.batch);
  return await ctx.runExclusive(canonical, async () => {
    const loaded = await loadProject(ctx, canonical);
    const batch = await materializeWorldbuildingConversionBatch(
      loaded,
      requestedBatch
    );
    for (const operation of batch.operations) {
      const raw = operation as unknown as Record<string, unknown>;
      const targetId =
        typeof raw.id === "string"
          ? raw.id
          : raw.category &&
              typeof raw.category === "object" &&
              "id" in raw.category &&
              typeof (raw.category as { id?: unknown }).id === "string"
            ? (raw.category as { id: string }).id
            : "";
      if (targetId.startsWith(MIGRATION_EVIDENCE_WORLD_ID_PREFIX)) {
        throw new Error("只读迁移证据不能通过长篇结构操作修改或删除。");
      }
    }
    const operationResult = applyLongWorkspaceOperations(loaded.index, batch);
    const nextIndex = operationResult.snapshot;
    // Canonical role paths, portable uniqueness and reserved-directory
    // boundaries are checked before any transaction is staged.
    validatePortableAndCanonicalPaths(indexedFileSlots(nextIndex));

    const proposalByFileId = new Map(
      operationResult.documentWrites.map((proposal) => [
        proposal.fileId,
        proposal
      ])
    );
    const fileOperations: ProjectTransactionFileOperation[] = [];

    for (const intent of operationResult.fileIntents) {
      if (intent.action === "delete") {
        const current = loaded.files.get(intent.file.id);
        if (!current || current.reference.path !== intent.file.path) {
          throw new Error(
            `长篇删除文件路径与当前索引不一致：${intent.file.id}`
          );
        }
        fileOperations.push({
          action: "delete",
          path: current.reference.path
        });
        continue;
      }
      const proposal = proposalByFileId.get(intent.file.id);
      const content = proposal?.content ?? "";
      const nextFile = requireIndexedFileReference(nextIndex, intent.file.id);
      intent.file.updatedAt = nextIndex.updatedAt;
      nextFile.updatedAt = nextIndex.updatedAt;
      updateChapterBodyStatus(nextIndex, nextFile.id, content);
      fileOperations.push({
        path: intent.file.path,
        content,
        expectedSha256: null
      });
    }

    for (const proposal of operationResult.documentWrites) {
      if (proposal.mode === "create") continue;
      assertDirectlyMutableDocument(loaded.index, proposal.fileId);
      const currentDescriptor = loaded.files.get(proposal.fileId);
      if (!currentDescriptor || currentDescriptor.kind !== "markdown") {
        throw new Error(`长篇文档提案目标不存在或不可写：${proposal.fileId}`);
      }
      const current = await loadIndexedFile(loaded, proposal.fileId);
      assertDocumentBaseUnchanged(proposal, current.disk.content);
      const content =
        proposal.mode === "append"
          ? `${current.disk.content}${proposal.content}`
          : proposal.content;
      const nextFile = requireIndexedFileReference(nextIndex, proposal.fileId);
      nextFile.updatedAt = nextIndex.updatedAt;
      updateChapterBodyStatus(nextIndex, nextFile.id, content);
      fileOperations.push({
        path: current.reference.path,
        content,
        // The checked text must still be on disk when the transaction commits.
        ...(proposal.expectedSha256 === undefined
          ? {}
          : { expectedSha256: current.disk.sha256 })
      });
    }

    fileOperations.push(
      ...(await buildLedgerRecordEditOperations({
        loaded,
        nextIndex,
        edits: operationResult.ledgerRecordEdits
      }))
    );

    const indexContent = serializeJson(nextIndex);
    const nextManifest = LongProjectManifestSchema.parse({
      ...loaded.manifest,
      updatedAt: nextIndex.updatedAt,
      workspaceIndexFile: {
        ...loaded.manifest.workspaceIndexFile,
        updatedAt: nextIndex.updatedAt
      }
    });
    await commitLongProjectTransaction({
      projectRoot: loaded.projectDirectory,
      operations: [
        ...fileOperations,
        { path: LONG_WORKSPACE_INDEX_PATH, content: indexContent },
        { path: MANIFEST_PATH, content: serializeJson(nextManifest) }
      ],
      maxFileBytes: MAX_LEDGER_RECORD_BYTES
    });
    const next = await loadProject(ctx, loaded.projectDirectory);
    return {
      book: next.book,
      summary: next.summary,
      operationResult: {
        ...operationResult,
        snapshot: next.index
      }
    };
  });
}

/**
 * Editing stays open while agents run, so a write carries the hash of the
 * text the agent edited. Comparing decoded text keeps a BOM or other byte
 * detail from turning into a false conflict.
 */
function assertDocumentBaseUnchanged(
  proposal: LongDocumentWriteProposal,
  diskContent: string
): void {
  if (proposal.mode === "create" || proposal.expectedSha256 === undefined) {
    return;
  }
  const actualSha256 = createHash("sha256")
    .update(diskContent, "utf8")
    .digest("hex");
  if (actualSha256 === proposal.expectedSha256) return;
  throw new LongWorkspaceOperationError(
    "document_changed",
    "文档在智能体读取后已被修改，未覆盖当前内容。",
    { fileId: proposal.fileId, actualSha256 }
  );
}

export async function materializeWorldbuildingConversionBatch(
  loaded: LoadedLongProject,
  requestedBatch: LongWorkspaceOperationBatch
): Promise<LongWorkspaceOperationBatch> {
  const structuralPreview = previewLongWorkspaceOperations(loaded.index, {
    ...requestedBatch,
    expectedImpact: undefined
  });
  const structuralResult = applyLongWorkspaceOperations(loaded.index, {
    ...requestedBatch,
    expectedImpact: structuralPreview.confirmation
  });
  const previousById = new Map(
    loaded.index.worldbuilding.map((category) => [category.id, category])
  );
  const documentWrites = [...requestedBatch.documentWrites];
  const writtenFileIds = new Set(documentWrites.map(({ fileId }) => fileId));

  for (const category of structuralResult.snapshot.worldbuilding) {
    const previous = previousById.get(category.id);
    if (!previous || previous.format === category.format) continue;

    let targetFile: LongWorkspaceFileReference | undefined;
    let content = "";
    if (previous.format === "list" && category.format === "text") {
      const parts: string[] = [];
      if (previous.overview) {
        const overviewSource = await loadIndexedFile(
          loaded,
          previous.overview.id
        );
        const overviewBody = overviewSource.disk.content.replace(/\s+$/u, "");
        if (overviewBody) {
          parts.push(["## 概览", "", overviewBody].join("\n"));
        }
      }
      for (const item of previous.items) {
        const source = await loadIndexedFile(loaded, item.file.id);
        const body = source.disk.content.replace(/\s+$/u, "");
        parts.push(
          [
            `<!-- 原世界观条目 ID：${item.id} -->`,
            `## ${item.title}`,
            ...(body ? ["", body] : [])
          ].join("\n")
        );
      }
      targetFile = category.file;
      content = parts.length ? `${parts.join("\n\n")}\n` : "";
    } else if (previous.format === "text" && category.format === "list") {
      const target = category.items[0];
      if (!target) continue;
      const source = await loadIndexedFile(loaded, previous.file.id);
      targetFile = target.file;
      content = source.disk.content;
    }
    if (!targetFile || writtenFileIds.has(targetFile.id)) continue;

    documentWrites.push({
      proposalId: `proposal_${createHash("sha256")
        .update(
          `worldbuilding-conversion:${requestedBatch.updatedAt}:${category.id}:${category.format}`,
          "utf8"
        )
        .digest("hex")
        .slice(0, 24)}`,
      fileId: targetFile.id,
      content,
      mode: "create",
      updatedAt: requestedBatch.updatedAt,
      reason: `转换世界观分类“${category.title}”为${
        category.format === "text" ? "文本" : "列表"
      }格式并保留原内容`
    });
    writtenFileIds.add(targetFile.id);
  }

  return LongWorkspaceOperationBatchSchema.parse({
    ...requestedBatch,
    documentWrites
  });
}
