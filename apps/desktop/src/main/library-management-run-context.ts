import { createId } from "@deepwrite/shared";
import {
  createEnvelope,
  CommandEnvelopeSchema,
  LibraryManagementQueryResultSchema,
  LibraryManagementRuntimeContextSchema,
  type CommandEnvelope,
  type CommandResult,
  type WorkspaceRuntimeContext,
  type LibraryManagementRuntimeContext
} from "@deepwrite/contracts";
import type { AgentTeamConfigStore } from "./agent-team-config-store";
import type { LibraryAgentConfigStore } from "./library-agent-config-store";

export async function prepareLibraryManagementRunContext(
  workspace: WorkspaceRuntimeContext | undefined,
  teams: Pick<AgentTeamConfigStore, "list">,
  profiles: Pick<LibraryAgentConfigStore, "resolve">,
  request: (command: CommandEnvelope) => Promise<CommandResult>
): Promise<LibraryManagementRuntimeContext | undefined> {
  const scope = workspace?.longWorkspace
    ? { bookType: "long" as const, bookId: workspace.longWorkspace.bookId }
    : workspace?.scriptWorkspace
      ? { bookType: "script" as const, bookId: workspace.scriptWorkspace.id }
      : workspace?.shortWorkspace
        ? { bookType: "short" as const, bookId: workspace.shortWorkspace.id }
        : undefined;
  if (!scope) return undefined;
  const settings = (await teams.list()).builtinSubagents;
  const managers = [];
  for (const domain of ["skill", "material"] as const) {
    if (settings[domain].enabled)
      managers.push({
        domain,
        description: settings[domain].description,
        profile: await profiles.resolve(domain)
      });
  }
  if (!managers.length) return undefined;
  const result = await request(
    CommandEnvelopeSchema.parse(
      createEnvelope(
        "catalog.queryLibraryManagement",
        { scope },
        { id: createId("library-management") }
      )
    )
  );
  if (result.status !== "accepted") throw new Error(result.error.message);
  return LibraryManagementRuntimeContextSchema.parse({
    scope,
    managers,
    libraries: LibraryManagementQueryResultSchema.parse(result.payload)
      .libraries
  });
}
