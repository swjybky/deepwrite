import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  CatalogDocumentSchema,
  CatalogSnapshotSchema,
  CreateShortBookInputSchema,
  DeleteBookInputSchema,
  MATERIAL_KINDS,
  MATERIAL_STAGE_IDS,
  MaterialLibraryKindSchema,
  MaterialStageIdSchema,
  SaveDocumentInputSchema,
  SKILL_KINDS,
  SKILL_STAGE_IDS,
  ShortBookSchema,
  SkillKindSchema,
  SkillStageIdSchema,
  UpdateBookInputSchema,
  createCatalogDraftDirectory,
  type CatalogDocument,
  type CatalogSnapshot,
  type CreateShortBookInput,
  type DeleteBookResult,
  type LibraryType,
  type LinkedMaterialIdsByKind,
  type LinkedMaterialIdsByKindInput,
  type LinkedSkillIdsByKind,
  type LinkedSkillIdsByKindInput,
  type MaterialEntry,
  type MaterialKind,
  type MaterialLibrary,
  type MaterialLibraryGroup,
  type MaterialStageId,
  type SaveDocumentInput,
  type ShortBook,
  type SkillEntry,
  type SkillKind,
  type SkillLibrary,
  type SkillLibraryGroup,
  type SkillStageId,
  type UpdateBookInput
} from "@deepwrite/contracts";

const LEGACY_MATERIALS_FILE = "materials.json";
const LEGACY_SKILLS_FILE = "skills.json";
const LEGACY_PREFERENCES_FILE = "preferences.json";
const LEGACY_FILES = [
  LEGACY_MATERIALS_FILE,
  LEGACY_SKILLS_FILE,
  LEGACY_PREFERENCES_FILE
] as const;

const MATERIAL_STAGE_LABELS: Record<MaterialStageId, string> = {
  gimmick: "梗",
  character: "人设",
  pacing: "剧情设计",
  intro: "导语设计",
  plot_refine: "剧情细化",
  draft_excerpt: "优秀正文片段",
  other: "其他素材"
};

const SKILL_STAGE_LABELS: Record<SkillStageId, string> = {
  character_design: "人物技能",
  plot_design: "剧情技能",
  outline: "大纲技能",
  draft: "正文专家编写技能",
  expert_section_writer: "分节写手技能"
};

const SKILL_STAGE_SOURCES: Record<SkillStageId, readonly string[]> = {
  character_design: ["character_design"],
  plot_design: ["plot_design", "intro_design", "plot_refine"],
  outline: ["outline"],
  draft: [
    "draft",
    "draft_review",
    "format_conversion",
    "expert_draft_coordinator"
  ],
  expert_section_writer: ["expert_section_writer"]
};

const DEFAULT_SHORT_DOCUMENTS = [
  ["character_design", "人物设计"],
  ["plot_design", "剧情设计"],
  ["intro_design", "导语设计"],
  ["plot_refine", "剧情细化"],
  ["outline", "大纲"]
] as const;

const DRAFT_CHARACTER_STATE_TITLE_SUFFIX = " · 人物状态";
const CATALOG_TITLE_MAX_LENGTH = 256;

function draftCharacterStateTitle(sectionTitle: string): string {
  return `${sectionTitle.slice(
    0,
    CATALOG_TITLE_MAX_LENGTH - DRAFT_CHARACTER_STATE_TITLE_SUFFIX.length
  )}${DRAFT_CHARACTER_STATE_TITLE_SUFFIX}`;
}

