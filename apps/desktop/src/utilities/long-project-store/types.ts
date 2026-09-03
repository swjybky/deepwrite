import {
  LONG_AGENTS_MD_MAX_CHARACTERS,
  type LongBook,
  type LongBookSummary,
  type LongCommitChapterInput,
  type LongDeleteLedgerCommitInput,
  type LongProjectManifest,
  type LongTextFilesBatchCommitInput,
  type LongTextFilesCommitChapterInput,
  type LongWorkspaceFileReference,
  type LongWorkspaceIndexSnapshot,
  type LongWorkspaceOperationBatch,
  type LongWorkspaceOperationResult,
  type LongWriteChapterInput
} from "@deepwrite/contracts";
import type {
  CreateWriteClawLongImportPlanOptions,
  WriteClawLongImportPlan
} from "../write-claw-long-import";

export const MANIFEST_PATH = "deepwrite.json";
export const BOOK_LINE_PATH = "long/plot/book-line.md";
export const MAX_MANIFEST_BYTES = 1024 * 1024;
export const MAX_INDEX_BYTES = 32 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 32 * 1024 * 1024;
export const MAX_AGENTS_MD_BYTES = LONG_AGENTS_MD_MAX_CHARACTERS * 4;
export const MAX_LEDGER_RECORD_BYTES = 128 * 1024 * 1024;
export const MAX_READ_PAGE_CHARACTERS = 256 * 1024;
export const MAX_SEARCH_FILE_IDS = 1_000_000;
export const MAX_SEARCH_SCANNED_FILES = 64;
export const MAX_SEARCH_RESULTS = 100;
export const DEFAULT_READ_PAGE_CHARACTERS = 16 * 1024;
export const DEFAULT_SEARCH_RESULTS = 20;
export const DEFAULT_SEARCH_CONTEXT_CHARACTERS = 80;
export const MAX_SEARCH_SCANNED_CHARACTERS = 1024 * 1024;
export const UNICODE_PAGE_INDEX_STRIDE = 4 * 1024;
export const DOCUMENT_READ_CACHE_MAX_COST = 128 * 1024 * 1024;
export const DOCUMENT_READ_CACHE_MAX_ENTRIES = 8;
export const MIGRATION_EVIDENCE_WORLD_ID_PREFIX = "world_migration-evidence-";

export const EMPTY_LINKED_MATERIALS = {
  character: [],
  gimmick: [],
  plot: [],
  draft: [],
  other: []
} as const;

export const EMPTY_LINKED_SKILLS = {
  general: [],
  plot: [],
  style: [],
  other: []
} as const;

export const DEFAULT_WORLD_CATEGORIES = [
  ["world_rules", "规则"],
  ["world_factions", "势力"],
  ["world_geography", "地理"],
  ["world_history", "历史"],
  ["world_terminology", "术语"],
  ["world_realms", "境界"],
  ["world_items", "物品"]
] as const;

export interface LongProjectStoreOptions {
  now?: () => string;
}

export interface CreateLongBookInput {
  id?: string;
  title: string;
  genre: string;
  linkedMaterialIdsByKind?: LongProjectManifest["linkedMaterialIdsByKind"];
  linkedSkillIdsByKind?: LongProjectManifest["linkedSkillIdsByKind"];
}

export interface CreatedLongBook {
  projectDirectory: string;
  book: LongBook;
  summary: LongBookSummary;
}

export type ImportWriteClawLongBookOptions = Omit<
  CreateWriteClawLongImportPlanOptions,
  "importedAt"
>;

export interface ImportedWriteClawLongBook extends CreatedLongBook {
  sourceKind: WriteClawLongImportPlan["sourceKind"];
  legacySchemaVersion: number;
  committedChapterPolicy: WriteClawLongImportPlan["committedChapterPolicy"];
  warnings: string[];
}

export interface ImportedPortableLongBook extends CreatedLongBook {
  exportedAt: string;
}

export interface ImportContinuationLongBookInput {
  sourcePath: string;
  expectedFingerprint: string;
  title: string;
  genre: string;
}

export interface ImportedContinuationLongBook extends CreatedLongBook {
  importedVolumeCount: number;
  importedChapterCount: number;
  checkpointCount: number;
  pendingChapterCardId: string;
  warnings: string[];
}

export interface OpenedLongBook {
  book: LongBook;
  summary: LongBookSummary;
}

