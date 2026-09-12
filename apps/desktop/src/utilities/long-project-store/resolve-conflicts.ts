import {
  LONG_WORKSPACE_INDEX_PATH,
  LongBookSchema,
  LongProjectManifestSchema,
  LongWorkspaceIndexSnapshotSchema
} from "@deepwrite/contracts";
import { TextDecoder } from "node:util";
import { resolveProjectTransactionConflicts } from "../project-transaction/resolve-conflicts";
import { stripLegacyLongVersionMetadata } from "../long-version-metadata";
import { validatePortableAndCanonicalPaths } from "./integrity";
import {
  parseJson,
  readSecureTextFile,
  serializeJson,
  secureDirectory,
  unknownRecord
} from "./io";
import { loadProject } from "./load-project";
import { indexedFileSlots } from "./paths";
import type { LongProjectStoreContext } from "./store-context";
import {
  MANIFEST_PATH,
  MAX_INDEX_BYTES,
  MAX_MANIFEST_BYTES,
  MAX_LEDGER_RECORD_BYTES
} from "./types";

export async function resolveLongProjectConflicts(
  ctx: LongProjectStoreContext,
  projectDirectory: string,
  bookId: string
) {
  const canonical = await secureDirectory(projectDirectory, "长篇项目目录");
  return await ctx.runExclusive(canonical, async () => {
    // Establish identity from disk without invoking the blocked recovery path.
    const manifest = await readSecureTextFile(
      canonical,
      MANIFEST_PATH,
      MAX_MANIFEST_BYTES
    );
    const rawManifest = parseJson(manifest.content, "长篇项目 manifest");
    if (
      LongProjectManifestSchema.parse(
        stripLegacyLongVersionMetadata(rawManifest).value
      ).id !== bookId
    ) {
      throw new Error("长篇项目标识与注册信息不一致，拒绝解决冲突。");
    }
    const resolved = await resolveProjectTransactionConflicts({
      projectRoot: canonical,
      maxFileBytes: MAX_LEDGER_RECORD_BYTES,
      prepare: async (read, recovery) => {
        const indexBytes = await read(LONG_WORKSPACE_INDEX_PATH);
        const manifestBytes = await read(MANIFEST_PATH);
        if (!indexBytes || !manifestBytes)
          throw new Error("长篇索引或清单缺失，无法解决冲突。");
        if (
          indexBytes.length > MAX_INDEX_BYTES ||
          manifestBytes.length > MAX_MANIFEST_BYTES
        ) {
          throw new Error("长篇索引或清单超过大小限制。");
        }
        const index = LongWorkspaceIndexSnapshotSchema.parse(
          stripLegacyLongVersionMetadata(
            decodeJson(indexBytes, "长篇工作区索引")
          ).value
        );
        const rawNextManifest = unknownRecord(
          decodeJson(manifestBytes, "长篇项目 manifest")
        );
        const nextManifest = LongProjectManifestSchema.parse(
          stripLegacyLongVersionMetadata(rawNextManifest).value
        );
        if (index.bookId !== bookId || nextManifest.id !== bookId) {
          throw new Error("长篇索引、清单与注册标识不一致，拒绝解决冲突。");
        }
        validatePortableAndCanonicalPaths(indexedFileSlots(index));
        // The index remains authoritative. Recovery may have a newer manifest
        // staged alongside an externally edited index; align only its timestamps.
        const updatedManifest = {
          ...nextManifest,
          updatedAt: index.updatedAt,
          workspaceIndexFile: {
            ...nextManifest.workspaceIndexFile,
            updatedAt: index.updatedAt
          }
        };
        const {
          kind: _kind,
          workspaceIndexFile: _file,
          ...bookFields
        } = updatedManifest;
        LongBookSchema.parse({
          ...bookFields,
          schemaVersion: index.schemaVersion,
          workspaceIndex: index
        });
        const changes = new Map<string, string>();
        // An external index can retain a document that the interrupted
        // transaction intended to delete. Preserve that reference, including
        // restoring its verified backup if the delete already took effect.
        for (const { reference } of indexedFileSlots(index)) {
          if (
            !recovery.paths.has(reference.path) ||
            (await read(reference.path))
          )
            continue;
          const before = recovery.deletions.has(reference.path)
            ? await recovery.readBeforeDeletion(reference.path)
            : null;
          if (before === null)
            throw new Error(
              `索引引用的文件缺失：${reference.path}。请恢复文件或修正索引后重试。`
            );
          changes.set(reference.path, before.toString("utf8"));
        }
        if (
          nextManifest.updatedAt !== index.updatedAt ||
          nextManifest.workspaceIndexFile.updatedAt !== index.updatedAt
        ) {
          // Leave legacy fields on disk until loadProject can migrate the
          // complete project, including lazily loaded ledger records.
          changes.set(
            MANIFEST_PATH,
            serializeJson({
              ...rawNextManifest,
              updatedAt: index.updatedAt,
              workspaceIndexFile: {
                ...unknownRecord(rawNextManifest?.workspaceIndexFile),
                updatedAt: index.updatedAt
              }
            })
          );
        }
        return changes;
      }
    });
    // Discard only cached reads. No renderer drafts or user files are removed.
    ctx.documentReadCache.clear();
    ctx.documentReadCacheCost = 0;
    const loaded = await loadProject(ctx, canonical);
    return { book: loaded.book, summary: loaded.summary, ...resolved };
  });
}

function decodeJson(bytes: Buffer, label: string): unknown {
  let text: string;
  try {
    // Match readSecureTextFile: accept a UTF-8 BOM from desktop editors while
    // still rejecting invalid encoding. Hashes and backups use original bytes.
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label}不是有效 UTF-8。请用 UTF-8 编码保存后重试。`);
  }
  return parseJson(text, label);
}