function isReservedDraftDocumentId(documentId: string): boolean {
  return (
    documentId.startsWith("draft-section:") &&
    (documentId.endsWith(":body") ||
      documentId.endsWith(":character-state"))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nonBlankString(value: unknown, fallback: string): string {
  const normalized = asString(value).trim();
  return normalized || fallback;
}

function normalizeTimestamp(value: unknown, fallback: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    return fallback;
  }
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : fallback;
}

function normalizeLibraryType(value: unknown): LibraryType {
  return value === "long" || value === "script" ? value : "short";
}

function normalizeParentGenre(value: unknown): string {
  const genre = asString(value).trim();
  if (genre === "现实情感" || genre === "情感") {
    return "追妻";
  }
  return genre;
}

function stableLegacyId(prefix: string, ...parts: unknown[]): string {
  const digest = createHash("sha256")
    .update(parts.map((part) => String(part ?? "")).join("\u0000"))
    .digest("hex")
    .slice(0, 24);
  return `${prefix}-${digest}`;
}

function fallbackMaterialEntryTitle(
  stageId: MaterialStageId,
  body: string,
  index: number
): string {
  const firstLine = body
    .split(/\r?\n/u)
    .map((line) => line.trim().replace(/^#+\s*/u, "").trim())
    .find(Boolean);
  if (firstLine) {
    return firstLine.slice(0, 40);
  }
  return `未命名${MATERIAL_STAGE_LABELS[stageId]}${index > 0 ? ` ${index + 1}` : ""}`;
}

function legacyEntryValues(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === undefined || value === null || value === "") {
    return [];
  }
  return [value];
}

function normalizeMaterialEntry(
  raw: unknown,
  materialId: string,
  stageId: MaterialStageId,
  index: number,
  fallbackTimestamp: string
): MaterialEntry | undefined {
  const item = asRecord(raw);
  const body = typeof raw === "string" ? raw : asString(item.body);
  const explicitTitle = typeof raw === "string" ? "" : asString(item.title).trim();
  if (!body.trim() && !explicitTitle && !asString(item.id).trim()) {
    return undefined;
  }
  const title = explicitTitle || fallbackMaterialEntryTitle(stageId, body, index);
  const createdAt = normalizeTimestamp(item.created_at, fallbackTimestamp);
  const updatedAt = normalizeTimestamp(item.updated_at, createdAt);
  return {
    id:
      asString(item.id).trim() ||
      stableLegacyId("material-entry", materialId, stageId, index, title, body),
    stageId,
    title,
    body,
    createdAt,
    updatedAt
  };
}

function normalizeMaterialEntries(
  rawMaterial: Record<string, unknown>,
  materialId: string,
  fallbackTimestamp: string
): MaterialEntry[] {
  const stageItems = asRecord(rawMaterial.stage_items);
  const stages = asRecord(rawMaterial.stages);
  const entries: MaterialEntry[] = [];

  for (const stageId of MATERIAL_STAGE_IDS) {
    const normalizedStageId = MaterialStageIdSchema.parse(stageId);
    const itemValues = legacyEntryValues(stageItems[stageId]);
    const stageEntries = itemValues.flatMap((value, index) => {
      const entry = normalizeMaterialEntry(
        value,
        materialId,
        normalizedStageId,
        index,
        fallbackTimestamp
      );
      return entry ? [entry] : [];
    });
    if (stageEntries.length > 0) {
      entries.push(...stageEntries);
      continue;
    }

    const legacyBody = asString(stages[stageId]);
    if (legacyBody.trim()) {
      const fallbackEntry = normalizeMaterialEntry(
        legacyBody,
        materialId,
        normalizedStageId,
        0,
        fallbackTimestamp
      );
      if (fallbackEntry) {
        entries.push(fallbackEntry);
      }
    }
  }
  return entries;
}

export function normalizeLegacyMaterialLibrary(
  raw: unknown,
  index: number,
  importedAt: string
): MaterialLibrary | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const id = asString(raw.id).trim() || stableLegacyId("material", index, raw.title);
  const createdAt = normalizeTimestamp(raw.created_at, importedAt);
  const updatedAt = normalizeTimestamp(raw.updated_at, createdAt);
  const rawKind = asString(raw.material_kind).trim();
  const materialKind = MaterialLibraryKindSchema.safeParse(rawKind).success
    ? MaterialLibraryKindSchema.parse(rawKind)
    : "mixed";
  return {
    id,
    title: nonBlankString(raw.title, "未命名素材"),
    materialType: normalizeLibraryType(raw.material_type),
    materialKind,
    parentGenre: normalizeParentGenre(raw.parent_genre),
    subGenre: asString(raw.sub_genre),
    overview: asString(raw.overview),
    entries: normalizeMaterialEntries(raw, id, createdAt),
    createdAt,
    updatedAt
  };
}

function normalizeSkillEntry(
  raw: unknown,
  skillId: string,
  sourceStageId: string,
  targetStageId: SkillStageId,
  index: number,
  fallbackTimestamp: string
): SkillEntry | undefined {
  const item = asRecord(raw);
  const body = typeof raw === "string" ? raw : asString(item.body);
  const explicitTitle = typeof raw === "string" ? "" : asString(item.title).trim();
  if (!body.trim() && !explicitTitle && !asString(item.id).trim()) {
    return undefined;
  }
  const title = explicitTitle || SKILL_STAGE_LABELS[targetStageId];
  const createdAt = normalizeTimestamp(item.created_at, fallbackTimestamp);
  const updatedAt = normalizeTimestamp(item.updated_at, createdAt);
  const optionalSourceFields = {
    ...(asString(item.source_common_skill_id).trim()
      ? { sourceCommonSkillId: asString(item.source_common_skill_id).trim() }
      : {}),
    ...(asString(item.source_skill_id).trim()
      ? { sourceSkillId: asString(item.source_skill_id).trim() }
      : {}),
    ...(asString(item.source_skill_entry_id).trim()
      ? { sourceSkillEntryId: asString(item.source_skill_entry_id).trim() }
      : {})
  };
  return {
    id:
      asString(item.id).trim() ||
      stableLegacyId(
        "skill-entry",
        skillId,
        sourceStageId,
        targetStageId,
        index,
        title,
        body
      ),
    stageId: targetStageId,
    title,
    body,
    createdAt,
    updatedAt,
    ...optionalSourceFields
  };
}

function normalizeSkillEntries(
  rawSkill: Record<string, unknown>,
  skillId: string,
  fallbackTimestamp: string
): SkillEntry[] {
  const stages = asRecord(rawSkill.stages);
  const entries: SkillEntry[] = [];

  for (const targetStageId of SKILL_STAGE_IDS) {
    const normalizedTarget = SkillStageIdSchema.parse(targetStageId);
    for (const sourceStageId of SKILL_STAGE_SOURCES[normalizedTarget]) {
      for (const [index, value] of legacyEntryValues(stages[sourceStageId]).entries()) {
        const entry = normalizeSkillEntry(
          value,
          skillId,
          sourceStageId,
          normalizedTarget,
          index,
          fallbackTimestamp
        );
        if (entry) {
          entries.push(entry);
        }
      }
    }
  }

  const singleStageId = asString(rawSkill.stage_id).trim();
  if (singleStageId && entries.length === 0) {
    let targetStageId: SkillStageId = "character_design";
    if (singleStageId === "intro_design" || singleStageId === "plot_refine") {
      targetStageId = "plot_design";
    } else if (
      singleStageId === "draft_review" ||
      singleStageId === "format_conversion" ||
      singleStageId === "expert_draft_coordinator"
    ) {
      targetStageId = "draft";
    } else if (SkillStageIdSchema.safeParse(singleStageId).success) {
      targetStageId = SkillStageIdSchema.parse(singleStageId);
    }
    const entry = normalizeSkillEntry(
      {
        title: rawSkill.title,
        body: rawSkill.body,
        created_at: rawSkill.created_at,
        updated_at: rawSkill.updated_at
      },
      skillId,
      singleStageId,
      targetStageId,
      0,
      fallbackTimestamp
    );
    if (entry) {
      entries.push(entry);
    }
  }
  return entries;
}

export function normalizeLegacySkillLibrary(
  raw: unknown,
  index: number,
  importedAt: string
): SkillLibrary | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const id = asString(raw.id).trim() || stableLegacyId("skill", index, raw.title);
  const createdAt = normalizeTimestamp(raw.created_at, importedAt);
  const updatedAt = normalizeTimestamp(raw.updated_at, createdAt);
  const rawKind = asString(raw.skill_kind).trim();
  const skillKind = SkillKindSchema.safeParse(rawKind).success
    ? SkillKindSchema.parse(rawKind)
    : "general";
  return {
    id,
    title: nonBlankString(raw.title, "未命名技能"),
    skillType: normalizeLibraryType(raw.skill_type),
    skillKind,
    overview: asString(raw.overview),
    isBuiltin: raw.is_builtin === true,
    entries: normalizeSkillEntries(raw, id, createdAt),
    createdAt,
    updatedAt
  };
}

