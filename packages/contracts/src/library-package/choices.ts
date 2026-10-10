import type {
  LibraryPackageImportChoices,
  LibraryPackagePreview,
  LibraryPackageSourceKind
} from "./commands";
import type { LibraryPackageDomain } from "./manifest";
import {
  LIBRARY_PACKAGE_SKIP_REASONS,
  type LibraryPackagePlan,
  type LibraryPackagePlanLibrary
} from "./plan";
import {
  assignLibraryPackageGroup,
  isLibraryPackageKind,
  resolveLibraryPackageStage
} from "./resolve";

/** Same budget Core enforces for one library project's content. */
export const LIBRARY_PACKAGE_MAX_LIBRARY_BYTES = 128 * 1024 * 1024;

function utf8Length(text: string): number {
  let length = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) length += 1;
    else if (code < 0x800) length += 2;
    else if (code >= 0xd800 && code < 0xdc00) {
      length += 4;
      index += 1;
    } else length += 3;
  }
  return length;
}

function contentBytes(library: LibraryPackagePlanLibrary): number {
  return library.entries.reduce(
    (total, entry) => total + utf8Length(entry.content),
    utf8Length(library.overview)
  );
}

/** The Renderer-facing preview: titles and counts, never entry bodies. */
export function previewLibraryPackage(
  plan: LibraryPackagePlan,
  source: { sourceName: string; sourceKind: LibraryPackageSourceKind }
): LibraryPackagePreview {
  const skipped = Object.fromEntries(
    LIBRARY_PACKAGE_SKIP_REASONS.map((reason) => [reason, 0])
  ) as LibraryPackagePreview["skipped"];
  for (const { reason } of plan.skippedFiles) skipped[reason] += 1;
  return {
    ...source,
    recognition: plan.recognition,
    domain: plan.domain,
    group: plan.group
      ? { title: plan.group.title, suggested: plan.group.suggested }
      : null,
    libraries: plan.libraries.map((library) => {
      const hints = new Map<string | null, number>();
      for (const { stageHint } of library.entries) {
        const hint = stageHint ?? null;
        hints.set(hint, (hints.get(hint) ?? 0) + 1);
      }
      const bytes = contentBytes(library);
      return {
        key: library.key,
        title: library.title,
        kind: library.kind,
        kindEditable: library.kindEditable,
        libraryType: library.libraryType,
        entryCount: library.entries.length,
        contentBytes: bytes,
        stageHints: [...hints]
          .slice(0, 32)
          .map(([hint, count]) => ({ hint, count })),
        blocked: bytes > LIBRARY_PACKAGE_MAX_LIBRARY_BYTES ? "bytes" : null
      };
    }),
    skipped,
    skippedFiles: plan.skippedFiles.slice(0, 200),
    notes: plan.notes
  };
}

export interface LibraryPackageResolvedLibrary {
  title: string;
  kind: string;
  libraryType: LibraryPackagePlanLibrary["libraryType"];
  parentGenre: string;
  subGenre: string;
  overview: string;
  entries: { title: string; stageId: string; content: string }[];
}

export interface LibraryPackageResolvedImport {
  domain: LibraryPackageDomain;
  /** `slots[i]` is the group slot of `libraries[i]`. */
  group: { title: string; slots: string[] } | null;
  libraries: LibraryPackageResolvedLibrary[];
}

/** Applies the user's preview choices; throws when they cannot be honoured. */
export function resolveLibraryPackageImport(
  plan: LibraryPackagePlan,
  choices: LibraryPackageImportChoices
): LibraryPackageResolvedImport {
  const chosen = new Map(
    choices.libraries.map((choice) => [choice.key, choice])
  );
  const included = plan.libraries.filter(
    ({ key }) => chosen.get(key)?.include === true
  );
  if (included.length === 0) throw new Error("请至少选择一个要导入的库。");
  const libraries = included.map((library): LibraryPackageResolvedLibrary => {
    if (contentBytes(library) > LIBRARY_PACKAGE_MAX_LIBRARY_BYTES) {
      throw new Error(`“${library.title}”的正文合计超过 128 MB，不能导入。`);
    }
    const choice = chosen.get(library.key)!;
    const kind =
      library.kindEditable && isLibraryPackageKind(plan.domain, choice.kind)
        ? choice.kind
        : library.kind;
    return {
      title: choice.title.trim() || library.title,
      kind,
      libraryType: library.libraryType,
      parentGenre: library.parentGenre,
      subGenre: library.subGenre,
      overview: library.overview,
      entries: library.entries.map((entry) => ({
        title: entry.title,
        stageId: resolveLibraryPackageStage(plan.domain, kind, entry.stageHint),
        content: entry.content
      }))
    };
  });
  if (!choices.createGroup)
    return { domain: plan.domain, group: null, libraries };
  const slotsByKey = new Map(
    Object.entries(plan.group?.slots ?? {}).map(([slot, key]) => [key, slot])
  );
  const assignment = assignLibraryPackageGroup(
    plan.domain,
    libraries.map(({ kind }) => kind),
    included.map(({ key }) => slotsByKey.get(key))
  );
  if ("problem" in assignment) {
    throw new Error("这些库不能组成一个分组：分组里每种类型只能有一个库。");
  }
  const title =
    choices.groupTitle?.trim() || plan.group?.title || libraries[0]!.title;
  return {
    domain: plan.domain,
    group: { title, slots: assignment.slots },
    libraries
  };
}
