const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu;

/** Name limits keep exported paths well under Windows' 260-character limit. */
export const LIBRARY_PACKAGE_NAME_LIMITS = {
  folder: 40,
  stage: 12,
  entry: 60
} as const;

/** A file or folder name that is valid on Windows, macOS and Linux. */
export function safePackageName(
  value: string,
  maxLength: number,
  fallback: string
): string {
  const cleaned = Array.from(
    value
      .normalize("NFC")
      .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/gu, " ")
      .replace(/\s+/gu, " ")
      .trim()
      .replace(/^[. ]+|[. ]+$/gu, "")
  )
    .slice(0, maxLength)
    .join("")
    .replace(/[. ]+$/gu, "");
  const name = cleaned || fallback;
  return WINDOWS_RESERVED.test(name) ? `${name}_` : name;
}

/** Hands out names unique within one folder, ignoring case. */
export function createPackageNameAllocator(
  reserved: readonly string[] = []
): (name: string, extension?: string) => string {
  const used = new Set(reserved.map((name) => name.toLocaleLowerCase("en-US")));
  return (name, extension = "") => {
    let candidate = `${name}${extension}`;
    for (let suffix = 2; used.has(candidate.toLocaleLowerCase("en-US"));) {
      candidate = `${name} (${suffix})${extension}`;
      suffix += 1;
    }
    used.add(candidate.toLocaleLowerCase("en-US"));
    return candidate;
  };
}

/** "01 标题": the number keeps library order in any file manager. */
export function numberedEntryName(
  index: number,
  count: number,
  title: string,
  fallback: string
): string {
  const width = Math.max(2, String(count).length);
  const number = String(index + 1).padStart(width, "0");
  return `${number} ${safePackageName(title, LIBRARY_PACKAGE_NAME_LIMITS.entry, fallback)}`;
}

const NUMBER_PREFIX = /^\d{1,5}[ ._-]+(?=\S)/u;

/**
 * Removes "01 " style prefixes only when every sibling has one, and either
 * several siblings share the pattern or it is zero-padded as exports write it.
 * A lone title that merely starts with a number ("1984 年的雨") stays intact.
 */
export function stripSharedNumberPrefixes(names: readonly string[]): string[] {
  const prefixes = names.map((name) => NUMBER_PREFIX.exec(name)?.[0]);
  const numbered =
    prefixes.length > 0 &&
    prefixes.every(Boolean) &&
    (prefixes.length > 1 ||
      prefixes.every((prefix) => prefix!.startsWith("0")));
  return numbered
    ? names.map((name) => name.replace(NUMBER_PREFIX, ""))
    : [...names];
}

/** Natural order: "2 x" before "10 x"; ties fall back to code points. */
export function compareNaturally(left: string, right: string): number {
  return (
    left.localeCompare(right, "zh-CN", { numeric: true }) ||
    (left < right ? -1 : left > right ? 1 : 0)
  );
}
