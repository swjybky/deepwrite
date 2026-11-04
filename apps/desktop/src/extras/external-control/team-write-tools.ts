import {
  AgentTeamCatalogSnapshotSchema,
  AgentTeamProfileSaveInputSchema,
  type AgentTeamProfile
} from "@deepwrite/contracts";
import {
  ExternalMutationResultSchema,
  type ExternalManageAgentTeamInput,
  type ExternalMutationResult,
  type ExternalSaveAgentTeamInput
} from "@deepwrite/contracts/external-control";
import { ExternalControlError } from "./errors";
import {
  assertNoActiveRun,
  requireField,
  runCommand,
  type MutationContext
} from "./mutation-client";
import { agentTeamRevision } from "./team-read-tools";

function teamNotFound(): ExternalControlError {
  return new ExternalControlError(
    "external.not_found",
    "找不到这个智能体团队。请用 list_agent_teams 重新确认团队 ID。"
  );
}

async function requireTeam(
  context: MutationContext,
  teamId: string
): Promise<AgentTeamProfile> {
  const { teams } = await context.agentTeams();
  const team = teams.find(({ id }) => id === teamId);
  if (!team) throw teamNotFound();
  return team;
}

function changed(context: MutationContext, teamId: string): void {
  context.broadcastChange({ domain: "agent_team", resourceId: teamId });
}

function teamCommand(
  context: MutationContext,
  type:
    | "agentTeams.create"
    | "agentTeams.rename"
    | "agentTeams.setEnabled"
    | "agentTeams.delete"
    | "agentTeams.save",
  payload: unknown
) {
  return runCommand(context, type, payload, AgentTeamCatalogSnapshotSchema);
}

/** Settings are large, so agents get the exact field rather than a refusal. */
export async function writeTeamSettings(
  context: MutationContext,
  teamId: string,
  settings: unknown
): Promise<AgentTeamProfile> {
  const parsed = AgentTeamProfileSaveInputSchema.safeParse({
    teamId,
    settings
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ExternalControlError(
      "external.invalid_input",
      `团队配置不合法（${issue?.path.join(".") ?? "settings"}）：${issue?.message ?? "格式无效"}`
    );
  }
  const { teams } = await teamCommand(context, "agentTeams.save", parsed.data);
  const saved = teams.find(({ id }) => id === teamId);
  if (!saved) throw teamNotFound();
  return saved;
}

export async function createTeam(
  context: MutationContext,
  workspaceType: AgentTeamProfile["workspaceType"],
  name: string
): Promise<ExternalMutationResult> {
  const before = new Set(
    (await context.agentTeams()).teams.map(({ id }) => id)
  );
  const { teams } = await teamCommand(context, "agentTeams.create", {
    name,
    workspaceType
  });
  const created = teams.find(({ id }) => !before.has(id));
  return { ...(created ? { id: created.id } : {}), title: name };
}

/** Team names must be unique, and the old name may have been reused. */
export async function availableTeamName(
  context: MutationContext,
  name: string
): Promise<string> {
  const { teams } = await context.agentTeams();
  const taken = new Set(teams.map((team) => team.name));
  if (!taken.has(name)) return name;
  for (let copy = 1; ; copy += 1) {
    const candidate = `${name} 恢复${copy === 1 ? "" : copy}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export async function saveAgentTeam(
  context: MutationContext,
  input: ExternalSaveAgentTeamInput
): Promise<ExternalMutationResult> {
  assertNoActiveRun(context);
  const { teamId, settings, baseRevision } = input;
  const team = await requireTeam(context, teamId);
  if (agentTeamRevision(team) !== baseRevision) {
    throw new ExternalControlError(
      "external.stale_revision",
      "团队配置已被修改，这次保存没有生效。请重新读取后，基于最新配置再保存。"
    );
  }
  const saved = await writeTeamSettings(context, teamId, settings);
  changed(context, teamId);
  return ExternalMutationResultSchema.parse({
    id: teamId,
    title: saved.name,
    revision: agentTeamRevision(saved)
  });
}

async function deleteTeam(
  context: MutationContext,
  teamId: string
): Promise<ExternalMutationResult> {
  const team = await requireTeam(context, teamId);
  const record = await context.trash.save({
    kind: "team",
    title: team.name,
    client: context.client.name,
    workspaceType: team.workspaceType,
    settings: team.settings
  });
  try {
    await teamCommand(context, "agentTeams.delete", { teamId });
  } catch (error: unknown) {
    await context.trash.remove(record.id);
    throw error;
  }
  return { id: teamId, title: team.name, trashId: record.id };
}

export async function manageAgentTeam(
  context: MutationContext,
  input: ExternalManageAgentTeamInput
): Promise<ExternalMutationResult> {
  assertNoActiveRun(context);
  const { action, name } = input;
  if (action === "create") {
    const created = await createTeam(
      context,
      requireField(input.type, "create", "type"),
      requireField(name, "create", "name")
    );
    changed(context, created.id ?? "unknown");
    return ExternalMutationResultSchema.parse(created);
  }
  const teamId = requireField(input.teamId, action, "teamId");
  await requireTeam(context, teamId);
  const run = async (): Promise<ExternalMutationResult> => {
    switch (action) {
      case "rename": {
        const nextName = requireField(name, "rename", "name");
        await teamCommand(context, "agentTeams.rename", {
          teamId,
          name: nextName
        });
        return { id: teamId, title: nextName };
      }
      case "enable":
      case "disable":
        await teamCommand(context, "agentTeams.setEnabled", {
          teamId,
          enabled: action === "enable"
        });
        return { id: teamId };
      case "delete":
        return deleteTeam(context, teamId);
    }
  };
  const result = await run();
  changed(context, teamId);
  return ExternalMutationResultSchema.parse(result);
}
