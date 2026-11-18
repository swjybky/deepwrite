import { createScopedTranslator } from "../i18n";
import {
  DEFAULT_ACADEMIC_FRAMEWORK_STAGES,
  type AgentTeamCatalogSnapshot,
  type BookTemplateDraft,
  type CreativePlotStage,
  type MaterialLibrary,
  type SkillLibrary
} from "@deepwrite/contracts/renderer";

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
  if (configuration.workspaceType === "academic") {
    if (
      configuration.defaultFrameworkStageIds.some(
        (id) =>
          !DEFAULT_ACADEMIC_FRAMEWORK_STAGES.some((stage) => stage.id === id)
      )
    )
      return t("aPlotStageInThisTemplateIsNoLonger");
    if (
      configuration.linkedMaterialIds.some(
        (id) => !catalog.materials.some((item) => item.id === id)
      )
    )
      return t("aMaterialLibraryInThisTemplateIsNoLonger");
    if (
      configuration.linkedSkillIds.some(
        (id) => !catalog.skills.some((item) => item.id === id)
      )
    )
      return t("aSkillLibraryInThisTemplateIsNoLonger");
    if (
      teams &&
      configuration.linkedAgentTeamIds?.some(
        (id) =>
          !teams.teams.some(
            (team) =>
              team.id === id &&
              team.workspaceType === configuration.workspaceType
          )
      )
    )
      return t("anAgentTeamInThisTemplateIsNoLonger");
    return null;
  }
  if (
    configuration.defaultPlotStageIds.some(
      (id) => !catalog.creativePlotStages.some((stage) => stage.id === id)
    )
  )
    return t("aPlotStageInThisTemplateIsNoLonger");
  for (const ids of Object.values(configuration.linkedMaterialIdsByKind)) {
    if (ids.some((id) => !catalog.materials.some((item) => item.id === id)))
      return t("aMaterialLibraryInThisTemplateIsNoLonger");
  }
  for (const ids of Object.values(configuration.linkedSkillIdsByKind)) {
    if (ids.some((id) => !catalog.skills.some((item) => item.id === id)))
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
