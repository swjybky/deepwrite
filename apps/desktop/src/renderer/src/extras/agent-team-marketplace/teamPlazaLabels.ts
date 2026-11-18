import type {
  AgentTeamWorkspaceType,
  MarketplaceStatus,
  SubagentAgentMode
} from "@deepwrite/contracts";
import { academicAgentT } from "../../components/academic/academicAgentLabels";
import { createScopedTranslator } from "../../i18n";

const t = createScopedTranslator("extras.agentTeamMarketplace");

export function workspaceTypeLabel(type: AgentTeamWorkspaceType): string {
  return type === "short"
    ? t("short")
    : type === "script"
      ? t("script")
      : type === "long"
        ? t("long")
        : academicAgentT("tabLabel");
}

export function statusLabel(status: MarketplaceStatus): string {
  switch (status) {
    case "draft":
      return t("draft");
    case "pending":
      return t("pending");
    case "published":
      return t("published");
    case "rejected":
      return t("rejected");
    case "archived":
      return t("archived");
    case "deleted":
      return t("deleted");
  }
}

export function agentModeLabel(mode: SubagentAgentMode): string {
  return mode === "pure-read"
    ? t("modePureRead")
    : mode === "pure-bare"
      ? t("modePureBare")
      : t("modeStandard");
}