function uniqueById<T extends { id: string }>(values: readonly T[]): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value.id)) {
      return false;
    }
    seen.add(value.id);
    return true;
  });
}

function normalizeFingerprintBody(body: string): string {
  return body
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

function recoveryTitlesMatch(left: string, right: string): boolean {
  const normalizedLeft = left.trim();
  const normalizedRight = right.trim();
  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.startsWith(normalizedRight) ||
    normalizedRight.startsWith(normalizedLeft)
  );
}

function entryContentKey(entry: {
  stageId: string;
  title: string;
  body: string;
}): string {
  const normalizedBody = normalizeFingerprintBody(entry.body);
  return `${entry.stageId}\u0000${normalizedBody || `title:${entry.title.trim()}`}`;
}

function libraryContentFingerprint(
  libraryType: LibraryType,
  entries: ReadonlyArray<{ stageId: string; title: string; body: string }>
): string | undefined {
  if (entries.length === 0) {
    return undefined;
  }
  const normalizedEntries = entries.map(entryContentKey).sort();
  return createHash("sha256")
    .update(libraryType)
    .update("\u0000")
    .update(normalizedEntries.join("\u0001"))
    .digest("hex");
}

function mergeEntries<T extends { id: string; stageId: string; title: string; body: string }>(
  target: T[],
  incoming: readonly T[]
): void {
  const ids = new Set(target.map(({ id }) => id));
  const contentKeys = new Set(target.map(entryContentKey));
  for (const entry of incoming) {
    const contentKey = entryContentKey(entry);
    if (ids.has(entry.id) || contentKeys.has(contentKey)) {
      continue;
    }
    target.push(entry);
    ids.add(entry.id);
    contentKeys.add(contentKey);
  }
}

interface NormalizedLegacySource {
  root: string;
  fileContents: Array<string | undefined>;
  materials: MaterialLibrary[];
  materialGroups: MaterialLibraryGroup[];
  skills: SkillLibrary[];
  skillGroups: SkillLibraryGroup[];
}

interface MergedLibraries<T> {
  values: T[];
  aliasesByRoot: Map<string, Map<string, string>>;
}

function mergeMaterialLibraries(
  sources: readonly NormalizedLegacySource[]
): MergedLibraries<MaterialLibrary> {
  const values: MaterialLibrary[] = [];
  const byId = new Map<string, MaterialLibrary>();
  const byContent = new Map<string, MaterialLibrary[]>();
  const aliasesByRoot = new Map<string, Map<string, string>>();

  for (const source of sources) {
    const aliases = new Map<string, string>();
    aliasesByRoot.set(source.root, aliases);
    for (const incoming of source.materials) {
      let selected = byId.get(incoming.id);
      const fingerprint = libraryContentFingerprint(
        incoming.materialType,
        incoming.entries
      );
      if (!selected && fingerprint) {
        selected = byContent.get(fingerprint)?.find(
          (candidate) =>
            candidate.materialType === incoming.materialType &&
            libraryContentFingerprint(
              candidate.materialType,
              candidate.entries
            ) === fingerprint &&
            (candidate.id.startsWith("recovered-material-") ||
              incoming.id.startsWith("recovered-material-")) &&
            recoveryTitlesMatch(candidate.title, incoming.title) &&
            (candidate.materialKind === incoming.materialKind ||
              candidate.materialKind === "mixed" ||
              incoming.materialKind === "mixed")
        );
      }

      if (selected) {
        aliases.set(incoming.id, selected.id);
        mergeEntries(selected.entries, incoming.entries);
        if (!selected.parentGenre && incoming.parentGenre) {
          selected.parentGenre = incoming.parentGenre;
        }
        if (!selected.subGenre && incoming.subGenre) {
          selected.subGenre = incoming.subGenre;
        }
        if (!selected.overview && incoming.overview) {
          selected.overview = incoming.overview;
        }
        if (
          selected.materialKind === "mixed" &&
          incoming.materialKind !== "mixed"
        ) {
          selected.materialKind = incoming.materialKind;
        }
        continue;
      }

      values.push(incoming);
      byId.set(incoming.id, incoming);
      aliases.set(incoming.id, incoming.id);
      if (fingerprint) {
        const bucket = byContent.get(fingerprint) ?? [];
        bucket.push(incoming);
        byContent.set(fingerprint, bucket);
      }
    }
  }
  return { values, aliasesByRoot };
}

