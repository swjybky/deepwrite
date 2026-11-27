import { constants as fsConstants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { TextDecoder } from "node:util";
import {
  LONG_BOOK_LINE_FILE_ID,
  LONG_CHARACTER_OVERVIEW_FILE_ID,
  LONG_CHARACTER_OVERVIEW_PATH,
  LONG_WORKSPACE_INDEX_FILE_ID,
  LONG_WORKSPACE_INDEX_PATH,
  LongContinuationImportScanSchema,
  LongImportContinuationAtPathInputSchema,
  LongLedgerCommitRecordSchema,
  LongProjectManifestSchema,
  LongWorkspaceIndexSnapshotSchema,
  longChapterBodyFileId,
  longChapterCardFileId,
  longChapterCharacterStateFileId,
  longChapterContinuityFilePath,
  longChapterFilePath,
  longChapterForeshadowingChangesFileId,
  longChapterHandoffFileId,
  longLedgerCommitFileId,
  longWorldbuildingOverviewContentPath,
  longWorldbuildingOverviewFileId,
  type LongContinuationImportEncoding,
  type LongContinuationImportScan,
  type LongProjectManifest,
  type LongWorkspaceFileReference,
  type LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import { createId, toJsonFileText } from "@deepwrite/shared";
import { sha256Hex } from "@deepwrite/shared/node";

const MAX_DOCUMENT_BYTES = 32 * 1024 * 1024;
const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0;
const NATURAL_COLLATOR = new Intl.Collator("zh-CN", {
  numeric: true,
  sensitivity: "base"
});
const DEFAULT_WORLD_CATEGORIES = [
  ["world_rules", "规则"],
  ["world_factions", "势力"],
  ["world_geography", "地理"],
  ["world_history", "历史"],
  ["world_terminology", "术语"],
  ["world_realms", "境界"],
  ["world_items", "物品"]
] as const;
const EMPTY_LINKED_MATERIALS = {
  character: [],
  gimmick: [],
  plot: [],
  draft: [],
  other: []
} as const;
const EMPTY_LINKED_SKILLS = {
  general: [],
  plot: [],
  style: [],
  other: []
} as const;

interface ScannedChapter {
  sourceName: string;
  title: string;
  order: number;
  byteLength: number;
  encoding: LongContinuationImportEncoding;
  relativePath: string;
  content: string;
  contentSha256: string;
}

interface ScannedVolume {
  sourceName: string;
  title: string;
  order: number;
  chapters: ScannedChapter[];
}

export interface ContinuationImportSource {
  sourceRoot: string;
  sourceFingerprint: string;
  mode: "flat" | "volume_folders";
  defaultTitle: string;
  volumes: ScannedVolume[];
  warnings: string[];
}

export interface ContinuationImportDocument {
  fileId: string;
  path: string;
  kind: "markdown" | "json";
  content: string;
}

export interface ContinuationImportPlan {
  manifest: LongProjectManifest;
  index: LongWorkspaceIndexSnapshot;
  documents: ContinuationImportDocument[];
  importedVolumeCount: number;
  importedChapterCount: number;
  checkpointCount: number;
  pendingChapterCardId: string;
  warnings: string[];
  sourceFingerprint: string;
}

function storageKey(id: string): string {
  return sha256Hex(id).slice(0, 32);
}

function ledgerPath(commitId: string): string {
  return `long/ledger/${storageKey(commitId)}.json`;
}

function visibleName(name: string): boolean {
  const normalized = name.toLocaleLowerCase("en-US");
  return (
    !name.startsWith(".") &&
    normalized !== "thumbs.db" &&
    normalized !== "desktop.ini"
  );
}

function assertWithinRoot(root: string, candidate: string): void {
  const path = relative(root, candidate);
  if (path === "" || (!path.startsWith(`..${sep}`) && path !== "..")) return;
  throw new Error("续写导入来源包含越出所选目录的路径。");
}

function isTxt(name: string): boolean {
  return extname(name).toLocaleLowerCase("en-US") === ".txt";
}

function safeTitle(raw: string, label: string): string {
  const title = raw.normalize("NFC").trim();
  if (!title) throw new Error(`${label}名称不能为空。`);
  if (Array.from(title).length > 256) {
    throw new Error(`${label}名称不能超过 256 个字符：${title}`);
  }
  return title;
}

function chineseDigit(value: string): number | null {
  const digits: Record<string, number> = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9
  };
  const units: Record<string, number> = {
    十: 10,
    百: 100,
    千: 1_000,
    万: 10_000,
    亿: 100_000_000
  };
  if ([...value].every((character) => character in digits)) {
    const joined = [...value].map((character) => digits[character]).join("");
    const parsed = Number(joined);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  let total = 0;
  let section = 0;
  let number = 0;
  for (const character of value) {
    if (character in digits) {
      number = digits[character]!;
      continue;
    }
    const unit = units[character];
    if (!unit) return null;
    if (unit === 10_000 || unit === 100_000_000) {
      section = (section + number) * unit;
      total += section;
      section = 0;
      number = 0;
    } else {
      section += (number || 1) * unit;
      number = 0;
    }
  }
  const parsed = total + section + number;
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parsedOrdinal(name: string): number | null {
  const stem = name.slice(0, name.length - extname(name).length).trim();
  const arabicPrefix = /^(?:chapter|volume|vol)?\s*0*(\d{1,12})(?:\D|$)/iu.exec(
    stem
  );
  if (arabicPrefix) {
    const value = Number(arabicPrefix[1]);
    return Number.isSafeInteger(value) ? value : null;
  }
  const ordinal =
    /^第\s*([零〇一二两三四五六七八九十百千万亿\d]+)\s*[章节卷回部集]/u.exec(
      stem
    );
  if (!ordinal) return null;
  if (/^\d+$/u.test(ordinal[1]!)) {
    const value = Number(ordinal[1]);
    return Number.isSafeInteger(value) ? value : null;
  }
  return chineseDigit(ordinal[1]!);
}

function orderedNames(
  names: readonly string[],
  label: string,
  warnings: string[]
): string[] {
  const ordinals = names.map((name) => ({
    name,
    ordinal: parsedOrdinal(name)
  }));
  const usable =
    ordinals.every(({ ordinal }) => ordinal !== null) &&
    new Set(ordinals.map(({ ordinal }) => ordinal)).size === ordinals.length;
  if (!usable) {
    warnings.push(
      `${label}无法全部识别唯一编号，已按中文数字感知的自然文件名排序；请在导入前核对顺序。`
    );
    return [...names].sort((left, right) =>
      NATURAL_COLLATOR.compare(left, right)
    );
  }
  const ordered = [...ordinals].sort(
    (left, right) =>
      left.ordinal! - right.ordinal! ||
      NATURAL_COLLATOR.compare(left.name, right.name)
  );
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index]!.ordinal! !== ordered[index - 1]!.ordinal! + 1) {
      warnings.push(`${label}编号存在缺口，已按识别到的编号顺序导入。`);
      break;
    }
  }
  return ordered.map(({ name }) => name);
}

