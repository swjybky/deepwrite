import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep
} from "node:path";
import {
  AcademicBookSchema,
  BUILTIN_MATERIAL_LIBRARY_IDS,
  BUILTIN_SKILL_LIBRARY_IDS,
  BookIdentityRecordSchema,
  BookProjectManifestSchema,
  BookSchema,
  LOCAL_BACKUP_FORMAT_VERSION,
  LibraryOrganizationSchema,
  LongProjectManifestSchema,
  LongWorkspaceIndexSnapshotSchema,
  MATERIAL_KINDS,
  MaterialGroupProjectManifestSchema,
  MaterialLibraryProjectManifestSchema,
  MysteryBookManifestSchema,
  SKILL_KINDS,
  SkillGroupProjectManifestSchema,
  SkillLibraryProjectManifestSchema,
  LocalBackupManifestSchema,
  assertLongProjectIndexMetadata,
  createLongBookSummary,
  emptyLibraryOrganization,
  flattenMaterialIdsByKind,
  flattenSkillIdsByKind,
  reconcileLibraryOrder,
  summarizeMysteryBook,
  type BookIdentityRecord,
  type BookProjectManifest,
  type LibraryOrganization,
  type LocalBackupCoreApplyImportAtPathInput,
  type LocalBackupCorePreviewResult,
  type LocalBackupImportResult,
  type LocalBackupItemKind,
  type LocalBackupManifest,
  type LocalBackupManifestItem,
  type LocalBackupPreviewItem,
  type LocalBackupPreviewStatus,
  type LongLedgerCommitRecord,
  type LongLinkedResourceStageScopes,
  type LongProjectManifest,
  type LongWorkspaceIndexSnapshot,
  type MaterialGroupProjectManifest,
  type MaterialLibraryProjectManifest,
  type MysteryBookManifest,
  type SkillGroupProjectManifest,
  type SkillLibraryProjectManifest
} from "@deepwrite/contracts";
import {
  createCatalogId,
  createId,
  isRecord,
  nowIso,
  randomHex8,
  toJsonFileText
} from "@deepwrite/shared";
import { isNodeError, sha256Hex } from "@deepwrite/shared/node";
import { mergeCreativePlotStageDefinitions } from "../folder-catalog-store/plot-stage-definitions";
import { assertLongLedgerRecordChain } from "../long-portable-bundle";
import { replaceExactIdentity } from "../long-project-store/lifecycle";
import { indexedFileSlots } from "../long-project-store/paths";
import {
  parseLongLedgerCommitRecord,
  stripLegacyLongVersionMetadata
} from "../long-version-metadata";
import {
  assertSufficientDiskSpace,
  readAvailableDiskBytes,
  requiredImportDiskBytes,
  type StatFsFn
} from "./disk-space";
import { LocalBackupError } from "./errors";
import type { StagedProjectDirectoryOp } from "./import-transaction";
import {
  backupItemKey,
  collectRegisteredRealRoots,
  computeProjectFilesHash,
  hashProjectDirectoryOnDisk,
  readAllRegistries,
  type RegistrySnapshotBundle
} from "./inventory";
import {
  allocateWorkspaceProjectDirectory,
  assertPathContained,
  caseFoldPathKey,
  ensureRealBackupDirectory,
  nextBackupCopyTitle,
  normalizeBackupArchivePath,
  sanitizeBackupFolderName
} from "./paths";
import { openVerifiedBackupZipArchive } from "./zip-archive";

export const BACKUP_MANIFEST_FILENAME = "manifest.json" as const;

export function backupItemArchivePrefix(
  kind: LocalBackupItemKind,
  id: string
): string {
  return `items/${kind}/${sha256Hex(id).slice(0, 24)}/`;
}

type ValidatedArchivePayload =
  | {
      kind: "book";
      manifest: BookProjectManifest;
      linkedMaterialIds: string[];
      linkedSkillIds: string[];
      identity?: BookIdentityRecord;
    }
  | {
      kind: "long-book";
      manifest: LongProjectManifest;
      index: LongWorkspaceIndexSnapshot;
      ledgerByPath: Map<string, LongLedgerCommitRecord>;
      linkedMaterialIds: string[];
      linkedSkillIds: string[];
      identity?: BookIdentityRecord;
    }
  | {
      kind: "mystery-book";
      manifest: MysteryBookManifest;
      linkedMaterialIds: string[];
      linkedSkillIds: string[];
      identity?: BookIdentityRecord;
    }
  | {
      kind: "material-library";
      manifest: MaterialLibraryProjectManifest;
      isUnbound: boolean;
      isBuiltin: false;
    }
  | {
      kind: "skill-library";
      manifest: SkillLibraryProjectManifest;
      isUnbound: boolean;
      isBuiltin: boolean;
    }
  | {
      kind: "material-group";
      manifest: MaterialGroupProjectManifest;
    }
  | {
      kind: "skill-group";
      manifest: SkillGroupProjectManifest;
    };

interface ValidatedArchiveItem {
  key: string;
  meta: LocalBackupManifestItem;
  files: Map<string, Buffer>;
  payload: ValidatedArchivePayload;
}

interface ValidatedArchiveBundle {
  manifest: LocalBackupManifest;
  items: ValidatedArchiveItem[];
  byKey: Map<string, ValidatedArchiveItem>;
}

export interface StagedBackupImportPlan {
  batchId: string;
  stagingRoot: string;
  backupPrevRoot: string;
  operations: StagedProjectDirectoryOp[];
  nextRegistries: RegistrySnapshotBundle;
  expectedRegistryFingerprints: Record<string, string>;
  summary: LocalBackupImportResult;
}

function parseUtf8Json(buffer: Buffer, label: string): unknown {
  try {
    return JSON.parse(
      buffer.toString("utf8").replace(/^\uFEFF/u, "")
    ) as unknown;
  } catch {
    throw new LocalBackupError(
      "local_backup.invalid_archive",
      `备份包中的「${label}」不是有效的 JSON 文件。`
    );
  }
}

function requireItemFile(
  files: ReadonlyMap<string, Buffer>,
  relativePath: string,
  itemTitle: string
): Buffer {
  const bytes = files.get(relativePath);
  if (!bytes) {
    throw new LocalBackupError(
      "local_backup.invalid_archive",
      `项目「${itemTitle}」缺少必需文件：${relativePath}`
    );
  }
  return bytes;
}

function validateIdentityRecordIfPresent(
  files: ReadonlyMap<string, Buffer>,
  expectedBookId: string,
  itemTitle: string
): BookIdentityRecord | undefined {
  const raw = files.get("book-identity/identity.json");
  if (!raw) return undefined;
  const parsed = BookIdentityRecordSchema.safeParse(
    parseUtf8Json(raw, `${itemTitle}/book-identity/identity.json`)
  );
  if (!parsed.success || parsed.data.bookId !== expectedBookId) {
    throw new LocalBackupError(
      "local_backup.invalid_archive",
      `作品「${itemTitle}」的封面与书名设计记录损坏或书号不匹配。`
    );
  }
  if (
    parsed.data.adopted.cover?.file &&
    !files.has("book-identity/cover.png")
  ) {
    throw new LocalBackupError(
      "local_backup.invalid_archive",
      `作品「${itemTitle}」声明了已采纳封面，但缺少 book-identity/cover.png。`
    );
  }
  return parsed.data;
}

