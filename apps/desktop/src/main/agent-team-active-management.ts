import { createHash } from "node:crypto";
import {
  ActiveAgentTeamListSchema,
  AgentTeamChangePreviewInputSchema,
  AgentTeamChangeReviewSchema,
  AgentTeamChangeSchema,
  AgentTeamMembersReadInputSchema,
  AgentTeamMembersReadResultSchema,
  AgentTeamProfileSchema,
  activeAgentTeams,
  agentTeamBoundBookCount,
  isBuiltinAgentTeamId,
  type AgentTeamBookBindings,
  type AgentTeamCatalogSnapshot,
  type AgentTeamChange,
  type AgentTeamChangeOperation,
  type AgentTeamChangePreviewInput,
  type AgentTeamChangeReview,
  type AgentTeamMembersReadInput,
  type AgentTeamModelChoice,
  type AgentTeamProfile,
  type LibraryManagementScope,
  type ShortAgentSubagentDefinition
} from "@deepwrite/contracts";

type Settings = AgentTeamProfile["settings"];

/** Team settings carry no revision of their own, so their content is one. */
export function activeTeamRevision(team: AgentTeamProfile): string {
  return createHash("sha256")
    .update(JSON.stringify(team.settings))
    .digest("hex")
    .slice(0, 32);
}

function requireTeam(
  snapshot: AgentTeamCatalogSnapshot,
  scope: LibraryManagementScope,
  teamId: string
): AgentTeamProfile {
  if (!snapshot.builtinSubagents.team.enabled)
    throw new Error("智能体团队管理已停用。");
  const team = activeAgentTeams(
    snapshot,
    scope.bookType,
    scope.bookId
  ).teams.find((item) => item.id === teamId);
  if (!team)
    throw new Error(
      "目标团队已不在当前作品的生效范围内，请重新读取生效团队列表。"
    );
  return team;
}

function group(settings: Settings, parentAgentId: string) {
  const found = settings.teams.find(
    (item) => item.parentAgentId === parentAgentId
  );
  if (!found)
    throw new Error(
      `团队中没有主智能体 ${parentAgentId}，请重新读取团队列表。`
    );
  return found as {
    parentAgentId: string;
    subagents: ShortAgentSubagentDefinition[];
  };
}

function member(settings: Settings, parentAgentId: string, memberId: string) {
  const found = group(settings, parentAgentId).subagents.find(
    (item) => item.id === memberId
  );
  if (!found) throw new Error(`成员 ${memberId} 不存在，请重新读取团队列表。`);
  return found;
}

export function listActiveTeams(
  snapshot: AgentTeamCatalogSnapshot,
  scope: LibraryManagementScope,
  models: AgentTeamModelChoice[]
) {
  const bookType = scope.bookType;
  return ActiveAgentTeamListSchema.parse({
    teams: activeAgentTeams(snapshot, bookType, scope.bookId).teams.map(
      (team) => ({
        id: team.id,
        name: team.name,
        boundBookCount: agentTeamBoundBookCount(snapshot.bookBindings, team.id),
        enabledAsDefault: snapshot.enabledTeamIds[bookType] === team.id,
        parallelSubagents: team.settings.parallelSubagents,
        parentAgentIds: team.settings.teams.map((item) => item.parentAgentId),
        revision: activeTeamRevision(team),
        members: team.settings.teams.flatMap((item) =>
          item.subagents.map(({ systemPrompt: _prompt, ...rest }) => ({
            ...rest,
            parentAgentId: item.parentAgentId
          }))
        )
      })
    ),
    models
  });
}

export function readActiveMembers(
  snapshot: AgentTeamCatalogSnapshot,
  raw: AgentTeamMembersReadInput
) {
  const input = AgentTeamMembersReadInputSchema.parse(raw);
  const team = requireTeam(snapshot, input.scope, input.teamId);
  return AgentTeamMembersReadResultSchema.parse({
    teamId: team.id,
    teamName: team.name,
    revision: activeTeamRevision(team),
    members: input.members.map((target) => ({
      ...member(team.settings, target.parentAgentId, target.memberId),
      parentAgentId: target.parentAgentId
    }))
  });
}