function looksBinary(content: string): boolean {
  if (content.includes("\u0000")) return true;
  let controlCount = 0;
  let count = 0;
  for (const character of content) {
    count += 1;
    const code = character.codePointAt(0)!;
    if (
      code < 32 &&
      character !== "\n" &&
      character !== "\r" &&
      character !== "\t"
    ) {
      controlCount += 1;
    }
  }
  return count > 0 && controlCount / count > 0.01;
}

function decodeChapter(
  bytes: Uint8Array,
  sourceName: string
): {
  content: string;
  encoding: LongContinuationImportEncoding;
} {
  const decode = (
    encoding: LongContinuationImportEncoding,
    value: Uint8Array
  ): string => new TextDecoder(encoding, { fatal: true }).decode(value);
  let encoding: LongContinuationImportEncoding;
  let content: string;
  try {
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      encoding = "utf-8";
      content = decode(encoding, bytes.subarray(3));
    } else if (bytes[0] === 0xff && bytes[1] === 0xfe) {
      encoding = "utf-16le";
      content = decode(encoding, bytes.subarray(2));
    } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
      encoding = "utf-16be";
      content = decode(encoding, bytes.subarray(2));
    } else {
      try {
        encoding = "utf-8";
        content = decode(encoding, bytes);
      } catch {
        encoding = "gb18030";
        content = decode(encoding, bytes);
      }
    }
  } catch {
    throw new Error(`章节无法按 UTF-8、UTF-16 或 GB18030 解码：${sourceName}`);
  }
  content = content.replace(/^\uFEFF/u, "");
  if (!content.trim()) throw new Error(`章节内容为空：${sourceName}`);
  if (looksBinary(content))
    throw new Error(`章节疑似二进制或包含非法控制字符：${sourceName}`);
  return { content, encoding };
}