export function validateItemPayload(
  meta: LocalBackupManifestItem,
  files: ReadonlyMap<string, Buffer>
): ValidatedArchivePayload {
  const manifestBytes = requireItemFile(files, "deepwrite.json", meta.title);
  const rawManifest = parseUtf8Json(
    manifestBytes,
    `${meta.title}/deepwrite.json`
  );

  switch (meta.kind) {
    case "book": {
      const parsed = BookProjectManifestSchema.safeParse(rawManifest);
      if (!parsed.success || parsed.data.id !== meta.id) {
        throw new LocalBackupError(
          "local_backup.invalid_archive",
          `作品「${meta.title}」的清单结构无效或标识不匹配。`
        );
      }
      const manifest = parsed.data;
      const writeReceiptPaths =
        "writeReceipts" in manifest && Array.isArray(manifest.writeReceipts)
          ? manifest.writeReceipts.map((r) => r.path)
          : [];
      const requiredPaths = [
        ...manifest.documents.map((doc) => doc.path),
        ...writeReceiptPaths,
        ...(manifest.bookType === "academic"
          ? [
              manifest.foundation.thesisOverview.path,
              manifest.foundation.terminology.path,
              ...manifest.foundation.cards.map((c) => c.document.path),
              ...manifest.manuscript.sections.flatMap((s) => [
                s.brief.path,
                s.body.path,
                s.state.path
              ])
            ]
          : "draft" in manifest
            ? manifest.draft.sections.flatMap((s) => [
                s.body.path,
                s.characterState.path
              ])
            : [])
      ];
      for (const path of requiredPaths) {
        requireItemFile(files, path, manifest.title);
      }
      const identity = validateIdentityRecordIfPresent(
        files,
        manifest.id,
        manifest.title
      );
      return {
        kind: "book",
        manifest,
        linkedMaterialIds:
          manifest.bookType === "academic"
            ? [...manifest.linkedMaterialIds]
            : flattenMaterialIdsByKind(manifest.linkedMaterialIdsByKind),
        linkedSkillIds:
          manifest.bookType === "academic"
            ? [...manifest.linkedSkillIds]
            : flattenSkillIdsByKind(manifest.linkedSkillIdsByKind),
        ...(identity ? { identity } : {})
      };
    }

    case "long-book": {
      const parsedManifest = LongProjectManifestSchema.safeParse(
        stripLegacyLongVersionMetadata(rawManifest).value
      );
      if (!parsedManifest.success || parsedManifest.data.id !== meta.id) {
        throw new LocalBackupError(
          "local_backup.invalid_archive",
          `长篇作品「${meta.title}」清单损坏或标识不匹配。`
        );
      }
      const manifest = parsedManifest.data;
      const rawIndex = parseUtf8Json(
        requireItemFile(files, "long/index.json", manifest.title),
        `${manifest.title}/long/index.json`
      );
      const parsedIndex = LongWorkspaceIndexSnapshotSchema.safeParse(
        stripLegacyLongVersionMetadata(rawIndex).value
      );
      if (!parsedIndex.success) {
        throw new LocalBackupError(
          "local_backup.invalid_archive",
          `长篇作品「${manifest.title}」工作区索引损坏。`
        );
      }
      const index = parsedIndex.data;
      try {
        assertLongProjectIndexMetadata(manifest, index);
      } catch {
        throw new LocalBackupError(
          "local_backup.invalid_archive",
          `长篇作品「${manifest.title}」的清单与工作区索引时间戳不一致。`
        );
      }

      const ledgerByPath = new Map<string, LongLedgerCommitRecord>();
      const ledgerRecords: LongLedgerCommitRecord[] = [];
      for (const slot of indexedFileSlots(index)) {
        requireItemFile(files, slot.reference.path, manifest.title);
      }
      for (const commit of index.ledger.commits) {
        const fileBytes = requireItemFile(
          files,
          commit.recordFile.path,
          manifest.title
        );
        const parsedRecord = parseLongLedgerCommitRecord(
          parseUtf8Json(
            fileBytes,
            `${manifest.title}/${commit.recordFile.path}`
          )
        );
        ledgerByPath.set(commit.recordFile.path, parsedRecord);
        ledgerRecords.push(parsedRecord);
      }
      try {
        assertLongLedgerRecordChain(index, ledgerRecords);
      } catch (error: unknown) {
        throw new LocalBackupError(
          "local_backup.invalid_archive",
          `长篇作品「${manifest.title}」连续性账本校验失败：${error instanceof Error ? error.message : "结构不一致"}`
        );
      }
      const identity = validateIdentityRecordIfPresent(
        files,
        manifest.id,
        manifest.title
      );
      return {
        kind: "long-book",
        manifest,
        index,
        ledgerByPath,
        linkedMaterialIds: flattenMaterialIdsByKind(
          manifest.linkedMaterialIdsByKind
        ),
        linkedSkillIds: flattenSkillIdsByKind(manifest.linkedSkillIdsByKind),
        ...(identity ? { identity } : {})
      };
    }

    case "mystery-book": {
      const parsed = MysteryBookManifestSchema.safeParse(rawManifest);
      if (!parsed.success || parsed.data.id !== meta.id) {
        throw new LocalBackupError(
          "local_backup.invalid_archive",
          `剧本杀作品「${meta.title}」清单损坏或标识不匹配。`
        );
      }
      const identity = validateIdentityRecordIfPresent(
        files,
        parsed.data.id,
        parsed.data.title
      );
      return {
        kind: "mystery-book",
        manifest: parsed.data,
        linkedMaterialIds: [...parsed.data.linkedMaterialIds],
        linkedSkillIds: [...parsed.data.linkedSkillIds],
        ...(identity ? { identity } : {})
      };
    }

    case "material-library": {
      const parsed =
        MaterialLibraryProjectManifestSchema.safeParse(rawManifest);
      if (!parsed.success || parsed.data.id !== meta.id) {
        throw new LocalBackupError(
          "local_backup.invalid_archive",
          `素材库「${meta.title}」清单损坏或标识不匹配。`
        );
      }
      for (const entry of parsed.data.entries) {
        requireItemFile(files, entry.path, parsed.data.title);
      }
      return {
        kind: "material-library",
        manifest: parsed.data,
        isUnbound: Boolean(meta.isUnbound),
        isBuiltin: false
      };
    }

    case "skill-library": {
      const parsed = SkillLibraryProjectManifestSchema.safeParse(rawManifest);
      if (!parsed.success || parsed.data.id !== meta.id) {
        throw new LocalBackupError(
          "local_backup.invalid_archive",
          `技能库「${meta.title}」清单损坏或标识不匹配。`
        );
      }
      for (const entry of parsed.data.entries) {
        requireItemFile(files, entry.path, parsed.data.title);
      }
      return {
        kind: "skill-library",
        manifest: parsed.data,
        isUnbound: Boolean(meta.isUnbound),
        isBuiltin: parsed.data.isBuiltin
      };
    }

    case "material-group": {
      const parsed = MaterialGroupProjectManifestSchema.safeParse(rawManifest);
      if (!parsed.success || parsed.data.id !== meta.id) {
        throw new LocalBackupError(
          "local_backup.invalid_archive",
          `素材分组「${meta.title}」清单损坏或标识不匹配。`
        );
      }
      return { kind: "material-group", manifest: parsed.data };
    }

    case "skill-group": {
      const parsed = SkillGroupProjectManifestSchema.safeParse(rawManifest);
      if (!parsed.success || parsed.data.id !== meta.id) {
        throw new LocalBackupError(
          "local_backup.invalid_archive",
          `技能分组「${meta.title}」清单损坏或标识不匹配。`
        );
      }
      return { kind: "skill-group", manifest: parsed.data };
    }
  }
}

export async function readAndValidateBackupArchive(
  archivePath: string
): Promise<ValidatedArchiveBundle> {
  const archive = await openVerifiedBackupZipArchive(archivePath);
  try {
    if (!archive.has(BACKUP_MANIFEST_FILENAME)) {
      throw new LocalBackupError(
        "local_backup.invalid_archive",
        "备份包缺少 manifest.json，可能已损坏或不是 DeepWrite 备份包。"
      );
    }
    const rawManifest = parseUtf8Json(
      await archive.readEntry(BACKUP_MANIFEST_FILENAME),
      BACKUP_MANIFEST_FILENAME
    );
    if (
      isRecord(rawManifest) &&
      typeof rawManifest.formatVersion === "number" &&
      rawManifest.formatVersion > LOCAL_BACKUP_FORMAT_VERSION
    ) {
      throw new LocalBackupError(
        "local_backup.unsupported_format_version",
        `此备份包格式版本（v${rawManifest.formatVersion}）高于当前 DeepWrite 支持的版本（v${LOCAL_BACKUP_FORMAT_VERSION}），请先升级应用。`,
        { formatVersion: rawManifest.formatVersion }
      );
    }
    const parsedManifest = LocalBackupManifestSchema.safeParse(rawManifest);
    if (!parsedManifest.success) {
      throw new LocalBackupError(
        "local_backup.invalid_archive",
        "备份包清单 manifest.json 格式无效。"
      );
    }
    const manifest = parsedManifest.data;

    for (const entryName of archive.entryNames) {
      if (
        entryName !== BACKUP_MANIFEST_FILENAME &&
        !(entryName in manifest.sha256ByPath)
      ) {
        throw new LocalBackupError(
          "local_backup.invalid_archive",
          `备份包包含未在清单中声明的冗余文件：${entryName}`
        );
      }
    }

    const prefixToKey = new Map<string, string>();
    const filesByKey = new Map<string, Map<string, Buffer>>();
    for (const item of manifest.items) {
      const key = backupItemKey(item.kind, item.id);
      if (filesByKey.has(key)) {
        throw new LocalBackupError(
          "local_backup.invalid_archive",
          `备份清单包含重复项目：${key}`
        );
      }
      const prefix = backupItemArchivePrefix(item.kind, item.id);
      if (prefixToKey.has(prefix)) {
        throw new LocalBackupError(
          "local_backup.invalid_archive",
          `备份清单包含冲突归档前缀：${prefix}`
        );
      }
      prefixToKey.set(prefix, key);
      filesByKey.set(key, new Map());
    }

    for (const [archiveEntryPath, expectedSha256] of Object.entries(
      manifest.sha256ByPath
    )) {
      const normalized = normalizeBackupArchivePath(archiveEntryPath);
      if (!archive.has(normalized)) {
        throw new LocalBackupError(
          "local_backup.invalid_archive",
          `备份包缺少清单声明的文件：${normalized}`
        );
      }
      let matchedKey: string | undefined;
      let matchedPrefix = "";
      for (const [prefix, key] of prefixToKey) {
        if (normalized.startsWith(prefix)) {
          matchedKey = key;
          matchedPrefix = prefix;
          break;
        }
      }
      if (!matchedKey) {
        throw new LocalBackupError(
          "local_backup.invalid_archive",
          `备份包存在未归属任何项目的文件：${normalized}`
        );
      }
      const bytes = await archive.readEntry(normalized);
      if (sha256Hex(bytes) !== expectedSha256) {
        throw new LocalBackupError(
          "local_backup.checksum_mismatch",
          `文件「${normalized}」SHA-256 校验和不匹配，请重新导出后再试。`
        );
      }
      const relativePath = normalized.slice(matchedPrefix.length);
      if (!relativePath) {
        throw new LocalBackupError(
          "local_backup.invalid_archive",
          `备份文件路径非法：${normalized}`
        );
      }
      filesByKey.get(matchedKey)!.set(relativePath, bytes);
    }

    const items: ValidatedArchiveItem[] = [];
    const byKey = new Map<string, ValidatedArchiveItem>();
    for (const meta of manifest.items) {
      const key = backupItemKey(meta.kind, meta.id);
      const files = filesByKey.get(key)!;
      const computed = computeProjectFilesHash(
        [...files.entries()].map(([relativePath, bytes]) => ({
          relativePath,
          bytes
        }))
      );
      if (
        computed.hash !== meta.hash ||
        computed.sizeBytes !== meta.sizeBytes
      ) {
        throw new LocalBackupError(
          "local_backup.checksum_mismatch",
          `项目「${meta.title}」校验和或体积不匹配，备份可能已损坏。`
        );
      }
      const payload = validateItemPayload(meta, files);
      const validated: ValidatedArchiveItem = { key, meta, files, payload };
      items.push(validated);
      byKey.set(key, validated);
    }

    return { manifest, items, byKey };
  } finally {
    await archive.close();
  }
}

