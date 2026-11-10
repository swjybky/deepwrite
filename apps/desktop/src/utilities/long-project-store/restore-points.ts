import { readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { randomHex8 } from "@deepwrite/shared";
import {
  LONG_WORKSPACE_INDEX_PATH,
  LongWorkspaceOperationError,
  type LongRestorePoint,
  type LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import {
  projectTransactionContentSha256,
  type ProjectTransactionFileOperation
} from "../project-transaction";
import {
  readRegularFileOptional,
  resolveInternalWritableFile,
  writeDurableNewFile
} from "../project-transaction/io";
import { MANIFEST_PATH, MAX_LEDGER_RECORD_BYTES } from "./types";

const RESTORE_DIRECTORY = ".deepwrite/restore-points";
/** Older restore points are pruned; each holds two compressed indexes. */
export const MAX_RESTORE_POINTS = 100;
const MAX_RESTORE_POINT_BYTES = 256 * 1024 * 1024;

export interface StoredRestorePoint {
  schemaVersion: 1;
  id: string;
  bookId: string;
  createdAt: string;
  beforeIndex: unknown;
  afterIndex: unknown;
  files: {
    path: string;
    before: string | null;
    afterSha256: string | null;
  }[];
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function parseStoredRestorePoint(
  value: unknown
): StoredRestorePoint | undefined {
  if (!value || typeof value !== "object") return undefined;
  const stored = value as Record<string, unknown>;
  if (
    stored.schemaVersion !== 1 ||
    typeof stored.id !== "string" ||
    typeof stored.bookId !== "string" ||
    typeof stored.createdAt !== "string" ||
    !Array.isArray(stored.files) ||
    !stored.files.every((file: unknown) => {
      const entry = file as Record<string, unknown> | null;
      return (
        !!entry &&
        typeof entry.path === "string" &&
        entry.path.length > 0 &&
        nullableString(entry.before) &&
        nullableString(entry.afterSha256)
      );
    })
  ) {
    return undefined;
  }
  return stored as unknown as StoredRestorePoint;
}

export interface RestoreBaseline {
  beforeIndex: LongWorkspaceIndexSnapshot;
  files: StoredRestorePoint["files"];
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

function contentPath(operation: ProjectTransactionFileOperation): boolean {
  return (
    operation.action !== "check" &&
    operation.path !== LONG_WORKSPACE_INDEX_PATH &&
    operation.path !== MANIFEST_PATH
  );
}

export function sha256Text(content: string): string {
  return projectTransactionContentSha256(Buffer.from(content, "utf8"));
}

export async function readProjectFileText(
  projectRoot: string,
  path: string
): Promise<string | null> {
  const bytes = await readRegularFileOptional(
    projectRoot,
    resolve(projectRoot, path),
    MAX_LEDGER_RECORD_BYTES
  );
  return bytes ? utf8.decode(bytes) : null;
}

/** Read what the batch is about to replace, before the transaction runs. */
export async function readRestoreBaseline(
  projectRoot: string,
  beforeIndex: LongWorkspaceIndexSnapshot,
  operations: readonly ProjectTransactionFileOperation[]
): Promise<RestoreBaseline | undefined> {
  const files: StoredRestorePoint["files"] = [];
  try {
    for (const operation of operations) {
      if (!contentPath(operation)) continue;
      files.push({
        path: operation.path,
        before: await readProjectFileText(projectRoot, operation.path),
        afterSha256:
          operation.action === "delete"
            ? null
            : operation.action === "check"
              ? operation.expectedSha256
              : sha256Text(operation.content)
      });
    }
  } catch {
    // An unreadable or non-UTF-8 file only costs the undo, never the save.
    return undefined;
  }
  return { beforeIndex, files };
}

function restorePointPath(id: string): string {
  return `${RESTORE_DIRECTORY}/${id}.json.gz`;
}

export async function saveRestorePoint(
  projectRoot: string,
  bookId: string,
  createdAt: string,
  baseline: RestoreBaseline,
  afterIndex: LongWorkspaceIndexSnapshot
): Promise<LongRestorePoint> {
  const id = `restore_${Date.now().toString(36)}${randomHex8()}`;
  const stored: StoredRestorePoint = {
    schemaVersion: 1,
    id,
    bookId,
    createdAt,
    beforeIndex: baseline.beforeIndex,
    afterIndex,
    files: baseline.files
  };
  const target = await resolveInternalWritableFile(
    projectRoot,
    restorePointPath(id)
  );
  await writeDurableNewFile(target, gzipSync(JSON.stringify(stored)));
  await pruneRestorePoints(projectRoot);
  return { id, createdAt };
}

async function pruneRestorePoints(projectRoot: string): Promise<void> {
  const directory = join(projectRoot, ...RESTORE_DIRECTORY.split("/"));
  const names = (await readdir(directory))
    .filter((name) => /^restore_[0-9a-z]+\.json\.gz$/u.test(name))
    .sort();
  for (const name of names.slice(0, -MAX_RESTORE_POINTS)) {
    await rm(join(directory, name), { force: true });
  }
}

function unavailable(): LongWorkspaceOperationError {
  return new LongWorkspaceOperationError(
    "restore_unavailable",
    "这次修改的还原记录已不存在，无法撤销。"
  );
}

export async function readRestorePoint(
  projectRoot: string,
  bookId: string,
  id: string
): Promise<StoredRestorePoint> {
  const bytes = await readRegularFileOptional(
    projectRoot,
    resolve(projectRoot, restorePointPath(id)),
    MAX_RESTORE_POINT_BYTES
  );
  if (!bytes) throw unavailable();
  let parsed: StoredRestorePoint | undefined;
  try {
    parsed = parseStoredRestorePoint(
      JSON.parse(gunzipSync(bytes).toString("utf8"))
    );
  } catch {
    parsed = undefined;
  }
  if (!parsed || parsed.id !== id || parsed.bookId !== bookId) {
    throw unavailable();
  }
  return parsed;
}

export async function removeRestorePoint(
  projectRoot: string,
  id: string
): Promise<void> {
  await rm(resolve(projectRoot, restorePointPath(id)), { force: true });
}