async function readSecureChapter(
  sourceRoot: string,
  absolutePath: string,
  sourceName: string,
  relativePath: string
): Promise<Omit<ScannedChapter, "title" | "order">> {
  assertWithinRoot(sourceRoot, absolutePath);
  const before = await lstat(absolutePath, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error(`章节必须是普通 TXT 文件：${relativePath}`);
  }
  if (before.nlink !== 1n)
    throw new Error(`章节不允许使用硬链接：${relativePath}`);
  if (before.size <= 0n) throw new Error(`章节文件为空：${relativePath}`);
  if (before.size > BigInt(MAX_DOCUMENT_BYTES)) {
    throw new Error(`章节超过 32 MiB 安全上限：${relativePath}`);
  }
  const handle = await open(absolutePath, fsConstants.O_RDONLY | O_NOFOLLOW);
  try {
    const after = await handle.stat({ bigint: true });
    if (
      !after.isFile() ||
      after.nlink !== 1n ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size
    ) {
      throw new Error(`扫描期间章节文件发生变化：${relativePath}`);
    }
    const bytes = await handle.readFile();
    const decoded = decodeChapter(bytes, relativePath);
    return {
      sourceName,
      relativePath,
      byteLength: bytes.byteLength,
      encoding: decoded.encoding,
      content: decoded.content,
      contentSha256: sha256Hex(bytes)
    };
  } finally {
    await handle.close();
  }
}

async function scanChapterDirectory(
  sourceRoot: string,
  directory: string,
  label: string,
  warnings: string[]
): Promise<ScannedChapter[]> {
  const entries = (await readdir(directory, { withFileTypes: true })).filter(
    ({ name }) => visibleName(name)
  );
  if (entries.length === 0) throw new Error(`${label}没有可导入的 TXT 章节。`);
  for (const entry of entries) {
    if (!entry.isFile() || !isTxt(entry.name)) {
      throw new Error(`${label}只能直接包含 TXT 章节文件：${entry.name}`);
    }
  }
  const names = orderedNames(
    entries.map(({ name }) => name),
    `${label}章节`,
    warnings
  );
  const chapters: ScannedChapter[] = [];
  for (const [index, name] of names.entries()) {
    const absolutePath = join(directory, name);
    const relativeName = relative(sourceRoot, absolutePath);
    const chapter = await readSecureChapter(
      sourceRoot,
      absolutePath,
      name,
      relativeName
    );
    chapters.push({
      ...chapter,
      title: safeTitle(name.slice(0, -extname(name).length), "章节"),
      order: index + 1
    });
  }
  return chapters;
}

function publicScan(
  source: ContinuationImportSource
): LongContinuationImportScan {
  const volumes = source.volumes.map((volume) => ({
    sourceName: volume.sourceName,
    title: volume.title,
    order: volume.order,
    chapters: volume.chapters.map((chapter) => ({
      sourceName: chapter.sourceName,
      title: chapter.title,
      order: chapter.order,
      byteLength: chapter.byteLength,
      encoding: chapter.encoding
    }))
  }));
  const pendingVolume = volumes.at(-1)!;
  const pendingChapter = pendingVolume.chapters.at(-1)!;
  const chapterCount = volumes.reduce(
    (total, volume) => total + volume.chapters.length,
    0
  );
  return LongContinuationImportScanSchema.parse({
    defaultTitle: source.defaultTitle,
    mode: source.mode,
    volumeCount: volumes.length,
    chapterCount,
    checkpointCount: Math.max(0, chapterCount - 1),
    pendingVolumeTitle: pendingVolume.title,
    pendingChapterTitle: pendingChapter.title,
    volumes,
    warnings: source.warnings
  });
}

