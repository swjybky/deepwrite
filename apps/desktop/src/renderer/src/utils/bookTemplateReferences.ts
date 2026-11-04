import { createScopedTranslator } from "../i18n";
import type {
  AgentTeamCatalogSnapshot,
  BookTemplateDraft,
  CreativePlotStage,
  MaterialLibrary,
  SkillLibrary
} from "@deepwrite/contracts";

const t = createScopedTranslator("workspace.bookTemplateReferences");
export function bookTemplateReferenceError(
  configuration: BookTemplateDraft,
  catalog: {
    creativePlotStages: readonly CreativePlotStage[];
    materials: readonly Pick<MaterialLibrary, "id" | "materialKind">[];
    skills: readonly Pick<SkillLibrary, "id" | "skillKind">[];
  },
  teams: Pick<AgentTeamCatalogSnapshot, "teams"> | null = null
): string | null {
  if (
    configuration.defaultPlotStageIds.some(
      (id) => !catalog.creativePlotStages.some((stage) => stage.id === id)
    )
  )
    return t("aPlotStageInThisTemplateIsNoLonger");
  for (const [kind, ids] of Object.entries(
    configuration.linkedMaterialIdsByKind
  )) {
    if (
      ids.some(
        (id) =>
          !catalog.materials.some(
            (item) =>
              item.id === id &&
              (item.materialKind === kind || item.materialKind === "mixed")
          )
      )
    )
      return t("aMaterialLibraryInThisTemplateIsNoLonger");
  }
  for (const [kind, ids] of Object.entries(
    configuration.linkedSkillIdsByKind
  )) {
    if (
      ids.some(
        (id) =>
          !catalog.skills.some(
            (item) => item.id === id && item.skillKind === kind
          )
      )
    )
      return t("aSkillLibraryInThisTemplateIsNoLonger");
  }
  if (
    teams &&
    configuration.linkedAgentTeamIds?.some(
      (id) =>
        !teams.teams.some(
          (team) =>
            team.id === id && team.workspaceType === configuration.workspaceType
        )
    )
  )
    return t("anAgentTeamInThisTemplateIsNoLonger");
  return null;
}
