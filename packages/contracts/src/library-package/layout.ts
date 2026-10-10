import {
  MATERIAL_STAGE_IDS,
  SKILL_STAGE_IDS,
  type CatalogLibrary,
  type MaterialStageId,
  type SkillStageId
} from "../catalog";
import {
  LIBRARY_PACKAGE_NAME_LIMITS,
  createPackageNameAllocator,
  numberedEntryName,
  safePackageName
} from "./file-names";
import {
  MATERIAL_KIND_NAMES,
  MATERIAL_STAGE_FOLDER_NAMES,
  SKILL_KIND_NAMES,
  SKILL_STAGE_FOLDER_NAMES,
  type LibraryPackageLocale
} from "./labels";
import {
  LIBRARY_PACKAGE_FORMAT,
  LIBRARY_PACKAGE_FORMAT_VERSION,
  LIBRARY_PACKAGE_MANIFEST_FILE,
  LIBRARY_PACKAGE_README_FILE,
  type LibraryPackageDomain,
  type LibraryPackageManifest,
  type LibraryPackageManifestLibrary
} from "./manifest";
import {
  renderGroupReadme,
  renderLibraryReadme,
  type ReadmeContext,
  type ReadmeEntryLine,
  type ReadmeGroupMember
} from "./readme";

/** What Core reads for one export; `library` is null when unavailable. */
export interface LibraryPackageExportSource {
  domain: LibraryPackageDomain;
  groupTitle: string | null;
  members: readonly {
    slot: string | null;
    library: CatalogLibrary | null;
  }[];
}

export interface LibraryPackageLayoutOptions {
  locale: LibraryPackageLocale;
  generator: string;
  exportedAt: string;
}

export interface LibraryPackageFile {
  /** Path inside the archive, starting with the package's root folder. */
  path: string;
  content: string;
}

export interface LibraryPackageLayout {
  rootName: string;
  files: LibraryPackageFile[];
  libraryCount: number;
  entryCount: number;
  skippedLibraryCount: number;
}

const FALLBACK = {
  "zh-CN": { library: "未命名库", entry: "未命名" },
  "en-US": { library: "Untitled library", entry: "Untitled" }
} as const;

function joinPath(...segments: readonly string[]): string {
  return segments.filter(Boolean).join("/");
}

function countCharacters(body: string): number {
  return Array.from(body.replace(/\s/gu, "")).length;
}

function stageName(
  domain: LibraryPackageDomain,
  stageId: string,
  locale: LibraryPackageLocale
): string {
  return domain === "material"
    ? MATERIAL_STAGE_FOLDER_NAMES[stageId as MaterialStageId][locale]
    : SKILL_STAGE_FOLDER_NAMES[stageId as SkillStageId][locale];
}

function slotName(
  domain: LibraryPackageDomain,
  slot: string,
  locale: LibraryPackageLocale
): string {
  const names: Readonly<Record<string, Readonly<Record<string, string>>>> =
    domain === "material" ? MATERIAL_KIND_NAMES : SKILL_KIND_NAMES;
  return names[slot]?.[locale] ?? slot;
}

function layoutLibrary(
  library: CatalogLibrary,
  key: string,
  directory: string,
  context: ReadmeContext
): { files: LibraryPackageFile[]; manifest: LibraryPackageManifestLibrary } {
  const { locale, domain } = context;
  const readmeFile = LIBRARY_PACKAGE_README_FILE[locale];
  const entries = library.entries as readonly {
    title: string;
    stageId: string;
    body: string;
  }[];
  const usedStages = new Set(entries.map(({ stageId }) => stageId));
  const staged = usedStages.size > 1;
  const stageOrder: readonly string[] =
    domain === "material" ? MATERIAL_STAGE_IDS : SKILL_STAGE_IDS;
  const folders = staged
    ? stageOrder.filter((stage) => usedStages.has(stage))
    : [undefined];
  const stageFolders = createPackageNameAllocator([readmeFile]);
  const manifestEntries: LibraryPackageManifestLibrary["entries"] = [];
  const readmeLines: ReadmeEntryLine[] = [];
  const files: LibraryPackageFile[] = [];

  for (const stage of folders) {
    const members = entries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => stage === undefined || entry.stageId === stage);
    const folder =
      stage === undefined
        ? ""
        : stageFolders(
            safePackageName(
              stageName(domain, stage, locale),
              LIBRARY_PACKAGE_NAME_LIMITS.stage,
              stage
            )
          );
    const names = createPackageNameAllocator(folder ? [] : [readmeFile]);
    members.forEach(({ entry, index }, position) => {
      const fileName = names(
        numberedEntryName(
          position,
          members.length,
          entry.title,
          FALLBACK[locale].entry
        ),
        ".md"
      );
      const file = joinPath(folder, fileName);
      manifestEntries[index] = {
        file,
        title: entry.title,
        stageId: entry.stageId
      };
      readmeLines.push({
        title: entry.title,
        file,
        stageName: stageName(domain, entry.stageId, locale),
        characters: countCharacters(entry.body)
      });
      files.push({ path: joinPath(directory, file), content: entry.body });
    });
  }

  files.unshift({
    path: joinPath(directory, readmeFile),
    content: renderLibraryReadme(library, readmeLines, staged, context)
  });
  const kind =
    "materialKind" in library
      ? {
          materialKind: library.materialKind,
          parentGenre: library.parentGenre,
          subGenre: library.subGenre
        }
      : { skillKind: library.skillKind };
  return {
    files,
    manifest: {
      key,
      directory,
      title: library.title,
      libraryType:
        "materialType" in library ? library.materialType : library.skillType,
      ...kind,
      overview: library.overview,
      entries: manifestEntries
    }
  };
}

