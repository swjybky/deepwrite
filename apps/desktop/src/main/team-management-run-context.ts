import type {
  TeamManagementRuntimeContext,
  WorkspaceRuntimeContext
} from "@deepwrite/contracts";
import type { AgentTeamConfigStore } from "./agent-team-config-store";

export async function prepareTeamManagementRunContext(
  workspace: WorkspaceRuntimeContext | undefined,
  teams: Pick<AgentTeamConfigStore, "list">
): Promise<TeamManagementRuntimeContext | undefined> {
  const scope = workspace?.longWorkspace
    ? { bookType: "long" as const, bookId: workspace.longWorkspace.bookId }
    : workspace?.scriptWorkspace
      ? { bookType: "script" as const, bookId: workspace.scriptWorkspace.id }
      : workspace?.shortWorkspace
        ? { bookType: "short" as const, bookId: workspace.shortWorkspace.id }
        : undefined;
  if (!scope) return undefined;
  const { team } = (await teams.list()).builtinSubagents;
  return team.enabled ? { scope, description: team.description } : undefined;
}
