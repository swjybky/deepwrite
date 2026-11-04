import { createScopedTranslator } from "../i18n";
import {
  activeAgentTeamMembers,
  activeAgentTeams
} from "@deepwrite/contracts/renderer";
import type {
  AgentTeamCatalogSnapshot,
  AgentTeamWorkspaceType,
  ShortAgentSubagentDefinition
} from "@deepwrite/contracts";

const t = createScopedTranslator("workspace.agentTeamModeAvailability");

export interface AgentTeamModeAvailabilityInput {
  catalog: AgentTeamCatalogSnapshot | null;
  workspaceType: AgentTeamWorkspaceType;
  parentAgentId: string;
  bookId?: string | undefined;
  loaded: boolean;
  loading: boolean;
  loadError: string | null;
}

export interface AgentTeamModeAvailability {
  available: boolean;
  description: string;
}

/**
 * Members the main agent can delegate to: the enabled subagents of the teams
 * the book is bound to, or of the enabled team when it has no binding.
 */
export function enabledTeamMembers(
  catalog: AgentTeamCatalogSnapshot,
  workspaceType: AgentTeamWorkspaceType,
  parentAgentId: string,
  bookId?: string
): readonly ShortAgentSubagentDefinition[] {
  return activeAgentTeamMembers(
    activeAgentTeams(catalog, workspaceType, bookId),
    parentAgentId
  );
}

export function resolveAgentTeamModeAvailability(
  input: AgentTeamModeAvailabilityInput
): AgentTeamModeAvailability {
  if (input.loading) {
    return {
      available: false,
      description: t("loadingAgentTeamConfiguration")
    };
  }
  if (input.loadError) {
    return {
      available: false,
      description: t("failedToLoadAgentTeamsRetryFromTheAgent")
    };
  }
  if (!input.loaded || !input.catalog) {
    return {
      available: false,
      description: t("agentTeamConfigurationHasNotLoadedYet")
    };
  }
  const active = activeAgentTeams(
    input.catalog,
    input.workspaceType,
    input.bookId
  );
  const bound = active.source === "bound";
  if (activeAgentTeamMembers(active, input.parentAgentId).length === 0) {
    return {
      available: false,
      description: bound
        ? t("theTeamsBoundToThisBookHaveNoAvailableMembers")
        : t("thisAgentHasNoEnabledTeamWithAvailableMembers")
    };
  }
  if (bound) {
    return {
      available: true,
      description: t("useTheTeamsBoundToThisBook", {
        names: active.teams.map((team) => team.name).join("、")
      })
    };
  }
  return {
    available: true,
    description: t("allowThisMainAgentToCallSubagentsInEnabled")
  };
}
