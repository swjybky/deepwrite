import type { LibraryType } from "../catalog";
import type { LibraryPackageDomain } from "./manifest";

export const LIBRARY_PACKAGE_SKIP_REASONS = [
  "unsupported",
  "empty",
  "tooLarge",
  "undecodable",
  /** Listed in deepwrite-package.json but absent from the source. */
  "missing",
  /** A text file outside every recognised library folder. */
  "unassigned",
  /** Beyond the library or entry count limits. */
  "limit"
] as const;
export type LibraryPackageSkipReason =
  (typeof LIBRARY_PACKAGE_SKIP_REASONS)[number];

export const LIBRARY_PACKAGE_NOTES = [
  "manifestUnreadable",
  "libraryLimitExceeded"
] as const;
export type LibraryPackageNote = (typeof LIBRARY_PACKAGE_NOTES)[number];

/**
 * A ZIP or folder as Core scanned it: "/"-separated NFC paths relative to the
 * chosen source. Readable text files carry `text` (possibly empty, which an
 * exported package may list); everything else a reason.
 */
export interface LibraryPackageSourceFile {
  path: string;
  text?: string;
  skip?: Extract<
    LibraryPackageSkipReason,
    "unsupported" | "empty" | "tooLarge" | "undecodable"
  >;
}

export interface LibraryPackageSourceTree {
  rootName: string;
  files: readonly LibraryPackageSourceFile[];
}

export interface LibraryPackagePlanEntry {
  title: string;
  /** Stage from the manifest or a stage-named folder; checked against kind. */
  stageHint?: string;
  content: string;
}

export interface LibraryPackagePlanLibrary {
  key: string;
  title: string;
  kind: string;
  /** Only folder recognition guesses kinds, so only those can be changed. */
  kindEditable: boolean;
  libraryType: LibraryType;
  parentGenre: string;
  subGenre: string;
  overview: string;
  entries: LibraryPackagePlanEntry[];
}

export interface LibraryPackagePlan {
  recognition: "package" | "folder";
  domain: LibraryPackageDomain;
  group: {
    title: string;
    /** Whether "create group" starts checked. */
    suggested: boolean;
    /** Slot → library key, as recorded in an exported package. */
    slots?: Readonly<Record<string, string>>;
  } | null;
  libraries: LibraryPackagePlanLibrary[];
  skippedFiles: { path: string; reason: LibraryPackageSkipReason }[];
  notes: LibraryPackageNote[];
}
