import { compareNaturally, stripSharedNumberPrefixes } from "./file-names";
import { LIBRARY_PACKAGE_MANIFEST_FILE } from "./manifest";
import type {
  LibraryPackagePlan,
  LibraryPackageSkipReason,
  LibraryPackageSourceFile
} from "./plan";

/** Entry files an import reads; the manifest is read as JSON separately. */
export const LIBRARY_PACKAGE_TEXT_EXTENSIONS = [".md", ".markdown", ".txt"];

const README_NAMES = new Set(
  ["_说明.md", "_说明.txt", "_readme.md", "_readme.txt"].map((name) =>
    name.normalize("NFC")
  )
);

export function isLibraryPackageTextPath(path: string): boolean {
  const name = baseName(path).toLocaleLowerCase("en-US");
  return (
    name === LIBRARY_PACKAGE_MANIFEST_FILE ||
    LIBRARY_PACKAGE_TEXT_EXTENSIONS.some((extension) =>
      name.endsWith(extension)
    )
  );
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function dirName(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

export function joinPackagePath(...segments: readonly string[]): string {
  return segments.filter(Boolean).join("/");
}

export function isReadmeName(name: string): boolean {
  return README_NAMES.has(name.normalize("NFC").toLocaleLowerCase("en-US"));
}

/** A valid catalog title, or undefined when nothing usable remains. */
export function cleanTitle(value: string | undefined): string | undefined {
  const title = Array.from((value ?? "").normalize("NFC").trim())
    .slice(0, 256)
    .join("")
    .trim();
  return title || undefined;
}

function stem(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/** Titles from file names, dropping "01 " prefixes shared by a whole folder. */
export function titlesFromFileNames(
  paths: readonly string[],
  fallback: string
): Map<string, string> {
  const byFolder = new Map<string, string[]>();
  for (const path of paths) {
    const folder = dirName(path);
    byFolder.set(folder, [...(byFolder.get(folder) ?? []), path]);
  }
  const titles = new Map<string, string>();
  for (const siblings of byFolder.values()) {
    const stems = stripSharedNumberPrefixes(
      siblings.map((path) => stem(baseName(path)))
    );
    siblings.forEach((path, index) =>
      titles.set(path, cleanTitle(stems[index]) ?? fallback)
    );
  }
  return titles;
}

export function sortPaths(paths: readonly string[]): string[] {
  return [...paths].sort((left, right) => {
    const a = left.split("/");
    const b = right.split("/");
    for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
      // Files sort before sibling folders, like most file managers.
      const aIsFile = index === a.length - 1;
      const bIsFile = index === b.length - 1;
      if (aIsFile !== bIsFile) return aIsFile ? -1 : 1;
      const order = compareNaturally(a[index]!, b[index]!);
      if (order) return order;
    }
    return a.length - b.length;
  });
}

/** Strips folder levels that wrap everything, as re-zipped packages often do. */
export function unwrapSourceRoot(
  rootName: string,
  files: readonly LibraryPackageSourceFile[]
): { rootName: string; files: LibraryPackageSourceFile[] } {
  let name = rootName;
  let current = [...files];
  for (;;) {
    const first = current[0]?.path.split("/")[0];
    if (!first || !current.every(({ path }) => path.startsWith(`${first}/`))) {
      return { rootName: name, files: current };
    }
    name = first;
    current = current.map((file) => ({
      ...file,
      path: file.path.slice(first.length + 1)
    }));
  }
}

/** Collects every file the plan did not turn into an entry, with a reason. */
export function collectSkipped(
  files: readonly LibraryPackageSourceFile[],
  used: ReadonlySet<string>,
  extra: LibraryPackagePlan["skippedFiles"]
): LibraryPackagePlan["skippedFiles"] {
  const skipped = [...extra];
  for (const file of files) {
    if (used.has(file.path)) continue;
    const reason: LibraryPackageSkipReason = file.skip ?? "unassigned";
    skipped.push({ path: file.path, reason });
  }
  return skipped;
}

/** "## 简介" / "## Overview" of an exported guide, if present. */
export function overviewFromReadme(text: string): string {
  const lines = text.replace(/\r\n?/gu, "\n").split("\n");
  const start = lines.findIndex((line) =>
    /^##\s+(简介|overview)\s*$/iu.test(line.trim())
  );
  if (start < 0) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^##\s/u.test(line));
  const body = (end < 0 ? rest : rest.slice(0, end)).join("\n").trim();
  return body === "无" || body.toLocaleLowerCase("en-US") === "none"
    ? ""
    : body;
}
