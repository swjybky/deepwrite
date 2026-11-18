import { createScopedTranslator } from "../i18n";
import { academicTreeT } from "./academic/academicTreeLabels";
import { academicAgentT } from "./academic/academicAgentLabels";
import type {
  AcademicAgentId,
  BuiltInReasoningLevel,
  SubagentAgentMode,
  SubagentWebSearchMode,
  WorkspaceAgentId
} from "@deepwrite/contracts";

const t = createScopedTranslator("components.agentTeamSettingsMeta");

export interface ParentAgentMeta {
  id: WorkspaceAgentId | AcademicAgentId;
  label: string;
  description: string;
}

export const ACADEMIC_PARENT_AGENT = {
  id: "academic",
  get label() {
    return academicTreeT("academicAgent");
  },
  get description() {
    return academicAgentT("parentAgentDesc");
  }
} as const satisfies ParentAgentMeta;

export const SHORT_PARENT_AGENT = {
  id: "short",
  get label() {
    return t("shortStoryAgent");
  },
  get description() {
    return t("configureSpecialistAssistantsForTheUnifiedShortStoryAgent");
  }
} as const satisfies ParentAgentMeta;

export const SCRIPT_PARENT_AGENTS = [
  {
    id: "script",
    get label() {
      return t("screenplayAgent");
    },
    get description() {
      return t("configureSpecialistAssistantsForTheUnifiedScreenplayAgentTo");
    }
  }
] as const satisfies readonly ParentAgentMeta[];

export const BUILT_IN_THINKING_LABELS: Record<BuiltInReasoningLevel, string> = {
  get minimal() {
    return t("minimal");
  },
  get low() {
    return t("low");
  },
  get medium() {
    return t("medium");
  },
  get high() {
    return t("high");
  },
  get xhigh() {
    return t("extraHigh");
  },
  get max() {
    return t("maximum");
  }
};

export const SUBAGENT_WEB_SEARCH_LABELS: Record<SubagentWebSearchMode, string> =
  {
    get inherit() {
      return t("webSearchInherit");
    },
    get on() {
      return t("webSearchOn");
    },
    get off() {
      return t("webSearchOff");
    }
  };

export const SUBAGENT_AGENT_MODE_LABELS: Record<SubagentAgentMode, string> = {
  get standard() {
    return t("agentModeStandard");
  },
  get "pure-read"() {
    return t("agentModePureRead");
  },
  get "pure-bare"() {
    return t("agentModePureBare");
  }
};