export interface UpdateLongBookBindingsInput {
  linkedMaterialIdsByKind: LongProjectManifest["linkedMaterialIdsByKind"];
  linkedSkillIdsByKind: LongProjectManifest["linkedSkillIdsByKind"];
  linkedResourceStageScopes?: LongProjectManifest["linkedResourceStageScopes"];
}

export interface RenameLongBookInput {
  title: string;
}

export interface ReadLongDocumentInput {
  fileId: string;
  offset?: number;
  limit?: number;
}

export interface ReadLongDocumentResult {
  fileId: string;
  path: string;
  content: string;
  offset: number;
  nextOffset: number | null;
  totalCharacters: number;
}

export interface SearchLongProjectInput {
  query: string;
  fileIds: readonly string[];
  maxResults?: number;
  contextCharacters?: number;
  resume?: LongProjectSearchResume;
}

export interface LongProjectSearchResume {
  fileIndex: number;
  fileId: string;
  characterOffset: number;
}

export interface LongProjectSearchMatch {
  fileId: string;
  path: string;
  offset: number;
  endOffset: number;
  line: number;
  preview: string;
}

export interface SearchLongProjectResult {
  query: string;
  matches: LongProjectSearchMatch[];
  nextResume: LongProjectSearchResume | null;
  truncated: boolean;
}

export interface WriteLongDocumentInput {
  fileId: string;
  content: string;
}

export interface WriteLongDocumentResult extends OpenedLongBook {
  fileId: string;
}

export interface ApplyLongWorkspaceOperationsInput {
  batch: LongWorkspaceOperationBatch;
}

export interface ApplyLongWorkspaceOperationsResult extends OpenedLongBook {
  operationResult: LongWorkspaceOperationResult;
}

export type StoreWriteLongChapterInput = Omit<LongWriteChapterInput, "bookId">;
export type LongStructuredCommitChapterInput = Extract<
  LongCommitChapterInput,
  { mode: "structured" }
>;
export type StoreCommitTypedContinuityFields = Pick<
  LongStructuredCommitChapterInput,
  | "coverage"
  | "factMutations"
  | "knowledgeMutations"
  | "openLoopMutations"
  | "chapterOutputs"
>;
export type StoreCommitLongChapterInput =
  | (Omit<
      LongStructuredCommitChapterInput,
      "bookId" | "mode" | keyof StoreCommitTypedContinuityFields
    > &
      Partial<StoreCommitTypedContinuityFields> & {
        mode?: "structured";
      })
  | Omit<LongTextFilesCommitChapterInput, "bookId">
  | Omit<LongTextFilesBatchCommitInput, "bookId">;
export type StoreDeleteLongLedgerCommitInput = Omit<
  LongDeleteLedgerCommitInput,
  "bookId"
>;
export interface SecureTextFile {
  content: string;
  bytes: Buffer;
  sha256: string;
  updatedAt: string;
  identity: string;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
}

export interface UnicodePageAnchor {
  characterOffset: number;
  codeUnitOffset: number;
}

export interface CachedPagedTextFile {
  disk: SecureTextFile;
  totalCharacters: number;
  anchors: UnicodePageAnchor[];
  cost: number;
}

export interface LoadedPagedIndexedFile extends LoadedIndexedFile {
  paging: CachedPagedTextFile;
}

export interface IndexedFileSlot {
  reference: LongWorkspaceFileReference;
  expectedPath: string;
  compatiblePaths?: readonly string[];
  kind: "markdown" | "json";
}

export interface IndexedFileDescriptor {
  reference: LongWorkspaceFileReference;
  kind: "markdown" | "json";
  disk: SecureTextFile | null;
}

export type LoadedIndexedFile = Omit<IndexedFileDescriptor, "disk"> & {
  disk: SecureTextFile;
};

export interface LoadedLongProject {
  projectDirectory: string;
  manifest: LongProjectManifest;
  manifestDisk: SecureTextFile;
  index: LongWorkspaceIndexSnapshot;
  indexDisk: SecureTextFile;
  files: Map<string, IndexedFileDescriptor>;
  book: LongBook;
  summary: LongBookSummary;
}

export interface InitialProjectFiles {
  manifest: LongProjectManifest;
  index: LongWorkspaceIndexSnapshot;
  operations: Array<{
    path: string;
    content: string;
    expectedSha256: null;
  }>;
}