function mergeSkillLibraries(
  sources: readonly NormalizedLegacySource[]
): MergedLibraries<SkillLibrary> {
  const values: SkillLibrary[] = [];
  const byId = new Map<string, SkillLibrary>();
  const byContent = new Map<string, SkillLibrary[]>();
  const aliasesByRoot = new Map<string, Map<string, string>>();

  for (const source of sources) {
    const aliases = new Map<string, string>();
    aliasesByRoot.set(source.root, aliases);
    for (const incoming of source.skills) {
      let selected = byId.get(incoming.id);
      const fingerprint = libraryContentFingerprint(incoming.skillType, incoming.entries);
      if (!selected && fingerprint) {
        selected = byContent.get(fingerprint)?.find(
          (candidate) =>
            candidate.skillType === incoming.skillType &&
            libraryContentFingerprint(candidate.skillType, candidate.entries) ===
              fingerprint &&
            (candidate.id.startsWith("recovered-skill-") ||
              incoming.id.startsWith("recovered-skill-")) &&
            recoveryTitlesMatch(candidate.title, incoming.title) &&
            candidate.skillKind === incoming.skillKind &&
            candidate.isBuiltin === incoming.isBuiltin
        );
      }

      if (selected) {
        aliases.set(incoming.id, selected.id);
        mergeEntries(selected.entries, incoming.entries);
        if (!selected.overview && incoming.overview) {
          selected.overview = incoming.overview;
        }
        selected.isBuiltin ||= incoming.isBuiltin;
        continue;
      }

      values.push(incoming);
      byId.set(incoming.id, incoming);
      aliases.set(incoming.id, incoming.id);
      if (fingerprint) {
        const bucket = byContent.get(fingerprint) ?? [];
        bucket.push(incoming);
        byContent.set(fingerprint, bucket);
      }
    }
  }
  return { values, aliasesByRoot };
}

function normalizeMaterialGroups(
  raw: unknown,
  materials: readonly MaterialLibrary[],
  importedAt: string
): MaterialLibraryGroup[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const byId = new Map(materials.map((material) => [material.id, material]));
  return uniqueById(
    raw.flatMap((value, index) => {
      if (!isRecord(value)) {
        return [];
      }
      const membersRaw = asRecord(value.members);
      const members: Partial<Record<MaterialKind, string>> = {};
      for (const kind of MATERIAL_KINDS) {
        const materialId = asString(membersRaw[kind]).trim();
        const material = byId.get(materialId);
        if (
          material &&
          (material.materialKind === "mixed" || material.materialKind === kind)
        ) {
          members[kind] = materialId;
        }
      }
      if (Object.keys(members).length === 0) {
        return [];
      }
      const createdAt = normalizeTimestamp(value.created_at, importedAt);
      const updatedAt = normalizeTimestamp(value.updated_at, createdAt);
      return [
        {
          id:
            asString(value.id).trim() ||
            stableLegacyId("material-group", index, value.title),
          title: nonBlankString(value.title, "未命名素材分组"),
          members,
          createdAt,
          updatedAt
        }
      ];
    })
  );
}

function normalizeSkillGroups(
  raw: unknown,
  skills: readonly SkillLibrary[],
  importedAt: string
): SkillLibraryGroup[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const byId = new Map(skills.map((skill) => [skill.id, skill]));
  return uniqueById(
    raw.flatMap((value, index) => {
      if (!isRecord(value)) {
        return [];
      }
      const membersRaw = asRecord(value.members);
      const members: Partial<Record<SkillKind, string>> = {};
      for (const kind of SKILL_KINDS) {
        const skillId = asString(membersRaw[kind]).trim();
        const skill = byId.get(skillId);
        if (skill?.skillKind === kind) {
          members[kind] = skillId;
        }
      }
      if (Object.keys(members).length === 0) {
        return [];
      }
      const createdAt = normalizeTimestamp(value.created_at, importedAt);
      const updatedAt = normalizeTimestamp(value.updated_at, createdAt);
      return [
        {
          id:
            asString(value.id).trim() ||
            stableLegacyId("skill-group", index, value.title),
          title: nonBlankString(value.title, "未命名技能分组"),
          members,
          createdAt,
          updatedAt
        }
      ];
    })
  );
}