interface ExistingProjectEntry {
  key: string;
  kind: LocalBackupItemKind;
  id: string;
  title: string;
  projectDirectory: string;
  isUnbound: boolean;
  isBuiltin: boolean;
}

interface TargetCatalogState {
  registries: RegistrySnapshotBundle;
  realRoots: Set<string>;
  existingByKey: Map<string, ExistingProjectEntry>;
  existingHashes: Map<string, string>;
  materialTitleSet: Set<string>;
  skillTitleSet: Set<string>;
  materialGroupTitleSet: Set<string>;
  skillGroupTitleSet: Set<string>;
  bookTitleSet: Set<string>;
  validMaterialIds: Set<string>;
  validSkillIds: Set<string>;
  unboundMaterial?: ExistingProjectEntry;
  unboundSkill?: ExistingProjectEntry;
}

async function readJsonFromProjectRoot(
  projectDirectory: string,
  relPath: string
): Promise<unknown> {
  const raw = await readFile(join(projectDirectory, relPath), "utf8");
  return JSON.parse(raw.replace(/^\uFEFF/u, "")) as unknown;
}

async function loadTargetCatalogState(
  userDataPath: string
): Promise<TargetCatalogState> {
  const registries = await readAllRegistries(userDataPath);
  const realRoots = await collectRegisteredRealRoots(registries);
  const unboundIds = new Set(
    registries.catalog.libraryOrganization?.unboundLibraryIds ?? []
  );

  const existingByKey = new Map<string, ExistingProjectEntry>();
  const existingHashes = new Map<string, string>();
  const materialTitleSet = new Set<string>();
  const skillTitleSet = new Set<string>();
  const materialGroupTitleSet = new Set<string>();
  const skillGroupTitleSet = new Set<string>();
  const bookTitleSet = new Set<string>();
  const validMaterialIds = new Set<string>(BUILTIN_MATERIAL_LIBRARY_IDS);
  const validSkillIds = new Set<string>(BUILTIN_SKILL_LIBRARY_IDS);
  let unboundMaterial: ExistingProjectEntry | undefined;
  let unboundSkill: ExistingProjectEntry | undefined;

  for (const reg of registries.catalog.projects) {
    const kind = reg.domain as LocalBackupItemKind;
    const key = backupItemKey(kind, reg.id);
    const isUnbound = unboundIds.has(reg.id);
    let title = basename(reg.projectDirectory);
    let isBuiltin = false;
    try {
      const raw = await readJsonFromProjectRoot(
        reg.projectDirectory,
        "deepwrite.json"
      );
      if (isRecord(raw) && typeof raw.title === "string") {
        title = raw.title;
      }
      if (kind === "skill-library" && isRecord(raw)) {
        isBuiltin = Boolean(raw.isBuiltin);
      }
      const hashed = await hashProjectDirectoryOnDisk(
        reg.projectDirectory,
        realRoots
      );
      existingHashes.set(key, hashed.hash);
    } catch {
      // Missing/unreadable directory on disk behaves cleanly as hashed mismatch or missing.
    }
    const entry: ExistingProjectEntry = {
      key,
      kind,
      id: reg.id,
      title,
      projectDirectory: reg.projectDirectory,
      isUnbound,
      isBuiltin
    };
    existingByKey.set(key, entry);

    const foldedTitle = caseFoldPathKey(title);
    if (kind === "book") {
      bookTitleSet.add(foldedTitle);
    } else if (kind === "material-library") {
      if (isUnbound) {
        unboundMaterial ??= entry;
      } else {
        validMaterialIds.add(reg.id);
        materialTitleSet.add(foldedTitle);
      }
    } else if (kind === "skill-library") {
      if (isUnbound) {
        unboundSkill ??= entry;
      } else {
        validSkillIds.add(reg.id);
        skillTitleSet.add(foldedTitle);
      }
    } else if (kind === "material-group") {
      materialGroupTitleSet.add(foldedTitle);
    } else if (kind === "skill-group") {
      skillGroupTitleSet.add(foldedTitle);
    }
  }

  for (const reg of registries.long.projects) {
    if (reg.deletion) continue;
    const key = backupItemKey("long-book", reg.bookId);
    let title = reg.summary?.title ?? basename(reg.projectDirectory);
    try {
      const raw = await readJsonFromProjectRoot(
        reg.projectDirectory,
        "deepwrite.json"
      );
      if (isRecord(raw) && typeof raw.title === "string") {
        title = raw.title;
      }
      const hashed = await hashProjectDirectoryOnDisk(
        reg.projectDirectory,
        realRoots
      );
      existingHashes.set(key, hashed.hash);
    } catch {
      // Missing directory handled on apply/stage checks.
    }
    existingByKey.set(key, {
      key,
      kind: "long-book",
      id: reg.bookId,
      title,
      projectDirectory: reg.projectDirectory,
      isUnbound: false,
      isBuiltin: false
    });
    bookTitleSet.add(caseFoldPathKey(title));
  }

  for (const reg of registries.mystery.projects) {
    const key = backupItemKey("mystery-book", reg.bookId);
    const title = reg.summary.title;
    try {
      const hashed = await hashProjectDirectoryOnDisk(
        reg.projectDirectory,
        realRoots
      );
      existingHashes.set(key, hashed.hash);
    } catch {
      // Missing directory handled cleanly.
    }
    existingByKey.set(key, {
      key,
      kind: "mystery-book",
      id: reg.bookId,
      title,
      projectDirectory: reg.projectDirectory,
      isUnbound: false,
      isBuiltin: false
    });
    bookTitleSet.add(caseFoldPathKey(title));
  }

  return {
    registries,
    realRoots,
    existingByKey,
    existingHashes,
    materialTitleSet,
    skillTitleSet,
    materialGroupTitleSet,
    skillGroupTitleSet,
    bookTitleSet,
    validMaterialIds,
    validSkillIds,
    ...(unboundMaterial ? { unboundMaterial } : {}),
    ...(unboundSkill ? { unboundSkill } : {})
  };
}

export async function computeRegistryFingerprints(
  userDataPath: string
): Promise<Record<string, string>> {
  const resolved = resolve(userDataPath);
  const files: Array<[string, string]> = [
    ["__registry__:catalog", "catalog-registry.json"],
    ["__registry__:long", "long-project-registry.json"],
    ["__registry__:mystery", "mystery-projects.json"]
  ];
  const fingerprints: Record<string, string> = {};
  for (const [key, filename] of files) {
    try {
      const bytes = await readFile(join(resolved, filename));
      fingerprints[key] = sha256Hex(bytes);
    } catch (error: unknown) {
      if (isNodeError(error, "ENOENT")) {
        fingerprints[key] = "__absent__";
      } else {
        throw error;
      }
    }
  }
  return fingerprints;
}

async function computeFullTargetFingerprints(
  userDataPath: string,
  state: TargetCatalogState
): Promise<Record<string, string>> {
  const fingerprints = await computeRegistryFingerprints(userDataPath);
  for (const key of state.existingByKey.keys()) {
    fingerprints[key] = state.existingHashes.get(key) ?? "__unreadable__";
  }
  return fingerprints;
}

function mapsEqual(
  expected: Readonly<Record<string, string>>,
  actual: Readonly<Record<string, string>>
): boolean {
  const expectedKeys = Object.keys(expected);
  const actualKeys = Object.keys(actual);
  if (expectedKeys.length !== actualKeys.length) {
    return false;
  }
  return expectedKeys.every((key) => expected[key] === actual[key]);
}

function titleSetForKind(
  state: TargetCatalogState,
  kind: LocalBackupItemKind
): Set<string> {
  switch (kind) {
    case "book":
    case "long-book":
    case "mystery-book":
      return state.bookTitleSet;
    case "material-library":
      return state.materialTitleSet;
    case "skill-library":
      return state.skillTitleSet;
    case "material-group":
      return state.materialGroupTitleSet;
    case "skill-group":
      return state.skillGroupTitleSet;
  }
}

function unboundEntryFingerprint(
  entry: { stageId: string; title: string },
  bodyBytes: Buffer
): string {
  return `${entry.stageId}\0${entry.title.normalize("NFC")}\0${sha256Hex(bodyBytes)}`;
}

