import {
  DEFAULT_LONG_CHARACTER_TYPES,
  LONG_CHARACTER_OVERVIEW_FILE_ID,
  LONG_CHARACTER_OVERVIEW_PATH,
  LONG_WORKSPACE_INDEX_PATH,
  LongWorkspaceFileReferenceSchema,
  LongWorkspaceIndexSnapshotSchema,
  longWorldbuildingItemContentPath,
  longWorldbuildingItemFileId,
  longWorldbuildingOverviewContentPath,
  longWorldbuildingOverviewFileId,
  parseLongWorldbuildingMarkdownList,
  type LongProjectManifest,
  type LongWorkspaceFileReference
} from "@deepwrite/contracts";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectTransactionFileOperation } from "../../project-transaction";
import {
  commitLongProjectTransaction,
  encodeUtf8Strict,
  readSecureTextFile,
  unknownRecord
} from "../io";
import {
  MAX_DOCUMENT_BYTES,
  MAX_LEDGER_RECORD_BYTES,
  type SecureTextFile
} from "../types";
import { isNodeError } from "@deepwrite/shared/node";
import { toJsonFileText } from "@deepwrite/shared";

export async function migrateLegacyWorldbuildingStorage(input: {
  projectDirectory: string;
  manifest: LongProjectManifest;
  manifestDisk: SecureTextFile;
  indexDisk: SecureTextFile;
  rawIndex: unknown;
}): Promise<boolean> {
  const rawIndex = unknownRecord(input.rawIndex);
  if (!rawIndex || !Array.isArray(rawIndex.worldbuilding)) return false;

  let migrated = false;
  const fileOperations: ProjectTransactionFileOperation[] = [];
  const worldbuilding: unknown[] = [];
  for (const rawCategory of rawIndex.worldbuilding) {
    const category = unknownRecord(rawCategory);
    if (!category || category.format !== "list") {
      worldbuilding.push(rawCategory);
      continue;
    }
    const categoryId = typeof category.id === "string" ? category.id : "";
    const overviewPath = longWorldbuildingOverviewContentPath(categoryId);
    const overview = {
      id: longWorldbuildingOverviewFileId(categoryId),
      path: overviewPath,
      updatedAt:
        typeof rawIndex.updatedAt === "string"
          ? rawIndex.updatedAt
          : input.manifest.updatedAt
    };
    if (category.contentAuthority === "files") {
      if (category.overview !== undefined) {
        try {
          await lstat(join(input.projectDirectory, overviewPath));
          worldbuilding.push(rawCategory);
          continue;
        } catch (error: unknown) {
          if (!isNodeError(error, "ENOENT")) throw error;
        }
      } else {
        try {
          const existingOverview = await readSecureTextFile(
            input.projectDirectory,
            overviewPath,
            MAX_DOCUMENT_BYTES
          );
          worldbuilding.push({
            ...category,
            overview: {
              ...overview,
              updatedAt: existingOverview.updatedAt
            }
          });
          migrated = true;
          continue;
        } catch (error: unknown) {
          if (!isNodeError(error, "ENOENT")) throw error;
        }
      }
      fileOperations.push({
        path: overviewPath,
        content: "",
        expectedSha256: null
      });
      worldbuilding.push({
        ...category,
        overview
      });
      migrated = true;
      continue;
    }
    const legacyFile = LongWorkspaceFileReferenceSchema.parse(category.file);
    const legacyDisk = await readSecureTextFile(
      input.projectDirectory,
      legacyFile.path,
      MAX_DOCUMENT_BYTES
    );
    const legacyItems = parseLongWorldbuildingMarkdownList(legacyDisk.content);
    const items = legacyItems.map((item, itemIndex) => {
      const path = longWorldbuildingItemContentPath(categoryId, item.id);
      const bytes = encodeUtf8Strict(item.content);
      if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
        throw new Error(`旧版世界观条目“${item.title}”超过 32 MiB，无法迁移。`);
      }
      const file: LongWorkspaceFileReference = {
        id: longWorldbuildingItemFileId(item.id),
        path,
        updatedAt: legacyFile.updatedAt
      };
      fileOperations.push({
        path,
        content: item.content,
        expectedSha256: null
      });
      return {
        id: item.id,
        title: item.title,
        order: itemIndex + 1,
        file
      };
    });
    fileOperations.push({
      action: "delete",
      path: legacyFile.path
    });
    fileOperations.push({
      path: overviewPath,
      content: "",
      expectedSha256: null
    });
    worldbuilding.push({
      id: category.id,
      title: category.title,
      order: category.order,
      format: "list",
      contentAuthority: "files",
      overview,
      items
    });
    migrated = true;
  }
  if (!migrated) return false;

  const nextIndex = LongWorkspaceIndexSnapshotSchema.parse({
    ...rawIndex,
    worldbuilding
  });
  const indexContent = toJsonFileText(nextIndex);
  await commitLongProjectTransaction({
    projectRoot: input.projectDirectory,
    operations: [
      ...fileOperations,
      {
        path: LONG_WORKSPACE_INDEX_PATH,
        content: indexContent
      }
    ],
    maxFileBytes: MAX_LEDGER_RECORD_BYTES
  });
  return true;
}

