import type {
  CatalogLibraryProjectDomain,
  MaterialLibrary,
  SkillLibrary
} from "@deepwrite/contracts";
import {
  normalizeLegacyMaterialLibrary,
  normalizeLegacySkillLibrary
} from "./catalog-store";
import { openLegacyZipArchive } from "./legacy-zip";

export type ImportedLegacyLibrary =
  | { domain: "material"; library: MaterialLibrary }
  | { domain: "skill"; library: SkillLibrary };

function libraryLabel(domain: CatalogLibraryProjectDomain): string {
  return domain === "material" ? "素材库" : "技能库";
}

function importedLibraryTitle(
  library: MaterialLibrary | SkillLibrary,
  domain: CatalogLibraryProjectDomain
): string {
  const fallback = domain === "material" ? "导入素材库" : "导入技能库";
  return (library.title.trim() || fallback).slice(0, 256);
}

export async function readLegacyLibraryArchive(
  path: string,
  expectedDomain: CatalogLibraryProjectDomain
): Promise<ImportedLegacyLibrary> {
  const expectedLabel = libraryLabel(expectedDomain);
  const archive = await openLegacyZipArchive(path, `旧版${expectedLabel}压缩包`);
  const metadata = archive.readJsonObject("metadata.json");
  if (!metadata) {
    throw new Error(`无效的旧版${expectedLabel}压缩包：缺少 metadata.json。`);
  }

  const actualDomain = metadata.library_type;
  if (actualDomain !== expectedDomain) {
    const actualLabel =
      actualDomain === "material"
        ? "素材库"
        : actualDomain === "skill"
          ? "技能库"
          : "未知类型资料库";
    throw new Error(
      `选择的是旧版${actualLabel}压缩包，不能作为${expectedLabel}导入。`
    );
  }

  const importedAt = new Date().toISOString();
  if (expectedDomain === "material") {
    const normalized = normalizeLegacyMaterialLibrary(
      metadata.data,
      0,
      importedAt
    );
    if (!normalized) {
      throw new Error("旧版素材库压缩包中的资料库数据无效。");
    }
    return {
      domain: "material",
      library: {
        ...normalized,
        title: importedLibraryTitle(normalized, expectedDomain),
        entries: normalized.entries.map((entry) => ({
          ...entry,
          title: entry.title.slice(0, 256)
        }))
      }
    };
  }

  const normalized = normalizeLegacySkillLibrary(metadata.data, 0, importedAt);
  if (!normalized) {
    throw new Error("旧版技能库压缩包中的资料库数据无效。");
  }
  return {
    domain: "skill",
    library: {
      ...normalized,
      title: importedLibraryTitle(normalized, expectedDomain),
      isBuiltin: false,
      entries: normalized.entries.map((entry) => ({
        ...entry,
        title: entry.title.slice(0, 256)
      }))
    }
  };
}
