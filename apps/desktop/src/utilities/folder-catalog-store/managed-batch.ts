import { join } from "node:path";
import {
  CATALOG_PROJECT_MAX_CONTENT_ITEMS,
  MaterialLibraryProjectManifestSchema,
  type MaterialLibraryProjectManifest,
  type MaterialStageId
} from "@deepwrite/contracts";
import {
  commitProjectTransaction,
  recoverProjectTransaction
} from "../project-transaction";
import { readNoFollowFile } from "../long-project-store/io";
import { decompositionSha } from "../long-book-decomposition/content-guard";
import { assertManagedStage } from "./managed-entry";

const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_ENTRY_BYTES = 32 * 1024 * 1024;

export interface ManagedLibraryState {
  manifest: MaterialLibraryProjectManifest;
  manifestSha256: string;
  /** Current content hash of every entry, by entry id. */
  entrySha256: Record<string, string>;
}

async function readManifest(root: string) {
  const text = (
    await readNoFollowFile(
      join(root, "deepwrite.json"),
      MAX_MANIFEST_BYTES,
      "素材清单",
      root
    )
  ).bytes.toString("utf8");
  return {
    text,
    manifest: MaterialLibraryProjectManifestSchema.parse(JSON.parse(text))
  };
}

export async function readManagedLibrary(
  root: string,
  libraryId: string
): Promise<ManagedLibraryState> {
  await recoverProjectTransaction(root);
  const { text, manifest } = await readManifest(root);
  if (manifest.id !== libraryId) throw new Error("素材库标识不一致。");
  const entrySha256: Record<string, string> = {};
  for (const entry of manifest.entries) {
    try {
      const { bytes } = await readNoFollowFile(
        join(root, entry.path),
        MAX_ENTRY_BYTES,
        "素材条目",
        root
      );
      entrySha256[entry.id] = decompositionSha(bytes.toString("utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return { manifest, manifestSha256: decompositionSha(text), entrySha256 };
}

export interface ManagedEntriesWrite {
  libraryId: string;
  /** The manifest the caller planned against; any other change aborts. */
  manifestSha256: string;
  writes: {
    entryId: string;
    title: string;
    stageId: MaterialStageId;
    content: string;
    /** Current content hash, or null for a new entry. */
    expectedSha256: string | null;
  }[];
  removals: { entryId: string; expectedSha256: string }[];
  /** Managed entries in library order; other entries follow, order kept. */
  order: readonly string[];
  overview?: string;
}

/** Writes, removes and reorders managed entries in one library transaction. */
export async function writeManagedEntries(
  root: string,
  input: ManagedEntriesWrite
): Promise<{ revision: number }> {
  await recoverProjectTransaction(root);
  const { text, manifest } = await readManifest(root);
  if (manifest.id !== input.libraryId || manifest.materialType !== "long")
    throw new Error("转换目标素材库不匹配。");
  if (decompositionSha(text) !== input.manifestSha256)
    throw new Error("素材库在转换期间被修改，请重新转换。");
  for (const write of input.writes)
    assertManagedStage(manifest.materialKind, write.stageId);
  const now = new Date().toISOString();
  const removed = new Set(input.removals.map(({ entryId }) => entryId));
  const existing = new Map(manifest.entries.map((entry) => [entry.id, entry]));
  const written = new Map(
    input.writes.map((write) => {
      const entry = existing.get(write.entryId);
      return [
        write.entryId,
        {
          id: write.entryId,
          title: write.title,
          stageId: write.stageId,
          path: entry?.path ?? `entries/${write.entryId}.md`,
          createdAt: entry?.createdAt ?? now,
          updatedAt: now
        }
      ];
    })
  );
  const current = manifest.entries
    .filter(({ id }) => !removed.has(id))
    .map((entry) => written.get(entry.id) ?? entry);
  for (const [id, entry] of written) if (!existing.has(id)) current.push(entry);
  const rank = new Map(input.order.map((id, index) => [id, index]));
  const managed = current
    .filter(({ id }) => rank.has(id))
    .sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  const entries = [...managed, ...current.filter(({ id }) => !rank.has(id))];
  if (entries.length > CATALOG_PROJECT_MAX_CONTENT_ITEMS)
    throw new Error("素材库容量不足，请减少转换内容或换用新分组。");
  const next = MaterialLibraryProjectManifestSchema.parse({
    ...manifest,
    revision: manifest.revision + 1,
    updatedAt: now,
    entries,
    ...(input.overview !== undefined ? { overview: input.overview } : {})
  });
  await commitProjectTransaction({
    projectRoot: root,
    operations: [
      ...input.writes.map((write) => ({
        path: written.get(write.entryId)!.path,
        content: write.content,
        expectedSha256: write.expectedSha256
      })),
      ...input.removals.map(({ entryId, expectedSha256 }) => ({
        path: existing.get(entryId)?.path ?? `entries/${entryId}.md`,
        action: "delete" as const,
        expectedSha256
      })),
      {
        path: "deepwrite.json",
        content: JSON.stringify(next),
        expectedSha256: input.manifestSha256
      }
    ]
  });
  return { revision: next.revision };
}

/** Replaces only the block between this pack's markers; user prose stays. */
export function replaceOverviewBlock(
  overview: string,
  marker: string,
  content: string
): string {
  const start = `<!-- ${marker} -->`;
  const end = `<!-- /${marker} -->`;
  const block = `${start}\n${content.trim()}\n${end}`;
  const from = overview.indexOf(start);
  const to = from < 0 ? -1 : overview.indexOf(end, from);
  if (from >= 0 && to < 0)
    throw new Error("素材库介绍中的转换索引边界已损坏。");
  return from < 0
    ? `${block}\n\n${overview.trim()}`.trim() + "\n"
    : overview.slice(0, from) + block + overview.slice(to + end.length);
}