export async function migrateLegacyCharacterTypes(input: {
  projectDirectory: string;
  manifest: LongProjectManifest;
  manifestDisk: SecureTextFile;
  indexDisk: SecureTextFile;
  rawIndex: unknown;
}): Promise<boolean> {
  const rawIndex = unknownRecord(input.rawIndex);
  if (!rawIndex || rawIndex.characterTypes !== undefined) return false;
  const nextIndex = LongWorkspaceIndexSnapshotSchema.parse({
    ...rawIndex,
    characterTypes: structuredClone(DEFAULT_LONG_CHARACTER_TYPES)
  });
  const indexContent = toJsonFileText(nextIndex);
  await commitLongProjectTransaction({
    projectRoot: input.projectDirectory,
    operations: [
      {
        path: LONG_WORKSPACE_INDEX_PATH,
        content: indexContent
      }
    ],
    maxFileBytes: MAX_LEDGER_RECORD_BYTES
  });
  return true;
}

export async function migrateLegacyCharacterOverviewStorage(input: {
  projectDirectory: string;
  manifest: LongProjectManifest;
  manifestDisk: SecureTextFile;
  indexDisk: SecureTextFile;
  rawIndex: unknown;
}): Promise<boolean> {
  const rawIndex = unknownRecord(input.rawIndex);
  if (!rawIndex || !Array.isArray(rawIndex.characters)) return false;

  const overviewPath = LONG_CHARACTER_OVERVIEW_PATH;
  const overview = {
    id: LONG_CHARACTER_OVERVIEW_FILE_ID,
    path: overviewPath,
    updatedAt:
      typeof rawIndex.updatedAt === "string"
        ? rawIndex.updatedAt
        : input.manifest.updatedAt
  };

  if (rawIndex.characterOverview !== undefined) {
    try {
      await lstat(join(input.projectDirectory, overviewPath));
      return false;
    } catch (error: unknown) {
      if (!isNodeError(error, "ENOENT")) throw error;
    }
    await commitLongProjectTransaction({
      projectRoot: input.projectDirectory,
      operations: [
        {
          path: overviewPath,
          content: "",
          expectedSha256: null
        }
      ],
      maxFileBytes: MAX_LEDGER_RECORD_BYTES
    });
    return true;
  }

  try {
    const existingOverview = await readSecureTextFile(
      input.projectDirectory,
      overviewPath,
      MAX_DOCUMENT_BYTES
    );
    const nextIndex = LongWorkspaceIndexSnapshotSchema.parse({
      ...rawIndex,
      characterOverview: {
        ...overview,
        updatedAt: existingOverview.updatedAt
      }
    });
    const indexContent = toJsonFileText(nextIndex);
    await commitLongProjectTransaction({
      projectRoot: input.projectDirectory,
      operations: [
        {
          path: LONG_WORKSPACE_INDEX_PATH,
          content: indexContent
        }
      ],
      maxFileBytes: MAX_LEDGER_RECORD_BYTES
    });
    return true;
  } catch (error: unknown) {
    if (!isNodeError(error, "ENOENT")) throw error;
  }

  const nextIndex = LongWorkspaceIndexSnapshotSchema.parse({
    ...rawIndex,
    characterOverview: overview
  });
  const indexContent = toJsonFileText(nextIndex);
  await commitLongProjectTransaction({
    projectRoot: input.projectDirectory,
    operations: [
      {
        path: overviewPath,
        content: "",
        expectedSha256: null
      },
      {
        path: LONG_WORKSPACE_INDEX_PATH,
        content: indexContent
      }
    ],
    maxFileBytes: MAX_LEDGER_RECORD_BYTES
  });
  return true;
}

/**
 * Removes the obsolete character-level state/history files after legacy
 * structured commits have been projected into chapter continuity Markdown.
 */
export async function migrateLegacyCharacterStateFiles(input: {
  projectDirectory: string;
  manifest: LongProjectManifest;
  manifestDisk: SecureTextFile;
  indexDisk: SecureTextFile;
  rawIndex: unknown;
}): Promise<boolean> {
  const rawIndex = unknownRecord(input.rawIndex);
  if (!rawIndex || !Array.isArray(rawIndex.characterFiles)) return false;
  const legacyFiles: LongWorkspaceFileReference[] = [];
  const characterFiles = rawIndex.characterFiles.map((value) => {
    const entry = unknownRecord(value);
    if (!entry) return value;
    for (const candidate of [entry.currentState, entry.history]) {
      if (candidate !== undefined) {
        legacyFiles.push(LongWorkspaceFileReferenceSchema.parse(candidate));
      }
    }
    const {
      currentState: _currentState,
      history: _history,
      ...current
    } = entry;
    return current;
  });
  if (legacyFiles.length === 0) return false;

  const index = LongWorkspaceIndexSnapshotSchema.parse({
    ...rawIndex,
    characterFiles
  });
  const operations: ProjectTransactionFileOperation[] = [];
  for (const reference of legacyFiles) {
    try {
      await readSecureTextFile(
        input.projectDirectory,
        reference.path,
        MAX_DOCUMENT_BYTES
      );
      operations.push({
        action: "delete",
        path: reference.path
      });
    } catch (error: unknown) {
      if (!isNodeError(error, "ENOENT")) throw error;
    }
  }

  const nextIndex = LongWorkspaceIndexSnapshotSchema.parse(index);
  const indexContent = toJsonFileText(nextIndex);
  await commitLongProjectTransaction({
    projectRoot: input.projectDirectory,
    operations: [
      ...operations,
      {
        path: LONG_WORKSPACE_INDEX_PATH,
        content: indexContent
      }
    ],
    maxFileBytes: MAX_LEDGER_RECORD_BYTES
  });
  return true;
}
