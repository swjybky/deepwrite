import { LibraryTypeSchema } from "../catalog";
import { CATALOG_PROJECT_MAX_CONTENT_ITEMS } from "../catalog/kinds";
import {
  LIBRARY_PACKAGE_FORMAT_VERSION,
  LIBRARY_PACKAGE_MANIFEST_FILE,
  LibraryPackageManifestSchema,
  type LibraryPackageDomain,
  type LibraryPackageManifest
} from "./manifest";
import type {
  LibraryPackageNote,
  LibraryPackagePlan,
  LibraryPackagePlanEntry,
  LibraryPackageSourceFile,
  LibraryPackageSourceTree
} from "./plan";
import {
  baseName,
  cleanTitle,
  collectSkipped,
  dirName,
  isReadmeName,
  joinPackagePath,
  sortPaths,
  titlesFromFileNames,
  unwrapSourceRoot
} from "./recognize-files";
import {
  LIBRARY_PACKAGE_FALLBACK_TITLES,
  recognizeFolder
} from "./recognize-folder";
import { stageForFolderName } from "./labels";
import { isLibraryPackageKind, kindFromStageHints } from "./resolve";

export type LibraryPackageErrorCode = "newerFormat" | "noTextFiles";

export class LibraryPackageError extends Error {
  constructor(readonly code: LibraryPackageErrorCode) {
    super(
      code === "newerFormat"
        ? "这个包由更新版本的 DeepWrite 导出，请升级后再导入。"
        : "没有找到可导入的 .md、.markdown 或 .txt 文件。"
    );
    this.name = "LibraryPackageError";
  }
}

