import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const MAX_ENTRIES = 1_000;
const TARGET_FIELDS = [
  "action",
  "workId",
  "documentId",
  "libraryId",
  "entryId",
  "trashId"
] as const;

export interface AuditEntry {
  time: string;
  client: string;
  tool: string;
  target: Record<string, string>;
  result: string;
}

/** Records ids only: the text an agent wrote must not be copied into a log. */
export function auditTarget(
  args: Record<string, unknown>
): Record<string, string> {
  const target: Record<string, string> = {};
  for (const field of TARGET_FIELDS) {
    const value = args[field];
    if (typeof value === "string") target[field] = value.slice(0, 512);
  }
  return target;
}

export function createAuditLog(
  path: () => string,
  warn: (message: string) => void
) {
  async function ensureDirectory(): Promise<void> {
    await mkdir(dirname(path()), { recursive: true, mode: 0o700 });
  }

  return {
    /** Auditing must never turn a finished write into a reported failure. */
    async append(entry: AuditEntry): Promise<void> {
      try {
        await ensureDirectory();
        await appendFile(path(), `${JSON.stringify(entry)}\n`, {
          encoding: "utf8",
          mode: 0o600
        });
      } catch {
        warn("DeepWrite external control could not write its audit log.");
      }
    },
    async recent(count: number): Promise<AuditEntry[]> {
      try {
        const lines = (await readFile(path(), "utf8"))
          .split("\n")
          .filter(Boolean);
        return lines
          .slice(-count)
          .reverse()
          .map((line) => JSON.parse(line) as AuditEntry);
      } catch {
        return [];
      }
    },
    async trim(): Promise<void> {
      try {
        const lines = (await readFile(path(), "utf8"))
          .split("\n")
          .filter(Boolean);
        if (lines.length <= MAX_ENTRIES) return;
        await writeFile(
          path(),
          `${lines.slice(-MAX_ENTRIES).join("\n")}\n`,
          "utf8"
        );
      } catch (error: unknown) {
        if (!(
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        )) {
          warn("DeepWrite external control could not trim its audit log.");
        }
      }
    }
  };
}

export type AuditLog = ReturnType<typeof createAuditLog>;
