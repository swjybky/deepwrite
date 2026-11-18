import type {
  CatalogIndexSnapshot,
  CatalogSnapshot,
  DeepWriteApi,
  MysteryBookManifest,
  WorkspaceRuntimeContext
} from "@deepwrite/contracts";
import {
  ATTACHED_CONTEXT_MAX_ITEMS,
  isOnDemandMaterial,
  parseMaterialMarkdown,
  resolveMaterialMetadata
} from "@deepwrite/contracts/renderer";
import { MATERIAL_STAGE_KINDS } from "../../data/catalogWorkspace";
import type { ComposerReferenceOption } from "../../types/conversation";

type AttachedSkills = NonNullable<WorkspaceRuntimeContext["attachedSkills"]>;
type AttachedMaterials = NonNullable<
  WorkspaceRuntimeContext["attachedMaterials"]
>;

const MAX_ATTACHMENT_BODY = 20_000;

export function buildMysteryReferenceOptions(
  indexSnapshot: CatalogIndexSnapshot | CatalogSnapshot | null,
  manifest: MysteryBookManifest | null
): {
  availableSkills: ComposerReferenceOption[];
  availableMaterials: ComposerReferenceOption[];
} {
  if (!indexSnapshot || !manifest) {
    return { availableSkills: [], availableMaterials: [] };
  }
  const skillLibraries = new Map(
    indexSnapshot.skills.map((lib) => [lib.id, lib])
  );
  const materialLibraries = new Map(
    indexSnapshot.materials.map((lib) => [lib.id, lib])
  );

  const availableSkills: ComposerReferenceOption[] = [];
  for (const libId of manifest.linkedSkillIds) {
    const lib = skillLibraries.get(libId);
    if (!lib) continue;
    for (const entry of lib.entries) {
      const size =
        "contentBytes" in entry ? entry.contentBytes : entry.body.length;
      if (size <= 0) continue;
      availableSkills.push({
        id: `skill:${lib.id}:${entry.id}`,
        label: `${lib.title} · ${entry.title}`,
        detail: lib.skillKind
      });
      if (availableSkills.length >= ATTACHED_CONTEXT_MAX_ITEMS) break;
    }
    if (availableSkills.length >= ATTACHED_CONTEXT_MAX_ITEMS) break;
  }

  const availableMaterials: ComposerReferenceOption[] = [];
  for (const libId of manifest.linkedMaterialIds) {
    const lib = materialLibraries.get(libId);
    if (!lib) continue;
    for (const entry of lib.entries) {
      const size =
        "contentBytes" in entry ? entry.contentBytes : entry.body.length;
      if (size <= 0) continue;
      availableMaterials.push({
        id: `material:${lib.id}:${entry.id}`,
        label: `${lib.title} · ${entry.title}`,
        detail: entry.stageId
      });
      if (availableMaterials.length >= ATTACHED_CONTEXT_MAX_ITEMS) break;
    }
    if (availableMaterials.length >= ATTACHED_CONTEXT_MAX_ITEMS) break;
  }

  return { availableSkills, availableMaterials };
}

export async function resolveMysteryAttachedLibraries(
  api: DeepWriteApi | undefined,
  manifest: MysteryBookManifest
): Promise<{
  attachedSkills: AttachedSkills;
  attachedMaterials: AttachedMaterials;
}> {
  if (
    !api ||
    (manifest.linkedSkillIds.length === 0 &&
      manifest.linkedMaterialIds.length === 0)
  ) {
    return { attachedSkills: [], attachedMaterials: [] };
  }
  const snapshot = await api.catalog.snapshot();

  const attachedSkills: AttachedSkills = [];
  const skillById = new Map(snapshot.skills.map((lib) => [lib.id, lib]));
  for (const libId of manifest.linkedSkillIds) {
    const lib = skillById.get(libId);
    if (!lib) continue;
    for (const entry of lib.entries) {
      if (!entry.body.trim()) continue;
      attachedSkills.push({
        id: `skill:${lib.id}:${entry.id}`,
        title: `${lib.title} · ${entry.title}`,
        content: entry.body.slice(0, MAX_ATTACHMENT_BODY),
        source: "attached-skill",
        kind: lib.skillKind
      });
      if (attachedSkills.length >= ATTACHED_CONTEXT_MAX_ITEMS) break;
    }
    if (attachedSkills.length >= ATTACHED_CONTEXT_MAX_ITEMS) break;
  }

  const attachedMaterials: AttachedMaterials = [];
  const matById = new Map(snapshot.materials.map((lib) => [lib.id, lib]));
  for (const libId of manifest.linkedMaterialIds) {
    const lib = matById.get(libId);
    if (!lib) continue;
    for (const entry of lib.entries) {
      if (!entry.body.trim() || isOnDemandMaterial(entry.body)) continue;
      const parsed = parseMaterialMarkdown(entry.body);
      const metadata = resolveMaterialMetadata({
        id: entry.id,
        title: entry.title,
        content: parsed.body
      });
      attachedMaterials.push({
        id: `material:${lib.id}:${entry.id}`,
        title: `${lib.title} · ${entry.title}`,
        content: entry.body.slice(0, MAX_ATTACHMENT_BODY),
        metadata,
        source: "attached-material",
        kind:
          MATERIAL_STAGE_KINDS[entry.stageId] ??
          (lib.materialKind === "mixed" ? "other" : lib.materialKind)
      });
      if (attachedMaterials.length >= ATTACHED_CONTEXT_MAX_ITEMS) break;
    }
    if (attachedMaterials.length >= ATTACHED_CONTEXT_MAX_ITEMS) break;
  }

  return { attachedSkills, attachedMaterials };
}
