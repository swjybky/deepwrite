export type LoadSkillCandidate = {
  id: string;
  title: string;
  content: string;
  kind?: string | undefined;
};

export type ResolveAttachedSkillResult =
  | { status: "found"; skill: LoadSkillCandidate }
  | { status: "ambiguous"; matches: LoadSkillCandidate[] }
  | { status: "out_of_scope"; matches: LoadSkillCandidate[] }
  | { status: "not_found" };

const TITLE_SEPARATOR = " · ";
const KIND_SUFFIX_RE = /\s*\[[^\]]+\]\s*$/;

/** Entry short name: text after the last ` · `, or the full title when absent. */
export function skillEntryShortName(title: string): string {
  const index = title.lastIndexOf(TITLE_SEPARATOR);
  if (index < 0) return title;
  const shortName = title.slice(index + TITLE_SEPARATOR.length).trim();
  return shortName || title;
}

/** Library / left-side title before the last ` · `. */
export function skillLibraryTitle(title: string): string | undefined {
  const index = title.lastIndexOf(TITLE_SEPARATOR);
  if (index <= 0) return undefined;
  const libraryTitle = title.slice(0, index).trim();
  return libraryTitle || undefined;
}

export function normalizeLoadSkillName(raw: string): string {
  return String(raw ?? "")
    .trim()
    .replace(KIND_SUFFIX_RE, "")
    .trim();
}

function uniqueOrAmbiguous(
  matches: LoadSkillCandidate[]
):
  | Extract<ResolveAttachedSkillResult, { status: "found" | "ambiguous" }>
  | undefined {
  if (matches.length === 1) {
    return { status: "found", skill: matches[0]! };
  }
  if (matches.length > 1) {
    return { status: "ambiguous", matches };
  }
  return undefined;
}

function matchByTiers(
  name: string,
  pool: readonly LoadSkillCandidate[]
):
  | Extract<ResolveAttachedSkillResult, { status: "found" | "ambiguous" }>
  | undefined {
  const exactTitle = pool.filter((item) => item.title === name);
  const exactTitleHit = uniqueOrAmbiguous(exactTitle);
  if (exactTitleHit) return exactTitleHit;

  const exactId = pool.filter((item) => item.id === name);
  const exactIdHit = uniqueOrAmbiguous(exactId);
  if (exactIdHit) return exactIdHit;

  const exactShort = pool.filter(
    (item) => skillEntryShortName(item.title) === name
  );
  const exactShortHit = uniqueOrAmbiguous(exactShort);
  if (exactShortHit) return exactShortHit;

  const exactLibrary = pool.filter(
    (item) => skillLibraryTitle(item.title) === name
  );
  const exactLibraryHit = uniqueOrAmbiguous(exactLibrary);
  if (exactLibraryHit) return exactLibraryHit;

  const fuzzy = pool.filter((item) => {
    const shortName = skillEntryShortName(item.title);
    const libraryTitle = skillLibraryTitle(item.title);
    return (
      item.title.includes(name) ||
      shortName.includes(name) ||
      (libraryTitle !== undefined && libraryTitle.includes(name))
    );
  });
  return uniqueOrAmbiguous(fuzzy);
}

/**
 * Resolve load_skill name against attached skills.
 * Priority: full title → id → entry short name → library title → unique fuzzy includes.
 */
export function resolveAttachedSkill(
  rawName: string,
  attached: readonly LoadSkillCandidate[],
  isReadable: (item: LoadSkillCandidate) => boolean
): ResolveAttachedSkillResult {
  const name = normalizeLoadSkillName(rawName);
  if (!name) return { status: "not_found" };

  const readable = attached.filter(isReadable);
  const readableHit = matchByTiers(name, readable);
  if (readableHit) return readableHit;

  const outOfScopeHit = matchByTiers(name, attached);
  if (outOfScopeHit) {
    return {
      status: "out_of_scope",
      matches:
        outOfScopeHit.status === "found"
          ? [outOfScopeHit.skill]
          : outOfScopeHit.matches
    };
  }

  return { status: "not_found" };
}

function formatSkillListLine(item: LoadSkillCandidate): string {
  const shortName = skillEntryShortName(item.title);
  const shortNote = shortName !== item.title ? `（短名：${shortName}）` : "";
  const kindNote = item.kind ? ` [${item.kind}]` : "";
  return `- ${item.title}${shortNote}${kindNote}`;
}

export function formatLoadSkillToolResult(
  rawName: string,
  result: ResolveAttachedSkillResult,
  readable: readonly LoadSkillCandidate[],
  english = false
): string {
  if (english) {
    if (result.status === "found")
      return `[Skill: ${result.skill.title}]\n\n${result.skill.content}`;
    const message =
      result.status === "ambiguous"
        ? `Multiple skills match “${rawName}”. Use a full title: ${result.matches.map((item) => item.title).join(", ")}.`
        : result.status === "out_of_scope"
          ? `Skill “${rawName}” is outside this agent's read scope.`
          : `No readable skill matches “${rawName}”.`;
    return [
      message,
      `Readable skills: ${readable.map((item) => item.title).join(", ") || "none"}`
    ].join("\n");
  }
  const name =
    normalizeLoadSkillName(rawName) || String(rawName ?? "").trim() || "(空)";
  if (result.status === "found") {
    return `【技能：${result.skill.title}】\n\n${result.skill.content}`;
  }

  const readableList = readable.length
    ? `当前可读取的已附加技能：\n${readable.map(formatSkillListLine).join("\n")}`
    : "当前没有可读取的已附加技能。";

  if (result.status === "ambiguous") {
    return [
      `名称「${name}」匹配到多个可读取技能，请改用完整标题或更具体的短名：`,
      ...result.matches.map(formatSkillListLine),
      "",
      readableList
    ].join("\n");
  }

  if (result.status === "out_of_scope") {
    return [
      `找到同名已附加技能「${result.matches.map((item) => item.title).join("、")}」，但不在当前智能体读取范围内。`,
      readableList
    ].join("\n");
  }

  return [
    `没有找到可读取的同名已附加技能（查询：${name}）。`,
    readableList
  ].join("\n");
}

export const LOAD_SKILL_TOOL_DESCRIPTION =
  "按名称加载本轮显式附加、且属于当前智能体读取范围的技能正文。name 优先传完整标题（如「库名 · 条目名」），也可用条目标题短名或库名；唯一命中时才会加载。技能是方法，不会自动成为作品事实。";

export const LOAD_SKILL_NAME_PARAMETER = {
  minLength: 1,
  maxLength: 240,
  description:
    "技能完整标题、条目标题短名、技能库名，或上下文列表中的标题（可省略末尾 [kind]）。多候选时需改用更具体名称。"
} as const;