export async function scanContinuationImportSource(
  rawSourcePath: string
): Promise<ContinuationImportSource> {
  const requestedRoot = resolve(rawSourcePath);
  const rootStat = await lstat(requestedRoot, { bigint: true });
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("续写导入来源必须是普通文件夹，不能是符号链接。");
  }
  const sourceRoot = await realpath(requestedRoot);
  const entries = (await readdir(sourceRoot, { withFileTypes: true })).filter(
    ({ name }) => visibleName(name)
  );
  if (entries.length === 0) throw new Error("所选文件夹没有可导入的章节。");
  const allFiles = entries.every(
    (entry) => entry.isFile() && isTxt(entry.name)
  );
  const allDirectories = entries.every((entry) => entry.isDirectory());
  if (!allFiles && !allDirectories) {
    throw new Error(
      "根目录必须全部是 TXT 章节，或全部是按卷划分的文件夹，不能混放。"
    );
  }
  const warnings: string[] = [];
  const volumes: ScannedVolume[] = [];
  if (allFiles) {
    volumes.push({
      sourceName: "第一卷",
      title: "第一卷",
      order: 1,
      chapters: await scanChapterDirectory(
        sourceRoot,
        sourceRoot,
        "第一卷",
        warnings
      )
    });
  } else {
    const volumeNames = orderedNames(
      entries.map(({ name }) => name),
      "分卷",
      warnings
    );
    for (const [index, name] of volumeNames.entries()) {
      const directory = join(sourceRoot, name);
      const stat = await lstat(directory, { bigint: true });
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error(`分卷必须是普通文件夹：${name}`);
      }
      const resolvedDirectory = await realpath(directory);
      assertWithinRoot(sourceRoot, resolvedDirectory);
      const title = safeTitle(name, "分卷");
      volumes.push({
        sourceName: name,
        title,
        order: index + 1,
        chapters: await scanChapterDirectory(
          sourceRoot,
          resolvedDirectory,
          title,
          warnings
        )
      });
    }
  }
  if (volumes.flatMap(({ chapters }) => chapters).length > 100_000) {
    throw new Error("续写导入章节数量不能超过 100,000。");
  }
  const rawTitle = basename(sourceRoot).normalize("NFC").trim() || "续写导入";
  const defaultTitle = Array.from(rawTitle).slice(0, 256).join("");
  if (defaultTitle !== rawTitle)
    warnings.push("根文件夹名过长，默认书名已截取前 256 个字符。");
  const fingerprint = sha256Hex(
    JSON.stringify({
      mode: allFiles ? "flat" : "volume_folders",
      volumes: volumes.map((volume) => ({
        sourceName: volume.sourceName.normalize("NFC"),
        chapters: volume.chapters.map((chapter) => ({
          relativePath: chapter.relativePath.normalize("NFC"),
          byteLength: chapter.byteLength,
          contentSha256: chapter.contentSha256
        }))
      }))
    })
  );
  return {
    sourceRoot,
    sourceFingerprint: fingerprint,
    mode: allFiles ? "flat" : "volume_folders",
    defaultTitle,
    volumes,
    warnings: [...new Set(warnings)]
  };
}

export async function previewContinuationImportSource(
  rawSourcePath: string
): Promise<LongContinuationImportScan & { sourceFingerprint: string }> {
  const source = await scanContinuationImportSource(rawSourcePath);
  return { ...publicScan(source), sourceFingerprint: source.sourceFingerprint };
}

