import { access, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  LongMaterialPackIdSchema,
  LongMaterialPackRecordSchema,
  type LongMaterialPackRecord
} from "@deepwrite/contracts";
import {
  commitProjectTransaction,
  recoverProjectTransaction
} from "../project-transaction";
import {
  ensureSecureDirectory,
  readNoFollowFile
} from "../long-project-store/io";

const MAX_RECORD_BYTES = 8 * 1024 * 1024;

/**
 * Device-local conversion records under `<workspace>/long-material-packs/`.
 * They hold ids and hashes only; the material itself lives in the libraries.
 */
export class LongMaterialPackStore {
  readonly root: string;
  constructor(workspaceDirectory: string) {
    this.root = join(workspaceDirectory, "long-material-packs");
  }
  private file(id: string) {
    return `${LongMaterialPackIdSchema.parse(id)}.json`;
  }
  async read(id: string): Promise<LongMaterialPackRecord> {
    const root = await ensureSecureDirectory(this.root, "长篇转素材库记录目录");
    await recoverProjectTransaction(root, MAX_RECORD_BYTES);
    const { bytes } = await readNoFollowFile(
      join(root, this.file(id)),
      MAX_RECORD_BYTES,
      "转换记录",
      root
    );
    const record = LongMaterialPackRecordSchema.parse(
      JSON.parse(bytes.toString("utf8"))
    );
    if (record.id !== id) throw new Error("转换记录标识不一致。");
    return record;
  }
  async save(record: LongMaterialPackRecord): Promise<void> {
    await ensureSecureDirectory(this.root, "长篇转素材库记录目录");
    await commitProjectTransaction({
      projectRoot: this.root,
      maxFileBytes: MAX_RECORD_BYTES,
      operations: [
        {
          path: this.file(record.id),
          content: JSON.stringify(LongMaterialPackRecordSchema.parse(record))
        }
      ]
    });
  }
  async remove(id: string): Promise<void> {
    await ensureSecureDirectory(this.root, "长篇转素材库记录目录");
    await commitProjectTransaction({
      projectRoot: this.root,
      maxFileBytes: MAX_RECORD_BYTES,
      operations: [{ path: this.file(id), action: "delete" }]
    });
  }
  /** Every readable record; damaged files are skipped, never rewritten. */
  async list(): Promise<LongMaterialPackRecord[]> {
    try {
      await access(this.root);
    } catch {
      return [];
    }
    const records: LongMaterialPackRecord[] = [];
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      const id = entry.name.replace(/\.json$/u, "");
      if (
        !entry.isFile() ||
        !entry.name.endsWith(".json") ||
        !LongMaterialPackIdSchema.safeParse(id).success
      )
        continue;
      try {
        records.push(await this.read(id));
      } catch {
        // A record another version cannot parse stays on disk untouched.
      }
    }
    return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}