function mergeMaterialGroups(
  sources: readonly NormalizedLegacySource[],
  aliasesByRoot: ReadonlyMap<string, ReadonlyMap<string, string>>
): MaterialLibraryGroup[] {
  const values: MaterialLibraryGroup[] = [];
  const byId = new Map<string, MaterialLibraryGroup>();
  const contentKeys = new Set<string>();

  for (const source of sources) {
    const aliases = aliasesByRoot.get(source.root);
    for (const incoming of source.materialGroups) {
      const members: Partial<Record<MaterialKind, string>> = {};
      for (const kind of MATERIAL_KINDS) {
        const memberId = incoming.members[kind];
        if (memberId) {
          members[kind] = aliases?.get(memberId) ?? memberId;
        }
      }
      const existing = byId.get(incoming.id);
      if (existing) {
        for (const kind of MATERIAL_KINDS) {
          existing.members[kind] ??= members[kind];
        }
        continue;
      }
      const contentKey = `${incoming.title}\u0000${MATERIAL_KINDS.map(
        (kind) => `${kind}:${members[kind] ?? ""}`
      ).join("\u0001")}`;
      if (contentKeys.has(contentKey)) {
        continue;
      }
      const group = { ...incoming, members };
      values.push(group);
      byId.set(group.id, group);
      contentKeys.add(contentKey);
    }
  }
  return values;
}

function mergeSkillGroups(
  sources: readonly NormalizedLegacySource[],
  aliasesByRoot: ReadonlyMap<string, ReadonlyMap<string, string>>
): SkillLibraryGroup[] {
  const values: SkillLibraryGroup[] = [];
  const byId = new Map<string, SkillLibraryGroup>();
  const contentKeys = new Set<string>();

  for (const source of sources) {
    const aliases = aliasesByRoot.get(source.root);
    for (const incoming of source.skillGroups) {
      const members: Partial<Record<SkillKind, string>> = {};
      for (const kind of SKILL_KINDS) {
        const memberId = incoming.members[kind];
        if (memberId) {
          members[kind] = aliases?.get(memberId) ?? memberId;
        }
      }
      const existing = byId.get(incoming.id);
      if (existing) {
        for (const kind of SKILL_KINDS) {
          existing.members[kind] ??= members[kind];
        }
        continue;
      }
      const contentKey = `${incoming.title}\u0000${SKILL_KINDS.map(
        (kind) => `${kind}:${members[kind] ?? ""}`
      ).join("\u0001")}`;
      if (contentKeys.has(contentKey)) {
        continue;
      }
      const group = { ...incoming, members };
      values.push(group);
      byId.set(group.id, group);
      contentKeys.add(contentKey);
    }
  }
  return values;
}

