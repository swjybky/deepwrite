import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  CATALOG_PROJECT_MAX_CONTENT_ITEMS,
  MaterialLibraryProjectManifestSchema,
  DecompositionReceiptSchema,
  updateMaterialMarkdownMetadata,
  type MaterialLibraryKind,
  type MaterialLibraryProjectManifest,
  type MaterialStageId,
  type DecompositionContentRef,
  type DecompositionReceipt
} from "@deepwrite/contracts";
import {
  commitProjectTransaction,
  recoverProjectTransaction
} from "../project-transaction";
import { readNoFollowFile } from "../long-project-store/io";
import { decompositionSha } from "../long-book-decomposition/content-guard";
import { updateDecompositionMaterialIndex } from "./managed-index";

const MANAGED_STAGES: Record<MaterialLibraryKind, readonly MaterialStageId[]> =
  {
    character: ["character"],
    plot: ["intro", "pacing", "plot_refine"],
    draft: ["draft_excerpt"],
    other: ["other"],
    gimmick: ["gimmick"],
    mixed: []
  };

/** Generated entries go only to single-kind libraries of the matching kind. */
export function assertManagedStage(
  kind: MaterialLibraryKind,
  stageId: MaterialStageId
): void {
  if (!MANAGED_STAGES[kind].includes(stageId))
    throw new Error("素材阶段与目标库类别不一致。");
}

export interface ManagedMaterialEntryInput {
  libraryId: string;
  entryId: string;
  title: string;
  stageId: MaterialStageId;
  /** The whole generated body; machine records stay in the task directory. */
  content: string;
  receipt: Omit<DecompositionReceipt, "refs">;
  /** The job's newest write to this entry, if any. */
  latest?: Pick<DecompositionContentRef, "sha256" | "userOwned">;
  replace?: boolean;
}
export async function writeManagedMaterialEntry(
  root: string,
  input: ManagedMaterialEntryInput
): Promise<DecompositionReceipt> {
  await recoverProjectTransaction(root);
  const manifestText = (
    await readNoFollowFile(
      join(root, "deepwrite.json"),
      4 * 1024 * 1024,
      "素材清单",
      root
    )
  ).bytes.toString("utf8");
  const manifest = MaterialLibraryProjectManifestSchema.parse(
    JSON.parse(manifestText)
  );
  if (manifest.id !== input.libraryId || manifest.materialType !== "long")
    throw new Error("拆解目标素材库不匹配。");
  assertManagedStage(manifest.materialKind, input.stageId);
  const receiptPath = `receipts/${input.receipt.id}.md`;
  const saved = manifest.writeReceipts?.find(
    ({ id }) => id === input.receipt.id
  );
  if (saved) {
    const { bytes } = await readNoFollowFile(
      join(root, saved.path),
      4 * 1024 * 1024,
      "素材写入回执",
      root
    );
    return DecompositionReceiptSchema.parse(JSON.parse(bytes.toString("utf8")));
  }
  const entry = manifest.entries.find(({ id }) => id === input.entryId);
  if (!entry && manifest.entries.length >= CATALOG_PROJECT_MAX_CONTENT_ITEMS)
    throw new Error("素材库容量不足，请换用新分组。");
  const path = entry?.path ?? `entries/${input.entryId}.md`;
  let existing: string | undefined;
  if (entry)
    existing = (
      await readNoFollowFile(
        join(root, path),
        32 * 1024 * 1024,
        "素材条目",
        root
      )
    ).bytes.toString("utf8");
  const metadata = updateMaterialMarkdownMetadata(input.content, {
    name: entry?.title ?? input.title,
    description: "整书拆解生成的内容。"
  });
  if (!metadata.updated) throw new Error(metadata.message);
  if (
    existing?.trim() &&
    !input.replace &&
    (input.latest
      ? input.latest.userOwned ||
        input.latest.sha256 !== decompositionSha(existing)
      : existing !== metadata.content)
  )
    throw new Error(`decomposition.conflict: ${input.entryId} 已被编辑。`);
  const sha256 = decompositionSha(metadata.content);
  const now = new Date().toISOString();
  const receipt = DecompositionReceiptSchema.parse({
    ...input.receipt,
    refs: [
      {
        projectId: manifest.id,
        resourceId: input.entryId,
        revision: manifest.revision + 1,
        sha256
      }
    ]
  });
  const nextEntry = {
    id: input.entryId,
    title: entry?.title ?? input.title,
    stageId: input.stageId,
    path,
    createdAt: entry?.createdAt ?? now,
    updatedAt: now
  };
  const next: MaterialLibraryProjectManifest =
    MaterialLibraryProjectManifestSchema.parse({
      ...manifest,
      revision: manifest.revision + 1,
      updatedAt: now,
      entries: entry
        ? manifest.entries.map((item) =>
            item.id === entry.id ? nextEntry : item
          )
        : [...manifest.entries, nextEntry],
      writeReceipts: [
        ...(manifest.writeReceipts ?? []),
        { id: receipt.id, path: receiptPath }
      ]
    });
  next.overview = updateDecompositionMaterialIndex(next, receipt);
  await mkdir(join(root, "receipts"), { recursive: true });
  await commitProjectTransaction({
    projectRoot: root,
    operations: [
      {
        path,
        content: metadata.content,
        expectedSha256:
          existing === undefined ? null : decompositionSha(existing)
      },
      {
        path: receiptPath,
        content: JSON.stringify(receipt),
        expectedSha256: null
      },
      {
        path: "deepwrite.json",
        content: JSON.stringify(next),
        expectedSha256: decompositionSha(manifestText)
      }
    ]
  });
  return receipt;
}
