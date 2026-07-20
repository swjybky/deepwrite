import type {
  LinkedMaterialIdsByKind,
  LinkedSkillIdsByKind,
  ShortBookGenre
} from "@deepwrite/contracts";
import { openLegacyZipArchive } from "./legacy-zip";

const MAX_IMPORTED_CONTENT_BYTES = 128 * 1024 * 1024;

const CORE_DOCUMENTS = [
  ["character_design", "人物设计"],
  ["plot_design", "剧情设计"],
  ["intro_design", "导语设计"],
  ["plot_refine", "剧情细化"],
  ["outline", "大纲"],
  ["draft", "正文编写"]
] as const;

const LEGACY_STAGE_ALIASES: Readonly<Record<string, string>> = {
  qinggan_character: "character_design",
  qinggan_intro: "intro_design",
  qinggan_plot_refine: "plot_refine",
  qinggan_outline: "outline",
  qinggan_draft: "draft",
  qinggan_draft_review: "draft_review"
};

const LEGACY_STAGE_TITLES: Readonly<Record<string, string>> = {
  ...Object.fromEntries(CORE_DOCUMENTS),
  draft_review: "正文审阅（旧版）",
  format_conversion: "格式转换（旧版）",
  expert_draft_coordinator: "专家正文总控（旧版）"
};

export interface ImportedLegacyBookDocument {
  id: string;
  title: string;
  content: string;
}

export interface ImportedLegacyBook {
  title: string;
  genre: ShortBookGenre;
  status: "editing" | "completed";
  linkedMaterialIdsByKind: LinkedMaterialIdsByKind;
  linkedSkillIdsByKind: LinkedSkillIdsByKind;
  documents: ImportedLegacyBookDocument[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function safeTitle(value: unknown): string {
  const title = asString(value).trim();
  return (title || "导入书籍").slice(0, 256);
}

function normalizeGenre(book: Record<string, unknown>): ShortBookGenre {
  const categories = Array.isArray(book.categories)
    ? book.categories.filter((value): value is string => typeof value === "string")
    : [];
  const raw = asString(book.genre).trim() || categories[0]?.trim() || "";
  if (raw === "世情" || raw === "追妻" || raw === "科幻" || raw === "悬疑") {
    return raw;
  }
  if (raw === "现实情感" || raw === "情感") {
    return "追妻";
  }
  return "其他";
}

function normalizedIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    )
  ];
}

function normalizeMaterialLinks(book: Record<string, unknown>): LinkedMaterialIdsByKind {
  const source = isRecord(book.linked_material_ids_by_kind)
    ? book.linked_material_ids_by_kind
    : {};
  const result: LinkedMaterialIdsByKind = {
    character: normalizedIdList(source.character),
    gimmick: normalizedIdList(source.gimmick),
    plot: normalizedIdList(source.plot),
    draft: normalizedIdList(source.draft),
    other: normalizedIdList(source.other)
  };
  const legacyId = asString(book.linked_material_id).trim();
  if (legacyId && !Object.values(result).some((ids) => ids.includes(legacyId))) {
    result.other.push(legacyId);
  }
  return result;
}

function normalizeSkillLinks(book: Record<string, unknown>): LinkedSkillIdsByKind {
  const source = isRecord(book.linked_skill_ids_by_kind)
    ? book.linked_skill_ids_by_kind
    : {};
  const result: LinkedSkillIdsByKind = {
    general: normalizedIdList(source.general),
    plot: normalizedIdList(source.plot),
    style: normalizedIdList(source.style),
    other: normalizedIdList(source.other)
  };
  const legacyId = asString(book.linked_skill_id).trim();
  if (legacyId && !Object.values(result).some((ids) => ids.includes(legacyId))) {
    result.other.push(legacyId);
  }
  return result;
}

function extraDocumentId(stageId: string, index: number): string {
  const safe = stageId
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 120);
  return `legacy-${index + 1}-${safe || "document"}`;
}

function legacyStageTitle(stageId: string): string {
  return LEGACY_STAGE_TITLES[stageId] ?? `旧版文稿 · ${stageId}`;
}

function expertDraftMarkdown(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.sections)) return "";
  return value.sections
    .flatMap((section, index) => {
      if (!isRecord(section)) return [];
      const title = safeTitle(section.title || `小节 ${index + 1}`);
      const body = asString(section.body);
      return body.trim() ? [`## ${title}\n\n${body}`] : [];
    })
    .join("\n\n");
}