async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function parseJson(text: string | undefined, path: string): unknown {
  if (text === undefined || text.trim() === "") {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error: unknown) {
    throw new Error(
      `旧版数据文件无法解析：${path}（${error instanceof Error ? error.message : "JSON 格式错误"}）`
    );
  }
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function loadLegacySource(
  root: string,
  importedAt: string
): Promise<NormalizedLegacySource | undefined> {
  const resolvedRoot = resolve(root);
  if (!(await directoryExists(resolvedRoot))) {
    return undefined;
  }
  const fileContents = await Promise.all(
    LEGACY_FILES.map((file) => readOptionalFile(join(resolvedRoot, file)))
  );
  if (fileContents.every((content) => content === undefined)) {
    return undefined;
  }
  const [materialsText, skillsText, preferencesText] = fileContents;
  const materialsPayload = asRecord(
    parseJson(materialsText, join(resolvedRoot, LEGACY_MATERIALS_FILE))
  );
  const skillsPayload = asRecord(
    parseJson(skillsText, join(resolvedRoot, LEGACY_SKILLS_FILE))
  );
  const preferencesPayload = asRecord(
    parseJson(preferencesText, join(resolvedRoot, LEGACY_PREFERENCES_FILE))
  );
  const materials = uniqueById(
    (Array.isArray(materialsPayload.materials) ? materialsPayload.materials : []).flatMap(
      (value, index) => {
        const material = normalizeLegacyMaterialLibrary(value, index, importedAt);
        return material ? [material] : [];
      }
    )
  );
  const skills = uniqueById(
    (Array.isArray(skillsPayload.skills) ? skillsPayload.skills : []).flatMap(
      (value, index) => {
        const skill = normalizeLegacySkillLibrary(value, index, importedAt);
        return skill ? [skill] : [];
      }
    )
  );
  return {
    root: resolvedRoot,
    fileContents,
    materials,
    materialGroups: normalizeMaterialGroups(
      preferencesPayload.material_library_groups,
      materials,
      importedAt
    ),
    skills,
    skillGroups: normalizeSkillGroups(
      preferencesPayload.skill_library_groups,
      skills,
      importedAt
    )
  };
}

async function importLegacyCatalog(
  legacyDataRoots: readonly string[],
  importedAt: string
): Promise<CatalogSnapshot> {
  const empty: CatalogSnapshot = {
    schemaVersion: 1,
    revision: 0,
    books: [],
    materials: [],
    materialGroups: [],
    skills: [],
    skillGroups: [],
    updatedAt: importedAt
  };
  const roots = [
    ...new Set(
      legacyDataRoots
        .map((root) => root.trim())
        .filter(Boolean)
        .map((root) => resolve(root))
    )
  ];
  if (roots.length === 0) {
    return CatalogSnapshotSchema.parse(empty);
  }
  const sources = (
    await Promise.all(roots.map((root) => loadLegacySource(root, importedAt)))
  ).flatMap((source) => (source ? [source] : []));
  if (sources.length === 0) {
    return CatalogSnapshotSchema.parse(empty);
  }
  const mergedMaterials = mergeMaterialLibraries(sources);
  const mergedSkills = mergeSkillLibraries(sources);
  const materials = mergedMaterials.values;
  const skills = mergedSkills.values;
  const materialGroups = mergeMaterialGroups(
    sources,
    mergedMaterials.aliasesByRoot
  );
  const skillGroups = mergeSkillGroups(sources, mergedSkills.aliasesByRoot);
  const fingerprint = createHash("sha256");
  for (const source of sources) {
    fingerprint.update(source.root);
    fingerprint.update("\u0000");
    for (const [index, file] of LEGACY_FILES.entries()) {
      fingerprint.update(file);
      fingerprint.update("\u0000");
      fingerprint.update(source.fileContents[index] ?? "<missing>");
      fingerprint.update("\u0000");
    }
  }

  return CatalogSnapshotSchema.parse({
    schemaVersion: 1,
    revision: 1,
    books: [],
    materials,
    materialGroups,
    skills,
    skillGroups,
    updatedAt: importedAt,
    legacyImport: {
      sourceRoot: sources[0]!.root,
      sourceRoots: sources.map(({ root }) => root),
      fingerprint: fingerprint.digest("hex"),
      importedAt,
      materials: materials.length,
      skills: skills.length,
      materialGroups: materialGroups.length,
      skillGroups: skillGroups.length
    }
  });
}

function snapshotAsLegacySource(
  root: string,
  snapshot: CatalogSnapshot
): NormalizedLegacySource {
  return {
    root,
    fileContents: [],
    materials: structuredClone(snapshot.materials),
    materialGroups: structuredClone(snapshot.materialGroups),
    skills: structuredClone(snapshot.skills),
    skillGroups: structuredClone(snapshot.skillGroups)
  };
}

async function importMissingLegacySources(
  existing: CatalogSnapshot,
  configuredRoots: readonly string[],
  updatedAt: string
): Promise<CatalogSnapshot | undefined> {
  const existingImport = existing.legacyImport;
  if (!existingImport) {
    return undefined;
  }
  const coveredRoots = [
    ...new Set(
      (existingImport.sourceRoots ?? [existingImport.sourceRoot]).map((root) =>
        resolve(root)
      )
    )
  ];
  const normalizedConfiguredRoots = [
    ...new Set(
      configuredRoots
        .map((root) => root.trim())
        .filter(Boolean)
        .map((root) => resolve(root))
    )
  ];
  const covered = new Set(coveredRoots);
  const missingRoots = normalizedConfiguredRoots.filter((root) => !covered.has(root));
  if (missingRoots.length === 0) {
    return undefined;
  }

  const missingSnapshot = await importLegacyCatalog(missingRoots, updatedAt);
  const missingImport = missingSnapshot.legacyImport;
  if (!missingImport) {
    return undefined;
  }
  const existingSource = snapshotAsLegacySource(
    "catalog-existing-source",
    existing
  );
  const missingSource = snapshotAsLegacySource(
    "catalog-missing-source",
    missingSnapshot
  );
  const sources = [existingSource, missingSource];
  const mergedMaterials = mergeMaterialLibraries(sources);
  const mergedSkills = mergeSkillLibraries(sources);
  const materials = mergedMaterials.values;
  const skills = mergedSkills.values;
  const materialGroups = mergeMaterialGroups(
    sources,
    mergedMaterials.aliasesByRoot
  );
  const skillGroups = mergeSkillGroups(sources, mergedSkills.aliasesByRoot);
  const newlyCoveredRoots = missingImport.sourceRoots ?? [missingImport.sourceRoot];
  const sourceRoots = [
    ...new Set([...coveredRoots, ...newlyCoveredRoots.map((root) => resolve(root))])
  ];
  const fingerprint = createHash("sha256")
    .update(existingImport.fingerprint)
    .update("\u0000")
    .update(missingImport.fingerprint)
    .update("\u0000")
    .update(sourceRoots.join("\u0000"))
    .digest("hex");

  return CatalogSnapshotSchema.parse({
    schemaVersion: 1,
    revision: existing.revision + 1,
    books: structuredClone(existing.books),
    materials,
    materialGroups,
    skills,
    skillGroups,
    updatedAt,
    legacyImport: {
      sourceRoot: existingImport.sourceRoot,
      sourceRoots,
      fingerprint,
      importedAt: updatedAt,
      materials: materials.length,
      skills: skills.length,
      materialGroups: materialGroups.length,
      skillGroups: skillGroups.length
    }
  });
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    await rename(temporary, path);
  } catch (error: unknown) {
    try {
      await unlink(temporary);
    } catch {
      // The temporary file may not have been created or may already be renamed.
    }
    throw error;
  }
}

function emptyLinkedMaterialIds(): LinkedMaterialIdsByKind {
  return { character: [], gimmick: [], plot: [], draft: [], other: [] };
}

function emptyLinkedSkillIds(): LinkedSkillIdsByKind {
  return { general: [], plot: [], style: [], other: [] };
}

function normalizeLinkedMaterialIds(
  raw: LinkedMaterialIdsByKindInput | undefined
): LinkedMaterialIdsByKind {
  const next = emptyLinkedMaterialIds();
  for (const kind of MATERIAL_KINDS) {
    next[kind] = [...new Set(raw?.[kind] ?? [])];
  }
  return next;
}

function normalizeLinkedSkillIds(
  raw: LinkedSkillIdsByKindInput | undefined
): LinkedSkillIdsByKind {
  const next = emptyLinkedSkillIds();
  for (const kind of SKILL_KINDS) {
    next[kind] = [...new Set(raw?.[kind] ?? [])];
  }
  return next;
}

