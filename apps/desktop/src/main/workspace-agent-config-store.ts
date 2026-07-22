import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES,
  SHORT_WORKSPACE_AGENT_IDS,
  ShortWorkspaceAgentSettingsInputSchema,
  ShortWorkspaceAgentSettingsSchema,
  ShortWorkspaceSnapshotSchema,
  resolveShortWorkspaceAgentIdForStage,
  type ShortAgentReadAccess,
  type ShortWorkspaceAgentId,
  type ShortWorkspaceAgentProfile,
  type ShortWorkspaceAgentSettings,
  type ShortWorkspaceAgentSettingsInput,
  type ShortWorkspaceSnapshot,
  type ShortWorkspaceStageId
} from "@deepwrite/contracts";

interface DiskWorkspaceAgentSettings {
  version: 1;
  workspaceType: "short";
  agents: ShortWorkspaceAgentSettingsInput["agents"];
}

// Keep this byte-for-byte copy of the retired builtin prompt so an existing
// default config can move to the file-based draft architecture without
// overwriting prompts the user actually customized.
export const RETIRED_SHORT_EXPERT_DRAFT_COORDINATOR_SYSTEM_PROMPT_V1 = `你是 DeepWrite 的短篇正文专家编写智能体，负责正文结构管理、分节任务调度和成稿后的处理。主要正文由分节写手完成，你不要在聊天中直接代写整章。

你负责四类任务：
1. 初始化：读取 outline，根据完整大纲调用 initialize_expert_draft，一次性创建导语、全部正文小节及一一对应的人物状态槽位。
2. 全部写作：用户明确要求“开始写正文”“自动写全部小节”或同义指令时，如果尚未完整初始化，先读取大纲并初始化，然后在同一轮调用 start_expert_writing，不要再要求用户二次确认。短篇默认跳过导语；用户明确要求写导语时才把 intro 加入 section_ids。
3. 单节写作：用户指定一个已初始化小节时，调用 write_single_expert_section；目标不存在则先按大纲初始化完整结构。
4. 后处理：正文审阅、润色、去 AI 味、格式整理、章节名修改和局部修订，都在当前智能体内完成。

初始化规则：
- 初始化前必须读取 outline；大纲为空且用户没有明确授权你从零规划时，说明无法可靠初始化并引导用户先完成大纲。
- 小节标题、顺序和数量必须与大纲一致。
- 把大纲中的预估字数或字数规划填入 word_count_requirement。
- 正文列表与人物状态列表必须一一对应。
- 已有正文只做结构补全或改名时，不要清空已有小节正文。

启动规则：
- 用户提出的文风、情绪、节奏、爽点、人设表达或平台要求，必须整理进 user_writing_prompt。
- start_expert_writing 和 write_single_expert_section 都是异步工具；调用成功后直接告知已经启动，不等待后台全部完成。
- 局部修改已有正文时不得重新启动分节写作，除非用户明确要求重写该小节。

后处理规则：
- 先调用 read_workspace_content（stage_id=draft）读取当前合并正文。
- 使用 edit_expert_draft_section 按原文片段修改章节名或正文；不要用初始化工具处理局部修改。
- 总控不修改人物状态，不调用普通阶段写入工具，也不要求用户复制粘贴。
- 需要技能时调用 load_skill；只有当前读取范围允许素材且确有必要时，才查询关联素材。
`;

const REQUIRED_WORKSPACE_STAGES: Record<
  ShortWorkspaceAgentId,
  readonly ShortWorkspaceStageId[]
> = {
  character_design: ["character_design"],
  plot_design: ["plot_design", "intro_design", "plot_refine"],
  outline: ["outline"],
  expert_draft_coordinator: ["draft"],
  expert_section_writer: ["draft"]
};

function cloneReadAccess(value: ShortAgentReadAccess): ShortAgentReadAccess {
  return {
    workspace: [...value.workspace],
    material: [...value.material],
    skill: [...value.skill]
  };
}

function cloneProfile(profile: ShortWorkspaceAgentProfile): ShortWorkspaceAgentProfile {
  return {
    ...profile,
    readAccess: cloneReadAccess(profile.readAccess)
  };
}

function defaultProfile(agentId: ShortWorkspaceAgentId): ShortWorkspaceAgentProfile {
  const profile = DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES.find(
    (candidate) => candidate.id === agentId
  );
  if (!profile) {
    throw new Error(`Missing builtin short workspace profile: ${agentId}`);
  }
  return cloneProfile(profile);
}

function normalizeReadAccess(
  agentId: ShortWorkspaceAgentId,
  access: ShortAgentReadAccess
): ShortAgentReadAccess {
  const workspace = [...access.workspace];
  for (const required of REQUIRED_WORKSPACE_STAGES[agentId]) {
    if (!workspace.includes(required)) {
      workspace.push(required);
    }
  }
  return { workspace, material: [...access.material], skill: [...access.skill] };
}

function defaultsAsInput(): ShortWorkspaceAgentSettingsInput {
  return {
    workspaceType: "short",
    agents: DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES.map((profile) => ({
      id: profile.id,
      systemPrompt: profile.systemPrompt,
      readAccess: cloneReadAccess(profile.readAccess)
    }))
  };
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  await rename(temporary, path);
}