async function isUnboundSubsetAlreadyInTarget(
  item: ValidatedArchiveItem,
  targetEntry: ExistingProjectEntry
): Promise<boolean> {
  if (
    item.payload.kind !== "material-library" &&
    item.payload.kind !== "skill-library"
  ) {
    return false;
  }
  try {
    const rawTarget = await readJsonFromProjectRoot(
      targetEntry.projectDirectory,
      "deepwrite.json"
    );
    const targetFingerprints = new Set<string>();
    const targetEntries =
      item.payload.kind === "material-library"
        ? MaterialLibraryProjectManifestSchema.parse(rawTarget).entries
        : SkillLibraryProjectManifestSchema.parse(rawTarget).entries;
    for (const entry of targetEntries) {
      const body = await readFile(
        join(targetEntry.projectDirectory, entry.path)
      );
      targetFingerprints.add(unboundEntryFingerprint(entry, body));
    }
    for (const entry of item.payload.manifest.entries) {
      const body = item.files.get(entry.path);
      if (
        !body ||
        !targetFingerprints.has(unboundEntryFingerprint(entry, body))
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function remapLibraryIdList(
  ids: readonly string[],
  remap: (id: string) => string,
  validIds: ReadonlySet<string>
): { next: string[]; removed: number } {
  const next: string[] = [];
  const seen = new Set<string>();
  let removed = 0;
  for (const id of ids) {
    const mapped = remap(id);
    if (!validIds.has(mapped)) {
      removed += 1;
      continue;
    }
    if (!seen.has(mapped)) {
      seen.add(mapped);
      next.push(mapped);
    }
  }
  return { next, removed };
}

function remapByKind<Kind extends string>(
  source: Readonly<Record<Kind, string[]>>,
  kinds: readonly Kind[],
  remap: (id: string) => string,
  validIds: ReadonlySet<string>
): { next: Record<Kind, string[]>; removed: number } {
  let removed = 0;
  const entries: Array<[Kind, string[]]> = [];
  for (const kind of kinds) {
    const result = remapLibraryIdList(source[kind] ?? [], remap, validIds);
    removed += result.removed;
    entries.push([kind, result.next]);
  }
  return {
    next: Object.fromEntries(entries) as Record<Kind, string[]>,
    removed
  };
}

function remapLongStageScopes(
  scopes: LongLinkedResourceStageScopes | undefined,
  remapMat: (id: string) => string,
  remapSkill: (id: string) => string,
  validMatIds: ReadonlySet<string>,
  validSkillIds: ReadonlySet<string>
): LongLinkedResourceStageScopes | undefined {
  if (!scopes) return undefined;
  const mapDomain = (
    input: Record<string, LongLinkedResourceStageScopes["materials"][string]>,
    remap: (id: string) => string,
    validIds: ReadonlySet<string>
  ): Record<string, LongLinkedResourceStageScopes["materials"][string]> => {
    const out: Record<
      string,
      LongLinkedResourceStageScopes["materials"][string]
    > = {};
    for (const [id, stages] of Object.entries(input)) {
      const mapped = remap(id);
      if (validIds.has(mapped)) {
        out[mapped] = [...stages];
      }
    }
    return out;
  };
  return {
    materials: mapDomain(scopes.materials, remapMat, validMatIds),
    skills: mapDomain(scopes.skills, remapSkill, validSkillIds)
  };
}

function rewriteWorkBindingsInFiles(
  item: ValidatedArchiveItem,
  options: {
    targetId: string;
    targetTitle: string;
    remapMat: (id: string) => string;
    remapSkill: (id: string) => string;
    validMatIds: ReadonlySet<string>;
    validSkillIds: ReadonlySet<string>;
  }
): {
  files: Map<string, Buffer>;
  danglingRemoved: number;
  longIndex?: LongWorkspaceIndexSnapshot;
  mysteryManifest?: MysteryBookManifest;
} {
  const {
    targetId,
    targetTitle,
    remapMat,
    remapSkill,
    validMatIds,
    validSkillIds
  } = options;
  const files = new Map<string, Buffer>(item.files);
  let danglingRemoved = 0;

  if (item.payload.kind === "book") {
    const original = item.payload.manifest;
    let updatedManifest: BookProjectManifest;
    if (original.bookType === "academic") {
      const mats = remapLibraryIdList(
        original.linkedMaterialIds,
        remapMat,
        validMatIds
      );
      const skills = remapLibraryIdList(
        original.linkedSkillIds,
        remapSkill,
        validSkillIds
      );
      danglingRemoved += mats.removed + skills.removed;
      updatedManifest = BookProjectManifestSchema.parse({
        ...original,
        id: targetId,
        title: targetTitle,
        linkedMaterialIds: mats.next,
        linkedSkillIds: skills.next
      });
    } else {
      const mats = remapByKind(
        original.linkedMaterialIdsByKind,
        MATERIAL_KINDS,
        remapMat,
        validMatIds
      );
      const skills = remapByKind(
        original.linkedSkillIdsByKind,
        SKILL_KINDS,
        remapSkill,
        validSkillIds
      );
      danglingRemoved += mats.removed + skills.removed;
      updatedManifest = BookProjectManifestSchema.parse({
        ...original,
        id: targetId,
        title: targetTitle,
        linkedMaterialIdsByKind: mats.next,
        linkedSkillIdsByKind: skills.next
      });
    }
    files.set(
      "deepwrite.json",
      Buffer.from(toJsonFileText(updatedManifest), "utf8")
    );
    if (item.payload.identity && targetId !== original.id) {
      const nextIdentity = BookIdentityRecordSchema.parse({
        ...item.payload.identity,
        bookId: targetId
      });
      files.set(
        "book-identity/identity.json",
        Buffer.from(toJsonFileText(nextIdentity), "utf8")
      );
    }
    return { files, danglingRemoved };
  }

  if (item.payload.kind === "long-book") {
    const original = item.payload.manifest;
    const mats = remapByKind(
      original.linkedMaterialIdsByKind,
      MATERIAL_KINDS,
      remapMat,
      validMatIds
    );
    const skills = remapByKind(
      original.linkedSkillIdsByKind,
      SKILL_KINDS,
      remapSkill,
      validSkillIds
    );
    danglingRemoved += mats.removed + skills.removed;
    const nextScopes = remapLongStageScopes(
      original.linkedResourceStageScopes,
      remapMat,
      remapSkill,
      validMatIds,
      validSkillIds
    );
    const updatedManifest = LongProjectManifestSchema.parse({
      ...original,
      id: targetId,
      title: targetTitle,
      linkedMaterialIdsByKind: mats.next,
      linkedSkillIdsByKind: skills.next,
      ...(nextScopes ? { linkedResourceStageScopes: nextScopes } : {})
    });
    files.set(
      "deepwrite.json",
      Buffer.from(toJsonFileText(updatedManifest), "utf8")
    );

    let nextIndex = item.payload.index;
    const ledgerRecords: LongLedgerCommitRecord[] = [];
    if (targetId !== original.id) {
      nextIndex = LongWorkspaceIndexSnapshotSchema.parse(
        replaceExactIdentity(item.payload.index, original.id, targetId)
      );
      files.set(
        "long/index.json",
        Buffer.from(toJsonFileText(nextIndex), "utf8")
      );
      for (const [ledgerPath, record] of item.payload.ledgerByPath) {
        const nextRecord = parseLongLedgerCommitRecord(
          replaceExactIdentity(record, original.id, targetId)
        );
        files.set(ledgerPath, Buffer.from(toJsonFileText(nextRecord), "utf8"));
        ledgerRecords.push(nextRecord);
      }
      assertLongProjectIndexMetadata(updatedManifest, nextIndex);
      assertLongLedgerRecordChain(nextIndex, ledgerRecords);
      if (item.payload.identity) {
        const nextIdentity = BookIdentityRecordSchema.parse({
          ...item.payload.identity,
          bookId: targetId
        });
        files.set(
          "book-identity/identity.json",
          Buffer.from(toJsonFileText(nextIdentity), "utf8")
        );
      }
    }
    return { files, danglingRemoved, longIndex: nextIndex };
  }

  if (item.payload.kind === "mystery-book") {
    const original = item.payload.manifest;
    const mats = remapLibraryIdList(
      original.linkedMaterialIds,
      remapMat,
      validMatIds
    );
    const skills = remapLibraryIdList(
      original.linkedSkillIds,
      remapSkill,
      validSkillIds
    );
    danglingRemoved += mats.removed + skills.removed;
    const updatedManifest = MysteryBookManifestSchema.parse({
      ...original,
      id: targetId,
      title: targetTitle,
      linkedMaterialIds: mats.next,
      linkedSkillIds: skills.next
    });
    files.set(
      "deepwrite.json",
      Buffer.from(toJsonFileText(updatedManifest), "utf8")
    );
    if (item.payload.identity && targetId !== original.id) {
      const nextIdentity = BookIdentityRecordSchema.parse({
        ...item.payload.identity,
        bookId: targetId
      });
      files.set(
        "book-identity/identity.json",
        Buffer.from(toJsonFileText(nextIdentity), "utf8")
      );
    }
    return { files, danglingRemoved, mysteryManifest: updatedManifest };
  }

  if (
    item.payload.kind === "material-group" ||
    item.payload.kind === "skill-group"
  ) {
    const isMaterial = item.payload.kind === "material-group";
    const original = item.payload.manifest;
    const validIds = isMaterial ? validMatIds : validSkillIds;
    const remap = isMaterial ? remapMat : remapSkill;
    const members = remapLibraryIdList(original.memberIds, remap, validIds);
    danglingRemoved += members.removed;
    const parsed = isMaterial
      ? MaterialGroupProjectManifestSchema.parse({
          ...original,
          id: targetId,
          title: targetTitle,
          memberIds: members.next
        })
      : SkillGroupProjectManifestSchema.parse({
          ...original,
          id: targetId,
          title: targetTitle,
          memberIds: members.next
        });
    files.set("deepwrite.json", Buffer.from(toJsonFileText(parsed), "utf8"));
    return { files, danglingRemoved };
  }

  return { files, danglingRemoved };
}

function simulatedNormalizedHashForTarget(
  item: ValidatedArchiveItem,
  validMatIds: ReadonlySet<string>,
  validSkillIds: ReadonlySet<string>,
  options: {
    targetId?: string;
    targetTitle?: string;
    remapMat?: (id: string) => string;
    remapSkill?: (id: string) => string;
  } = {}
): string {
  const rewritten = rewriteWorkBindingsInFiles(item, {
    targetId: options.targetId ?? item.meta.id,
    targetTitle: options.targetTitle ?? item.meta.title,
    remapMat: options.remapMat ?? ((id) => id),
    remapSkill: options.remapSkill ?? ((id) => id),
    validMatIds,
    validSkillIds
  });
  return computeProjectFilesHash(
    [...rewritten.files.entries()].map(([relativePath, bytes]) => ({
      relativePath,
      bytes
    }))
  ).hash;
}

function computeLibraryRenamedHash(
  item: ValidatedArchiveItem,
  targetId: string,
  targetTitle: string
): string | undefined {
  if (
    item.payload.kind !== "material-library" &&
    item.payload.kind !== "skill-library"
  ) {
    return undefined;
  }
  const files = new Map<string, Buffer>(item.files);
  const nextManifest =
    item.payload.kind === "material-library"
      ? MaterialLibraryProjectManifestSchema.parse({
          ...item.payload.manifest,
          id: targetId,
          title: targetTitle
        })
      : SkillLibraryProjectManifestSchema.parse({
          ...item.payload.manifest,
          id: targetId,
          title: targetTitle
        });
  files.set(
    "deepwrite.json",
    Buffer.from(toJsonFileText(nextManifest), "utf8")
  );
  return computeProjectFilesHash(
    [...files.entries()].map(([relativePath, bytes]) => ({
      relativePath,
      bytes
    }))
  ).hash;
}

/**
 * Detects whether conflicting archive items already have exact content-equivalent
 * copies in `state` (created by an earlier `keep_both` import), preventing
 * duplicate `(备份)` copies on immediate repeat preview/import.
 */
function findEquivalentTargetCopies(
  bundle: ValidatedArchiveBundle,
  state: TargetCatalogState,
  validMatIds: ReadonlySet<string>,
  validSkillIds: ReadonlySet<string>
): {
  equivalentCopyByKey: Map<string, ExistingProjectEntry>;
  equivMatMap: Map<string, string>;
  equivSkillMap: Map<string, string>;
} {
  const equivalentCopyByKey = new Map<string, ExistingProjectEntry>();
  const equivMatMap = new Map<string, string>();
  const equivSkillMap = new Map<string, string>();
  const allTargets = [...state.existingByKey.values()];

  for (const item of bundle.items) {
    if (
      item.payload.kind !== "material-library" &&
      item.payload.kind !== "skill-library"
    ) {
      continue;
    }
    if (item.payload.isUnbound || item.payload.isBuiltin) continue;
    const isMaterial = item.payload.kind === "material-library";
    const idMap = isMaterial ? equivMatMap : equivSkillMap;
    const existing = state.existingByKey.get(item.key);
    if (!existing) continue;
    if (state.existingHashes.get(item.key) === item.meta.hash) {
      idMap.set(item.meta.id, item.meta.id);
      continue;
    }
    for (const candidate of allTargets) {
      if (
        candidate.kind !== item.meta.kind ||
        candidate.key === item.key ||
        candidate.isUnbound ||
        candidate.isBuiltin
      ) {
        continue;
      }
      const candidateHash = state.existingHashes.get(candidate.key);
      if (!candidateHash) continue;
      if (
        computeLibraryRenamedHash(item, candidate.id, candidate.title) ===
        candidateHash
      ) {
        equivalentCopyByKey.set(item.key, candidate);
        idMap.set(item.meta.id, candidate.id);
        break;
      }
    }
  }

  const remapMat = (id: string) => equivMatMap.get(id) ?? id;
  const remapSkill = (id: string) => equivSkillMap.get(id) ?? id;

  for (const item of bundle.items) {
    if (
      item.payload.kind === "material-library" ||
      item.payload.kind === "skill-library"
    ) {
      continue;
    }
    const existing = state.existingByKey.get(item.key);
    if (!existing) continue;
    const directHash = state.existingHashes.get(item.key);
    if (directHash === item.meta.hash) continue;
    try {
      if (
        directHash ===
        simulatedNormalizedHashForTarget(item, validMatIds, validSkillIds, {
          remapMat,
          remapSkill
        })
      ) {
        continue;
      }
    } catch {
      // Ignore simulation failures on malformed optional candidates.
    }

    for (const candidate of allTargets) {
      if (candidate.kind !== item.meta.kind || candidate.key === item.key) {
        continue;
      }
      const candidateHash = state.existingHashes.get(candidate.key);
      if (!candidateHash) continue;
      try {
        if (
          simulatedNormalizedHashForTarget(item, validMatIds, validSkillIds, {
            targetId: candidate.id,
            targetTitle: candidate.title,
            remapMat,
            remapSkill
          }) === candidateHash
        ) {
          equivalentCopyByKey.set(item.key, candidate);
          break;
        }
      } catch {
        // Long-book ID check mismatches are skipped silently.
      }
    }
  }

  return { equivalentCopyByKey, equivMatMap, equivSkillMap };
}

export async function previewLocalBackupArchive(options: {
  archivePath: string;
  userDataPath: string;
  workspaceDirectory: string;
  statfsImpl?: StatFsFn;
}): Promise<LocalBackupCorePreviewResult> {
  const bundle = await readAndValidateBackupArchive(options.archivePath);
  const state = await loadTargetCatalogState(options.userDataPath);

  const previewValidMatIds = new Set(state.validMaterialIds);
  const previewValidSkillIds = new Set(state.validSkillIds);
  for (const item of bundle.items) {
    if (item.payload.kind === "material-library" && !item.payload.isUnbound) {
      previewValidMatIds.add(item.meta.id);
    }
    if (
      item.payload.kind === "skill-library" &&
      !item.payload.isUnbound &&
      !item.payload.isBuiltin
    ) {
      previewValidSkillIds.add(item.meta.id);
    }
  }

  const { equivalentCopyByKey, equivMatMap, equivSkillMap } =
    findEquivalentTargetCopies(
      bundle,
      state,
      previewValidMatIds,
      previewValidSkillIds
    );
  const previewRemapMat = (id: string) => equivMatMap.get(id) ?? id;
  const previewRemapSkill = (id: string) => equivSkillMap.get(id) ?? id;

  const previewItems: LocalBackupPreviewItem[] = [];
  const localHashes = await computeFullTargetFingerprints(
    options.userDataPath,
    state
  );
  let candidateBytes = 0;

  for (const item of bundle.items) {
    const existing = state.existingByKey.get(item.key);
    const existingHash = state.existingHashes.get(item.key);

    let status: LocalBackupPreviewStatus;
    let hasTitleCollision = false;

    if (item.payload.kind === "skill-library" && item.payload.isBuiltin) {
      status = "builtin_skipped";
    } else if (
      item.payload.kind === "material-library" &&
      item.payload.isUnbound &&
      state.unboundMaterial
    ) {
      status = (await isUnboundSubsetAlreadyInTarget(
        item,
        state.unboundMaterial
      ))
        ? "identical"
        : "new";
    } else if (
      item.payload.kind === "skill-library" &&
      item.payload.isUnbound &&
      state.unboundSkill
    ) {
      status = (await isUnboundSubsetAlreadyInTarget(item, state.unboundSkill))
        ? "identical"
        : "new";
    } else if (!existing || existingHash === undefined) {
      status = "new";
      hasTitleCollision = titleSetForKind(state, item.meta.kind).has(
        caseFoldPathKey(item.meta.title)
      );
    } else if (
      existingHash === item.meta.hash ||
      equivalentCopyByKey.has(item.key)
    ) {
      status = "identical";
    } else if (
      (item.payload.kind === "book" ||
        item.payload.kind === "long-book" ||
        item.payload.kind === "mystery-book" ||
        item.payload.kind === "material-group" ||
        item.payload.kind === "skill-group") &&
      existingHash ===
        simulatedNormalizedHashForTarget(
          item,
          previewValidMatIds,
          previewValidSkillIds,
          { remapMat: previewRemapMat, remapSkill: previewRemapSkill }
        )
    ) {
      status = "identical";
    } else {
      status = "conflict_same_id";
    }

    if (status === "new" || status === "conflict_same_id") {
      candidateBytes += item.meta.sizeBytes;
    }

    previewItems.push({
      key: item.key,
      kind: item.meta.kind,
      id: item.meta.id,
      title: item.meta.title,
      ...(item.meta.workSubtype ? { workSubtype: item.meta.workSubtype } : {}),
      ...(item.meta.isUnbound ? { isUnbound: true } : {}),
      sizeBytes: item.meta.sizeBytes,
      status,
      ...(hasTitleCollision ? { hasTitleCollision: true } : {})
    });
  }

  const requiredDiskBytes = requiredImportDiskBytes(candidateBytes);
  const availableDiskBytes = await readAvailableDiskBytes(
    options.workspaceDirectory,
    options.statfsImpl
  );

  return {
    preview: {
      fileName: basename(options.archivePath),
      sourcePlatform: bundle.manifest.platform,
      exportedAt: bundle.manifest.exportedAt,
      appVersion: bundle.manifest.appVersion,
      totalItems: previewItems.length,
      totalBytes: bundle.items.reduce(
        (sum, item) => sum + item.meta.sizeBytes,
        0
      ),
      availableDiskBytes,
      requiredDiskBytes,
      diskSpaceSufficient: availableDiskBytes >= requiredDiskBytes,
      items: previewItems
    },
    localHashes
  };
}

async function copyDirectoryToStaging(
  sourceDir: string,
  stagedDir: string
): Promise<Map<string, Buffer>> {
  const copied = new Map<string, Buffer>();
  const { readdir, lstat } = await import("node:fs/promises");

  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".deepwrite-") || entry.name === ".deepwrite") {
        continue;
      }
      const fullPath = join(current, entry.name);
      const info = await lstat(fullPath);
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory()) {
        await walk(fullPath);
      } else if (info.isFile()) {
        const rel = relative(sourceDir, fullPath)
          .split(sep)
          .join("/")
          .normalize("NFC");
        copied.set(rel, await readFile(fullPath));
      }
    }
  }

  await walk(sourceDir);
  await writeStagedFiles(stagedDir, copied);
  return copied;
}