function assertCatalogReferences(snapshot: CatalogSnapshot): void {
  const materials = new Map(snapshot.materials.map((material) => [material.id, material]));
  const skills = new Map(snapshot.skills.map((skill) => [skill.id, skill]));

  for (const book of snapshot.books) {
    for (const kind of MATERIAL_KINDS) {
      for (const materialId of book.linkedMaterialIdsByKind[kind]) {
        const material = materials.get(materialId);
        if (!material) {
          throw new Error(`书籍「${book.title}」关联了不存在的素材库：${materialId}`);
        }
        if (material.materialType !== "short") {
          throw new Error(`短篇书籍不能关联${material.materialType}素材库：${material.title}`);
        }
        if (material.materialKind !== "mixed" && material.materialKind !== kind) {
          throw new Error(`素材库「${material.title}」不能关联到 ${kind} 分类。`);
        }
      }
    }
    for (const kind of SKILL_KINDS) {
      for (const skillId of book.linkedSkillIdsByKind[kind]) {
        const skill = skills.get(skillId);
        if (!skill) {
          throw new Error(`书籍「${book.title}」绑定了不存在的技能库：${skillId}`);
        }
        if (skill.skillType !== "short") {
          throw new Error(`短篇书籍不能绑定${skill.skillType}技能库：${skill.title}`);
        }
        if (skill.skillKind !== kind) {
          throw new Error(`技能库「${skill.title}」不能绑定到 ${kind} 分类。`);
        }
      }
    }
  }

  for (const group of snapshot.materialGroups) {
    for (const [kind, materialId] of Object.entries(group.members) as Array<
      [MaterialKind, string]
    >) {
      const material = materials.get(materialId);
      if (!material) {
        throw new Error(`素材分组「${group.title}」引用了不存在的素材库。`);
      }
      if (material.materialKind !== "mixed" && material.materialKind !== kind) {
        throw new Error(`素材分组「${group.title}」包含了错误分类的素材库。`);
      }
    }
  }

  for (const group of snapshot.skillGroups) {
    for (const [kind, skillId] of Object.entries(group.members) as Array<
      [SkillKind, string]
    >) {
      const skill = skills.get(skillId);
      if (!skill) {
        throw new Error(`技能分组「${group.title}」引用了不存在的技能库。`);
      }
      if (skill.skillKind !== kind) {
        throw new Error(`技能分组「${group.title}」包含了错误分类的技能库。`);
      }
    }
  }
}

function createDefaultDocuments(now: string): CatalogDocument[] {
  return DEFAULT_SHORT_DOCUMENTS.map(([id, title]) => ({
    id,
    title,
    content: "",
    createdAt: now,
    updatedAt: now
  }));
}

function defaultDocumentTitle(documentId: string): string {
  return DEFAULT_SHORT_DOCUMENTS.find(([id]) => id === documentId)?.[1] ?? documentId;
}

export interface CatalogStoreOptions {
  userDataPath: string;
  legacyDataRoot?: string;
  legacyDataRoots?: readonly string[];
  now?: () => string;
}

