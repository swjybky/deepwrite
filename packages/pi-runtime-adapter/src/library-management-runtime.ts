import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  BUILTIN_SUBAGENT_IDS,
  BUILTIN_SUBAGENT_NAMES,
  LIBRARY_MANAGEMENT_INVOCATION_POLICY,
  CommandEnvelopeSchema,
  LibraryManagementQueryResultSchema,
  createEnvelope,
  type CommandEnvelope,
  type CommandResult,
  type LibraryAgentWorkspaceSnapshot
} from "@deepwrite/contracts";
import { buildLibraryAgentTools } from "./library-agent-tools";
import { reconcileLibraryToolState } from "./library-management-state";
import {
  buildEffectiveSystemPrompt,
  buildDeepWriteSystemPrompt
} from "./prompts-system";
import type { AgentRunInput } from "./runtime-types";
import type { RuntimeSubagentDefinition } from "./subagent-types";
import type { LibraryAgentToolSharedState } from "./library-agent-tools/types";

export type LibraryManagementCommandExecutor = (
  command: Extract<CommandEnvelope, { type: "catalog.queryLibraryManagement" }>,
  signal?: AbortSignal
) => Promise<CommandResult>;

export function libraryManagementParentPrompt(input: AgentRunInput): string {
  const context = input.libraryManagement;
  if (!context) return "";
  return [
    "【内置资料库管理子智能体】",
    LIBRARY_MANAGEMENT_INVOCATION_POLICY,
    "管理范围是整本作品绑定的资料库；一次调用只管理一个目标库，使用 library_id 指定。编辑用条目所属库；只有一个可写候选的新建任务可直接使用，否则必须先确定目标库。管理子智能体返回的待澄清事项应由你使用 ask_user_question 询问后再委派。",
    "已绑定的候选库（只读库不能写入，未绑定的库不可管理）：",
    ...context.libraries.map(
      (library) =>
        `- ${library.domain} / ${library.libraryId}：${library.title}${library.readOnly ? "（只读）" : ""}`
    ),
    ...(context.libraries.length
      ? []
      : ["当前没有已绑定的资料库，请告知用户先绑定目标库。"])
  ].join("\n");
}

export function createLibraryManagementRuntime(input: AgentRunInput) {
  const context = input.libraryManagement;
  const states = new Map<
    string,
    {
      workspace: LibraryAgentWorkspaceSnapshot;
      state: LibraryAgentToolSharedState;
    }
  >();
  const definitions: RuntimeSubagentDefinition[] = (
    context?.managers ?? []
  ).map((manager) => ({
    id: BUILTIN_SUBAGENT_IDS[manager.domain],
    name: BUILTIN_SUBAGENT_NAMES[manager.domain],
    description: manager.description,
    systemPrompt: manager.profile.systemPrompt,
    enabled: true,
    modelMode: "inherit",
    contextMode: "parent-snapshot",
    toolSource: "library-management"
  }));
  const prepareChild = async (
    definition: RuntimeSubagentDefinition,
    libraryId: string | undefined,
    signal?: AbortSignal
  ) => {
    const manager = context?.managers.find(
      (item) => BUILTIN_SUBAGENT_IDS[item.domain] === definition.id
    );
    if (!context || !manager || !input.libraryManagementCommandExecutor)
      throw new Error("资料库管理子智能体未启用或运行通道不可用。");
    if (!libraryId)
      throw new Error(
        "请先确定目标资料库并传入 library_id；不明确时由主智能体询问用户。"
      );
    if (
      !context.libraries.some(
        (item) =>
          item.domain === manager.domain &&
          item.libraryId === libraryId &&
          !item.readOnly
      )
    )
      throw new Error("目标资料库不在本轮绑定的可写范围内。");
    const command = CommandEnvelopeSchema.parse(
      createEnvelope(
        "catalog.queryLibraryManagement",
        { scope: context.scope, domain: manager.domain, libraryId },
        {
          id: `library-management:${input.runId}:${libraryId}`,
          context: {
            sessionId: input.sessionId,
            runId: input.runId,
            resourceId: context.scope.bookId
          }
        }
      )
    ) as Extract<CommandEnvelope, { type: "catalog.queryLibraryManagement" }>;
    const result = await input.libraryManagementCommandExecutor(
      command,
      signal
    );
    if (result.status !== "accepted") throw new Error(result.error.message);
    const workspace = LibraryManagementQueryResultSchema.parse(
      result.payload
    ).workspace;
    if (
      !workspace ||
      workspace.domain !== manager.domain ||
      workspace.libraryId !== libraryId ||
      workspace.readOnly
    )
      throw new Error("目标资料库已不可写。");
    const attachedSkills = manager.profile.readAccess.skills.map((skill) => ({
      id: skill.id,
      title: skill.name,
      content: skill.content,
      kind: "general" as const,
      source: "attached-skill" as const
    }));
    const prior = states.get(libraryId);
    const state = reconcileLibraryToolState(workspace, prior);
    states.set(libraryId, { workspace, state });
    const tools: AgentTool[] = buildLibraryAgentTools({
      workspace,
      profile: manager.profile,
      attachedSkills,
      sharedState: state,
      writeApprovalMode: input.writeApprovalMode ?? "request-approval"
    });
    const systemPrompt = [
      buildEffectiveSystemPrompt(buildDeepWriteSystemPrompt(), {
        ...input,
        mode: "workspace",
        libraryAgentProfile: manager.profile,
        workspaceContext: { libraryWorkspace: workspace, attachedSkills },
        webSearchEnabled: false
      }),
      LIBRARY_MANAGEMENT_INVOCATION_POLICY,
      "你是受委派的管理子智能体，当前目标库已经由主智能体确定。只能管理上述目标库。若仍缺少影响正确执行的关键信息，返回待澄清事项，由主智能体询问用户；不要猜测或越权写入。",
      `当前目标库：${workspace.title} / ${workspace.libraryId}；库介绍：${workspace.overview}`
    ].join("\n\n");
    return { tools, systemPrompt };
  };
  return { definitions, prepareChild };
}
