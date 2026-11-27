import { randomUUID } from "node:crypto";
import { lstat, rename } from "node:fs/promises";
import {
  BOOK_IDENTITY_MAX_RECORD_BYTES,
  BookIdentityRecordSchema,
  type BookIdentityRecord,
  type ChatAssistantProjectRef
} from "@deepwrite/contracts";
import {
  AssetTransaction,
  cleanOrphanAssets,
  referencedAssets,
  removeAssets
} from "./assets";
import {
  writeIdentityFile,
  identityDirectory,
  identityFile,
  isMissing,
  readBytes
} from "./io";

export interface BookIdentityStoreOptions {
  resolveProject(book: ChatAssistantProjectRef): Promise<string>;
  now?: () => string;
  write?: typeof writeIdentityFile;
}

export interface IdentityMutationContext {
  directory: string;
  assets: AssetTransaction;
  deleteFiles: Set<string>;
}

/** Core-only semantic writes, serialized by the canonical project directory. */
export class BookIdentityStore {
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly recovered = new Map<string, string>();
  readonly now: () => string;
  private readonly write: typeof writeIdentityFile;

  constructor(private readonly options: BookIdentityStoreOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.write = options.write ?? writeIdentityFile;
  }

  private async queued<T>(
    book: ChatAssistantProjectRef,
    task: (directory: string) => Promise<T>
  ): Promise<T> {
    const directory = await identityDirectory(
      await this.options.resolveProject(book),
      false
    );
    const previous = this.queues.get(directory) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(() => task(directory));
    this.queues.set(directory, current);
    try {
      return await current;
    } finally {
      if (this.queues.get(directory) === current) this.queues.delete(directory);
    }
  }

  private empty(book: ChatAssistantProjectRef): BookIdentityRecord {
    return BookIdentityRecordSchema.parse({
      schemaVersion: 1,
      kind: "deepwrite.book-identity",
      bookId: book.projectId,
      revision: 0,
      updatedAt: this.now(),
      adopted: {},
      rounds: []
    });
  }

  private async load(
    book: ChatAssistantProjectRef,
    directory: string
  ): Promise<BookIdentityRecord> {
    const path = await identityFile(directory, "identity.json");
    let record: BookIdentityRecord;
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink())
        throw new Error("书名设计记录必须是普通文件。");
      let parsed:
        ReturnType<typeof BookIdentityRecordSchema.safeParse> | undefined;
      if (info.size <= BOOK_IDENTITY_MAX_RECORD_BYTES) {
        const bytes = await readBytes(path, BOOK_IDENTITY_MAX_RECORD_BYTES);
        try {
          parsed = BookIdentityRecordSchema.safeParse(
            JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
          );
        } catch {
          /* Retain malformed JSON and invalid UTF-8 for recovery. */
        }
      }
      if (!parsed?.success) {
        const backup = `identity.corrupt-${this.now().replace(/[:.]/g, "-")}-${randomUUID()}.json`;
        await rename(path, await identityFile(directory, backup));
        this.recovered.set(directory, backup);
        record = this.empty(book);
      } else {
        record = parsed.data;
        // Never infer asset ownership from a damaged or absent record.
        await cleanOrphanAssets(
          directory,
          record,
          new Date(this.now()).getTime()
        );
      }
    } catch (error) {
      if (!isMissing(error)) throw error;
      record = this.empty(book);
    }
    const corruptFile = this.recovered.get(directory);
    const foreignBookId =
      record.bookId !== book.projectId ? record.bookId : undefined;
    if (corruptFile || foreignBookId)
      record.diagnostics = {
        ...(corruptFile ? { corruptFile } : {}),
        ...(foreignBookId ? { foreignBookId } : {})
      };
    return record;
  }

  async get(book: ChatAssistantProjectRef): Promise<BookIdentityRecord> {
    return this.queued(book, (directory) => this.load(book, directory));
  }

  async read<T>(
    book: ChatAssistantProjectRef,
    reader: (record: BookIdentityRecord, directory: string) => Promise<T> | T
  ): Promise<T> {
    return this.queued(book, async (directory) =>
      reader(await this.load(book, directory), directory)
    );
  }

  async mutate(
    book: ChatAssistantProjectRef,
    change: (
      record: BookIdentityRecord,
      context: IdentityMutationContext
    ) => Promise<void> | void,
    inherit = false
  ): Promise<BookIdentityRecord> {
    return this.queued(book, async (directory) => {
      const record = await this.load(book, directory);
      if (record.bookId !== book.projectId && !inherit)
        throw new Error("记录来自其他作品，请先继承到本作品。");
      // Re-check the project root and all directory components before any write.
      const secured = await identityDirectory(
        await this.options.resolveProject(book),
        true
      );
      if (secured !== directory)
        throw new Error("作品目录在操作期间发生变化。");
      const assets = new AssetTransaction(directory, this.write);
      const context = { directory, assets, deleteFiles: new Set<string>() };
      try {
        await change(record, context);
        record.bookId = book.projectId;
        record.revision += 1;
        record.updatedAt = this.now();
        delete record.diagnostics;
        const validated = BookIdentityRecordSchema.parse(record);
        const serialized = `${JSON.stringify(validated, null, 2)}\n`;
        if (Buffer.byteLength(serialized) > BOOK_IDENTITY_MAX_RECORD_BYTES)
          throw new Error("设计记录超过 4 MB，请先清理旧记录。");
        await this.write(
          await identityFile(directory, "identity.json"),
          serialized
        );
        this.recovered.delete(directory);
      } catch (error) {
        try {
          await assets.rollback();
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            "设计记录保存失败，且封面文件回滚失败。"
          );
        }
        throw error;
      }
      // The durable record is authoritative. A failed cleanup is retried as an orphan.
      try {
        const retained = referencedAssets(record);
        await removeAssets(
          directory,
          [...context.deleteFiles].filter((file) => !retained.has(file))
        );
      } catch {
        /* Do not report a committed operation as failed. */
      }
      return record;
    });
  }

  async inherit(book: ChatAssistantProjectRef): Promise<BookIdentityRecord> {
    return this.mutate(book, () => undefined, true);
  }
}