function replacePrompt(
  prompt: string,
  replacements: readonly { originalText: string; newText: string }[]
): string {
  let next = prompt;
  for (const [index, { originalText, newText }] of replacements.entries()) {
    const first = next.indexOf(originalText);
    if (first < 0)
      throw new Error(`提示词中没有找到第 ${index + 1} 个原文片段。`);
    if (next.indexOf(originalText, first + originalText.length) >= 0)
      throw new Error(
        `第 ${index + 1} 个原文片段出现多次，请提供更长且唯一的上下文。`
      );
    next = `${next.slice(0, first)}${newText}${next.slice(first + originalText.length)}`;
  }
  return next;
}

function freeMemberId(settings: Settings, wanted?: string): string {
  const used = new Set(
    settings.teams.flatMap((item) =>
      item.subagents.map((sub) => sub.id.toLowerCase())
    )
  );
  if (wanted) {
    if (used.has(wanted.toLowerCase()))
      throw new Error(`成员 id ${wanted} 已存在。`);
    return wanted;
  }
  let index = 1;
  while (used.has(`member-${index}`)) index += 1;
  return `member-${index}`;
}

function apply(
  settings: Settings,
  operation: AgentTeamChangeOperation
): [string, string] | undefined {
  if (operation.action === "set-parallel") {
    settings.parallelSubagents = operation.enabled;
    return undefined;
  }
  if (operation.action === "remove-member") {
    const list = group(settings, operation.parentAgentId).subagents;
    list.splice(
      list.indexOf(
        member(settings, operation.parentAgentId, operation.memberId)
      ),
      1
    );
    return [operation.parentAgentId, operation.memberId];
  }
  if (operation.action === "add-member") {
    const id = freeMemberId(settings, operation.member.id);
    group(settings, operation.parentAgentId).subagents.push({
      enabled: true,
      agentMode: "standard",
      modelMode: "inherit",
      ...operation.member,
      id
    } as ShortAgentSubagentDefinition);
    return [operation.parentAgentId, id];
  }
  if (operation.systemPrompt && operation.promptReplacements)
    throw new Error("systemPrompt 与 promptReplacements 只能二选一。");
  const target = member(settings, operation.parentAgentId, operation.memberId);
  Object.assign(target, operation.set ?? {});
  if (operation.systemPrompt) target.systemPrompt = operation.systemPrompt;
  if (operation.promptReplacements)
    target.systemPrompt = replacePrompt(
      target.systemPrompt,
      operation.promptReplacements
    );
  return [operation.parentAgentId, operation.memberId];
}

function validated(
  team: AgentTeamProfile,
  settings: Settings,
  models: readonly AgentTeamModelChoice[]
): Settings {
  const result = AgentTeamProfileSchema.safeParse({ ...team, settings });
  if (!result.success) {
    const issue = result.error.issues[0]!;
    throw new Error(
      `团队设置无效（${issue.path.join(".")}）：${issue.message}`
    );
  }
  const validateModel = (
    config: Pick<
      ShortAgentSubagentDefinition,
      "modelMode" | "modelId" | "thinkingLevel" | "temperature"
    >,
    kind: "llm" | "jev"
  ) => {
    if (kind === "llm" && config.modelMode !== "custom") return;
    const model = models.find(
      (item) => item.id === config.modelId && item.kind === kind
    );
    if (!model)
      throw new Error(
        `模型 ${config.modelId} 不在可用的 ${kind} 模型列表中，请重新选择。`
      );
    if (
      kind === "llm" &&
      config.thinkingLevel !== "off" &&
      !model.thinkingLevelOptions.includes(config.thinkingLevel ?? "")
    )
      throw new Error("所选模型不支持该思考等级。");
    if (
      kind === "llm" &&
      config.thinkingLevel === "off" &&
      (config.temperature === undefined ||
        !model.temperatureOptions.includes(config.temperature))
    )
      throw new Error("请使用所选模型支持的温度。");
  };
  for (const item of result.data.settings.teams)
    for (const sub of item.subagents) {
      const previous = team.settings.teams
        .find((group) => group.parentAgentId === item.parentAgentId)
        ?.subagents.find((member) => member.id === sub.id);
      const modelFields = (value: ShortAgentSubagentDefinition | undefined) =>
        value && [
          value.modelMode,
          value.modelId,
          value.thinkingLevel,
          value.temperature
        ];
      if (
        JSON.stringify(modelFields(previous)) !==
        JSON.stringify(modelFields(sub))
      )
        validateModel(sub, "llm");
      if (
        sub.draw?.evaluator &&
        JSON.stringify(previous?.draw?.evaluator) !==
          JSON.stringify(sub.draw.evaluator)
      )
        validateModel(
          sub.draw.evaluator,
          sub.draw.evaluator.evaluationMethod === "jev" ? "jev" : "llm"
        );
    }
  return result.data.settings;
}