function legacyMemoriesMarkdown(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .flatMap((memory, index) => {
      if (!isRecord(memory)) return [];
      const content = asString(memory.content).trim();
      if (!content) return [];
      const title = safeTitle(memory.title || `记忆 ${index + 1}`);
      const tag = asString(memory.tag).trim();
      return [`## ${title}${tag ? ` · ${tag}` : ""}\n\n${content}`];
    })
    .join("\n\n");
}

export function normalizeLegacyBook(
  rawBook: Record<string, unknown>,
  archivedStageFiles: ReadonlyMap<string, string> = new Map()
): ImportedLegacyBook {
  const rawStages = isRecord(rawBook.stages) ? rawBook.stages : {};
  const stages = new Map<string, string>();
  for (const [rawId, rawContent] of Object.entries(rawStages)) {
    const stageId = LEGACY_STAGE_ALIASES[rawId] ?? rawId;
    const content = asString(rawContent);
    if (!stages.has(stageId)) {
      stages.set(stageId, content);
    }
  }
  for (const [rawId, content] of archivedStageFiles) {
    const stageId = LEGACY_STAGE_ALIASES[rawId] ?? rawId;
    if (!stages.get(stageId)?.trim()) {
      stages.set(stageId, content);
    }
  }
  if (!stages.get("draft")?.trim() && asString(rawBook.content).trim()) {
    stages.set("draft", asString(rawBook.content));
  }

  const documents: ImportedLegacyBookDocument[] = CORE_DOCUMENTS.map(
    ([id, title]) => ({ id, title, content: stages.get(id) ?? "" })
  );
  const coreIds = new Set(CORE_DOCUMENTS.map(([id]) => id));
  for (const [stageId, content] of stages) {
    if (coreIds.has(stageId as (typeof CORE_DOCUMENTS)[number][0]) || !content.trim()) {
      continue;
    }
    documents.push({
      id: extraDocumentId(stageId, documents.length),
      title: legacyStageTitle(stageId),
      content
    });
  }
  const expertDraft = expertDraftMarkdown(rawBook.expert_draft);
  if (expertDraft) {
    documents.push({
      id: extraDocumentId("expert-draft", documents.length),
      title: "专家正文（旧版）",
      content: expertDraft
    });
  }
  const memories = legacyMemoriesMarkdown(rawBook.memories);
  if (memories) {
    documents.push({
      id: extraDocumentId("memories", documents.length),
      title: "书籍记忆（旧版）",
      content: memories
    });
  }
  const contentBytes = documents.reduce(
    (total, document) => total + Buffer.byteLength(document.content, "utf8"),
    0
  );
  if (contentBytes > MAX_IMPORTED_CONTENT_BYTES) {
    throw new Error("旧版书籍正文合计超过 128 MB 安全上限。");
  }
  if (documents.length > 4_096) {
    throw new Error("旧版书籍包含的文稿数量过多，无法安全导入。");
  }

  return {
    title: safeTitle(rawBook.title),
    genre: normalizeGenre(rawBook),
    status: rawBook.status === "completed" ? "completed" : "editing",
    linkedMaterialIdsByKind: normalizeMaterialLinks(rawBook),
    linkedSkillIdsByKind: normalizeSkillLinks(rawBook),
    documents
  };
}

export async function readLegacyBookArchive(path: string): Promise<ImportedLegacyBook> {
  const archive = await openLegacyZipArchive(path, "旧版书籍压缩包");
  let book = archive.readJsonObject("book.json");
  if (!book) {
    const metadata = archive.readJsonObject("metadata.json");
    if (
      metadata &&
      (metadata.library_type === "book" || metadata.library_type === "workspace") &&
      isRecord(metadata.data)
    ) {
      book = metadata.data;
    }
  }
  if (!book) {
    throw new Error("无效的旧版书籍压缩包：缺少 book.json。");
  }
  const stageFiles = new Map<string, string>();
  for (const entryName of archive.entryNames) {
    const match = /^stages\/([^/]+)\.txt$/u.exec(entryName);
    if (match?.[1]) {
      stageFiles.set(match[1], archive.read(entryName)!.toString("utf8"));
    }
  }
  return normalizeLegacyBook(book, stageFiles);
}
