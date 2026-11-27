import {
  LONG_BOOK_LINE_FILE_ID,
  LONG_CHARACTER_OVERVIEW_FILE_ID,
  LONG_CHARACTER_OVERVIEW_PATH,
  LONG_WORKSPACE_INDEX_FILE_ID,
  LONG_WORKSPACE_INDEX_PATH,
  LongProjectManifestSchema,
  LongWorkspaceIndexSnapshotSchema
} from "@deepwrite/contracts";
import type { WriteClawLongArchiveSource } from "../write-claw-long-archive";
import {
  appendMigrationEvidenceCategories,
  memoryArchiveMarkdown
} from "./evidence";
import {
  extractGenre,
  normalizeLegacyMaterialLinks,
  normalizeLegacySkillLinks
} from "./links";
import {
  DeterministicIdRegistry,
  WarningCollector,
  clippedTextDocument,
  normalizeImportedAt,
  normalizeTimestamp,
  record,
  stringValue,
  title
} from "./normalize";
import {
  buildCharacterOverviewMarkdown,
  buildImportedCharacters
} from "./plan-characters";
import { createDocumentBuilder } from "./plan-documents";
import { buildImportedPlot } from "./plan-plot";
import { buildImportedWorldbuilding } from "./plan-worldbuilding";
import type {
  CreateWriteClawLongImportPlanOptions,
  WriteClawLongImportPlan
} from "./types";
import { isRecord, toJsonFileText } from "@deepwrite/shared";
import { sha256Hex } from "@deepwrite/shared/node";

const BOOK_LINE_PATH = "long/plot/book-line.md";

function sourceIdentity(
  source: WriteClawLongArchiveSource,
  override: string | undefined
): string {
  if (override?.trim()) return override.trim();
  const legacyBookId = stringValue(source.book?.id).trim();
  if (legacyBookId) return `write-claw-book:${legacyBookId}`;
  return `write-claw-workspace:${sha256Hex(JSON.stringify(source.workspace))}`;
}