export async function createContinuationImportPlan(
  rawInput: unknown,
  importedAt: string
): Promise<ContinuationImportPlan> {
  const input = LongImportContinuationAtPathInputSchema.parse(rawInput);
  const source = await scanContinuationImportSource(input.sourcePath);
  if (source.sourceFingerprint !== input.expectedFingerprint) {
    throw new Error(
      "续写导入源文件在预览后发生变化，请重新选择文件夹并核对顺序。"
    );
  }
  const bookId = createId("longbook");
  const documents: ContinuationImportDocument[] = [];
  const addDocument = (
    fileId: string,
    path: string,
    content: string,
    kind: "markdown" | "json" = "markdown"
  ): LongWorkspaceFileReference => {
    const reference = {
      id: fileId,
      path,
      updatedAt: importedAt
    } as LongWorkspaceFileReference;
    documents.push({
      fileId,
      path,
      kind,
      content
    });
    return reference;
  };
  const bookLine = addDocument(
    LONG_BOOK_LINE_FILE_ID,
    "long/plot/book-line.md",
    ""
  );
  const worldbuilding = DEFAULT_WORLD_CATEGORIES.map(([id, title], index) => ({
    id,
    title,
    order: index + 1,
    format: "list" as const,
    contentAuthority: "files" as const,
    overview: addDocument(
      longWorldbuildingOverviewFileId(id),
      longWorldbuildingOverviewContentPath(id),
      ""
    ),
    items: []
  }));
  const characterOverview = addDocument(
    LONG_CHARACTER_OVERVIEW_FILE_ID,
    LONG_CHARACTER_OVERVIEW_PATH,
    ""
  );
  const volumes: LongWorkspaceIndexSnapshot["plot"]["volumes"] = [];
  const arcs: LongWorkspaceIndexSnapshot["plot"]["arcs"] = [];
  const chapterCards: LongWorkspaceIndexSnapshot["plot"]["chapterCards"] = [];
  const chapters: LongWorkspaceIndexSnapshot["chapters"] = [];
  const commits: LongWorkspaceIndexSnapshot["ledger"]["commits"] = [];
  const flattened = source.volumes.flatMap((volume) =>
    volume.chapters.map((chapter) => ({ volume, chapter }))
  );
  let globalChapterIndex = 0;
  let pendingChapterCardId = "";
  for (const volumeSource of source.volumes) {
    const volumeId = createId("volume");
    volumes.push({
      id: volumeId,
      title: volumeSource.title,
      order: volumeSource.order,
      summary: ""
    });
    for (const chapterSource of volumeSource.chapters) {
      globalChapterIndex += 1;
      const chapterId = createId("chapter");
      const isPending = globalChapterIndex === flattened.length;
      pendingChapterCardId = isPending ? chapterId : pendingChapterCardId;
      chapterCards.push({
        id: chapterId,
        volumeId,
        primaryArcId: null,
        title: chapterSource.title,
        narrativeOrder: chapterSource.order
      });
      const body = addDocument(
        longChapterBodyFileId(chapterId),
        longChapterFilePath(chapterId, "body.md"),
        chapterSource.content
      );
      const card = addDocument(
        longChapterCardFileId(chapterId),
        longChapterFilePath(chapterId, "card.md"),
        ""
      );
      const characterState = addDocument(
        longChapterCharacterStateFileId(chapterId),
        longChapterFilePath(chapterId, "character-state.md"),
        ""
      );
      const handoff = addDocument(
        longChapterHandoffFileId(chapterId),
        longChapterFilePath(chapterId, "handoff.md"),
        ""
      );
      const foreshadowingChanges = addDocument(
        longChapterForeshadowingChangesFileId(chapterId),
        longChapterContinuityFilePath(chapterId, "foreshadowing-changes.md"),
        ""
      );
      let commitId: string | null = null;
      if (!isPending) {
        commitId = createId("commit");
        const sequence = commits.length + 1;
        const record = LongLedgerCommitRecordSchema.parse({
          schemaVersion: 1,
          id: commitId,
          bookId,
          sequence,
          chapterCardId: chapterId,
          committedAt: importedAt,
          commitMessage: `续写导入检查点 #${sequence}`,
          committedThroughChapterId: chapterId,
          placementChanges: [],
          foreshadowingBeatChanges: [],
          foreshadowingThreadChanges: []
        });
        const recordContent = toJsonFileText(record);
        const recordFile = addDocument(
          longLedgerCommitFileId(commitId),
          ledgerPath(commitId),
          recordContent,
          "json"
        );
        commits.push({
          id: commitId,
          mode: "import_checkpoint",
          sequence,
          chapterCardId: chapterId,
          committedAt: importedAt,
          placementIds: [],
          foreshadowingBeatIds: [],
          recordFile
        });
      }
      chapters.push({
        chapterCardId: chapterId,
        bodyStatus: chapterSource.content.trim() ? "written" : "empty",
        body,
        card,
        characterState,
        handoff,
        foreshadowingChanges,
        worldReveals: null,
        characterContinuity: [],
        commitId
      });
    }
  }
  const checkpointCount = commits.length;
  const index = LongWorkspaceIndexSnapshotSchema.parse({
    schemaVersion: 1,
    bookId,
    updatedAt: importedAt,
    bookLine,
    featureSettings: {
      worldbuildingItemLayout: "right-list",
      characterAndContinuityItemLayout: "top-tabs",
      plotItemLayout: "top-tabs"
    },
    worldbuilding,
    characterOverview,
    characters: [],
    characterFiles: [],
    plot: {
      volumes,
      arcs,
      chapterCards,
      storyEvents: [],
      storyPlots: [],
      eventConnections: [],
      narrativePlacements: [],
      foreshadowing: []
    },
    chapters,
    ledger: {
      committedThroughChapterId: commits.at(-1)?.chapterCardId ?? null,
      commits,
      projection: {
        throughCommitId: null,
        facts: [],
        knowledge: [],
        openLoops: [],
        latestHandoff: null
      }
    }
  });
  const validatedIndex = LongWorkspaceIndexSnapshotSchema.parse(index);
  const manifest = LongProjectManifestSchema.parse({
    schemaVersion: 1,
    kind: "deepwrite.long-book",
    id: bookId,
    title: input.title,
    bookType: "long",
    genre: input.genre,
    status: "editing",
    linkedMaterialIdsByKind: EMPTY_LINKED_MATERIALS,
    linkedSkillIdsByKind: EMPTY_LINKED_SKILLS,
    createdAt: importedAt,
    updatedAt: importedAt,
    workspaceIndexFile: {
      id: LONG_WORKSPACE_INDEX_FILE_ID,
      path: LONG_WORKSPACE_INDEX_PATH,
      updatedAt: importedAt
    }
  });
  return {
    manifest,
    index: validatedIndex,
    documents,
    importedVolumeCount: volumes.length,
    importedChapterCount: flattened.length,
    checkpointCount,
    pendingChapterCardId,
    warnings: source.warnings,
    sourceFingerprint: source.sourceFingerprint
  };
}
