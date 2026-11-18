import { createScopedTranslator } from "../../i18n";
import { academicTreeT } from "../../components/academic/academicTreeLabels";
import type { PopupSelectOption } from "../../components/PopupSelect.vue";
import type { ChatAssistantProjectOption } from "./useChatAssistantMode";

const t = createScopedTranslator("extras.chatAssistant");
export const projectTypeLabels = {
  get short() {
    return t("shortStory");
  },
  get script() {
    return t("script");
  },
  get long() {
    return t("novel");
  },
  get academic() {
    return academicTreeT("academicWork");
  }
} as const;
export function groupedProjectOptions(
  candidates: readonly ChatAssistantProjectOption[]
): PopupSelectOption[] {
  const options: PopupSelectOption[] = [];
  for (const type of ["short", "script", "long", "academic"] as const) {
    const projects = candidates.filter(
      (option) => option.project.projectType === type
    );
    if (!projects.length) continue;
    options.push({
      value: `group:${type}`,
      label: projectTypeLabels[type],
      disabled: true,
      style: { fontWeight: "600", color: "var(--text-tertiary)" }
    });
    options.push(
      ...projects.map((option) => ({
        value: option.key,
        label: option.label,
        description: projectTypeLabels[type],
        style: { paddingLeft: "22px" }
      }))
    );
  }
  return options;
}
