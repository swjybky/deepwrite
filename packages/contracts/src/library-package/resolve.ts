import {
  MATERIAL_STAGE_IDS,
  SKILL_KINDS,
  SKILL_STAGE_IDS,
  type MaterialLibraryKind,
  type MaterialStageId,
  type SkillKind,
  type SkillStageId
} from "../catalog";
import { MATERIAL_STAGE_KINDS } from "../material-stages";
import type { LibraryPackageDomain } from "./manifest";

export const LIBRARY_PACKAGE_MATERIAL_KINDS = [
  "character",
  "gimmick",
  "plot",
  "draft",
  "other",
  "mixed"
] as const satisfies readonly MaterialLibraryKind[];
const MATERIAL_SLOTS = ["character", "gimmick", "plot", "draft", "other"];
/** A general library joins a group where it reads most naturally. */
const MIXED_SLOT_ORDER = ["other", "character", "plot", "gimmick", "draft"];

export function libraryPackageKinds(
  domain: LibraryPackageDomain
): readonly string[] {
  return domain === "material" ? LIBRARY_PACKAGE_MATERIAL_KINDS : SKILL_KINDS;
}

export function isLibraryPackageKind(
  domain: LibraryPackageDomain,
  kind: string | undefined
): kind is MaterialLibraryKind | SkillKind {
  return kind !== undefined && libraryPackageKinds(domain).includes(kind);
}

/** The kind a recognised library gets from the stages of its entries. */
export function kindFromStageHints(
  domain: LibraryPackageDomain,
  hints: Iterable<string | undefined>
): MaterialLibraryKind | SkillKind {
  if (domain === "skill") return "general";
  const kinds = new Set<string | undefined>();
  for (const hint of hints) {
    kinds.add(MATERIAL_STAGE_KINDS[hint as MaterialStageId]);
  }
  // Unclassified entries keep "其他" only in a general library.
  const [only] = kinds;
  return kinds.size === 1 && only ? (only as MaterialLibraryKind) : "mixed";
}

/** A stage the library kind accepts: the hint when allowed, else its default. */
export function resolveLibraryPackageStage(
  domain: LibraryPackageDomain,
  kind: string,
  hint?: string
): MaterialStageId | SkillStageId {
  if (domain === "skill") {
    if (hint && (SKILL_STAGE_IDS as readonly string[]).includes(hint)) {
      return hint as SkillStageId;
    }
    return kind === "plot" ? "plot_design" : "draft";
  }
  if (
    hint &&
    (MATERIAL_STAGE_IDS as readonly string[]).includes(hint) &&
    (kind === "mixed" || MATERIAL_STAGE_KINDS[hint as MaterialStageId] === kind)
  ) {
    return hint as MaterialStageId;
  }
  switch (kind) {
    case "character":
      return "character";
    case "gimmick":
      return "gimmick";
    case "plot":
      return "pacing";
    case "draft":
      return "draft_excerpt";
    default:
      return "other";
  }
}

export type LibraryPackageGroupProblem = "empty" | "tooMany" | "duplicateKind";

/**
 * Places libraries into group slots: one library per kind, general material
 * libraries fill the free slots. `preferred` keeps an exported package's slots.
 */
export function assignLibraryPackageGroup(
  domain: LibraryPackageDomain,
  kinds: readonly string[],
  preferred: readonly (string | undefined)[] = []
): { slots: string[] } | { problem: LibraryPackageGroupProblem } {
  const slotNames: readonly string[] =
    domain === "material" ? MATERIAL_SLOTS : SKILL_KINDS;
  if (kinds.length === 0) return { problem: "empty" };
  if (kinds.length > slotNames.length) return { problem: "tooMany" };
  const fits = (kind: string, slot: string) =>
    slotNames.includes(slot) &&
    (kind === slot || (domain === "material" && kind === "mixed"));
  const slots: (string | undefined)[] = kinds.map(() => undefined);
  const used = new Set<string>();
  kinds.forEach((kind, index) => {
    const slot = preferred[index];
    if (slot && fits(kind, slot) && !used.has(slot)) {
      slots[index] = slot;
      used.add(slot);
    }
  });
  for (const [index, kind] of kinds.entries()) {
    if (slots[index] || kind === "mixed") continue;
    if (!slotNames.includes(kind) || used.has(kind)) {
      return { problem: "duplicateKind" };
    }
    slots[index] = kind;
    used.add(kind);
  }
  for (const [index, kind] of kinds.entries()) {
    if (slots[index] || kind !== "mixed") continue;
    const free = MIXED_SLOT_ORDER.find((slot) => !used.has(slot));
    if (!free) return { problem: "tooMany" };
    slots[index] = free;
    used.add(free);
  }
  return { slots: slots as string[] };
}

const TITLE_MAX_LENGTH = 256;

/** "标题", then "标题 (2)", "标题 (3)"…, comparing titles case-insensitively. */
export function nextLibraryPackageTitle(
  baseTitle: string,
  existingTitles: Iterable<string>
): string {
  const taken = new Set(
    [...existingTitles].map((title) => title.trim().toLocaleLowerCase("en-US"))
  );
  const base = Array.from(baseTitle.trim()).slice(0, TITLE_MAX_LENGTH).join("");
  if (!taken.has(base.toLocaleLowerCase("en-US"))) return base;
  for (let suffix = 2; ; suffix += 1) {
    const tail = ` (${suffix})`;
    const head = Array.from(base)
      .slice(0, TITLE_MAX_LENGTH - tail.length)
      .join("")
      .trimEnd();
    const candidate = `${head}${tail}`;
    if (!taken.has(candidate.toLocaleLowerCase("en-US"))) return candidate;
  }
}