function parseManifest(text: string): LibraryPackageManifest | undefined {
  try {
    const parsed = LibraryPackageManifestSchema.safeParse(
      JSON.parse(text.replace(/^\uFEFF/u, ""))
    );
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function packageDirectory(value: string): string {
  return value
    .normalize("NFC")
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment && segment !== ".")
    .join("/");
}

/** An exported package: the manifest is the skeleton, files supply content. */
function recognizePackage(
  manifest: LibraryPackageManifest,
  rootName: string,
  files: readonly LibraryPackageSourceFile[]
): LibraryPackagePlan {
  const domain = manifest.domain;
  const byPath = new Map(files.map((file) => [file.path, file]));
  const used = new Set<string>();
  const skipped: LibraryPackagePlan["skippedFiles"] = [];
  const directories = manifest.libraries.map(({ directory }) =>
    packageDirectory(directory)
  );
  for (const { path } of files) {
    const folder = dirName(path);
    if (
      path === LIBRARY_PACKAGE_MANIFEST_FILE ||
      ((folder === "" || directories.includes(folder)) &&
        isReadmeName(baseName(path)))
    ) {
      used.add(path);
    }
  }

  const listed = manifest.libraries.map((library, index) => {
    const entries: (LibraryPackagePlanEntry & { path: string })[] = [];
    for (const entry of library.entries) {
      const path = joinPackagePath(
        directories[index]!,
        packageDirectory(entry.file)
      );
      const file = byPath.get(path);
      if (!file) {
        skipped.push({ path, reason: "missing" });
        continue;
      }
      if (used.has(path)) continue;
      used.add(path);
      if (file.text === undefined) {
        skipped.push({ path, reason: file.skip ?? "unsupported" });
        continue;
      }
      const title =
        cleanTitle(entry.title) ??
        titlesFromFileNames([path], LIBRARY_PACKAGE_FALLBACK_TITLES.entry).get(
          path
        )!;
      entries.push({
        path,
        title,
        ...(entry.stageId ? { stageHint: entry.stageId } : {}),
        content: file.text
      });
    }
    return entries;
  });

  // Files added in another app join the deepest library folder holding them.
  const owners = directories
    .map((directory, index) => ({ directory, index }))
    .sort((left, right) => right.directory.length - left.directory.length);
  const extras = new Map<number, string[]>();
  for (const { path, text } of files) {
    if (text === undefined || used.has(path)) continue;
    if (!text.trim()) {
      used.add(path);
      skipped.push({ path, reason: "empty" });
      continue;
    }
    const owner = owners.find(
      ({ directory }) => !directory || path.startsWith(`${directory}/`)
    );
    if (owner)
      extras.set(owner.index, [...(extras.get(owner.index) ?? []), path]);
  }
  for (const [index, paths] of extras) {
    const prefix = directories[index] ? `${directories[index]}/` : "";
    const relative = sortPaths(paths.map((path) => path.slice(prefix.length)));
    const titles = titlesFromFileNames(
      relative,
      LIBRARY_PACKAGE_FALLBACK_TITLES.entry
    );
    for (const rest of relative) {
      const path = `${prefix}${rest}`;
      const segments = rest.split("/");
      const stageHint =
        segments.length > 1
          ? stageForFolderName(domain, segments[0]!)
          : undefined;
      used.add(path);
      listed[index]!.push({
        path,
        title: titles.get(rest)!,
        ...(stageHint ? { stageHint } : {}),
        content: byPath.get(path)!.text!
      });
    }
  }

  const libraries = manifest.libraries.map((library, index) => {
    const all = listed[index]!;
    for (const { path } of all.slice(CATALOG_PROJECT_MAX_CONTENT_ITEMS)) {
      skipped.push({ path, reason: "limit" });
    }
    const entries = all
      .slice(0, CATALOG_PROJECT_MAX_CONTENT_ITEMS)
      .map(({ path: _path, ...entry }) => entry);
    const declaredKind =
      domain === "material" ? library.materialKind : library.skillKind;
    const libraryType = LibraryTypeSchema.safeParse(library.libraryType);
    return {
      key: library.key,
      title:
        cleanTitle(library.title) ??
        cleanTitle(baseName(directories[index]!)) ??
        cleanTitle(rootName) ??
        LIBRARY_PACKAGE_FALLBACK_TITLES.library,
      kind: isLibraryPackageKind(domain, declaredKind)
        ? declaredKind
        : kindFromStageHints(
            domain,
            entries.map(({ stageHint }) => stageHint)
          ),
      kindEditable: false,
      libraryType: libraryType.success ? libraryType.data : "short",
      parentGenre: domain === "material" ? (library.parentGenre ?? "") : "",
      subGenre: domain === "material" ? (library.subGenre ?? "") : "",
      overview: library.overview ?? "",
      entries
    };
  });

  return {
    recognition: "package",
    domain,
    group: manifest.group
      ? {
          title:
            cleanTitle(manifest.group.title) ??
            cleanTitle(rootName) ??
            LIBRARY_PACKAGE_FALLBACK_TITLES.group,
          suggested: true,
          slots: manifest.group.members
        }
      : null,
    libraries,
    skippedFiles: collectSkipped(files, used, skipped),
    notes: []
  };
}

/**
 * Recognises a scanned ZIP or folder: an exported DeepWrite package restores
 * exactly; anything else is read by its folder structure (第 5 节).
 */
export function recognizeLibraryPackage(
  tree: LibraryPackageSourceTree,
  fallbackDomain: LibraryPackageDomain
): LibraryPackagePlan {
  const { rootName, files } = unwrapSourceRoot(tree.rootName, tree.files);
  const notes: LibraryPackageNote[] = [];
  const manifestText = files.find(
    ({ path }) => path === LIBRARY_PACKAGE_MANIFEST_FILE
  )?.text;
  let plan: LibraryPackagePlan | undefined;
  if (manifestText !== undefined) {
    const manifest = parseManifest(manifestText);
    if (manifest && manifest.formatVersion > LIBRARY_PACKAGE_FORMAT_VERSION) {
      throw new LibraryPackageError("newerFormat");
    }
    if (manifest && manifest.libraries.length > 0) {
      plan = recognizePackage(manifest, rootName, files);
    } else {
      notes.push("manifestUnreadable");
    }
  }
  plan ??= recognizeFolder(fallbackDomain, rootName, files, notes);
  if (plan.libraries.length === 0) throw new LibraryPackageError("noTextFiles");
  return plan;
}
