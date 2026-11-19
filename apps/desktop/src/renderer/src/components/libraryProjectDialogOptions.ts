import { createScopedTranslator } from "../i18n";

const t = createScopedTranslator("components.libraryProjectDialog");

export function entryStageOptions() {
  return [
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
}
