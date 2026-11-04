import {
  ExternalTrashRecordSchema,
  type ExternalTrashRecord
} from "@deepwrite/contracts/external-control";
import { randomUUID } from "node:crypto";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { readPrivateJson, writePrivateJson } from "./control-state-file";

export const TRASH_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1_000;
/** Ids arrive from agents, so only this exact shape may become a file name. */
const TRASH_ID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;

type NewTrashRecord = ExternalTrashRecord extends infer Record
  ? Record extends ExternalTrashRecord
    ? Omit<Record, "id" | "deletedAt">
    : never
  : never;

interface TrashStoreOptions {
  directory(): string;
  now?: () => Date;
}

export function trashExpiry(record: ExternalTrashRecord): string | null {
  // Project folders were never removed, so there is nothing to expire.
  if (record.kind === "project") return null;
  return new Date(
    Date.parse(record.deletedAt) + TRASH_RETENTION_DAYS * DAY_MS
  ).toISOString();
}

export function createTrashStore(options: TrashStoreOptions) {
  const now = options.now ?? (() => new Date());
  const filePath = (id: string) => join(options.directory(), `${id}.json`);

  async function list(): Promise<ExternalTrashRecord[]> {
    let names: string[];
    try {
      names = await readdir(options.directory());
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return [];
      throw error;
    }
    const records = await Promise.all(
      names
        .filter((name) => TRASH_ID_PATTERN.test(name.replace(/\.json$/u, "")))
        .map((name) =>
          readPrivateJson(
            join(options.directory(), name),
            ExternalTrashRecordSchema
          )
        )
    );
    return records
      .filter((record): record is ExternalTrashRecord => record !== undefined)
      .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  }

  return {
    list,
    async save(record: NewTrashRecord): Promise<ExternalTrashRecord> {
      const saved = ExternalTrashRecordSchema.parse({
        ...record,
        id: randomUUID(),
        deletedAt: now().toISOString()
      });
      await writePrivateJson(filePath(saved.id), saved);
      return saved;
    },
    async get(id: string): Promise<ExternalTrashRecord | undefined> {
      if (!TRASH_ID_PATTERN.test(id)) return undefined;
      return await readPrivateJson(filePath(id), ExternalTrashRecordSchema);
    },
    async remove(id: string): Promise<void> {
      if (TRASH_ID_PATTERN.test(id)) await rm(filePath(id), { force: true });
    },
    /** Project folders stay on disk; only the way back through here goes. */
    async clear(): Promise<void> {
      const records = await list();
      await Promise.all(
        records.map(({ id }) => rm(filePath(id), { force: true }))
      );
    },
    /** Called once per start, so a long-running app stays within a day or so. */
    async purgeExpired(): Promise<void> {
      const records = await list();
      const expired = records.filter((record) => {
        const expiry = trashExpiry(record);
        return expiry !== null && Date.parse(expiry) <= now().getTime();
      });
      await Promise.all(
        expired.map(({ id }) => rm(filePath(id), { force: true }))
      );
    }
  };
}

export type TrashStore = ReturnType<typeof createTrashStore>;