async function writeStagedFiles(
  stagedDir: string,
  files: ReadonlyMap<string, Buffer>
): Promise<void> {
  await mkdir(stagedDir, { recursive: true, mode: 0o700 });
  for (const [relativePath, bytes] of files) {
    const cleanRel = normalizeBackupArchivePath(relativePath);
    const destination = resolve(stagedDir, cleanRel);
    assertPathContained(stagedDir, destination);
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await writeFile(destination, bytes, { mode: 0o600 });
  }
}

async function isInsideDirectory(
  parentReal: string,
  candidatePath: string
): Promise<{ inside: boolean; realTarget?: string }> {
  const { lstat, realpath } = await import("node:fs/promises");
  try {
    const info = await lstat(resolve(candidatePath));
    if (info.isSymbolicLink() || !info.isDirectory()) return { inside: false };
    const realTarget = await realpath(resolve(candidatePath));
    const offset = relative(parentReal, realTarget);
    const inside =
      offset !== "" &&
      !offset.startsWith(`..${sep}`) &&
      offset !== ".." &&
      !isAbsolute(offset);
    return inside ? { inside: true, realTarget } : { inside: false };
  } catch (error: unknown) {
    if (isNodeError(error, "ENOENT")) return { inside: false };
    throw error;
  }
}