export function previewActiveTeamChange(
  snapshot: AgentTeamCatalogSnapshot,
  raw: AgentTeamChangePreviewInput,
  models: AgentTeamModelChoice[]
): AgentTeamChangeReview {
  const input = AgentTeamChangePreviewInputSchema.parse(raw);
  const team = requireTeam(snapshot, input.scope, input.teamId);
  if (team.isBuiltin || isBuiltinAgentTeamId(team.id))
    throw new Error(
      "内置智能体团队为只读，不能直接修改，请先复制团队后再调整。"
    );
  if (activeTeamRevision(team) !== input.baseRevision)
    throw new Error("团队设置已变化，请重新读取后再生成审阅。");
  const draft = structuredClone(team.settings);
  const touched: [string, string][] = [];
  for (const operation of input.operations) {
    const key = apply(draft, operation);
    if (key && !touched.some(([p, m]) => p === key[0] && m === key[1]))
      touched.push(key);
  }
  const next = validated(team, draft, models);
  const find = (
    settings: Settings,
    [parentAgentId, memberId]: [string, string]
  ) =>
    settings.teams
      .find((item) => item.parentAgentId === parentAgentId)
      ?.subagents.find((item) => item.id === memberId);
  const members = touched.flatMap((key) => {
    const before = find(team.settings, key);
    const after = find(next, key);
    if (JSON.stringify(before) === JSON.stringify(after)) return [];
    return [
      {
        parentAgentId: key[0],
        memberId: key[1],
        ...(before ? { before } : {}),
        ...(after ? { after } : {})
      }
    ];
  });
  const parallel = team.settings.parallelSubagents !== next.parallelSubagents;
  if (!members.length && !parallel)
    throw new Error("团队设置没有变化，未生成审阅。");
  const bookType = input.scope.bookType;
  return AgentTeamChangeReviewSchema.parse({
    scope: input.scope,
    teamId: team.id,
    baseRevision: activeTeamRevision(team),
    summary: raw.summary,
    ...(parallel
      ? {
          parallelSubagents: {
            before: team.settings.parallelSubagents,
            after: next.parallelSubagents
          }
        }
      : {}),
    members,
    teamName: team.name,
    boundBookCount: agentTeamBoundBookCount(snapshot.bookBindings, team.id),
    enabledAsDefault: snapshot.enabledTeamIds[bookType] === team.id
  });
}

/** Called inside the store's write queue, with freshly read device bindings. */
export function applyActiveTeamChange(
  snapshot: AgentTeamCatalogSnapshot,
  bindings: AgentTeamBookBindings,
  raw: AgentTeamChange,
  models: readonly AgentTeamModelChoice[]
): void {
  const change = AgentTeamChangeSchema.parse(raw);
  const team = requireTeam(
    { ...snapshot, bookBindings: bindings },
    change.scope,
    change.teamId
  );
  if (team.isBuiltin || isBuiltinAgentTeamId(team.id))
    throw new Error(
      "内置智能体团队为只读，不能直接修改，请先复制团队后再调整。"
    );
  if (activeTeamRevision(team) !== change.baseRevision)
    throw new Error(
      "团队设置已被其他操作修改，请重新读取并审阅，当前修改未保存。"
    );
  const draft = structuredClone(team.settings);
  if (change.parallelSubagents)
    draft.parallelSubagents = change.parallelSubagents.after;
  for (const item of change.members) {
    const list = group(draft, item.parentAgentId).subagents;
    const index = list.findIndex((sub) => sub.id === item.memberId);
    if (item.before && index < 0) throw new Error("审阅中的成员已不存在。");
    if (!item.before && index >= 0)
      throw new Error("审阅中新增的成员 id 已被占用。");
    if (item.after) {
      if (index >= 0) list[index] = item.after;
      else list.push(item.after);
    } else list.splice(index, 1);
  }
  team.settings = validated(team, draft, models);
}
