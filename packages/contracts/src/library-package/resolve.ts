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
import {
  LIBRARY_PACKAGE_MAX_LIBRARIES,
  type LibraryPackageDomain
} from "./manifest";

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

/** A stage for the entry: preserves any valid stage hint, else kind default. */
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
  if (hint && (MATERIAL_STAGE_IDS as readonly string[]).includes(hint)) {
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
 * Validates that selected libraries can form a group and produces display/order
 * slot keys. Groups accept any combination of tags and kinds up to the package limit.
 */
export function assignLibraryPackageGroup(
  domain: LibraryPackageDomain,
  kinds: readonly string[],
  preferred: readonly (string | undefined)[] = []
): { slots: string[] } | { problem: LibraryPackageGroupProblem } {
  const slotNames: readonly string[] =
    domain === "material" ? MATERIAL_SLOTS : SKILL_KINDS;
  if (kinds.length === 0) return { problem: "empty" };
  if (kinds.length > LIBRARY_PACKAGE_MAX_LIBRARIES)
    return { problem: "tooMany" };
  const slots: string[] = [];
  const used = new Set<string>();
  kinds.forEach((kind, index) => {
    const pref = preferred[index];
    if (pref && !used.has(pref)) {
      slots.push(pref);
      used.add(pref);
      return;
    }
    if (slotNames.includes(kind) && !used.has(kind)) {
      slots.push(kind);
      used.add(kind);
      return;
    }
    if (domain === "material" && kind === "mixed") {
      const free = MIXED_SLOT_ORDER.find((slot) => !used.has(slot));
      if (free) {
        slots.push(free);
        used.add(free);
        return;
      }
    }
    let candidate = `${kind || "member"}-${index + 1}`;
    let suffix = 2;
    while (used.has(candidate)) {
      candidate = `${kind || "member"}-${index + 1}-${suffix}`;
      suffix += 1;
    }
    slots.push(candidate);
    used.add(candidate);
  });
  return { slots };
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
