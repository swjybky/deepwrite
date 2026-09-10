import { createHash } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Keep the exact pre-migration records independently of active history limits. */
export async function backupRendererStateHistory(
  statePath: string,
  entries: ReadonlyMap<string, unknown>
): Promise<void> {
  const serialized = `${JSON.stringify({ version: 1, entries: Object.fromEntries(entries) })}\n`;
  const digest = createHash("sha256").update(serialized).digest("hex");
  const directory = join(dirname(statePath), "history-migration-backups");
  const destination = join(directory, `${digest}.json`);
  try {
    if ((await readFile(destination, "utf8")) === serialized) return;
    throw new Error(
      "History migration backup does not match its original records."
    );
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${destination}.tmp-${process.pid}`;
  try {
    await writeFile(temporary, serialized, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, destination);
  } finally {
    await unlink(temporary).catch((error: unknown) => {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    });
  }
}
