import {
  AgentTeamPromptChangeSchema,
  AgentTeamPromptReadResultSchema,
  AgentTeamPromptTargetSchema,
  ActiveAgentTeamListSchema,
  agentTeamBoundBookCount,
  activeAgentTeams,
  type AgentTeamBookBindings,
  type AgentTeamCatalogSnapshot,
  type AgentTeamPromptChange,
  type AgentTeamPromptTarget,
  type LibraryManagementScope
} from "@deepwrite/contracts";

function effectiveTeams(
  snapshot: AgentTeamCatalogSnapshot,
  scope: LibraryManagementScope
) {
  return activeAgentTeams(snapshot, scope.bookType, scope.bookId).teams;
}

export function listActiveTeamPrompts(
  snapshot: AgentTeamCatalogSnapshot,
  scope: LibraryManagementScope
) {
  return ActiveAgentTeamListSchema.parse(
    effectiveTeams(snapshot, scope).map((team) => ({
      id: team.id,
      name: team.name,
      boundBookCount: agentTeamBoundBookCount(snapshot.bookBindings, team.id),
      enabledAsDefault: snapshot.enabledTeamIds[scope.bookType] === team.id,
      members: team.settings.teams.flatMap((group) =>
        group.subagents.map((member) => ({
          parentAgentId: group.parentAgentId,
          id: member.id,
          name: member.name,
          description: member.description,
          enabled: member.enabled
        }))
      )
    }))
  );
}

function requireMember(
  snapshot: AgentTeamCatalogSnapshot,
  target: AgentTeamPromptTarget
) {
  if (!snapshot.builtinSubagents.team.enabled)
    throw new Error("智能体团队管理已停用。");
  const team = effectiveTeams(snapshot, target.scope).find(
    (team) => team.id === target.teamId
  );
  if (!team)
    throw new Error(
      "目标团队已不在当前作品的生效范围内，请重新读取生效团队列表。"
    );
  const group = team.settings.teams.find(
    (group) => group.parentAgentId === target.parentAgentId
  );
  const member = group?.subagents.find(
    (member) => member.id === target.memberId
  );
  if (!member) throw new Error("目标团队成员已不存在，请重新读取团队列表。");
  return { team, member };
}

export function readActiveTeamPrompt(
  snapshot: AgentTeamCatalogSnapshot,
  target: AgentTeamPromptTarget
) {
  const { team, member } = requireMember(snapshot, target);
  return AgentTeamPromptReadResultSchema.parse({
    ...AgentTeamPromptTargetSchema.strip().parse(target),
    teamName: team.name,
    memberName: member.name,
    description: member.description,
    boundBookCount: agentTeamBoundBookCount(snapshot.bookBindings, team.id),
    enabledAsDefault:
      snapshot.enabledTeamIds[target.scope.bookType] === team.id,
    prompt: member.systemPrompt
  });
}

/** Called inside the store's write queue, with freshly read device bindings. */
export function applyActiveTeamPrompt(
  snapshot: AgentTeamCatalogSnapshot,
  bindings: AgentTeamBookBindings,
  rawInput: AgentTeamPromptChange
): void {
  const input = AgentTeamPromptChangeSchema.parse(rawInput);
  const { member } = requireMember(
    { ...snapshot, bookBindings: bindings },
    input
  );
  if (member.systemPrompt !== input.previousPrompt) {
    throw new Error(
      "团队提示词已被其他操作修改，请重新读取并审阅，当前修改未保存。"
    );
  }
  member.systemPrompt = input.prompt;
}