/**
 * Lays out one library or group as plain Markdown files a person can read
 * outside DeepWrite, plus `deepwrite-package.json` for a lossless re-import.
 * Entry bodies are written verbatim; titles live in the file names.
 */
export function buildLibraryPackageFiles(
  source: LibraryPackageExportSource,
  options: LibraryPackageLayoutOptions
): LibraryPackageLayout {
  const context: ReadmeContext = { ...options, domain: source.domain };
  const readmeFile = LIBRARY_PACKAGE_README_FILE[options.locale];
  const fallback = FALLBACK[options.locale].library;
  const firstTitle = source.members.find(({ library }) => library)?.library
    ?.title;
  const rootName = safePackageName(
    source.groupTitle ?? firstTitle ?? fallback,
    LIBRARY_PACKAGE_NAME_LIMITS.folder,
    fallback
  );
  const libraryFolders = createPackageNameAllocator([
    readmeFile,
    LIBRARY_PACKAGE_MANIFEST_FILE
  ]);
  const files: LibraryPackageFile[] = [];
  const libraries: LibraryPackageManifestLibrary[] = [];
  const groupMembers: ReadmeGroupMember[] = [];
  const memberKeys: Record<string, string> = {};

  source.members.forEach(({ slot, library }, index) => {
    const kindName = slot ? slotName(source.domain, slot, options.locale) : "";
    if (!library) {
      groupMembers.push({ kindName, title: "", directory: "", entryCount: 0 });
      return;
    }
    const key = `lib-${index + 1}`;
    const directory =
      source.groupTitle === null
        ? ""
        : libraryFolders(
            safePackageName(
              library.title,
              LIBRARY_PACKAGE_NAME_LIMITS.folder,
              fallback
            )
          );
    const laidOut = layoutLibrary(library, key, directory, context);
    files.push(...laidOut.files);
    libraries.push(laidOut.manifest);
    if (slot) memberKeys[slot] = key;
    groupMembers.push({
      kindName,
      title: library.title,
      directory,
      entryCount: library.entries.length
    });
  });

  if (source.groupTitle !== null) {
    files.unshift({
      path: readmeFile,
      content: renderGroupReadme(
        source.groupTitle,
        groupMembers,
        readmeFile,
        context
      )
    });
  }
  const manifest: LibraryPackageManifest = {
    format: LIBRARY_PACKAGE_FORMAT,
    formatVersion: LIBRARY_PACKAGE_FORMAT_VERSION,
    generator: options.generator,
    exportedAt: options.exportedAt,
    domain: source.domain,
    ...(source.groupTitle !== null
      ? { group: { title: source.groupTitle, members: memberKeys } }
      : {}),
    libraries
  };
  files.push({
    path: LIBRARY_PACKAGE_MANIFEST_FILE,
    content: `${JSON.stringify(manifest, null, 2)}\n`
  });
  return {
    rootName,
    files: files.map((file) => ({
      ...file,
      path: joinPath(rootName, file.path)
    })),
    libraryCount: libraries.length,
    entryCount: libraries.reduce(
      (total, library) => total + library.entries.length,
      0
    ),
    skippedLibraryCount: source.members.filter(({ library }) => !library).length
  };
}
