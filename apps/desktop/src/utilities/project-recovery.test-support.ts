import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sha256Hex } from "@deepwrite/shared/node";

export async function stageRecovery(
  root: string,
  files: { path: string; content: string | null }[],
  phase: "prepared" | "committing" = "prepared"
) {
  const transactionId = "txn-123456-abcdef12";
  const prefix = `.deepwrite/transactions/${transactionId}`;
  await mkdir(join(root, prefix, "stage"), { recursive: true });
  await mkdir(join(root, prefix, "backup"), { recursive: true });
  const operations = [];
  for (const [index, file] of files.entries()) {
    const before = await readFile(join(root, file.path)).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      }
    );
    const backupPath = `${prefix}/backup/${index}.previous`;
    const stagePath =
      file.content === null ? null : `${prefix}/stage/${index}.next`;
    if (before !== null) await writeFile(join(root, backupPath), before);
    if (stagePath) await writeFile(join(root, stagePath), file.content!);
    operations.push({
      action: file.content === null ? "delete" : "write",
      path: file.path,
      stagePath,
      backupPath,
      beforeSha256: before === null ? null : sha256Hex(before),
      afterSha256: file.content === null ? null : sha256Hex(file.content)
    });
  }
  const journalPath = join(root, ".deepwrite/transaction.json");
  const journal = {
    schemaVersion: 1,
    transactionId,
    phase,
    appliedCount: 0,
    operations
  };
  await writeFile(journalPath, JSON.stringify(journal));
  return { journal, journalPath };
}