export function createWriteClawLongImportPlan(
  source: WriteClawLongArchiveSource,
  options: CreateWriteClawLongImportPlanOptions = {}
): WriteClawLongImportPlan {
  const warnings = new WarningCollector();
  source.warnings.forEach((warning) => warnings.add(warning));
  const workspace = source.workspace;
  warnings.preserve(
    "旧版本原始工作区完整快照",
    "long_workspace.json",
    toJsonFileText(workspace)
  );
  if (source.book) {
    warnings.preserve(
      "旧版本原始书籍元数据完整快照",
      "book.json",
      toJsonFileText(source.book)
    );
  }
  const legacySchemaVersion = Math.max(
    0,
    Math.floor(Number(workspace.schema_version) || 0)
  );
  if (legacySchemaVersion > 5) {
    throw new Error(
      `旧版本长篇 schema v${legacySchemaVersion} 高于当前导入器支持的 v5。`
    );
  }
  if (legacySchemaVersion !== 5) {
    warnings.add(
      `来源长篇 schema 版本为 v${legacySchemaVersion || "未知"}；已按旧版本 v5 兼容字段进行保守迁移。`
    );
  }

  const importedAt = normalizeImportedAt(options.importedAt);
  const namespace = sourceIdentity(source, options.sourceIdentity);
  const ids = new DeterministicIdRegistry(namespace, warnings);
  const documents = createDocumentBuilder(importedAt, warnings);
  const legacyBookId = stringValue(source.book?.id).trim();
  const bookId = ids.allocate(
    "book",
    "longbook",
    legacyBookId,
    sha256Hex(namespace)
  );
  const bookTitle = title(
    options.title ?? source.book?.title ?? workspace.title,
    "导入长篇",
    warnings,
    "书名"
  );
  const bookGenre = extractGenre(source.book, options.genre, warnings);
  const memoryArchive = source.book ? memoryArchiveMarkdown(source.book) : "";
  if (memoryArchive) {
    warnings.preserve(
      "书籍记忆（旧版）",
      "book.json.memories / memory_auto_capture_enabled",
      memoryArchive
    );
    warnings.add(
      "旧版书籍记忆已写入可搜索的“书籍记忆（旧版）”迁移证据；自动捕获设置仅存档，未在当前长篇中启用。"
    );
  }
  if (source.book && isRecord(source.book.expert_draft)) {
    warnings.preserve(
      "专家正文结构（旧版）",
      "book.json.expert_draft",
      toJsonFileText(source.book.expert_draft)
    );
    warnings.add("book.json 中的旧版专家正文结构已完整存入可搜索迁移证据。");
  }
  (source.evidenceFiles ?? []).forEach((file) => {
    warnings.preserve(
      `旧版附件 · ${file.archivePath.split("/").at(-1) || "未命名文件"}`,
      `ZIP:${file.archivePath}`,
      file.content
    );
    warnings.add(`旧版附件“${file.archivePath}”已迁入可搜索的只读证据。`);
  });
  const legacyLedger = record(workspace.ledger);
  if (Object.keys(legacyLedger).length > 0) {
    warnings.preserve(
      "全书状态账本（旧版迁移证据）",
      "long_workspace.json.ledger",
      toJsonFileText(legacyLedger)
    );
    warnings.add(
      "旧版全书状态账本已完整存入可搜索迁移证据；无章节归属的条目不会被静默丢弃。"
    );
  }
  const linkedMaterialIdsByKind = normalizeLegacyMaterialLinks(
    source.book,
    warnings
  );
  const linkedSkillIdsByKind = normalizeLegacySkillLinks(source.book, warnings);
  const hasLegacyBindings =
    Object.values(linkedMaterialIdsByKind).some(
      (values) => values.length > 0
    ) ||
    Object.values(linkedSkillIdsByKind).some((values) => values.length > 0);
  if (hasLegacyBindings) {
    warnings.add(
      "旧版素材库/技能库绑定 ID 已按原分类保留；当前 Catalog 中缺失的 ID 会在 Agent 使用时明确诊断，不会导致导入失败。"
    );
  }

  const plot = record(workspace.plot);
  const bookLineContent = clippedTextDocument(
    plot.book_line,
    warnings,
    "全书主线"
  );
  const bookLine = documents.add(
    LONG_BOOK_LINE_FILE_ID,
    BOOK_LINE_PATH,
    bookLineContent
  );

  const worldbuilding = buildImportedWorldbuilding(
    record(workspace.worldbuilding),
    ids,
    documents,
    warnings
  );
  const { characters, characterFiles } = buildImportedCharacters(
    record(workspace.characters),
    ids,
    documents,
    warnings
  );
  const {
    volumes,
    arcs,
    chapterCards,
    storyEvents,
    eventConnections,
    narrativePlacements,
    foreshadowing,
    chapterFiles,
    legacyCommits
  } = buildImportedPlot(
    workspace,
    source,
    ids,
    documents,
    warnings,
    characters,
    bookId,
    legacySchemaVersion
  );

  const idMap = ids.snapshot();
  warnings.preserve(
    "Legacy → DeepWrite 完整 ID 映射",
    "migration.id-map.json",
    toJsonFileText({
      schema: "deepwrite.write-claw-id-map",
      schemaVersion: 1,
      sourceIdentity: namespace,
      idMap
    })
  );

  appendMigrationEvidenceCategories(worldbuilding, documents, warnings);

  const characterOverview = documents.add(
    LONG_CHARACTER_OVERVIEW_FILE_ID,
    LONG_CHARACTER_OVERVIEW_PATH,
    buildCharacterOverviewMarkdown(characters)
  );

  const index = LongWorkspaceIndexSnapshotSchema.parse({
    schemaVersion: 1,
    bookId,
    updatedAt: importedAt,
    bookLine,
    worldbuilding,
    characterOverview,
    characters,
    characterFiles,
    plot: {
      volumes,
      arcs,
      chapterCards,
      storyEvents,
      eventConnections,
      narrativePlacements,
      foreshadowing
    },
    chapters: chapterFiles,
    ledger: {
      committedThroughChapterId: legacyCommits.at(-1)?.chapterCardId ?? null,
      commits: legacyCommits
    }
  });

  const createdAt = normalizeTimestamp(source.book?.created_at, importedAt);
  const manifest = LongProjectManifestSchema.parse({
    schemaVersion: 1,
    kind: "deepwrite.long-book",
    id: bookId,
    title: bookTitle,
    bookType: "long",
    genre: bookGenre,
    status: source.book?.status === "completed" ? "completed" : "editing",
    linkedMaterialIdsByKind,
    linkedSkillIdsByKind,
    createdAt,
    updatedAt: importedAt,
    workspaceIndexFile: {
      id: LONG_WORKSPACE_INDEX_FILE_ID,
      path: LONG_WORKSPACE_INDEX_PATH,
      updatedAt: importedAt
    }
  });

  return {
    schemaVersion: 1,
    sourceKind: source.sourceKind,
    legacySchemaVersion,
    committedChapterPolicy:
      legacyCommits.length > 0 ? "legacy-checkpoints" : "written-uncommitted",
    manifest,
    index,
    documents: documents.documents,
    warnings: warnings.all(),
    idMap
  };
}
