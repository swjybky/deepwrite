import type { MaterialLibraryKind } from "@deepwrite/contracts";
import { createScopedTranslator } from "../i18n";

const t = createScopedTranslator("components.libraryProjectDialog");

export function libraryKindOptions(domain: "material" | "skill") {
  return domain === "material"
    ? [
        {
          value: "character",
          label: t("characterMaterialLibrary")
        },
        {
          value: "gimmick",
          label: t("ideaMaterialLibrary")
        },
        {
          value: "plot",
          label: t("plotMaterialLibrary")
        },
        {
          value: "draft",
          label: t("manuscriptMaterialLibrary")
        },
        {
          value: "other",
          label: t("otherMaterialLibrary")
        }
      ]
    : [
        {
          value: "general",
          label: t("generalSkillLibrary")
        },
        {
          value: "plot",
          label: t("plotDesignSkillLibrary")
        },
        {
          value: "style",
          label: t("writingStyleSkillLibrary")
        },
        {
          value: "other",
          label: t("otherSkillLibrary")
        }
      ];
}
export function entryStageOptions(kind: MaterialLibraryKind) {
  const allOptions = [
    { value: "gimmick", label: t("idea") },
    {
      value: "character",
      label: t("characterConcept")
    },
    { value: "pacing", label: t("plotDesign") },
    {
      value: "intro",
      label: t("introductionDesign")
    },
    {
      value: "plot_refine",
      label: t("plotDevelopment")
    },
    {
      value: "draft_excerpt",
      label: t("manuscriptExcerpts")
    },
    {
      value: "other",
      label: t("otherMaterials")
    }
  ];
  const allowedByKind: Record<MaterialLibraryKind, readonly string[]> = {
    character: ["character"],
    gimmick: ["gimmick"],
    plot: ["pacing", "intro", "plot_refine"],
    draft: ["draft_excerpt"],
    other: ["other"],
    mixed: allOptions.map(({ value }) => value)
  };
  const allowed = new Set(allowedByKind[kind]);
  return allOptions.filter(({ value }) => allowed.has(value));
}
