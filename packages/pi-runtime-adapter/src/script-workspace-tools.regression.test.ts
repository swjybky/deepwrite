import {
  DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES,
  createShortWorkspaceContentRevision,
  type ScriptWorkspaceSnapshot
} from "@deepwrite/contracts";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import {
  describe,
  expect,
  it,
  screenplayWorkspace,
  scriptAgentProfile
} from "./index.test-support";
import {
  buildScriptWorkspaceTools,
  createScriptWorkspaceToolSharedState
} from "./short-agent-tools";

function toolByName(tools: AgentTool[], name: string): AgentTool {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Missing tool: ${name}`);
  return tool;
}

function resultText(result: AgentToolResult<unknown>): string {
  return result.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

describe("script workspace tool regression", () => {
  it("uses the unified five tools in every script stage", () => {
    const { activeSectionId: _activeSectionId, ...draftWorkspace } =
      screenplayWorkspace();
    const plotWorkspace = {
      ...draftWorkspace,
      activeStageId: "plot_design",
      activeAgentId: "script"
    } satisfies ScriptWorkspaceSnapshot;
    const plotProfile = DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES[0]!;

    const plotTools = buildScriptWorkspaceTools({
      workspace: plotWorkspace,
      profile: plotProfile
    });
    expect(plotTools.map(({ name }) => name)).toEqual([
      "read",
      "create",
      "edit",
      "write",
      "delete",
      "query_linked_material_entries",
      "load_skill"
    ]);

    const draftTools = buildScriptWorkspaceTools({
      workspace: screenplayWorkspace(),
      profile: scriptAgentProfile()
    });
    expect(draftTools.map(({ name }) => name)).toEqual(
      plotTools.map(({ name }) => name)
    );
    expect(
      draftTools.find(({ name }) => name === "write")?.description
    ).toContain("剧本正文必须遵守");
    expect(draftTools.map(({ name }) => name)).not.toContain(
      "delete_draft_section"
    );
    expect(toolByName(draftTools, "delete").description).toContain(
      "正文至少保留一个剧集"
    );
  });

  it("uses script-aware deletion semantics for all three writing phases", async () => {
    const workspace = screenplayWorkspace();
    const characterStage = workspace.stages.find(
      ({ stageId }) => stageId === "character_design"
    )!;
    characterStage.content = "人物总稿";
    characterStage.revision = createShortWorkspaceContentRevision(
      characterStage.content
    );
    const plotStage = workspace.stages.find(
      ({ stageId }) => stageId === "plot_design"
    )!;
    plotStage.content = "剧情正文";
    plotStage.revision = createShortWorkspaceContentRevision(plotStage.content);
    const secondBody = "2. 外景 码头 - 黎明\n△雾散开。";
    workspace.expertDraft.sections.push({
      id: "episode-2",
      title: "第二集",
      wordCountRequirement: "15 分钟",
      body: {
        documentId: "draft:episode-2:body",
        title: "第二集",
        content: secondBody,
        revision: createShortWorkspaceContentRevision(secondBody)
      },
      characterState: {
        documentId: "draft:episode-2:state",
        title: "第二集 · 人物状态",
        content: "主角抵达码头。",
        revision: createShortWorkspaceContentRevision("主角抵达码头。")
      }
    });
    const sharedState = createScriptWorkspaceToolSharedState(workspace);
    const tools = buildScriptWorkspaceTools({
      workspace,
      profile: scriptAgentProfile(),
      sharedState,
      autoApproveCrossStageOperations: true
    });
    const remove = toolByName(tools, "delete");

    expect(
      (
        await remove.execute("clear-script-characters", {
          kind: "character_overview",
          id: "character_design"
        })
      ).details
    ).toMatchObject({
      kind: "workspace-editor-mutation",
      stageId: "character_design",
      text: ""
    });
    expect(
      (
        await remove.execute("clear-script-plot", {
          kind: "plot_stage",
          id: "plot_design"
        })
      ).details
    ).toMatchObject({
      kind: "workspace-editor-mutation",
      stageId: "plot_design",
      text: ""
    });
    const deletedEpisode = await remove.execute("delete-script-episode", {
      kind: "draft_section",
      id: "episode-2"
    });
    expect(deletedEpisode.details).toMatchObject({
      kind: "workspace-expert-draft-section-deletion",
      sectionId: "episode-2",
      title: "第二集"
    });
    expect(resultText(deletedEpisode)).toContain("删除剧集《第二集》");
    expect(sharedState.expertSections.has("episode-2")).toBe(false);

    const finalEpisode = await remove.execute("delete-final-script-episode", {
      kind: "draft_section",
      id: "episode-1"
    });
    expect(resultText(finalEpisode)).toContain("至少需要保留一个剧集");
  });

  it("requires complete reads and explicit consent before overwriting a script body", async () => {
    const workspace = screenplayWorkspace();
    const body = workspace.expertDraft.sections[0]!.body;
    body.content = "1. 内景 客厅 - 夜\n△灯忽然熄灭。";
    body.revision = createShortWorkspaceContentRevision(body.content);
    const tools = buildScriptWorkspaceTools({
      workspace,
      profile: scriptAgentProfile()
    });
    const write = toolByName(tools, "write");
    const request = {
      kind: "draft_section",
      id: "episode-1",
      document: "body",
      content: "1. 内景 客厅 - 夜\n△应急灯亮起。",
      summary: "重写第一集。"
    };
    expect(resultText(await write.execute("blocked", request))).toContain(
      "请先用 read 完整读取"
    );
    await toolByName(tools, "read").execute("read", {
      kind: "draft_section",
      id: "episode-1",
      document: "body"
    });
    expect(resultText(await write.execute("no-consent", request))).toContain(
      "allow_overwrite_existing=true"
    );
    expect(
      (
        await write.execute("accepted", {
          ...request,
          allow_overwrite_existing: true
        })
      ).details
    ).toMatchObject({
      kind: "workspace-expert-draft-file-mutation",
      sectionId: "episode-1",
      fileKind: "body"
    });
  });

  it("shares same-run proposals while isolating child read credentials", async () => {
    const workspace = screenplayWorkspace();
    const sharedState = createScriptWorkspaceToolSharedState(workspace);
    const parentTools = buildScriptWorkspaceTools({
      workspace,
      profile: scriptAgentProfile(),
      sharedState
    });
    const created = await toolByName(parentTools, "create").execute("create", {
      kind: "draft_section",
      meta: { title: "第二集" },
      summary: "创建第二集。"
    });
    const sectionId = resultText(created).match(/section_id=(.+)/u)?.[1];
    expect(sectionId).toMatch(/^pending:section:/u);
    const childTools = buildScriptWorkspaceTools({
      workspace,
      profile: scriptAgentProfile(),
      sharedState
    });
    expect(
      (
        await toolByName(childTools, "write").execute("write-created", {
          kind: "draft_section",
          id: sectionId!,
          document: "body",
          content: "1. 外景 码头 - 黎明\n△雾散开。",
          summary: "写入第二集。"
        })
      ).details
    ).toMatchObject({ sectionId });

    const existingBody = workspace.expertDraft.sections[0]!.body;
    existingBody.content = "旧正文";
    existingBody.revision = createShortWorkspaceContentRevision("旧正文");
    const isolatedState = createScriptWorkspaceToolSharedState(workspace);
    const reader = buildScriptWorkspaceTools({
      workspace,
      profile: scriptAgentProfile(),
      sharedState: isolatedState
    });
    await toolByName(reader, "read").execute("read-existing", {
      kind: "draft_section",
      id: "episode-1",
      document: "body"
    });
    const isolatedWriter = buildScriptWorkspaceTools({
      workspace,
      profile: scriptAgentProfile(),
      sharedState: isolatedState
    });
    expect(
      resultText(
        await toolByName(isolatedWriter, "write").execute("isolated", {
          kind: "draft_section",
          id: "episode-1",
          document: "body",
          content: "新正文",
          allow_overwrite_existing: true,
          summary: "重写第一集。"
        })
      )
    ).toContain("请先用 read 完整读取");
  });
});
