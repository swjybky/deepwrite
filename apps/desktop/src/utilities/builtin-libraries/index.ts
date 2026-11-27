import {
  BUILTIN_MATERIAL_GROUP_BASIC_LONG_ID,
  CatalogIndexMaterialLibrarySchema,
  CatalogIndexSkillLibrarySchema,
  MaterialLibraryGroupSchema,
  MaterialLibrarySchema,
  SkillLibrarySchema,
  isBuiltinCatalogProjectId,
  type CatalogIndexSnapshot,
  type MaterialLibrary,
  type MaterialLibraryGroup,
  type SkillLibrary,
  type SkillLibraryGroup
} from "@deepwrite/contracts";
import rawData from "./basic-long-data.json";

const BUILTIN_TIMESTAMP = rawData.updatedAt;

function manifestStamp(content: string): string {
  return `manifest-v1:${Buffer.byteLength(content, "utf8")}:${BUILTIN_TIMESTAMP}`;
}

const BUILTIN_MATERIAL_LIBRARIES: readonly MaterialLibrary[] =
  rawData.materials.map((library) =>
    MaterialLibrarySchema.parse({
      ...library,
      isBuiltin: true,
      projectRevision: 0,
      createdAt: BUILTIN_TIMESTAMP,
      updatedAt: BUILTIN_TIMESTAMP,
      entries: library.entries.map((entry) => ({
        ...entry,
        createdAt: BUILTIN_TIMESTAMP,
        updatedAt: BUILTIN_TIMESTAMP
      }))
    })
  );

const BUILTIN_MATERIAL_GROUPS: readonly MaterialLibraryGroup[] =
  rawData.materialGroups.map((group) =>
    MaterialLibraryGroupSchema.parse({
      ...group,
      isBuiltin: true,
      projectRevision: 0,
      createdAt: BUILTIN_TIMESTAMP,
      updatedAt: BUILTIN_TIMESTAMP
    })
  );

const BUILTIN_SKILL_LIBRARIES: readonly SkillLibrary[] = rawData.skills.map(
  (library) =>
    SkillLibrarySchema.parse({
      ...library,
      isBuiltin: true,
      projectRevision: 0,
      createdAt: BUILTIN_TIMESTAMP,
      updatedAt: BUILTIN_TIMESTAMP,
      entries: library.entries.map((entry) => ({
        ...entry,
        createdAt: BUILTIN_TIMESTAMP,
        updatedAt: BUILTIN_TIMESTAMP
      }))
    })
);

const BUILTIN_SKILL_GROUPS: readonly SkillLibraryGroup[] = [];

const BUILTIN_INDEX_MATERIAL_LIBRARIES: readonly CatalogIndexSnapshot["materials"][number][] =
  BUILTIN_MATERIAL_LIBRARIES.map((library) =>
    CatalogIndexMaterialLibrarySchema.parse({
      ...library,
      overview: "",
      overviewContentBytes: Buffer.byteLength(library.overview, "utf8"),
      overviewContentStamp: manifestStamp(library.overview),
      entries: library.entries.map((entry) => ({
        ...entry,
        body: "",
        contentBytes: Buffer.byteLength(entry.body, "utf8"),
        contentStamp: manifestStamp(entry.body)
      }))
    })
  );

const BUILTIN_INDEX_SKILL_LIBRARIES: readonly CatalogIndexSnapshot["skills"][number][] =
  BUILTIN_SKILL_LIBRARIES.map((library) =>
    CatalogIndexSkillLibrarySchema.parse({
      ...library,
      overview: "",
      overviewContentBytes: Buffer.byteLength(library.overview, "utf8"),
      overviewContentStamp: manifestStamp(library.overview),
      entries: library.entries.map((entry) => ({
        ...entry,
        body: "",
        contentBytes: Buffer.byteLength(entry.body, "utf8"),
        contentStamp: manifestStamp(entry.body)
      }))
    })
  );

export function getBuiltinMaterialLibraries(): MaterialLibrary[] {
  return structuredClone([...BUILTIN_MATERIAL_LIBRARIES]);
}

export function getBuiltinMaterialGroups(): MaterialLibraryGroup[] {
  return structuredClone([...BUILTIN_MATERIAL_GROUPS]);
}

export function getBuiltinSkillLibraries(): SkillLibrary[] {
  return structuredClone([...BUILTIN_SKILL_LIBRARIES]);
}

export function getBuiltinSkillGroups(): SkillLibraryGroup[] {
  return structuredClone([...BUILTIN_SKILL_GROUPS]);
}

export function getBuiltinIndexMaterialLibraries(): CatalogIndexSnapshot["materials"] {
  return structuredClone([...BUILTIN_INDEX_MATERIAL_LIBRARIES]);
}

export function getBuiltinIndexSkillLibraries(): CatalogIndexSnapshot["skills"] {
  return structuredClone([...BUILTIN_INDEX_SKILL_LIBRARIES]);
}

export function findBuiltinLibrary(
  id: string
):
  | { domain: "material"; library: MaterialLibrary }
  | { domain: "skill"; library: SkillLibrary }
  | undefined {
  const material = BUILTIN_MATERIAL_LIBRARIES.find((item) => item.id === id);
  if (material) {
    return { domain: "material", library: structuredClone(material) };
  }
  const skill = BUILTIN_SKILL_LIBRARIES.find((item) => item.id === id);
  if (skill) {
    return { domain: "skill", library: structuredClone(skill) };
  }
  return undefined;
}

export function findBuiltinGroup(
  id: string
):
  | { domain: "material-group"; group: MaterialLibraryGroup }
  | { domain: "skill-group"; group: SkillLibraryGroup }
  | undefined {
  const materialGroup = BUILTIN_MATERIAL_GROUPS.find((item) => item.id === id);
  if (materialGroup) {
    return {
      domain: "material-group",
      group: structuredClone(materialGroup)
    };
  }
  const skillGroup = BUILTIN_SKILL_GROUPS.find((item) => item.id === id);
  if (skillGroup) {
    return { domain: "skill-group", group: structuredClone(skillGroup) };
  }
  return undefined;
}

export { BUILTIN_MATERIAL_GROUP_BASIC_LONG_ID, isBuiltinCatalogProjectId };
