import type {
  LibraryType,
  MaterialLibraryKind,
  MaterialStageId,
  SkillKind,
  SkillStageId
} from "../catalog";

export const LIBRARY_PACKAGE_LOCALES = ["zh-CN", "en-US"] as const;
export type LibraryPackageLocale = (typeof LIBRARY_PACKAGE_LOCALES)[number];

type Localized = Readonly<Record<LibraryPackageLocale, string>>;

/** Folder names follow the app's catalog wording so exports read naturally. */
export const MATERIAL_STAGE_FOLDER_NAMES: Readonly<
  Record<MaterialStageId, Localized>
> = {
  gimmick: { "zh-CN": "梗", "en-US": "Story ideas" },
  character: { "zh-CN": "人设", "en-US": "Character concepts" },
  pacing: { "zh-CN": "剧情设计", "en-US": "Plot design" },
  intro: { "zh-CN": "导语设计", "en-US": "Opening design" },
  plot_refine: { "zh-CN": "剧情细化", "en-US": "Plot refinement" },
  draft_excerpt: { "zh-CN": "优秀正文片段", "en-US": "Prose excerpts" },
  other: { "zh-CN": "其他素材", "en-US": "Other materials" }
};

export const SKILL_STAGE_FOLDER_NAMES: Readonly<
  Record<SkillStageId, Localized>
> = {
  character_design: { "zh-CN": "人物技能", "en-US": "Character skills" },
  plot_design: { "zh-CN": "剧情技能", "en-US": "Plot skills" },
  outline: { "zh-CN": "大纲技能", "en-US": "Outline skills" },
  draft: { "zh-CN": "正文专家编写技能", "en-US": "Prose writing skills" },
  expert_section_writer: {
    "zh-CN": "分节写手技能",
    "en-US": "Section writing skills"
  }
};

export const MATERIAL_KIND_NAMES: Readonly<
  Record<MaterialLibraryKind, Localized>
> = {
  character: { "zh-CN": "人设素材库", "en-US": "Character material library" },
  gimmick: { "zh-CN": "梗素材库", "en-US": "Story idea library" },
  plot: { "zh-CN": "剧情素材库", "en-US": "Plot material library" },
  draft: { "zh-CN": "正文素材库", "en-US": "Prose material library" },
  other: { "zh-CN": "其他素材库", "en-US": "Other material library" },
  mixed: { "zh-CN": "综合素材库", "en-US": "General material library" }
};

export const SKILL_KIND_NAMES: Readonly<Record<SkillKind, Localized>> = {
  general: { "zh-CN": "通用技能库", "en-US": "General skill library" },
  plot: { "zh-CN": "剧情设计技能库", "en-US": "Plot design skill library" },
  style: { "zh-CN": "文风写作技能库", "en-US": "Writing style skill library" },
  other: { "zh-CN": "其他技能库", "en-US": "Other skill library" }
};

export const LIBRARY_TYPE_NAMES: Readonly<Record<LibraryType, Localized>> = {
  short: { "zh-CN": "短篇", "en-US": "Short story" },
  long: { "zh-CN": "长篇", "en-US": "Novel" },
  script: { "zh-CN": "剧本", "en-US": "Screenplay" }
};

/** Extra folder names recognised on import, beyond both locales' names. */
const MATERIAL_STAGE_ALIASES: Readonly<
  Partial<Record<MaterialStageId, readonly string[]>>
> = {
  gimmick: ["脑洞", "创意"],
  character: ["人物", "角色", "characters"],
  pacing: ["节奏", "plot"],
  intro: ["开篇", "导语", "opening"],
  plot_refine: ["细纲"],
  draft_excerpt: ["正文", "范文", "片段", "excerpts"],
  other: ["其他", "other"]
};

const SKILL_STAGE_ALIASES: Readonly<
  Partial<Record<SkillStageId, readonly string[]>>
> = {
  character_design: ["人物", "人设"],
  plot_design: ["剧情"],
  outline: ["大纲"],
  draft: ["正文"],
  expert_section_writer: ["分节"]
};

function folderKey(value: string): string {
  return value.normalize("NFC").trim().toLocaleLowerCase("en-US");
}

function stageIndex<Stage extends string>(
  names: Readonly<Record<Stage, Localized>>,
  aliases: Readonly<Partial<Record<Stage, readonly string[]>>>
): ReadonlyMap<string, Stage> {
  const index = new Map<string, Stage>();
  for (const [stage, localized] of Object.entries(names) as [
    Stage,
    Localized
  ][]) {
    for (const name of [...Object.values(localized), ...(aliases[stage] ?? [])])
      index.set(folderKey(name), stage);
  }
  return index;
}

const MATERIAL_STAGE_INDEX = stageIndex(
  MATERIAL_STAGE_FOLDER_NAMES,
  MATERIAL_STAGE_ALIASES
);
const SKILL_STAGE_INDEX = stageIndex(
  SKILL_STAGE_FOLDER_NAMES,
  SKILL_STAGE_ALIASES
);

/** Maps a folder name to a stage, in either locale or by a common alias. */
export function stageForFolderName(
  domain: "material" | "skill",
  folderName: string
): MaterialStageId | SkillStageId | undefined {
  const key = folderKey(folderName);
  return domain === "material"
    ? MATERIAL_STAGE_INDEX.get(key)
    : SKILL_STAGE_INDEX.get(key);
}

const MATERIAL_KIND_KEYWORDS: readonly (readonly [
  Exclude<MaterialLibraryKind, "mixed">,
  readonly string[]
])[] = [
  ["character", ["人设", "人物", "角色", "character"]],
  ["gimmick", ["梗", "脑洞", "创意", "点子", "idea"]],
  ["plot", ["剧情", "情节", "大纲", "节奏", "开篇", "细纲", "plot", "outline"]],
  ["draft", ["正文", "范文", "片段", "摘录", "prose", "excerpt"]],
  ["other", ["其他", "other"]]
];

const SKILL_KIND_KEYWORDS: readonly (readonly [
  Exclude<SkillKind, "general">,
  readonly string[]
])[] = [
  ["plot", ["剧情", "plot"]],
  ["style", ["文风", "风格", "style"]],
  ["other", ["其他", "other"]]
];

/** Guesses a library kind from its folder name; undefined when no keyword. */
export function kindFromLibraryName(
  domain: "material",
  name: string
): Exclude<MaterialLibraryKind, "mixed"> | undefined;
export function kindFromLibraryName(
  domain: "skill",
  name: string
): Exclude<SkillKind, "general"> | undefined;
export function kindFromLibraryName(
  domain: "material" | "skill",
  name: string
): string | undefined {
  const key = folderKey(name);
  const keywords =
    domain === "material" ? MATERIAL_KIND_KEYWORDS : SKILL_KIND_KEYWORDS;
  return keywords.find(([, words]) =>
    words.some((word) => key.includes(word))
  )?.[0];
}