export async function stageLocalBackupImport(
  input: LocalBackupCoreApplyImportAtPathInput & {
    userDataPath: string;
    statfsImpl?: StatFsFn;
  }
): Promise<StagedBackupImportPlan> {
  const realWorkspace = await ensureRealBackupDirectory(
    input.workspaceDirectory
  );
  const bundle = await readAndValidateBackupArchive(input.archivePath);
  const state = await loadTargetCatalogState(input.userDataPath);

  const selectedSet = new Set(input.selectedKeys);
  const selectedItems = bundle.items.filter(
    (item) =>
      selectedSet.has(item.key) &&
      !(item.payload.kind === "skill-library" && item.payload.isBuiltin)
  );

  // Target-change detection: ensure no target project or registry mutated since preview.
  const currentFingerprints = await computeFullTargetFingerprints(
    input.userDataPath,
    state
  );
  if (!mapsEqual(input.expectedLocalHashes, currentFingerprints)) {
    throw new LocalBackupError(
      "local_backup.target_changed",
      "本地作品、资料库或注册表在预览后发生了变化，请重新选择备份包以刷新对比结果。"
    );
  }
  const expectedRegistryFingerprints: Record<string, string> = {
    "__registry__:catalog": currentFingerprints["__registry__:catalog"]!,
    "__registry__:long": currentFingerprints["__registry__:long"]!,
    "__registry__:mystery": currentFingerprints["__registry__:mystery"]!
  };

  const totalSelectedBytes = selectedItems.reduce(
    (sum, item) => sum + item.meta.sizeBytes,
    0
  );
  await assertSufficientDiskSpace({
    targetPath: realWorkspace,
    requiredBytes: requiredImportDiskBytes(totalSelectedBytes),
    purpose: "import",
    ...(input.statfsImpl ? { statfsImpl: input.statfsImpl } : {})
  });

  const batchId = `${Date.now()}-${randomHex8()}`;
  const stagingRoot = join(
    realWorkspace,
    `.deepwrite-backup-staging-${batchId}`
  );
  const backupPrevRoot = join(
    realWorkspace,
    `.deepwrite-backup-prev-${batchId}`
  );
  await mkdir(stagingRoot, { recursive: true, mode: 0o700 });

  const operations: StagedProjectDirectoryOp[] = [];
  const reservedDirKeys = new Set<string>();
  const now = nowIso();

  const nextCatalog = structuredClone(state.registries.catalog);
  const nextLong = structuredClone(state.registries.long);
  const nextMystery = structuredClone(state.registries.mystery);

  const org: LibraryOrganization = nextCatalog.libraryOrganization
    ? structuredClone(nextCatalog.libraryOrganization)
    : emptyLibraryOrganization();

  const matIdMap = new Map<string, string>();
  const skillIdMap = new Map<string, string>();
  const groupMatIdMap = new Map<string, string>();
  const groupSkillIdMap = new Map<string, string>();

  const validMatIds = new Set(state.validMaterialIds);
  const validSkillIds = new Set(state.validSkillIds);
  const newTopLevelMatIds: string[] = [];
  const newTopLevelSkillIds: string[] = [];
  const groupedMatIds = new Set<string>();
  const groupedSkillIds = new Set<string>();

  for (const [groupId, members] of Object.entries(org.groups)) {
    const isMatGroup = nextCatalog.projects.some(
      (p) => p.id === groupId && p.domain === "material-group"
    );
    const targetSet = isMatGroup ? groupedMatIds : groupedSkillIds;
    for (const memberId of members) targetSet.add(memberId);
  }

  const stagedValidMatIds = new Set(state.validMaterialIds);
  const stagedValidSkillIds = new Set(state.validSkillIds);
  for (const item of bundle.items) {
    if (item.payload.kind === "material-library" && !item.payload.isUnbound) {
      stagedValidMatIds.add(item.meta.id);
    }
    if (
      item.payload.kind === "skill-library" &&
      !item.payload.isUnbound &&
      !item.payload.isBuiltin
    ) {
      stagedValidSkillIds.add(item.meta.id);
    }
  }
  const { equivalentCopyByKey } = findEquivalentTargetCopies(
    bundle,
    state,
    stagedValidMatIds,
    stagedValidSkillIds
  );

  let added = 0;
  let duplicated = 0;
  let replaced = 0;
  let skipped = 0;
  let danglingBindingsRemoved = 0;
  const warnings: string[] = [];

  try {
    // Pass 1: Stage material & skill libraries first so groups and works know final IDs.
    for (const item of selectedItems) {
      if (
        item.payload.kind !== "material-library" &&
        item.payload.kind !== "skill-library"
      ) {
        continue;
      }
      const isMaterial = item.payload.kind === "material-library";
      const targetUnbound = isMaterial
        ? state.unboundMaterial
        : state.unboundSkill;

      // Special case: merge unbound archive library into existing target unbound library.
      if (item.payload.isUnbound && targetUnbound) {
        const alreadySynced = await isUnboundSubsetAlreadyInTarget(
          item,
          targetUnbound
        );
        if (alreadySynced) {
          skipped += 1;
          continue;
        }
        const rawTarget = await readJsonFromProjectRoot(
          targetUnbound.projectDirectory,
          "deepwrite.json"
        );
        const targetManifest = isMaterial
          ? MaterialLibraryProjectManifestSchema.parse(rawTarget)
          : SkillLibraryProjectManifestSchema.parse(rawTarget);
        const existingFingerprints = new Set<string>();
        const usedPaths = new Set<string>();
        const targetDirContainment = await isInsideDirectory(
          realWorkspace,
          targetUnbound.projectDirectory
        );
        const stagedDir = join(
          stagingRoot,
          sanitizeBackupFolderName(item.meta.kind),
          randomHex8()
        );
        const existingFiles = await copyDirectoryToStaging(
          targetUnbound.projectDirectory,
          stagedDir
        );
        for (const entry of targetManifest.entries) {
          usedPaths.add(caseFoldPathKey(entry.path));
          const body = existingFiles.get(entry.path) ?? Buffer.alloc(0);
          existingFingerprints.add(unboundEntryFingerprint(entry, body));
        }

        const appendedEntries = [...targetManifest.entries];
        let appendedCount = 0;
        for (const entry of item.payload.manifest.entries) {
          const body = item.files.get(entry.path) ?? Buffer.alloc(0);
          if (existingFingerprints.has(unboundEntryFingerprint(entry, body))) {
            continue;
          }
          const newEntryId = createCatalogId(
            isMaterial ? "material-entry" : "skill-entry"
          );
          let relPath = `entries/${newEntryId}.md`;
          let suffix = 2;
          while (usedPaths.has(caseFoldPathKey(relPath))) {
            relPath = `entries/${newEntryId}-${suffix}.md`;
            suffix += 1;
          }
          usedPaths.add(caseFoldPathKey(relPath));
          const stagedEntryPath = resolve(stagedDir, relPath);
          assertPathContained(stagedDir, stagedEntryPath);
          await mkdir(dirname(stagedEntryPath), {
            recursive: true,
            mode: 0o700
          });
          await writeFile(stagedEntryPath, body, { mode: 0o600 });
          appendedEntries.push({
            ...entry,
            id: newEntryId,
            path: relPath,
            createdAt: entry.createdAt,
            updatedAt: now
          });
          appendedCount += 1;
        }

        if (appendedCount === 0) {
          await rm(stagedDir, { recursive: true, force: true });
          skipped += 1;
          continue;
        }
        const mergedManifest = isMaterial
          ? MaterialLibraryProjectManifestSchema.parse({
              ...targetManifest,
              revision: targetManifest.revision + 1,
              updatedAt: now,
              entries: appendedEntries
            })
          : SkillLibraryProjectManifestSchema.parse({
              ...targetManifest,
              revision: targetManifest.revision + 1,
              updatedAt: now,
              entries: appendedEntries
            });
        await writeFile(
          join(stagedDir, "deepwrite.json"),
          Buffer.from(toJsonFileText(mergedManifest), "utf8"),
          { mode: 0o600 }
        );

        const targetDir = targetDirContainment.inside
          ? targetDirContainment.realTarget!
          : await allocateWorkspaceProjectDirectory(
              realWorkspace,
              item.meta.kind,
              targetManifest.title,
              reservedDirKeys
            );
        operations.push({
          key: targetUnbound.key,
          mode: targetDirContainment.inside ? "replace" : "create",
          stagedDir,
          targetDir,
          ...(targetDirContainment.inside
            ? {
                backupDir: join(backupPrevRoot, `unbound-${randomHex8()}`)
              }
            : {})
        });
        const regIndex = nextCatalog.projects.findIndex(
          (p) => p.id === targetUnbound.id && p.domain === item.meta.kind
        );
        if (regIndex >= 0) {
          nextCatalog.projects[regIndex] = {
            ...nextCatalog.projects[regIndex]!,
            projectDirectory: targetDir
          };
        }
        if (isMaterial) {
          matIdMap.set(item.meta.id, targetUnbound.id);
        } else {
          skillIdMap.set(item.meta.id, targetUnbound.id);
        }
        added += 1;
        continue;
      }

      const existing = state.existingByKey.get(item.key);
      const existingHash = state.existingHashes.get(item.key);
      const equivCopy =
        input.conflictPolicy === "keep_both"
          ? equivalentCopyByKey.get(item.key)
          : undefined;
      if (
        (existing && existingHash === item.meta.hash) ||
        equivCopy !== undefined
      ) {
        const mappedId = equivCopy?.id ?? item.meta.id;
        skipped += 1;
        if (!item.payload.isUnbound) {
          if (isMaterial) {
            matIdMap.set(item.meta.id, mappedId);
            validMatIds.add(mappedId);
          } else {
            skillIdMap.set(item.meta.id, mappedId);
            validSkillIds.add(mappedId);
          }
        }
        continue;
      }

      const isConflict = Boolean(existing && existingHash !== undefined);
      const mode: "new" | "keep_both" | "replace" = !isConflict
        ? "new"
        : input.conflictPolicy === "replace"
          ? "replace"
          : "keep_both";

      const targetId =
        mode === "keep_both"
          ? createCatalogId(isMaterial ? "material" : "skill")
          : item.meta.id;
      const titlePool = titleSetForKind(state, item.meta.kind);
      const targetTitle =
        mode === "keep_both"
          ? nextBackupCopyTitle(item.meta.title, titlePool)
          : item.meta.title;

      const filesToStage = new Map<string, Buffer>(item.files);
      if (targetId !== item.meta.id || targetTitle !== item.meta.title) {
        const nextManifest = isMaterial
          ? MaterialLibraryProjectManifestSchema.parse({
              ...item.payload.manifest,
              id: targetId,
              title: targetTitle
            })
          : SkillLibraryProjectManifestSchema.parse({
              ...item.payload.manifest,
              id: targetId,
              title: targetTitle
            });
        filesToStage.set(
          "deepwrite.json",
          Buffer.from(toJsonFileText(nextManifest), "utf8")
        );
      }

      const stagedDir = join(
        stagingRoot,
        sanitizeBackupFolderName(item.meta.kind),
        randomHex8()
      );
      await writeStagedFiles(stagedDir, filesToStage);

      let opMode: "create" | "replace" = "create";
      let targetDir: string | undefined;
      let backupDir: string | undefined;
      if (mode === "replace" && existing) {
        const inside = await isInsideDirectory(
          realWorkspace,
          existing.projectDirectory
        );
        if (inside.inside && inside.realTarget) {
          opMode = "replace";
          targetDir = inside.realTarget;
          backupDir = join(
            backupPrevRoot,
            `${sanitizeBackupFolderName(item.meta.kind)}-${randomHex8()}`
          );
        }
      }
      if (!targetDir) {
        targetDir = await allocateWorkspaceProjectDirectory(
          realWorkspace,
          item.meta.kind,
          targetTitle,
          reservedDirKeys
        );
      }

      operations.push({
        key: item.key,
        mode: opMode,
        stagedDir,
        targetDir,
        ...(backupDir ? { backupDir } : {})
      });

      const libDomain = item.payload.kind;
      const filteredProjects = nextCatalog.projects.filter(
        (p) => !(p.domain === libDomain && p.id === targetId)
      );
      filteredProjects.push({
        id: targetId,
        domain: libDomain,
        projectDirectory: targetDir,
        registeredAt:
          existing && mode === "replace"
            ? (nextCatalog.projects.find(
                (p) => p.id === targetId && p.domain === libDomain
              )?.registeredAt ?? now)
            : now
      });
      nextCatalog.projects = filteredProjects;

      if (item.payload.isUnbound) {
        if (!org.unboundLibraryIds.includes(targetId)) {
          org.unboundLibraryIds.push(targetId);
        }
      } else if (isMaterial) {
        matIdMap.set(item.meta.id, targetId);
        validMatIds.add(targetId);
        if (!groupedMatIds.has(targetId) && !org.material.includes(targetId)) {
          newTopLevelMatIds.push(targetId);
        }
      } else {
        skillIdMap.set(item.meta.id, targetId);
        validSkillIds.add(targetId);
        if (!groupedSkillIds.has(targetId) && !org.skill.includes(targetId)) {
          newTopLevelSkillIds.push(targetId);
        }
      }

      if (mode === "new") added += 1;
      else if (mode === "keep_both") duplicated += 1;
      else replaced += 1;
    }

    const remapMat = (id: string) => matIdMap.get(id) ?? id;
    const remapSkill = (id: string) => skillIdMap.get(id) ?? id;

    // Pass 2: Stage material-group & skill-group projects with remapped memberIds.
    for (const item of selectedItems) {
      if (
        item.payload.kind !== "material-group" &&
        item.payload.kind !== "skill-group"
      ) {
        continue;
      }
      const isMaterial = item.payload.kind === "material-group";
      const existing = state.existingByKey.get(item.key);
      const existingHash = state.existingHashes.get(item.key);
      const expectedLocal = simulatedNormalizedHashForTarget(
        item,
        validMatIds,
        validSkillIds,
        { remapMat, remapSkill }
      );
      if (
        (existing &&
          (existingHash === item.meta.hash ||
            existingHash === expectedLocal)) ||
        (input.conflictPolicy === "keep_both" &&
          equivalentCopyByKey.has(item.key))
      ) {
        skipped += 1;
        continue;
      }
      const isConflict = Boolean(existing && existingHash !== undefined);
      const mode: "new" | "keep_both" | "replace" = !isConflict
        ? "new"
        : input.conflictPolicy === "replace"
          ? "replace"
          : "keep_both";
      const targetId =
        mode === "keep_both"
          ? createCatalogId(isMaterial ? "material-group" : "skill-group")
          : item.meta.id;
      const targetTitle =
        mode === "keep_both"
          ? nextBackupCopyTitle(
              item.meta.title,
              titleSetForKind(state, item.meta.kind)
            )
          : item.meta.title;

      const rewritten = rewriteWorkBindingsInFiles(item, {
        targetId,
        targetTitle,
        remapMat,
        remapSkill,
        validMatIds,
        validSkillIds
      });
      danglingBindingsRemoved += rewritten.danglingRemoved;

      const stagedDir = join(
        stagingRoot,
        sanitizeBackupFolderName(item.meta.kind),
        randomHex8()
      );
      await writeStagedFiles(stagedDir, rewritten.files);

      let opMode: "create" | "replace" = "create";
      let targetDir: string | undefined;
      let backupDir: string | undefined;
      if (mode === "replace" && existing) {
        const inside = await isInsideDirectory(
          realWorkspace,
          existing.projectDirectory
        );
        if (inside.inside && inside.realTarget) {
          opMode = "replace";
          targetDir = inside.realTarget;
          backupDir = join(
            backupPrevRoot,
            `${sanitizeBackupFolderName(item.meta.kind)}-${randomHex8()}`
          );
        }
      }
      targetDir ??= await allocateWorkspaceProjectDirectory(
        realWorkspace,
        item.meta.kind,
        targetTitle,
        reservedDirKeys
      );

      operations.push({
        key: item.key,
        mode: opMode,
        stagedDir,
        targetDir,
        ...(backupDir ? { backupDir } : {})
      });

      const groupDomain = item.payload.kind;
      const filteredProjects = nextCatalog.projects.filter(
        (p) => !(p.domain === groupDomain && p.id === targetId)
      );
      filteredProjects.push({
        id: targetId,
        domain: groupDomain,
        projectDirectory: targetDir,
        registeredAt:
          existing && mode === "replace"
            ? (nextCatalog.projects.find(
                (p) => p.id === targetId && p.domain === groupDomain
              )?.registeredAt ?? now)
            : now
      });
      nextCatalog.projects = filteredProjects;

      const nextMembers = remapLibraryIdList(
        item.payload.manifest.memberIds,
        isMaterial ? remapMat : remapSkill,
        isMaterial ? validMatIds : validSkillIds
      ).next;
      org.groups[targetId] = nextMembers;
      if (isMaterial) {
        groupMatIdMap.set(item.meta.id, targetId);
        if (!org.material.includes(targetId)) newTopLevelMatIds.push(targetId);
        for (const memberId of nextMembers) groupedMatIds.add(memberId);
      } else {
        groupSkillIdMap.set(item.meta.id, targetId);
        if (!org.skill.includes(targetId)) newTopLevelSkillIds.push(targetId);
        for (const memberId of nextMembers) groupedSkillIds.add(memberId);
      }

      if (mode === "new") added += 1;
      else if (mode === "keep_both") duplicated += 1;
      else replaced += 1;
    }

    // Reconcile libraryOrganization ordering cleanly.
    const existingGroupIds = new Set(Object.keys(org.groups));
    const archiveGroupTopMats = (
      bundle.manifest.libraryOrganization?.material ?? []
    )
      .map((id) => groupMatIdMap.get(id) ?? matIdMap.get(id) ?? id)
      .filter(
        (id) =>
          (validMatIds.has(id) || existingGroupIds.has(id)) &&
          !groupedMatIds.has(id)
      );
    const archiveGroupTopSkills = (
      bundle.manifest.libraryOrganization?.skill ?? []
    )
      .map((id) => groupSkillIdMap.get(id) ?? skillIdMap.get(id) ?? id)
      .filter(
        (id) =>
          (validSkillIds.has(id) || existingGroupIds.has(id)) &&
          !groupedSkillIds.has(id)
      );

    const allMatTopCandidates = [
      ...nextCatalog.projects
        .filter(
          (p) =>
            p.domain === "material-library" &&
            !org.unboundLibraryIds.includes(p.id) &&
            !groupedMatIds.has(p.id)
        )
        .map((p) => p.id),
      ...nextCatalog.projects
        .filter((p) => p.domain === "material-group")
        .map((p) => p.id)
    ];
    const allSkillTopCandidates = [
      ...nextCatalog.projects
        .filter(
          (p) =>
            p.domain === "skill-library" &&
            !org.unboundLibraryIds.includes(p.id) &&
            !groupedSkillIds.has(p.id)
        )
        .map((p) => p.id),
      ...nextCatalog.projects
        .filter((p) => p.domain === "skill-group")
        .map((p) => p.id)
    ];
    org.material = reconcileLibraryOrder(allMatTopCandidates, [
      ...org.material,
      ...archiveGroupTopMats,
      ...newTopLevelMatIds
    ]);
    org.skill = reconcileLibraryOrder(allSkillTopCandidates, [
      ...org.skill,
      ...archiveGroupTopSkills,
      ...newTopLevelSkillIds
    ]);
    org.revision += 1;
    nextCatalog.libraryOrganization = LibraryOrganizationSchema.parse(org);
    nextCatalog.creativePlotStages = mergeCreativePlotStageDefinitions(
      nextCatalog.creativePlotStages,
      bundle.manifest.creativePlotStages
    );
    nextCatalog.revision += 1;
    nextCatalog.updatedAt = now;

    // Pass 3: Stage all 5 work types (`book`, `long-book`, `mystery-book`).
    for (const item of selectedItems) {
      if (
        item.payload.kind !== "book" &&
        item.payload.kind !== "long-book" &&
        item.payload.kind !== "mystery-book"
      ) {
        continue;
      }
      const existing = state.existingByKey.get(item.key);
      const existingHash = state.existingHashes.get(item.key);
      const expectedLocal = simulatedNormalizedHashForTarget(
        item,
        validMatIds,
        validSkillIds,
        { remapMat, remapSkill }
      );
      if (
        (existing &&
          (existingHash === item.meta.hash ||
            existingHash === expectedLocal)) ||
        (input.conflictPolicy === "keep_both" &&
          equivalentCopyByKey.has(item.key))
      ) {
        skipped += 1;
        continue;
      }
      const isConflict = Boolean(existing && existingHash !== undefined);
      const mode: "new" | "keep_both" | "replace" = !isConflict
        ? "new"
        : input.conflictPolicy === "replace"
          ? "replace"
          : "keep_both";
      const targetId =
        mode === "keep_both"
          ? item.payload.kind === "long-book"
            ? createId("longbook")
            : item.payload.kind === "mystery-book"
              ? createId("mys")
              : createCatalogId("book")
          : item.meta.id;
      const targetTitle =
        mode === "keep_both"
          ? nextBackupCopyTitle(item.meta.title, state.bookTitleSet)
          : item.meta.title;

      const rewritten = rewriteWorkBindingsInFiles(item, {
        targetId,
        targetTitle,
        remapMat,
        remapSkill,
        validMatIds,
        validSkillIds
      });
      if (rewritten.danglingRemoved > 0) {
        danglingBindingsRemoved += rewritten.danglingRemoved;
        warnings.push(
          `作品「${targetTitle}」已清理 ${rewritten.danglingRemoved} 条未在目标库存在的关联引用。`
        );
      }

      const stagedDir = join(
        stagingRoot,
        sanitizeBackupFolderName(item.meta.kind),
        randomHex8()
      );
      await writeStagedFiles(stagedDir, rewritten.files);

      let opMode: "create" | "replace" = "create";
      let targetDir: string | undefined;
      let backupDir: string | undefined;
      if (mode === "replace" && existing) {
        const inside = await isInsideDirectory(
          realWorkspace,
          existing.projectDirectory
        );
        if (inside.inside && inside.realTarget) {
          opMode = "replace";
          targetDir = inside.realTarget;
          backupDir = join(
            backupPrevRoot,
            `${sanitizeBackupFolderName(item.meta.kind)}-${randomHex8()}`
          );
        }
      }
      targetDir ??= await allocateWorkspaceProjectDirectory(
        realWorkspace,
        item.meta.kind,
        targetTitle,
        reservedDirKeys
      );

      operations.push({
        key: item.key,
        mode: opMode,
        stagedDir,
        targetDir,
        ...(backupDir ? { backupDir } : {})
      });

      if (item.payload.kind === "book") {
        // Also ensure deepwrite.json passes current book schema when opening later.
        const rawStagedManifest = parseUtf8Json(
          rewritten.files.get("deepwrite.json")!,
          `${targetTitle}/deepwrite.json`
        );
        if (
          isRecord(rawStagedManifest) &&
          rawStagedManifest.bookType === "academic"
        ) {
          AcademicBookSchema.safeParse(rawStagedManifest);
        } else if (isRecord(rawStagedManifest)) {
          BookSchema.safeParse(rawStagedManifest);
        }
        const filtered = nextCatalog.projects.filter(
          (p) => !(p.domain === "book" && p.id === targetId)
        );
        filtered.push({
          id: targetId,
          domain: "book",
          projectDirectory: targetDir,
          registeredAt:
            existing && mode === "replace"
              ? (nextCatalog.projects.find(
                  (p) => p.id === targetId && p.domain === "book"
                )?.registeredAt ?? now)
              : now
        });
        nextCatalog.projects = filtered;
      } else if (item.payload.kind === "long-book") {
        const longManifest = LongProjectManifestSchema.parse(
          stripLegacyLongVersionMetadata(
            parseUtf8Json(
              rewritten.files.get("deepwrite.json")!,
              `${targetTitle}/deepwrite.json`
            )
          ).value
        );
        const longIndex = rewritten.longIndex ?? item.payload.index;
        const summary = createLongBookSummary({
          schemaVersion: longManifest.schemaVersion,
          id: longManifest.id,
          title: longManifest.title,
          bookType: longManifest.bookType,
          genre: longManifest.genre,
          status: longManifest.status,
          linkedMaterialIdsByKind: longManifest.linkedMaterialIdsByKind,
          linkedSkillIdsByKind: longManifest.linkedSkillIdsByKind,
          ...(longManifest.linkedResourceStageScopes
            ? {
                linkedResourceStageScopes:
                  longManifest.linkedResourceStageScopes
              }
            : {}),
          createdAt: longManifest.createdAt,
          updatedAt: longManifest.updatedAt,
          workspaceIndex: longIndex
        });
        nextLong.projects = nextLong.projects.filter(
          (p) => p.bookId !== targetId && p.projectDirectory !== targetDir
        );
        nextLong.projects.push({
          bookId: targetId,
          projectDirectory: targetDir,
          registeredAt:
            existing && mode === "replace"
              ? (nextLong.projects.find((p) => p.bookId === targetId)
                  ?.registeredAt ?? now)
              : now,
          summary
        });
        nextLong.updatedAt = now;
      } else if (item.payload.kind === "mystery-book") {
        const mysteryManifest =
          rewritten.mysteryManifest ?? item.payload.manifest;
        nextMystery.projects = nextMystery.projects.filter(
          (p) => p.bookId !== targetId && p.projectDirectory !== targetDir
        );
        nextMystery.projects.push({
          bookId: targetId,
          projectDirectory: targetDir,
          summary: summarizeMysteryBook(mysteryManifest)
        });
      }

      if (mode === "new") added += 1;
      else if (mode === "keep_both") duplicated += 1;
      else replaced += 1;
    }

    return {
      batchId,
      stagingRoot,
      backupPrevRoot,
      operations,
      nextRegistries: {
        catalog: nextCatalog,
        long: nextLong,
        mystery: nextMystery
      },
      expectedRegistryFingerprints,
      summary: {
        added,
        duplicated,
        replaced,
        skipped,
        danglingBindingsRemoved,
        warnings
      }
    };
  } catch (error: unknown) {
    await rm(stagingRoot, { recursive: true, force: true }).catch(
      () => undefined
    );
    throw error;
  }
}
