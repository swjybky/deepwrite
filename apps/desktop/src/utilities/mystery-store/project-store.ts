import { constants } from "node:fs";
import { cp, lstat, mkdir, readdir, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  CreateMysteryBookInputSchema,
  MYSTERY_AGENTS_MD_MAX_CHARACTERS,
  MYSTERY_DOCUMENT_MAX_CHARACTERS,
  MysteryApplyOperationsInputSchema,
  MysteryApplyOperationsResultSchema,
  MysteryBoardSpecSchema,
  MysteryBookManifestSchema,
  MysteryDocumentTargetSchema,
  MysteryOpenBookResultSchema,
  MysteryOperationBatchSchema,
  MysteryPreviewOperationsResultSchema,
  MysteryReadAgentsMdResultSchema,
  MysteryReadDocumentInputSchema,
  MysteryReadDocumentResultSchema,
  MysteryRestoreOperationsResultSchema,
  MysteryRestorePointSchema,
  MysterySearchInputSchema,
  MysterySearchResultSchema,
  MysteryWorkspaceIndexSnapshotSchema,
  MysteryWorkspaceOperationError,
  MysteryWriteAgentsMdResultSchema,
  MysteryWriteDocumentInputSchema,
  MysteryWriteDocumentResultSchema,
  createDefaultMysteryTruthDocuments,
  isMysteryPlayerVisibleTarget,
  mysteryCharCount,
  mysteryDocumentExistsInManifest,
  mysteryDocumentRelativePath,
  mysteryDocumentTargetKey,
  mysteryDocumentTitle,
  mysteryStageForTarget,
  mysteryTextRevision,
  previewMysteryWorkspaceOperations,
  summarizeMysteryBook,
  type CreateMysteryBookInput,
  type DocumentVersionOrigin,
  type MysteryApplyOperationsInput,
  type MysteryApplyOperationsResult,
  type MysteryBookManifest,
  type MysteryBookSummary,
  type MysteryDeletedDocumentSnapshot,
  type MysteryDocumentTarget,
  type MysteryOpenBookResult,
  type MysteryOperationBatch,
  type MysteryPreviewOperationsResult,
  type MysteryReadAgentsMdResult,
  type MysteryReadDocumentInput,
  type MysteryReadDocumentResult,
  type MysteryRestoreOperationsResult,
  type MysteryRestorePoint,
  type MysterySearchHit,
  type MysterySearchInput,
  type MysterySearchResult,
  type MysteryWorkspaceIndexSnapshot,
  type MysteryWriteAgentsMdResult,
  type MysteryWriteDocumentInput,
  type MysteryWriteDocumentResult
} from "@deepwrite/contracts";
import {
  createId,
  nowIso,
  randomHex8,
  escapeRegExp,
  toJsonFileText
} from "@deepwrite/shared";
import { nextCopyTitle } from "../copy-title";
import { DocumentVersionError } from "../document-versions/version-errors";
import {
  DocumentVersionStore,
  documentVersionCurrent
} from "../document-versions/version-store";
import { availableProjectDirectory } from "../folder-catalog-store/paths-io";
import {
  ensureSecureDirectory,
  readNoFollowFile,
  requireMissing,
  secureDirectory
} from "../long-project-store/io";
import {
  commitProjectTransaction,
  recoverProjectTransaction,
  type ProjectTransactionFileOperation
} from "../project-transaction";
import {
  readRegularFileOptional,
  resolveInternalWritableFile,
  writeDurableNewFile
} from "../project-transaction/io";
import {
  DEFAULT_MYSTERY_AGENTS_MD,
  MYSTERY_MANIFEST_FILE,
  MYSTERY_MAX_AGENTS_MD_BYTES,
  MYSTERY_MAX_FILE_BYTES,
  MYSTERY_MAX_MANIFEST_BYTES,
  MYSTERY_RESTORE_DIR,
  MysteryDocumentConflictError,
  listMysteryManifestTargets
} from "./types";
import { isNodeError, sha256Hex } from "@deepwrite/shared/node";

const CN_ACT_NUMERALS = [
  "一",
  "二",
  "三",
  "四",
  "五",
  "六",
  "七",
  "八",
  "九",
  "十"
] as const;

function defaultActTitle(index: number, total: number): string {
  if (total === 1) return "完整剧本";
  const numeral = CN_ACT_NUMERALS[index];
  return numeral ? `第${numeral}幕` : `第 ${index + 1} 幕`;
}

function buildSearchSnippet(
  content: string,
  query: string
): {
  count: number;
  snippet: string;
} {
  const regex = new RegExp(escapeRegExp(query), "giu");
  const matches = [...content.matchAll(regex)];
  if (matches.length === 0) return { count: 0, snippet: "" };
  const first = matches[0]!;
  const index = first.index ?? 0;
  const start = Math.max(0, index - 60);
  const end = Math.min(content.length, index + query.length + 100);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < content.length ? "…" : "";
  return {
    count: matches.length,
    snippet:
      `${prefix}${content.slice(start, end).replace(/\s+/gu, " ").trim()}${suffix}`.slice(
        0,
        380
      )
  };
}

