import {
  CatalogReadDocumentResultSchema,
  type CatalogIndexSnapshot
} from "@deepwrite/contracts";
import {
  ExternalEntryPageSchema,
  ExternalLibraryDetailSchema,
  ExternalListLibrariesResultSchema,
  type ExternalGetLibraryInput,
  type ExternalListLibrariesInput,
  type ExternalReadEntryInput
} from "@deepwrite/contracts/external-control";
import { readCore, type CoreRequest } from "./core-client";
import { pageText } from "./document-page";
import { ExternalControlError } from "./errors";
import { readCatalogIndex } from "./work-read-tools";

type MaterialLibrary = CatalogIndexSnapshot["materials"][number];
type SkillLibrary = CatalogIndexSnapshot["skills"][number];

function librarySummary(
  library:
    | { domain: "material"; value: MaterialLibrary }
    | { domain: "skill"; value: SkillLibrary }
) {
  const { value } = library;
  return {
    id: value.id,
    domain: library.domain,
    title: value.title,
    type:
      library.domain === "material"
        ? library.value.materialType
        : library.value.skillType,
    kind:
      library.domain === "material"
        ? library.value.materialKind
        : library.value.skillKind,
    entryCount: value.entries.length,
    updatedAt: value.updatedAt
  };
}

function materialSummaries(index: CatalogIndexSnapshot) {
  return index.materials.map((value) =>
    librarySummary({ domain: "material", value })
  );
}

function skillSummaries(index: CatalogIndexSnapshot) {
  return index.skills.map((value) =>
    librarySummary({ domain: "skill", value })
  );
}

function groupSummary(
  domain: "material" | "skill",
  group: { id: string; title: string; members: Record<string, unknown> }
) {
  return {
    id: group.id,
    domain,
    title: group.title,
    libraryIds: Object.values(group.members).filter(
      (id): id is string => typeof id === "string"
    )
  };
}

export async function listLibraries(
  core: CoreRequest,
  input: ExternalListLibrariesInput
) {
  const index = await readCatalogIndex(core);
  const wants = (domain: "material" | "skill") =>
    !input.domain || input.domain === domain;
  return ExternalListLibrariesResultSchema.parse({
    libraries: [
      ...(wants("material") ? materialSummaries(index) : []),
      ...(wants("skill") ? skillSummaries(index) : [])
    ],
    groups: [
      ...(wants("material")
        ? index.materialGroups.map((group) => groupSummary("material", group))
        : []),
      ...(wants("skill")
        ? index.skillGroups.map((group) => groupSummary("skill", group))
        : [])
    ]
  });
}

export function findLibrary(index: CatalogIndexSnapshot, libraryId: string) {
  const material = index.materials.find(({ id }) => id === libraryId);
  if (material) return { domain: "material" as const, value: material };
  const skill = index.skills.find(({ id }) => id === libraryId);
  if (skill) return { domain: "skill" as const, value: skill };
  throw new ExternalControlError(
    "external.not_found",
    "找不到这个库。请用 list_libraries 重新确认库 ID。"
  );
}

export async function getLibrary(
  core: CoreRequest,
  input: ExternalGetLibraryInput
) {
  const library = findLibrary(await readCatalogIndex(core), input.libraryId);
  return ExternalLibraryDetailSchema.parse({
    ...librarySummary(library),
    overviewBytes: library.value.overviewContentBytes,
    entries: library.value.entries.map((entry) => ({
      id: entry.id,
      stageId: entry.stageId,
      title: entry.title,
      bytes: entry.contentBytes,
      updatedAt: entry.updatedAt
    }))
  });
}

export async function readEntry(
  core: CoreRequest,
  input: ExternalReadEntryInput
) {
  const { libraryId, entryId } = input;
  const document = await readCore(
    core,
    "catalog.readDocument",
    entryId
      ? { projectId: libraryId, target: "document", documentId: entryId }
      : { projectId: libraryId, target: "overview" },
    CatalogReadDocumentResultSchema,
    "找不到这个条目。请用 get_library 重新确认条目 ID。"
  );
  return ExternalEntryPageSchema.parse({
    libraryId,
    ...(entryId ? { entryId } : {}),
    title: document.title,
    revision: document.revision,
    ...pageText(document.content, input.offset, input.maxCharacters)
  });
}
