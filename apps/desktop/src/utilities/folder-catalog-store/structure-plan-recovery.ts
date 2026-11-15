import { join } from "node:path";
import {
  CatalogProjectManifestSchema,
  type LibraryStructureOperation
} from "@deepwrite/contracts";
import { readNoFollowFile } from "../long-project-store/io";
import { projectTransactionContentSha256 as sha } from "../project-transaction";
import type { Library, StructurePlanState } from "./structure-plan-context";

/** Archive and restore share the same multi-root transaction as the library manifest. */
export async function applyRecoverableEntryOperation(
  operation: Extract<
    LibraryStructureOperation,
    { action: "archive-entries" | "restore-entries" }
  >,
  state: StructurePlanState
) {
  const source = state.library(operation.libraryId);
  if (new Set(operation.entryIds).size !== operation.entryIds.length)
    throw new Error("条目重复。");
  const recoveryId =
    operation.action === "archive-entries"
      ? state.request.requestId
      : operation.recoveryId;
  for (const id of operation.entryIds) {
    const prefix = `.deepwrite-trash/${sha(recoveryId)}/${sha(id)}`;
    const metadataPath = `${prefix}.json`;
    const bodyPath = `${prefix}.md`;
    if (operation.action === "archive-entries") {
      const entry = source.manifest.entries.find((item) => item.id === id);
      if (!entry) throw new Error("要删除的条目不存在。");
      const content = await state.body(source, entry);
      source.files.set(metadataPath, {
        action: "write",
        path: metadataPath,
        content: JSON.stringify(entry),
        expectedSha256: null
      });
      source.files.set(bodyPath, {
        action: "write",
        path: bodyPath,
        content,
        expectedSha256: null
      });
      source.files.set(entry.path, {
        action: "delete",
        path: entry.path,
        expectedSha256: sha(content)
      });
      source.manifest.entries = source.manifest.entries.filter(
        (item) => item.id !== id
      ) as Library["entries"];
      state.summary.push(
        `删除「${source.manifest.title} / ${entry.title}」并保留可恢复备份；recovery_id=${recoveryId}，entry_id=${id}`
      );
    } else {
      const root = source.registration.projectDirectory;
      const metadata = (
        await readNoFollowFile(
          join(root, metadataPath),
          state.ctx.maxManifestBytes ?? 1024 * 1024,
          "deleted entry metadata",
          root
        )
      ).bytes.toString("utf8");
      const content = (
        await readNoFollowFile(
          join(root, bodyPath),
          state.ctx.maxMarkdownBytes ?? 32 * 1024 * 1024,
          "deleted entry",
          root
        )
      ).bytes.toString("utf8");
      state.fingerprints.push(
        `${metadataPath}:${sha(metadata)}`,
        `${bodyPath}:${sha(content)}`
      );
      // Parse via the same manifest schema that saves live entries; restore to a safe generated path.
      const manifest = CatalogProjectManifestSchema.parse({
        ...source.manifest,
        entries: [JSON.parse(metadata)]
      }) as Library;
      const entry = manifest.entries[0]!;
      if (
        entry.id !== id ||
        source.manifest.entries.some(
          (item) =>
            item.id === id ||
            (item.title === entry.title && item.stageId === entry.stageId)
        )
      )
        throw new Error("原条目已存在或有同名条目，请先处理冲突再恢复。");
      const path = `entries/${sha(id).slice(0, 32)}.md`;
      source.files.set(path, {
        action: "write",
        path,
        content,
        expectedSha256: null
      });
      source.files.set(metadataPath, {
        action: "delete",
        path: metadataPath,
        expectedSha256: sha(metadata)
      });
      source.files.set(bodyPath, {
        action: "delete",
        path: bodyPath,
        expectedSha256: sha(content)
      });
      source.manifest.entries.push({
        ...entry,
        path,
        updatedAt: state.ctx.now
      } as never);
      state.summary.push(
        `恢复「${source.manifest.title} / ${entry.title}」及完整正文`
      );
    }
  }
}
