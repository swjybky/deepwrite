import { mkdir, unlink } from "node:fs/promises";
import { join, resolve, relative, isAbsolute } from "node:path";
import { LibraryStructureTransactionJournalSchema as JournalSchema } from "@deepwrite/contracts";
import {
  atomicWriteJson,
  readOptionalUtf8File,
  secureProjectRoot
} from "./paths-io";
import {
  commitProjectTransaction,
  recoverProjectTransaction,
  projectTransactionContentSha256 as sha,
  type ProjectTransactionFileOperation
} from "../project-transaction";
import { readNoFollowFile } from "../long-project-store/io";

const LIMIT = 128 * 1024 * 1024;
export interface StructureTransactionRoot {
  root: string;
  files: ProjectTransactionFileOperation[];
}
const journalPath = (userData: string) =>
  join(userData, "library-structure-transaction.json");

async function currentSha(root: string, path: string): Promise<string | null> {
  // The existing no-follow reader enforces root containment and symlink safety.
  const target = resolve(root, path);
  const offset = relative(root, target);
  if (!offset || offset.startsWith("..") || isAbsolute(offset))
    throw new Error("Invalid transaction path.");
  try {
    return sha(
      (await readNoFollowFile(target, LIMIT, "organization file", root)).bytes
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** The catalog lock prevents readers observing partial cross-project commits.
 * A durable coordinator rolls forward each existing per-project transaction on restart. */
export async function recoverStructureTransaction(
  userData: string
): Promise<void> {
  const text = await readOptionalUtf8File(
    journalPath(userData),
    LIMIT,
    "library organization journal"
  );
  if (!text) return;
  const journal = JournalSchema.parse(JSON.parse(text));
  for (const item of journal.roots) {
    const root = await secureProjectRoot(item.root);
    await recoverProjectTransaction(root);
    const pending: ProjectTransactionFileOperation[] = [];
    for (const file of item.files) {
      const current = await currentSha(root, file.path);
      const after =
        file.action === "write"
          ? sha(file.content)
          : file.action === "check"
            ? file.expectedSha256
            : null;
      if (current === after) continue;
      if (current !== file.expectedSha256)
        throw new Error(`整理事务遇到外部修改，保留恢复记录：${file.path}`);
      pending.push(file);
    }
    if (pending.length)
      await commitProjectTransaction({
        projectRoot: root,
        operations: pending,
        maxFileBytes: LIMIT
      });
  }
  await unlink(journalPath(userData));
}

export async function commitStructureTransaction(
  userData: string,
  roots: StructureTransactionRoot[]
): Promise<void> {
  await recoverStructureTransaction(userData);
  for (const item of roots) {
    await mkdir(item.root, { recursive: true, mode: 0o700 });
    const root = await secureProjectRoot(item.root);
    for (const file of item.files) {
      if (file.expectedSha256 === undefined)
        throw new Error("整理事务缺少文件版本。");
      if ((await currentSha(root, file.path)) !== file.expectedSha256)
        throw new Error(`整理前文件已更新：${file.path}`);
    }
  }
  const journal = JournalSchema.parse({ version: 1, roots });
  await atomicWriteJson(journalPath(userData), journal, LIMIT);
  await recoverStructureTransaction(userData);
}