function sliceCodePoints(
  content: string,
  offset = 0,
  limit?: number
): { slice: string; totalCharacters: number; hasMore: boolean } {
  const chars = Array.from(content);
  const totalCharacters = chars.length;
  const safeOffset = Math.min(offset, totalCharacters);
  const end =
    limit === undefined
      ? totalCharacters
      : Math.min(totalCharacters, safeOffset + limit);
  return {
    slice: chars.slice(safeOffset, end).join(""),
    totalCharacters,
    hasMore: end < totalCharacters
  };
}

export interface MysteryProjectStoreOptions {
  now?: () => string;
}

export class MysteryProjectStore {
  private readonly now: () => string;
  private readonly queues = new Map<string, Promise<void>>();

  constructor(options: MysteryProjectStoreOptions = {}) {
    this.now = options.now ?? nowIso;
  }

  private timestamp(): string {
    return this.now();
  }

  private async runExclusive<T>(
    key: string,
    task: () => Promise<T>
  ): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    const tail = previous.catch(() => undefined).then(() => gate);
    this.queues.set(key, tail);
    await previous.catch(() => undefined);
    try {
      return await task();
    } finally {
      release();
      if (this.queues.get(key) === tail) this.queues.delete(key);
    }
  }

  private async readOptionalText(
    projectDirectory: string,
    relativePath: string,
    maxBytes = MYSTERY_MAX_FILE_BYTES
  ): Promise<{ exists: boolean; content: string; sha256: string | null }> {
    const target = resolve(projectDirectory, relativePath);
    try {
      const { bytes } = await readNoFollowFile(
        target,
        maxBytes,
        relativePath,
        projectDirectory
      );
      const content = bytes.toString("utf8");
      return {
        exists: true,
        content,
        sha256: sha256Hex(bytes)
      };
    } catch (error: unknown) {
      if (isNodeError(error, "ENOENT")) {
        return { exists: false, content: "", sha256: null };
      }
      throw error;
    }
  }

  private async loadManifestLocked(projectDirectory: string): Promise<{
    manifest: MysteryBookManifest;
    manifestSha256: string;
  }> {
    await recoverProjectTransaction(projectDirectory);
    const { bytes } = await readNoFollowFile(
      resolve(projectDirectory, MYSTERY_MANIFEST_FILE),
      MYSTERY_MAX_MANIFEST_BYTES,
      MYSTERY_MANIFEST_FILE,
      projectDirectory
    );
    const raw = JSON.parse(bytes.toString("utf8")) as unknown;
    return {
      manifest: MysteryBookManifestSchema.parse(raw),
      manifestSha256: sha256Hex(bytes)
    };
  }

  private async buildWorkspaceIndexLocked(
    projectDirectory: string,
    manifest: MysteryBookManifest
  ): Promise<MysteryWorkspaceIndexSnapshot> {
    const readStats = async (target: MysteryDocumentTarget) => {
      const file = await this.readOptionalText(
        projectDirectory,
        mysteryDocumentRelativePath(target),
        target.kind === "agents_md"
          ? MYSTERY_MAX_AGENTS_MD_BYTES
          : MYSTERY_MAX_FILE_BYTES
      );
      return {
        charCount: mysteryCharCount(file.content),
        revision: mysteryTextRevision(file.content),
        updatedAt: manifest.updatedAt
      };
    };

    const [agentsMd, relations, publicOpenings, endings, dmManual] =
      await Promise.all([
        readStats({ kind: "agents_md" }),
        readStats({ kind: "character_relations" }),
        readStats({ kind: "public_doc", docId: "public_openings" }),
        readStats({ kind: "public_doc", docId: "endings" }),
        readStats({ kind: "dm_manual" })
      ]);

    const truthDocuments = await Promise.all(
      [...manifest.truthDocuments]
        .sort((a, b) => a.order - b.order)
        .map(async (doc) => {
          const stats = await readStats({ kind: "truth_doc", docId: doc.id });
          return {
            ...doc,
            charCount: stats.charCount,
            revision: stats.revision
          };
        })
    );

    const sortedRoles = [...manifest.roles].sort((a, b) => a.order - b.order);
    const sortedActs = [...manifest.acts].sort((a, b) => a.order - b.order);

    const roles = await Promise.all(
      sortedRoles.map(async (role) => {
        const [profile, pitch] = await Promise.all([
          readStats({ kind: "role", roleId: role.id, document: "profile" }),
          readStats({ kind: "role", roleId: role.id, document: "pitch" })
        ]);
        return {
          ...role,
          profileChars: profile.charCount,
          pitchChars: pitch.charCount,
          profileRevision: profile.revision,
          pitchRevision: pitch.revision
        };
      })
    );

    const actMatrix = (
      await Promise.all(
        sortedRoles.flatMap((role) =>
          sortedActs.map(async (act) => {
            const [brief, body] = await Promise.all([
              readStats({
                kind: "player_act",
                roleId: role.id,
                actId: act.id,
                document: "brief"
              }),
              readStats({
                kind: "player_act",
                roleId: role.id,
                actId: act.id,
                document: "body"
              })
            ]);
            return {
              roleId: role.id,
              actId: act.id,
              briefChars: brief.charCount,
              bodyChars: body.charCount,
              briefRevision: brief.revision,
              bodyRevision: body.revision
            };
          })
        )
      )
    ).flat();

    const clueRounds = await Promise.all(
      [...manifest.clueRounds]
        .sort((a, b) => a.order - b.order)
        .map(async (round) => {
          const stats = await readStats({
            kind: "clue_round",
            roundId: round.id
          });
          return {
            ...round,
            charCount: stats.charCount,
            revision: stats.revision
          };
        })
    );

    return MysteryWorkspaceIndexSnapshotSchema.parse({
      bookId: manifest.id,
      title: manifest.title,
      genre: manifest.genre,
      status: manifest.status,
      boardSpec: manifest.boardSpec,
      revision: manifest.revision,
      updatedAt: manifest.updatedAt,
      agentsMdChars: agentsMd.charCount,
      agentsMdRevision: agentsMd.revision,
      truthDocuments,
      characterRelations: relations,
      roles,
      acts: sortedActs,
      actMatrix,
      clueRounds,
      publicOpenings,
      endings,
      dmManual
    });
  }

  private async recordDocumentVersion(
    projectDirectory: string,
    bookId: string,
    target: MysteryDocumentTarget,
    before: string,
    after: string,
    origin: DocumentVersionOrigin | undefined
  ): Promise<void> {
    if (!origin) return;
    try {
      const store = new DocumentVersionStore(
        projectDirectory,
        {
          workspace: "mystery",
          bookId,
          targetKey: mysteryDocumentTargetKey(target),
          target
        },
        MYSTERY_MAX_FILE_BYTES,
        this.now
      );
      await store.capture(before, after, origin);
    } catch (error) {
      console.warn(
        "[mystery-store] Failed to capture document version:",
        error instanceof Error ? error.message : "unknown"
      );
    }
  }

  async createBook(
    parentDirectory: string,
    rawInput: CreateMysteryBookInput
  ): Promise<MysteryOpenBookResult> {
    const input = CreateMysteryBookInputSchema.parse(rawInput);
    const parent = await ensureSecureDirectory(
      parentDirectory,
      "剧本杀项目父目录"
    );
    const createdAt = this.timestamp();
    const boardSpec = MysteryBoardSpecSchema.parse(input.boardSpec ?? {});
    const roles = Array.from({ length: boardSpec.playerCount }, (_, index) => ({
      id: `role_${index + 1}`,
      name: `角色 ${index + 1}`,
      tag: "",
      order: index + 1
    }));
    const acts = Array.from(
      { length: boardSpec.actCountTarget },
      (_, index) => ({
        id: `act_${index + 1}`,
        title: defaultActTitle(index, boardSpec.actCountTarget),
        order: index + 1
      })
    );
    const manifest = MysteryBookManifestSchema.parse({
      kind: "deepwrite.mystery-book",
      schemaVersion: 1,
      id: createId("mys"),
      title: input.title,
      genre: input.genre,
      status: "editing",
      boardSpec,
      linkedMaterialIds: input.linkedMaterialIds ?? [],
      linkedSkillIds: input.linkedSkillIds ?? [],
      truthDocuments: createDefaultMysteryTruthDocuments(),
      roles,
      acts,
      clueRounds: [
        { id: "round_1", title: "第一轮搜证", order: 1 },
        { id: "round_2", title: "第二轮搜证", order: 2 }
      ],
      revision: 0,
      createdAt,
      updatedAt: createdAt
    });

    const staging = join(parent, `.mystery-stage-${randomHex8()}`);
    await mkdir(staging, { recursive: true, mode: 0o700 });
    let promoted = false;
    try {
      const operations: ProjectTransactionFileOperation[] = [
        {
          path: MYSTERY_MANIFEST_FILE,
          content: toJsonFileText(manifest),
          expectedSha256: null
        },
        ...listMysteryManifestTargets(manifest).map((target) => ({
          path: mysteryDocumentRelativePath(target),
          content: target.kind === "agents_md" ? DEFAULT_MYSTERY_AGENTS_MD : "",
          expectedSha256: null
        }))
      ];
      await commitProjectTransaction({
        projectRoot: staging,
        operations,
        maxFileBytes: MYSTERY_MAX_FILE_BYTES
      });
      const finalDir = await availableProjectDirectory(parent, input.title);
      await rename(staging, finalDir);
      promoted = true;
      return await this.openBook(finalDir);
    } finally {
      if (!promoted) {
        await rm(staging, { recursive: true, force: true }).catch(
          () => undefined
        );
      }
    }
  }

  async inspectBook(projectDirectory: string): Promise<{
    bookId: string;
    summary: MysteryBookSummary;
  }> {
    const root = await secureDirectory(projectDirectory, "剧本杀项目目录");
    return await this.runExclusive(root, async () => {
      const { manifest } = await this.loadManifestLocked(root);
      return {
        bookId: manifest.id,
        summary: summarizeMysteryBook(manifest)
      };
    });
  }

  async openBook(projectDirectory: string): Promise<MysteryOpenBookResult> {
    const root = await secureDirectory(projectDirectory, "剧本杀项目目录");
    return await this.runExclusive(root, async () => {
      const { manifest } = await this.loadManifestLocked(root);
      const workspaceIndex = await this.buildWorkspaceIndexLocked(
        root,
        manifest
      );
      return MysteryOpenBookResultSchema.parse({
        book: manifest,
        summary: summarizeMysteryBook(manifest),
        workspaceIndex,
        projectDirectory: root
      });
    });
  }

  async deleteBook(
    projectDirectory: string,
    bookId: string,
    unregister: () => Promise<void>
  ): Promise<void> {
    const root = await secureDirectory(projectDirectory, "剧本杀项目目录");
    await this.runExclusive(root, async () => {
      const { manifest } = await this.loadManifestLocked(root);
      if (manifest.id !== bookId) {
        throw new Error("剧本杀项目标识与注册信息不一致。");
      }
      const staged = join(dirname(root), `.deepwrite-deleting-${randomHex8()}`);
      await rename(root, staged);
      try {
        const stagedRoot = await secureDirectory(staged, "剧本杀项目目录");
        const moved = await this.loadManifestLocked(stagedRoot);
        if (moved.manifest.id !== bookId) {
          throw new Error("剧本杀项目标识与注册信息不一致。");
        }
        await unregister();
      } catch (error: unknown) {
        try {
          await requireMissing(root, "原项目目录已被占用。");
          await rename(staged, root);
        } catch (rollbackError: unknown) {
          throw new AggregateError(
            [error, rollbackError],
            "剧本杀作品删除失败，且无法恢复原目录位置。"
          );
        }
        throw error;
      }
      await Promise.allSettled([rm(staged, { recursive: true, force: true })]);
    });
  }

  async readDocument(
    projectDirectory: string,
    rawInput: MysteryReadDocumentInput
  ): Promise<MysteryReadDocumentResult> {
    const input = MysteryReadDocumentInputSchema.parse(rawInput);
    const root = await secureDirectory(projectDirectory, "剧本杀项目目录");
    return await this.runExclusive(root, async () => {
      const { manifest } = await this.loadManifestLocked(root);
      if (manifest.id !== input.bookId) {
        throw new Error("剧本杀项目标识与注册信息不一致。");
      }
      if (!mysteryDocumentExistsInManifest(manifest, input.target)) {
        throw new MysteryWorkspaceOperationError(
          "not_found",
          `目标文档不存在：${mysteryDocumentTargetKey(input.target)}`
        );
      }
      const maxBytes =
        input.target.kind === "agents_md"
          ? MYSTERY_MAX_AGENTS_MD_BYTES
          : MYSTERY_MAX_FILE_BYTES;
      const file = await this.readOptionalText(
        root,
        mysteryDocumentRelativePath(input.target),
        maxBytes
      );
      const sliced = sliceCodePoints(file.content, input.offset, input.limit);
      return MysteryReadDocumentResultSchema.parse({
        bookId: manifest.id,
        target: input.target,
        content: sliced.slice,
        totalCharacters: sliced.totalCharacters,
        offset: Math.min(input.offset ?? 0, sliced.totalCharacters),
        hasMore: sliced.hasMore,
        revision: mysteryTextRevision(file.content),
        updatedAt: manifest.updatedAt
      });
    });
  }

  async writeDocument(
    projectDirectory: string,
    rawInput: MysteryWriteDocumentInput
  ): Promise<MysteryWriteDocumentResult> {
    const input = MysteryWriteDocumentInputSchema.parse(rawInput);
    const root = await secureDirectory(projectDirectory, "剧本杀项目目录");
    return await this.runExclusive(root, async () =>
      this.writeDocumentLocked(root, input)
    );
  }

  private async writeDocumentLocked(
    root: string,
    input: MysteryWriteDocumentInput,
    options?: {
      expectedSha256?: string;
      afterCommit?: (before: string) => Promise<void>;
    }
  ): Promise<MysteryWriteDocumentResult> {
    const { manifest, manifestSha256 } = await this.loadManifestLocked(root);
    if (manifest.id !== input.bookId) {
      throw new Error("剧本杀项目标识与注册信息不一致。");
    }
    if (!mysteryDocumentExistsInManifest(manifest, input.target)) {
      throw new MysteryWorkspaceOperationError(
        "not_found",
        `写入目标不存在：${mysteryDocumentTargetKey(input.target)}`
      );
    }
    const relPath = mysteryDocumentRelativePath(input.target);
    const maxBytes =
      input.target.kind === "agents_md"
        ? MYSTERY_MAX_AGENTS_MD_BYTES
        : MYSTERY_MAX_FILE_BYTES;
    const current = await this.readOptionalText(root, relPath, maxBytes);
    const currentRevision = mysteryTextRevision(current.content);
    if (
      input.expectedRevision !== undefined &&
      input.expectedRevision !== currentRevision
    ) {
      throw new MysteryDocumentConflictError();
    }
    if (
      options?.expectedSha256 !== undefined &&
      documentVersionCurrent(current.content).sha256 !== options.expectedSha256
    ) {
      throw new DocumentVersionError("version.conflict", "当前内容已变化。");
    }
    const maxChars =
      input.target.kind === "agents_md"
        ? MYSTERY_AGENTS_MD_MAX_CHARACTERS
        : MYSTERY_DOCUMENT_MAX_CHARACTERS;
    if (mysteryCharCount(input.content) > maxChars) {
      throw new Error(`文档内容超过 ${maxChars} 字符限制。`);
    }

    const updatedAt = this.timestamp();
    const nextManifest = MysteryBookManifestSchema.parse({
      ...manifest,
      revision: manifest.revision + 1,
      updatedAt
    });
    const operations: ProjectTransactionFileOperation[] = [
      {
        path: relPath,
        content: input.content,
        expectedSha256: current.sha256
      },
      {
        path: MYSTERY_MANIFEST_FILE,
        content: toJsonFileText(nextManifest),
        expectedSha256: manifestSha256
      }
    ];
    await commitProjectTransaction(
      {
        projectRoot: root,
        operations,
        maxFileBytes: MYSTERY_MAX_FILE_BYTES
      },
      options?.afterCommit
        ? () => options.afterCommit!(current.content)
        : undefined
    );
    if (!options?.afterCommit) {
      await this.recordDocumentVersion(
        root,
        manifest.id,
        input.target,
        current.content,
        input.content,
        input.versionOrigin
      );
    }
    return MysteryWriteDocumentResultSchema.parse({
      bookId: manifest.id,
      target: input.target,
      revision: mysteryTextRevision(input.content),
      charCount: mysteryCharCount(input.content),
      updatedAt,
      summary: summarizeMysteryBook(nextManifest)
    });
  }

  async readAgentsMd(
    projectDirectory: string,
    bookId: string
  ): Promise<MysteryReadAgentsMdResult> {
    const result = await this.readDocument(projectDirectory, {
      bookId,
      target: { kind: "agents_md" }
    });
    return MysteryReadAgentsMdResultSchema.parse({
      bookId: result.bookId,
      content: result.content,
      revision: result.revision,
      updatedAt: result.updatedAt
    });
  }

  async writeAgentsMd(
    projectDirectory: string,
    bookId: string,
    content: string,
    expectedRevision?: string
  ): Promise<MysteryWriteAgentsMdResult> {
    const written = await this.writeDocument(projectDirectory, {
      bookId,
      target: { kind: "agents_md" },
      content,
      ...(expectedRevision ? { expectedRevision } : {})
    });
    return MysteryWriteAgentsMdResultSchema.parse({
      bookId: written.bookId,
      content,
      revision: written.revision,
      updatedAt: written.updatedAt
    });
  }

  async renameBook(
    projectDirectory: string,
    bookId: string,
    title: string
  ): Promise<MysteryOpenBookResult> {
    const root = await secureDirectory(projectDirectory, "剧本杀项目目录");
    await this.runExclusive(root, async () => {
      const { manifest, manifestSha256 } = await this.loadManifestLocked(root);
      if (manifest.id !== bookId) {
        throw new Error("剧本杀项目标识与注册信息不一致。");
      }
      const nextManifest = MysteryBookManifestSchema.parse({
        ...manifest,
        title,
        revision: manifest.revision + 1,
        updatedAt: this.timestamp()
      });
      await commitProjectTransaction({
        projectRoot: root,
        operations: [
          {
            path: MYSTERY_MANIFEST_FILE,
            content: toJsonFileText(nextManifest),
            expectedSha256: manifestSha256
          }
        ],
        maxFileBytes: MYSTERY_MAX_MANIFEST_BYTES
      });
    });
    return await this.openBook(root);
  }

  async updateBindings(
    projectDirectory: string,
    bookId: string,
    linkedMaterialIds: string[],
    linkedSkillIds: string[]
  ): Promise<MysteryOpenBookResult> {
    const root = await secureDirectory(projectDirectory, "剧本杀项目目录");
    await this.runExclusive(root, async () => {
      const { manifest, manifestSha256 } = await this.loadManifestLocked(root);
      if (manifest.id !== bookId) {
        throw new Error("剧本杀项目标识与注册信息不一致。");
      }
      const nextManifest = MysteryBookManifestSchema.parse({
        ...manifest,
        linkedMaterialIds,
        linkedSkillIds,
        revision: manifest.revision + 1,
        updatedAt: this.timestamp()
      });
      await commitProjectTransaction({
        projectRoot: root,
        operations: [
          {
            path: MYSTERY_MANIFEST_FILE,
            content: toJsonFileText(nextManifest),
            expectedSha256: manifestSha256
          }
        ],
        maxFileBytes: MYSTERY_MAX_MANIFEST_BYTES
      });
    });
    return await this.openBook(root);
  }

  async previewOperations(
    projectDirectory: string,
    bookId: string,
    rawBatch: MysteryOperationBatch
  ): Promise<MysteryPreviewOperationsResult> {
    const batch = MysteryOperationBatchSchema.parse(rawBatch);
    const root = await secureDirectory(projectDirectory, "剧本杀项目目录");
    return await this.runExclusive(root, async () => {
      const { manifest } = await this.loadManifestLocked(root);
      if (manifest.id !== bookId) {
        throw new Error("剧本杀项目标识与注册信息不一致。");
      }
      const index = await this.buildWorkspaceIndexLocked(root, manifest);
      const preview = previewMysteryWorkspaceOperations(manifest, index, batch);
      return MysteryPreviewOperationsResultSchema.parse({
        workspaceIndex: preview.workspaceIndex,
        structureChanges: preview.structureChanges
      });
    });
  }

  async applyOperations(
    projectDirectory: string,
    rawInput: MysteryApplyOperationsInput
  ): Promise<MysteryApplyOperationsResult> {
    const input = MysteryApplyOperationsInputSchema.parse(rawInput);
    const root = await secureDirectory(projectDirectory, "剧本杀项目目录");
    return await this.runExclusive(root, async () => {
      const { manifest, manifestSha256 } = await this.loadManifestLocked(root);
      if (manifest.id !== input.bookId) {
        throw new Error("剧本杀项目标识与注册信息不一致。");
      }
      if (
        input.expectedBookRevision !== undefined &&
        manifest.revision !== input.expectedBookRevision
      ) {
        throw new MysteryDocumentConflictError(
          "作品版本已变化，请刷新后重试。"
        );
      }
      const index = await this.buildWorkspaceIndexLocked(root, manifest);
      const preview = previewMysteryWorkspaceOperations(
        manifest,
        index,
        input.batch
      );

      const currentTargets = listMysteryManifestTargets(manifest);
      const nextTargets = listMysteryManifestTargets(preview.manifest);
      const currentByKey = new Map(
        currentTargets.map((t) => [mysteryDocumentTargetKey(t), t])
      );
      const nextByKey = new Map(
        nextTargets.map((t) => [mysteryDocumentTargetKey(t), t])
      );

      const writeByKey = new Map(
        input.batch.documentWrites.map((w) => [
          mysteryDocumentTargetKey(w.target),
          w
        ])
      );

      // Seed initial content supplied via create operations if not explicitly overridden in documentWrites.
      const seedContentByKey = new Map<string, string>();
      for (const op of input.batch.operations) {
        if (op.type === "truthDoc.create" && op.doc.content !== undefined) {
          seedContentByKey.set(
            mysteryDocumentTargetKey({
              kind: "truth_doc",
              docId: op.doc.id
            }),
            op.doc.content
          );
        } else if (op.type === "role.create") {
          if (op.role.profileContent !== undefined) {
            seedContentByKey.set(
              mysteryDocumentTargetKey({
                kind: "role",
                roleId: op.role.id,
                document: "profile"
              }),
              op.role.profileContent
            );
          }
          if (op.role.pitchContent !== undefined) {
            seedContentByKey.set(
              mysteryDocumentTargetKey({
                kind: "role",
                roleId: op.role.id,
                document: "pitch"
              }),
              op.role.pitchContent
            );
          }
        } else if (
          op.type === "clueRound.create" &&
          op.round.content !== undefined
        ) {
          seedContentByKey.set(
            mysteryDocumentTargetKey({
              kind: "clue_round",
              roundId: op.round.id
            }),
            op.round.content
          );
        }
      }

      const operations: ProjectTransactionFileOperation[] = [];
      const deletedDocuments: MysteryDeletedDocumentSnapshot[] = [];
      const writtenTargetsBefore: MysteryDeletedDocumentSnapshot[] = [];
      const versionRecords: Array<{
        target: MysteryDocumentTarget;
        before: string;
        after: string;
      }> = [];

      // Delete removed targets (and record snapshots for restore).
      for (const [key, target] of currentByKey.entries()) {
        if (nextByKey.has(key)) continue;
        const relPath = mysteryDocumentRelativePath(target);
        const existing = await this.readOptionalText(root, relPath);
        deletedDocuments.push({ target, content: existing.content });
        if (existing.exists) {
          operations.push({
            action: "delete",
            path: relPath,
            ...(existing.sha256 ? { expectedSha256: existing.sha256 } : {})
          });
        }
      }

      // Create newly introduced targets.
      for (const [key, target] of nextByKey.entries()) {
        if (currentByKey.has(key)) continue;
        const explicitWrite = writeByKey.get(key);
        const content =
          explicitWrite?.content ?? seedContentByKey.get(key) ?? "";
        operations.push({
          path: mysteryDocumentRelativePath(target),
          content,
          expectedSha256: null
        });
      }

      // Update existing targets specified in documentWrites.
      for (const [key, write] of writeByKey.entries()) {
        if (!currentByKey.has(key) || !nextByKey.has(key)) continue;
        const relPath = mysteryDocumentRelativePath(write.target);
        const existing = await this.readOptionalText(root, relPath);
        if (
          write.expectedRevision !== undefined &&
          mysteryTextRevision(existing.content) !== write.expectedRevision
        ) {
          throw new MysteryDocumentConflictError(
            `文档在读取后已被修改：${key}`
          );
        }
        writtenTargetsBefore.push({
          target: write.target,
          content: existing.content
        });
        versionRecords.push({
          target: write.target,
          before: existing.content,
          after: write.content
        });
        operations.push({
          path: relPath,
          content: write.content,
          expectedSha256: existing.sha256
        });
      }

      const updatedAt = this.timestamp();
      const nextManifest = MysteryBookManifestSchema.parse({
        ...preview.manifest,
        revision: manifest.revision + 1,
        updatedAt
      });

      let restorePoint: MysteryRestorePoint | undefined;
      if (deletedDocuments.length > 0 || writtenTargetsBefore.length > 0) {
        const restoreId = createId("mys_rst");
        restorePoint = MysteryRestorePointSchema.parse({
          restoreId,
          createdAt: updatedAt,
          previousRevision: manifest.revision,
          previousManifest: manifest,
          writtenTargetsBefore,
          deletedDocuments
        });
      }

      operations.push({
        path: MYSTERY_MANIFEST_FILE,
        content: toJsonFileText(nextManifest),
        expectedSha256: manifestSha256
      });

      await commitProjectTransaction({
        projectRoot: root,
        operations,
        maxFileBytes: MYSTERY_MAX_FILE_BYTES
      });

      if (restorePoint) {
        const restoreTarget = await resolveInternalWritableFile(
          root,
          `${MYSTERY_RESTORE_DIR}/${restorePoint.restoreId}.json`
        );
        await writeDurableNewFile(restoreTarget, toJsonFileText(restorePoint));
      }

      if (input.versionOrigin) {
        for (const rec of versionRecords) {
          await this.recordDocumentVersion(
            root,
            manifest.id,
            rec.target,
            rec.before,
            rec.after,
            input.versionOrigin
          );
        }
      }

      const nextIndex = await this.buildWorkspaceIndexLocked(
        root,
        nextManifest
      );
      return MysteryApplyOperationsResultSchema.parse({
        book: nextManifest,
        summary: summarizeMysteryBook(nextManifest),
        workspaceIndex: nextIndex,
        ...(restorePoint ? { restorePoint } : {})
      });
    });
  }

  async restoreOperations(
    projectDirectory: string,
    bookId: string,
    restoreId: string
  ): Promise<MysteryRestoreOperationsResult> {
    const root = await secureDirectory(projectDirectory, "剧本杀项目目录");
    return await this.runExclusive(root, async () => {
      const { manifest, manifestSha256 } = await this.loadManifestLocked(root);
      if (manifest.id !== bookId) {
        throw new Error("剧本杀项目标识与注册信息不一致。");
      }
      const restorePath = `${MYSTERY_RESTORE_DIR}/${restoreId}.json`;
      const rawRestoreBytes = await readRegularFileOptional(
        root,
        resolve(root, restorePath),
        MYSTERY_MAX_MANIFEST_BYTES
      );
      if (!rawRestoreBytes) {
        throw new MysteryWorkspaceOperationError(
          "restore_unavailable",
          `还原点不存在：${restoreId}`
        );
      }
      const restorePoint = MysteryRestorePointSchema.parse(
        JSON.parse(rawRestoreBytes.toString("utf8"))
      );

      const currentTargets = listMysteryManifestTargets(manifest);
      const targetKeysBefore = new Set(
        listMysteryManifestTargets(restorePoint.previousManifest).map(
          mysteryDocumentTargetKey
        )
      );

      const operations: ProjectTransactionFileOperation[] = [];
      // Remove targets that were added after the snapshot.
      for (const target of currentTargets) {
        const key = mysteryDocumentTargetKey(target);
        if (targetKeysBefore.has(key)) continue;
        const relPath = mysteryDocumentRelativePath(target);
        const existing = await this.readOptionalText(root, relPath);
        if (existing.exists) {
          operations.push({
            action: "delete",
            path: relPath,
            ...(existing.sha256 ? { expectedSha256: existing.sha256 } : {})
          });
        }
      }
      // Restore deleted documents.
      for (const item of restorePoint.deletedDocuments) {
        operations.push({
          path: mysteryDocumentRelativePath(item.target),
          content: item.content
        });
      }
      // Restore overwritten documents.
      for (const item of restorePoint.writtenTargetsBefore) {
        operations.push({
          path: mysteryDocumentRelativePath(item.target),
          content: item.content
        });
      }

      const updatedAt = this.timestamp();
      const restoredManifest = MysteryBookManifestSchema.parse({
        ...restorePoint.previousManifest,
        revision: manifest.revision + 1,
        updatedAt
      });
      operations.push({
        path: MYSTERY_MANIFEST_FILE,
        content: toJsonFileText(restoredManifest),
        expectedSha256: manifestSha256
      });

      await commitProjectTransaction({
        projectRoot: root,
        operations,
        maxFileBytes: MYSTERY_MAX_FILE_BYTES
      });
      await rm(resolve(root, restorePath), { force: true }).catch(
        () => undefined
      );

      const workspaceIndex = await this.buildWorkspaceIndexLocked(
        root,
        restoredManifest
      );
      return MysteryRestoreOperationsResultSchema.parse({
        book: restoredManifest,
        summary: summarizeMysteryBook(restoredManifest),
        workspaceIndex,
        restoredId: restoreId
      });
    });
  }

  async search(
    projectDirectory: string,
    rawInput: MysterySearchInput
  ): Promise<MysterySearchResult> {
    const input = MysterySearchInputSchema.parse(rawInput);
    const root = await secureDirectory(projectDirectory, "剧本杀项目目录");
    return await this.runExclusive(root, async () => {
      const { manifest } = await this.loadManifestLocked(root);
      if (manifest.id !== input.bookId) {
        throw new Error("剧本杀项目标识与注册信息不一致。");
      }
      const targets = listMysteryManifestTargets(manifest).filter((target) => {
        if (input.stage && mysteryStageForTarget(target) !== input.stage) {
          return false;
        }
        if (input.playerVisibleOnly && !isMysteryPlayerVisibleTarget(target)) {
          return false;
        }
        return true;
      });

      const hits: MysterySearchHit[] = [];
      let totalHits = 0;
      for (const target of targets) {
        const file = await this.readOptionalText(
          root,
          mysteryDocumentRelativePath(target)
        );
        if (!file.content) continue;
        const matched = buildSearchSnippet(file.content, input.query);
        if (matched.count === 0) continue;
        totalHits += 1;
        if (hits.length < input.limit) {
          hits.push({
            target,
            targetKey: mysteryDocumentTargetKey(target),
            stage: mysteryStageForTarget(target),
            title: mysteryDocumentTitle(manifest, target),
            playerVisible: isMysteryPlayerVisibleTarget(target),
            snippet: matched.snippet,
            matchCount: matched.count
          });
        }
      }
      return MysterySearchResultSchema.parse({
        bookId: manifest.id,
        query: input.query,
        totalHits,
        hits
      });
    });
  }

  async withDocumentVersions<T>(
    projectDirectory: string,
    bookId: string,
    rawTarget: unknown,
    operation: (
      versions: DocumentVersionStore,
      content: string,
      save: (
        content: string,
        expectedSha256: string,
        afterCommit: (before: string) => Promise<void>
      ) => Promise<MysteryWriteDocumentResult>
    ) => Promise<T>
  ): Promise<T> {
    const target = MysteryDocumentTargetSchema.parse(rawTarget);
    const root = await secureDirectory(projectDirectory, "剧本杀项目目录");
    return await this.runExclusive(root, async () => {
      const { manifest } = await this.loadManifestLocked(root);
      if (
        manifest.id !== bookId ||
        !mysteryDocumentExistsInManifest(manifest, target)
      ) {
        throw new DocumentVersionError(
          "version.unavailable",
          "文档不存在或不属于当前剧本杀作品。"
        );
      }
      const file = await this.readOptionalText(
        root,
        mysteryDocumentRelativePath(target)
      );
      const versions = new DocumentVersionStore(
        root,
        {
          workspace: "mystery",
          bookId,
          targetKey: mysteryDocumentTargetKey(target),
          target
        },
        MYSTERY_MAX_FILE_BYTES,
        this.now
      );
      return await operation(
        versions,
        file.content,
        async (content, expectedSha256, afterCommit) =>
          await this.writeDocumentLocked(
            root,
            { bookId, target, content },
            { expectedSha256, afterCommit }
          )
      );
    });
  }

  async duplicateBook(
    sourceDirectory: string,
    parentDirectory: string,
    existingTitles: readonly string[]
  ): Promise<MysteryOpenBookResult> {
    const sourceRoot = await secureDirectory(sourceDirectory, "源剧本杀项目");
    const parent = await ensureSecureDirectory(
      parentDirectory,
      "剧本杀项目父目录"
    );
    const { manifest } = await this.runExclusive(sourceRoot, async () =>
      this.loadManifestLocked(sourceRoot)
    );
    const copyTitle = nextCopyTitle(manifest.title, existingTitles);
    const createdAt = this.timestamp();
    const copyManifest = MysteryBookManifestSchema.parse({
      ...manifest,
      id: createId("mys"),
      title: copyTitle,
      revision: 0,
      createdAt,
      updatedAt: createdAt
    });
    const staging = join(parent, `.mystery-copy-${randomHex8()}`);
    await mkdir(staging, { recursive: true, mode: 0o700 });
    let promoted = false;
    try {
      const operations: ProjectTransactionFileOperation[] = [
        {
          path: MYSTERY_MANIFEST_FILE,
          content: toJsonFileText(copyManifest),
          expectedSha256: null
        }
      ];
      for (const target of listMysteryManifestTargets(manifest)) {
        const relPath = mysteryDocumentRelativePath(target);
        const file = await this.readOptionalText(sourceRoot, relPath);
        operations.push({
          path: relPath,
          content: file.content,
          expectedSha256: null
        });
      }
      await commitProjectTransaction({
        projectRoot: staging,
        operations,
        maxFileBytes: MYSTERY_MAX_FILE_BYTES
      });
      const imagesDir = join(sourceRoot, "images");
      const hasImages = await lstat(imagesDir)
        .then((s) => s.isDirectory() && !s.isSymbolicLink())
        .catch(() => false);
      if (hasImages) {
        const destImages = join(staging, "images");
        await mkdir(destImages, { recursive: true });
        for (const name of await readdir(imagesDir)) {
          const srcFile = join(imagesDir, name);
          const stat = await lstat(srcFile);
          if (stat.isFile() && !stat.isSymbolicLink()) {
            await cp(srcFile, join(destImages, name), {
              errorOnExist: false,
              force: true
            });
          }
        }
      }
      const finalDir = await availableProjectDirectory(parent, copyTitle);
      await rename(staging, finalDir);
      promoted = true;
      return await this.openBook(finalDir);
    } finally {
      if (!promoted) {
        await rm(staging, { recursive: true, force: true }).catch(
          () => undefined
        );
      }
    }
  }
}

export async function assertSafeMysteryDirectory(
  path: string
): Promise<string> {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error("无效的剧本杀作品目录。");
  }
  return await secureDirectory(path, "剧本杀项目目录");
}

export { constants as mysteryFsConstants };
