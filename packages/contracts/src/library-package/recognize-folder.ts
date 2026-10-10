import { CATALOG_PROJECT_MAX_CONTENT_ITEMS } from "../catalog/kinds";
import { kindFromLibraryName, stageForFolderName } from "./labels";
import {
  LIBRARY_PACKAGE_MANIFEST_FILE,
  LIBRARY_PACKAGE_MAX_LIBRARIES,
  type LibraryPackageDomain
} from "./manifest";
import type {
  LibraryPackageNote,
  LibraryPackagePlan,
  LibraryPackagePlanLibrary,
  LibraryPackageSourceFile
} from "./plan";
import {
  baseName,
  cleanTitle,
  collectSkipped,
  isReadmeName,
  overviewFromReadme,
  sortPaths,
  titlesFromFileNames
} from "./recognize-files";
import { assignLibraryPackageGroup, kindFromStageHints } from "./resolve";

export const LIBRARY_PACKAGE_FALLBACK_TITLES = {
  library: "未命名库",
  group: "未命名分组",
  entry: "未命名"
} as const;

function libraryFolders(
  files: readonly LibraryPackageSourceFile[]
): string[] | null {
  const entryFiles = files.filter(
    ({ path, text }) => text !== undefined && !isReadmeName(baseName(path))
  );
  if (entryFiles.some(({ path }) => !path.includes("/"))) return null;
  return sortPaths([
    ...new Set(entryFiles.map(({ path }) => `${path.split("/")[0]!}/`))
  ]).map((folder) => folder.slice(0, -1));
}

/**
 * A plain folder: text files directly in the root make one library; otherwise
 * each top-level folder is a library and the root a candidate group. Folders
 * named after a stage ("人设", "剧情细化"…) set the stage of their files.
 */
export function recognizeFolder(
  domain: LibraryPackageDomain,
  rootName: string,
  files: readonly LibraryPackageSourceFile[],
  notes: LibraryPackageNote[]
): LibraryPackagePlan {
  const used = new Set(
    files
      .filter(({ path }) => path === LIBRARY_PACKAGE_MANIFEST_FILE)
      .map(({ path }) => path)
  );
  const skipped: LibraryPackagePlan["skippedFiles"] = [];
  for (const { path, text } of files) {
    if (text === undefined || text.trim() || used.has(path)) continue;
    used.add(path);
    skipped.push({ path, reason: "empty" });
  }
  const textFiles = files.filter(
    (file): file is LibraryPackageSourceFile & { text: string } =>
      file.text !== undefined && !used.has(file.path)
  );
  let folders = libraryFolders(textFiles) ?? [""];
  if (folders.length > LIBRARY_PACKAGE_MAX_LIBRARIES) {
    notes.push("libraryLimitExceeded");
    for (const folder of folders.slice(LIBRARY_PACKAGE_MAX_LIBRARIES)) {
      for (const { path } of textFiles) {
        if (!path.startsWith(`${folder}/`)) continue;
        used.add(path);
        skipped.push({ path, reason: "limit" });
      }
    }
    folders = folders.slice(0, LIBRARY_PACKAGE_MAX_LIBRARIES);
  }
  for (const { path } of textFiles) {
    if (!path.includes("/") && isReadmeName(path)) used.add(path);
  }

  const libraries = folders.map((folder, index): LibraryPackagePlanLibrary => {
    const prefix = folder ? `${folder}/` : "";
    const members = textFiles.filter(({ path }) => path.startsWith(prefix));
    const relative = (path: string) => path.slice(prefix.length);
    const readme = members.find(
      ({ path }) =>
        !relative(path).includes("/") && isReadmeName(baseName(path))
    );
    if (readme) used.add(readme.path);
    const byPath = new Map(members.map((file) => [file.path, file.text]));
    const ordered = sortPaths(
      members.filter((file) => file !== readme).map(({ path }) => path)
    );
    for (const path of ordered.slice(CATALOG_PROJECT_MAX_CONTENT_ITEMS)) {
      used.add(path);
      skipped.push({ path, reason: "limit" });
    }
    const paths = ordered.slice(0, CATALOG_PROJECT_MAX_CONTENT_ITEMS);
    const titles = titlesFromFileNames(
      paths.map(relative),
      LIBRARY_PACKAGE_FALLBACK_TITLES.entry
    );
    const entries = paths.map((path) => {
      used.add(path);
      const segments = relative(path).split("/");
      const stageHint =
        segments.length > 1
          ? stageForFolderName(domain, segments[0]!)
          : undefined;
      return {
        title: titles.get(relative(path))!,
        ...(stageHint ? { stageHint } : {}),
        content: byPath.get(path)!
      };
    });
    const title =
      cleanTitle(folder || rootName) ?? LIBRARY_PACKAGE_FALLBACK_TITLES.library;
    const kind =
      domain === "material"
        ? (kindFromLibraryName("material", title) ??
          kindFromStageHints(
            domain,
            entries.map((entry) => entry.stageHint)
          ))
        : (kindFromLibraryName("skill", title) ?? "general");
    return {
      key: `lib-${index + 1}`,
      title,
      kind,
      kindEditable: true,
      libraryType: "short",
      parentGenre: "",
      subGenre: "",
      overview: readme ? overviewFromReadme(readme.text) : "",
      entries
    };
  });

  const assignment = assignLibraryPackageGroup(
    domain,
    libraries.map(({ kind }) => kind)
  );
  return {
    recognition: "folder",
    domain,
    group:
      libraries.length > 1
        ? {
            title:
              cleanTitle(rootName) ?? LIBRARY_PACKAGE_FALLBACK_TITLES.group,
            suggested: "slots" in assignment
          }
        : null,
    libraries,
    skippedFiles: collectSkipped(files, used, skipped),
    notes
  };
}
