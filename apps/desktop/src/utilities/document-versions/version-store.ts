import { createHash } from "node:crypto";
import { lstat, readdir, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { TextDecoder } from "node:util";
import { gunzipSync, gzipSync } from "node:zlib";
import { randomHex8 } from "@deepwrite/shared";
import {
  DOCUMENT_VERSION_LIMIT,
  DocumentVersionSummarySchema,
  DocumentVersionIndexSchema,
  type DocumentVersionIndex,
  type DocumentVersionCurrent,
  type DocumentVersionOrigin,
  type DocumentVersionSummary,
  type DocumentVersionTarget
} from "@deepwrite/contracts";
import {
  ensureSafeDirectory,
  isNodeError,
  readRegularFileOptional,
  secureProjectRoot,
  syncDirectory,
  writeDurableNewFile
} from "../project-transaction/io";
import {
  planDocumentVersionCapture,
  type VersionCaptureAction
} from "./capture-rules";
import { DocumentVersionError } from "./version-errors";

const MAX_INDEX_BYTES = 256 * 1024;
const StoredIndexSchema = DocumentVersionIndexSchema;
type StoredIndex = DocumentVersionIndex;

export function documentVersionCurrent(
  content: string
): DocumentVersionCurrent {
  let charCount = 0;
  for (const _character of content) charCount += 1;
  return {
    sha256: createHash("sha256").update(content, "utf8").digest("hex"),
    charCount
  };
}

export function documentVersionKey(target: DocumentVersionTarget): string {
  const id =
    target.workspace === "catalog"
      ? target.documentId
      : target.workspace === "mystery"
        ? target.targetKey
        : target.fileId;
  return createHash("sha256")
    .update(`${target.workspace}:${id}`)
    .digest("hex")
    .slice(0, 32);
}

/** All mutations run inside the document writer's lock, after its main commit. */
export class DocumentVersionStore {
  readonly directory: string;

  constructor(
    readonly projectDirectory: string,
    readonly target: DocumentVersionTarget,
    readonly maxBytes: number,
    private readonly now: () => string = () => new Date().toISOString()
  ) {
    this.directory = join(
      projectDirectory,
      ".deepwrite",
      "versions",
      documentVersionKey(target)
    );
  }

  private empty(): StoredIndex {
    return { schemaVersion: 1, target: this.target, nextSeq: 1, versions: [] };
  }

  private async secureDirectory(create: boolean): Promise<boolean> {
    await secureProjectRoot(this.projectDirectory);
    let path = this.projectDirectory;
    for (const part of [
      ".deepwrite",
      "versions",
      documentVersionKey(this.target)
    ]) {
      path = join(path, part);
      if (create) await ensureSafeDirectory(this.projectDirectory, path);
      else {
        const info = await lstat(path).catch((error: unknown) => {
          if (isNodeError(error, "ENOENT")) return undefined;
          throw error;
        });
        if (!info) return false;
        if (!info.isDirectory() || info.isSymbolicLink())
          throw new Error("版本目录必须是真实目录。");
      }
    }
    return true;
  }

  private async load(repair = false): Promise<StoredIndex> {
    if (!(await this.secureDirectory(false))) return this.empty();
    const path = join(this.directory, "index.json");
    let index: StoredIndex | undefined;
    try {
      const bytes = await readRegularFileOptional(
        this.projectDirectory,
        path,
        MAX_INDEX_BYTES
      );
      if (!bytes) return this.empty();
      const parsed = StoredIndexSchema.safeParse(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
      );
      if (parsed.success) {
        const candidate = parsed.data;
        const sorted = candidate.versions.every(
          (version, i) =>
            version.seq > (candidate.versions[i - 1]?.seq ?? 0) &&
            version.seq < candidate.nextSeq &&
            version.id.startsWith(`v${version.seq}-`)
        );
        if (
          sorted &&
          JSON.stringify(candidate.target) === JSON.stringify(this.target)
        )
          index = candidate;
      }
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return this.empty();
    }
    if (index) return index;
    if (repair) {
      await rename(
        path,
        join(
          this.directory,
          `index.corrupt-${this.now().replace(/[:.]/gu, "-")}-${randomHex8()}.json`
        )
      );
      await syncDirectory(this.directory);
    }
    return this.empty();
  }

  async list(): Promise<DocumentVersionSummary[]> {
    return [...(await this.load()).versions].reverse();
  }

  private async readContent(version: DocumentVersionSummary): Promise<string> {
    try {
      const bytes = await readRegularFileOptional(
        this.projectDirectory,
        join(this.directory, `${version.id}.md.gz`),
        this.maxBytes + 64 * 1024
      );
      if (!bytes) throw new Error("Missing version.");
      const plain = gunzipSync(bytes, { maxOutputLength: this.maxBytes });
      const content = new TextDecoder("utf-8", { fatal: true }).decode(plain);
      const current = documentVersionCurrent(content);
      if (
        current.sha256 !== version.sha256 ||
        current.charCount !== version.charCount
      )
        throw new Error("Version checksum mismatch.");
      return content;
    } catch {
      throw new DocumentVersionError(
        "version.unavailable",
        "这个版本的记录已损坏或不存在。"
      );
    }
  }

  async read(
    versionId: string
  ): Promise<{ version: DocumentVersionSummary; content: string }> {
    const index = await this.load();
    const version = index.versions.find(({ id }) => id === versionId);
    if (!version)
      throw new DocumentVersionError(
        "version.unavailable",
        "这个版本的记录已损坏或不存在。"
      );
    return { version, content: await this.readContent(version) };
  }

  async capture(
    before: string,
    after: string,
    origin: DocumentVersionOrigin
  ): Promise<DocumentVersionSummary | null> {
    return this.record(before, after, { origin });
  }

  async restore(
    before: string,
    after: string,
    restoredFromSeq: number
  ): Promise<DocumentVersionSummary | null> {
    return this.record(before, after, { restoredFromSeq });
  }

  private async record(
    before: string,
    after: string,
    source: { origin?: DocumentVersionOrigin; restoredFromSeq?: number }
  ): Promise<DocumentVersionSummary | null> {
    if (
      Buffer.byteLength(before, "utf8") > this.maxBytes ||
      Buffer.byteLength(after, "utf8") > this.maxBytes
    ) {
      console.warn(
        "[document-versions] Skipped history exceeding the document byte limit."
      );
      return null;
    }
    const index = await this.load(true);
    const latest = index.versions.at(-1);
    const content = latest
      ? await this.readContent(latest).catch(() => undefined)
      : undefined;
    const actions = planDocumentVersionCapture({
      before,
      after,
      ...source,
      ...(latest && content !== undefined
        ? { latest: { ...latest, content } }
        : {})
    });
    if (!actions.length) return null;
    await this.secureDirectory(true);
    let result: DocumentVersionSummary | null = null;
    for (const action of actions) result = await this.apply(index, action);
    index.versions = index.versions.slice(-DOCUMENT_VERSION_LIMIT);
    const serialized = `${JSON.stringify(StoredIndexSchema.parse(index), null, 2)}\n`;
    if (Buffer.byteLength(serialized, "utf8") > MAX_INDEX_BYTES)
      throw new Error("版本索引超过大小限制。");
    const temporary = join(this.directory, `index-${randomHex8()}.tmp`);
    await writeDurableNewFile(temporary, serialized);
    try {
      await rename(temporary, join(this.directory, "index.json"));
      await syncDirectory(this.directory);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
    // The new durable index is authoritative; failed cleanup is retried next time.
    const retained = new Set(index.versions.map(({ id }) => `${id}.md.gz`));
    for (const entry of await readdir(this.directory).catch(() => [])) {
      if (
        /^v[1-9]\d*-[0-9a-f]{8}\.md\.gz$/u.test(entry) &&
        !retained.has(entry)
      )
        await unlink(join(this.directory, entry)).catch(() => undefined);
    }
    return result;
  }

  private async apply(
    index: StoredIndex,
    action: VersionCaptureAction
  ): Promise<DocumentVersionSummary> {
    const previous =
      action.action === "update" ? index.versions.pop() : undefined;
    const seq = previous?.seq ?? index.nextSeq++;
    const timestamp = this.now();
    const version = DocumentVersionSummarySchema.parse({
      id: `v${seq}-${randomHex8()}`,
      seq,
      kind: action.kind,
      createdAt: previous?.createdAt ?? timestamp,
      updatedAt: timestamp,
      ...documentVersionCurrent(action.content),
      ...(action.origin ? { origin: action.origin } : {}),
      ...(action.reason ? { reason: action.reason } : {}),
      ...(action.restoredFromSeq
        ? { restoredFromSeq: action.restoredFromSeq }
        : {})
    });
    await writeDurableNewFile(
      join(this.directory, `${version.id}.md.gz`),
      gzipSync(Buffer.from(action.content, "utf8"))
    );
    await syncDirectory(dirname(join(this.directory, `${version.id}.md.gz`)));
    index.versions.push(version);
    return version;
  }
}

export async function captureDocumentVersions(
  store: DocumentVersionStore,
  before: string | Uint8Array,
  after: string,
  origin: DocumentVersionOrigin
): Promise<void> {
  try {
    await store.capture(
      typeof before === "string"
        ? before
        : new TextDecoder("utf-8", { fatal: true }).decode(before),
      after,
      origin
    );
  } catch (error) {
    console.warn(
      "[document-versions] Failed to capture saved document history.",
      error instanceof Error ? error.message : "unknown"
    );
  }
}