export class CatalogStore {
  readonly catalogPath: string;
  private readonly legacyDataRoots: string[];
  private readonly now: () => string;
  private snapshotValue: CatalogSnapshot | undefined;
  private initialization: Promise<CatalogSnapshot> | undefined;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(options: CatalogStoreOptions) {
    const userDataPath = options.userDataPath.trim();
    if (!userDataPath) {
      throw new Error("CatalogStore requires a user data path.");
    }
    this.catalogPath = join(userDataPath, "catalog.json");
    this.legacyDataRoots = [
      ...(options.legacyDataRoots ?? []),
      ...(options.legacyDataRoot ? [options.legacyDataRoot] : [])
    ]
      .map((root) => root.trim())
      .filter(Boolean);
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async snapshot(): Promise<CatalogSnapshot> {
    await this.writeChain;
    return structuredClone(await this.load());
  }

  async createShortBook(rawInput: CreateShortBookInput): Promise<ShortBook> {
    const input = CreateShortBookInputSchema.parse(rawInput);
    const id = `book-${randomUUID()}`;
    const now = this.now();
    const book = ShortBookSchema.parse({
      id,
      title: input.title,
      bookType: "short",
      genre: input.genre,
      status: "editing",
      linkedMaterialIdsByKind: normalizeLinkedMaterialIds(
        input.linkedMaterialIdsByKind
      ),
      linkedSkillIdsByKind: normalizeLinkedSkillIds(input.linkedSkillIdsByKind),
      documents: createDefaultDocuments(now),
      draft: createCatalogDraftDirectory(now),
      createdAt: now,
      updatedAt: now
    });
    const next = await this.commit((draft) => {
      draft.books.push(book);
      return true;
    });
    return structuredClone(next.books.find((candidate) => candidate.id === id)!);
  }

  async updateBook(rawInput: UpdateBookInput): Promise<ShortBook> {
    const input = UpdateBookInputSchema.parse(rawInput);
    const next = await this.commit((draft) => {
      const book = draft.books.find((candidate) => candidate.id === input.bookId);
      if (!book) {
        throw new Error("书籍不存在或已被删除。");
      }
      if (input.title !== undefined) {
        book.title = input.title;
      }
      if (input.genre !== undefined) {
        book.genre = input.genre;
      }
      if (input.status !== undefined) {
        book.status = input.status;
      }
      if (input.linkedMaterialIdsByKind !== undefined) {
        book.linkedMaterialIdsByKind = normalizeLinkedMaterialIds(
          input.linkedMaterialIdsByKind
        );
      }
      if (input.linkedSkillIdsByKind !== undefined) {
        book.linkedSkillIdsByKind = normalizeLinkedSkillIds(
          input.linkedSkillIdsByKind
        );
      }
      book.updatedAt = this.now();
      return true;
    });
    return structuredClone(
      next.books.find((candidate) => candidate.id === input.bookId)!
    );
  }

  async deleteBook(rawInput: { bookId: string }): Promise<DeleteBookResult> {
    const input = DeleteBookInputSchema.parse(rawInput);
    let deleted = false;
    await this.commit((draft) => {
      const nextBooks = draft.books.filter((book) => book.id !== input.bookId);
      deleted = nextBooks.length !== draft.books.length;
      if (deleted) {
        draft.books = nextBooks;
      }
      return deleted;
    });
    return { bookId: input.bookId, deleted };
  }

  async saveDocument(rawInput: SaveDocumentInput): Promise<CatalogDocument> {
    const input = SaveDocumentInputSchema.parse(rawInput);
    const next = await this.commit((draft) => {
      const book = draft.books.find((candidate) => candidate.id === input.bookId);
      if (!book) {
        throw new Error("书籍不存在或已被删除。");
      }
      const now = this.now();
      const existing = book.documents.find(
        (document) => document.id === input.documentId
      );
      if (existing) {
        existing.content = input.content;
        if (input.title !== undefined) {
          existing.title = input.title;
        }
        existing.updatedAt = now;
      } else {
        const section = book.draft.sections.find(
          (candidate) =>
            candidate.body.id === input.documentId ||
            candidate.characterState.id === input.documentId
        );
        if (section?.body.id === input.documentId) {
          const sectionTitle = input.title ?? section.title;
          section.title = sectionTitle;
          section.body.title = sectionTitle;
          section.body.content = input.content;
          section.body.updatedAt = now;
          section.characterState.title = draftCharacterStateTitle(sectionTitle);
          section.updatedAt = now;
          book.draft.updatedAt = now;
        } else if (section?.characterState.id === input.documentId) {
          section.characterState.title = draftCharacterStateTitle(section.title);
          section.characterState.content = input.content;
          section.characterState.updatedAt = now;
          section.updatedAt = now;
          book.draft.updatedAt = now;
        } else {
          if (isReservedDraftDocumentId(input.documentId)) {
            throw new Error("该正文小节已删除或不存在。");
          }
          if (input.documentId === "draft") {
            throw new Error(
              "正文现在是小节文件夹，不能再按单一 draft 文档整篇覆盖。"
            );
          }
          book.documents.push(
            CatalogDocumentSchema.parse({
              id: input.documentId,
              title: input.title ?? defaultDocumentTitle(input.documentId),
              content: input.content,
              createdAt: now,
              updatedAt: now
            })
          );
        }
      }
      book.updatedAt = now;
      return true;
    });
    const book = next.books.find((candidate) => candidate.id === input.bookId)!;
    const saved =
      book.documents.find((document) => document.id === input.documentId) ??
      book.draft.sections
        .flatMap((section) => [section.body, section.characterState])
        .find((document) => document.id === input.documentId);
    if (!saved) {
      throw new Error("正文文件保存后未能重新读取。");
    }
    return structuredClone(saved);
  }

  private async load(): Promise<CatalogSnapshot> {
    if (this.snapshotValue) {
      return this.snapshotValue;
    }
    if (!this.initialization) {
      this.initialization = this.initialize();
    }
    return await this.initialization;
  }

  private async initialize(): Promise<CatalogSnapshot> {
    const existingText = await readOptionalFile(this.catalogPath);
    let snapshot: CatalogSnapshot;
    if (existingText !== undefined) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(existingText) as unknown;
      } catch (error: unknown) {
        throw new Error(
          `目录数据无法解析：${this.catalogPath}（${error instanceof Error ? error.message : "JSON 格式错误"}）`
        );
      }
      snapshot = CatalogSnapshotSchema.parse(parsed);
      assertCatalogReferences(snapshot);
      const supplemented = await importMissingLegacySources(
        snapshot,
        this.legacyDataRoots,
        this.now()
      );
      if (supplemented) {
        assertCatalogReferences(supplemented);
        await atomicWriteJson(this.catalogPath, supplemented);
        snapshot = supplemented;
      }
    } else {
      snapshot = await importLegacyCatalog(this.legacyDataRoots, this.now());
      await atomicWriteJson(this.catalogPath, snapshot);
    }
    assertCatalogReferences(snapshot);
    this.snapshotValue = snapshot;
    return snapshot;
  }

  private async commit(
    mutate: (draft: CatalogSnapshot) => boolean
  ): Promise<CatalogSnapshot> {
    let committed: CatalogSnapshot | undefined;
    const operation = this.writeChain.then(async () => {
      const current = await this.load();
      const draft = structuredClone(current);
      const changed = mutate(draft);
      if (!changed) {
        committed = current;
        return;
      }
      draft.revision = current.revision + 1;
      draft.updatedAt = this.now();
      const validated = CatalogSnapshotSchema.parse(draft);
      assertCatalogReferences(validated);
      await atomicWriteJson(this.catalogPath, validated);
      this.snapshotValue = validated;
      committed = validated;
    });
    this.writeChain = operation.then(
      () => undefined,
      () => undefined
    );
    await operation;
    return committed!;
  }
}