function normalizeDiskSettings(raw: unknown): ShortWorkspaceAgentSettingsInput {
  if (!raw || typeof raw !== "object") {
    return defaultsAsInput();
  }
  const candidate = raw as Record<string, unknown>;
  const parsed = ShortWorkspaceAgentSettingsInputSchema.safeParse({
    workspaceType: candidate.workspaceType,
    agents: candidate.agents
  });
  if (!parsed.success) {
    return defaultsAsInput();
  }
  return {
    workspaceType: "short",
    agents: parsed.data.agents.map((agent) => ({
      ...agent,
      systemPrompt:
        agent.id === "expert_draft_coordinator" &&
        agent.systemPrompt ===
          RETIRED_SHORT_EXPERT_DRAFT_COORDINATOR_SYSTEM_PROMPT_V1
          ? defaultProfile(agent.id).systemPrompt
          : agent.systemPrompt,
      readAccess: normalizeReadAccess(agent.id, agent.readAccess)
    }))
  };
}

export class WorkspaceAgentConfigStore {
  private readonly settingsPath: string;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(userDataPath: string) {
    this.settingsPath = join(userDataPath, "config", "workspace-agents.json");
  }

  async list(): Promise<ShortWorkspaceAgentSettings> {
    await this.writeChain;
    return this.toPublicSettings(await this.readInput());
  }

  async save(
    rawInput: ShortWorkspaceAgentSettingsInput
  ): Promise<ShortWorkspaceAgentSettings> {
    const input = ShortWorkspaceAgentSettingsInputSchema.parse(rawInput);
    let saved: ShortWorkspaceAgentSettings | undefined;
    const operation = this.writeChain.then(async () => {
      const normalized: ShortWorkspaceAgentSettingsInput = {
        workspaceType: "short",
        agents: input.agents.map((agent) => ({
          ...agent,
          readAccess: normalizeReadAccess(agent.id, agent.readAccess)
        }))
      };
      await this.writeInput(normalized);
      saved = this.toPublicSettings(normalized);
    });
    this.writeChain = operation.then(
      () => undefined,
      () => undefined
    );
    await operation;
    return saved!;
  }

  async reset(agentId?: ShortWorkspaceAgentId): Promise<ShortWorkspaceAgentSettings> {
    let saved: ShortWorkspaceAgentSettings | undefined;
    const operation = this.writeChain.then(async () => {
      const next = agentId ? await this.readInput() : defaultsAsInput();
      if (agentId) {
        const builtin = defaultProfile(agentId);
        const index = next.agents.findIndex((agent) => agent.id === agentId);
        const replacement = {
          id: builtin.id,
          systemPrompt: builtin.systemPrompt,
          readAccess: cloneReadAccess(builtin.readAccess)
        };
        if (index >= 0) {
          next.agents[index] = replacement;
        } else {
          next.agents.push(replacement);
        }
      }
      const validated = ShortWorkspaceAgentSettingsInputSchema.parse(next);
      await this.writeInput(validated);
      saved = this.toPublicSettings(validated);
    });
    this.writeChain = operation.then(
      () => undefined,
      () => undefined
    );
    await operation;
    return saved!;
  }

  async resolveForStage(
    stageId: ShortWorkspaceStageId
  ): Promise<ShortWorkspaceAgentProfile> {
    return await this.resolve(resolveShortWorkspaceAgentIdForStage(stageId));
  }

  async resolveForWorkspace(
    rawWorkspace: ShortWorkspaceSnapshot
  ): Promise<ShortWorkspaceAgentProfile> {
    const workspace = ShortWorkspaceSnapshotSchema.parse(rawWorkspace);
    return await this.resolve(
      workspace.activeAgentId ??
        resolveShortWorkspaceAgentIdForStage(workspace.activeStageId)
    );
  }

  async resolve(agentId: ShortWorkspaceAgentId): Promise<ShortWorkspaceAgentProfile> {
    const settings = await this.list();
    const profile = settings.agents.find((candidate) => candidate.id === agentId);
    if (!profile) {
      return defaultProfile(agentId);
    }
    return cloneProfile(profile);
  }

  private async readInput(): Promise<ShortWorkspaceAgentSettingsInput> {
    return normalizeDiskSettings(await readJson(this.settingsPath));
  }

  private async writeInput(input: ShortWorkspaceAgentSettingsInput): Promise<void> {
    const disk: DiskWorkspaceAgentSettings = {
      version: 1,
      workspaceType: "short",
      agents: input.agents
    };
    await atomicWriteJson(this.settingsPath, disk);
  }

  private toPublicSettings(
    input: ShortWorkspaceAgentSettingsInput
  ): ShortWorkspaceAgentSettings {
    const byId = new Map(input.agents.map((agent) => [agent.id, agent]));
    return ShortWorkspaceAgentSettingsSchema.parse({
      workspaceType: "short",
      agents: SHORT_WORKSPACE_AGENT_IDS.map((agentId) => {
        const builtin = defaultProfile(agentId);
        const override = byId.get(agentId);
        return {
          ...builtin,
          ...(override ? { systemPrompt: override.systemPrompt } : {}),
          readAccess: normalizeReadAccess(
            agentId,
            override?.readAccess ?? builtin.readAccess
          )
        };
      })
    });
  }
}
