import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import {
  DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES,
  SHORT_WORKSPACE_TEXT_STAGE_IDS,
  createShortWorkspaceContentRevision,
  type ShortWorkspaceAgentId,
  type ShortWorkspaceAgentProfile,
  type ShortWorkspaceSnapshot
} from "@deepwrite/contracts";
import { describe, expect, it } from "vitest";
import {
  buildShortWorkspaceTools,
  createShortWorkspaceToolSharedState,
  SHORT_WORKSPACE_TOOL_MANIFEST,
  type ShortWorkspaceToolDetails
} from "./short-agent-tools";

function profile(agentId: ShortWorkspaceAgentId): ShortWorkspaceAgentProfile {
  const value = DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES.find(
    (candidate) => candidate.id === agentId
  );
  if (!value) throw new Error(`Missing profile: ${agentId}`);
  return value;
}

function workspace(
  activeStageId: ShortWorkspaceSnapshot["activeStageId"] = "plot_design"
): ShortWorkspaceSnapshot {
  return {
    id: "short-tool-test",
    title: "雾港回声",
    categories: ["悬疑"],
    activeStageId,
    expertDraft: {
      id: "draft",
      title: "正文",
      revision: createShortWorkspaceContentRevision("draft-directory"),
      sections: [
        expertSection(
          "intro",
          "导语",
          "150 字",
          "雨夜名单出现了。",
          "林默尚未看清名单。"
        ),
        expertSection(
          "section-1",
          "第一节·迟到的汽笛",
          "1000 字",
          "汽笛迟到了七分钟。共同片段。",
          ""
        ),
        expertSection(
          "section-2",
          "第二节·暗房",
          "1200 字",
          "共同片段。暗房里显出了照片。",
          "苏遥拿着底片。"
        )
      ]
    },
    stages: SHORT_WORKSPACE_TEXT_STAGE_IDS.map((stageId) => ({
      stageId,
      title: stageId,
      content: stageId === "plot_design" ? "旧剧情的唯一片段。" : "",
      revision: createShortWorkspaceContentRevision(
        stageId === "plot_design" ? "旧剧情的唯一片段。" : ""
      )
    }))
  };
}

function expertSection(
  id: string,
  title: string,
  wordCountRequirement: string,
  body: string,
  characterState: string
) {
  return {
    id,
    title,
    wordCountRequirement,
    body: {
      documentId: `draft:${id}:body`,
      title: `${title}·正文`,
      content: body,
      revision: createShortWorkspaceContentRevision(body)
    },
    characterState: {
      documentId: `draft:${id}:state`,
      title: `${title}·人物状态`,
      content: characterState,
      revision: createShortWorkspaceContentRevision(characterState)
    }
  };
}

function toolByName(tools: AgentTool[], name: string): AgentTool {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Missing tool: ${name}`);
  return tool;
}

function sectionWriterWorkspace(): ShortWorkspaceSnapshot {
  const value = workspace("draft");
  return {
    ...value,
    activeAgentId: "expert_section_writer",
    activeSectionId: "section-1"
  };
}

function resultText(result: AgentToolResult<unknown>): string {
  return result.content
    .filter(
      (item): item is Extract<(typeof result.content)[number], { type: "text" }> =>
        item.type === "text"
    )
    .map((item) => item.text)
    .join("\n");
}

describe("short workspace tools", () => {
  it("assembles the reference standard tool set and the plot switch tool", () => {
    const characterNames = buildShortWorkspaceTools({
      workspace: workspace("character_design"),
      profile: profile("character_design")
    }).map((tool) => tool.name);
    const plotNames = buildShortWorkspaceTools({
      workspace: workspace(),
      profile: profile("plot_design")
    }).map((tool) => tool.name);

    expect(characterNames).toEqual(SHORT_WORKSPACE_TOOL_MANIFEST.standard);
    expect(plotNames).toEqual([
      ...SHORT_WORKSPACE_TOOL_MANIFEST.standard.slice(0, 4),
      "switch_storyline_stage",
      ...SHORT_WORKSPACE_TOOL_MANIFEST.standard.slice(4)
    ]);
  });

  it("switches the plot substage before applying an implicit write target", async () => {
    const tools = buildShortWorkspaceTools({
      workspace: workspace(),
      profile: profile("plot_design")
    });

    const selected = await toolByName(tools, "switch_storyline_stage").execute(
      "switch-1",
      { target_stage_id: "intro_design" }
    );
    const written = await toolByName(tools, "write_workspace_editor").execute(
      "write-1",
      { mode: "replace", text: "新的导语。" }
    );

    expect(selected.details).toMatchObject({
      kind: "workspace-stage-selection",
      stageId: "intro_design"
    });
    expect(written.details).toMatchObject({
      kind: "workspace-editor-mutation",
      stageId: "intro_design",
      text: "新的导语。"
    });
  });

  it("protects existing text unless a whole-stage overwrite is explicit", async () => {
    const tools = buildShortWorkspaceTools({
      workspace: workspace(),
      profile: profile("plot_design")
    });
    const write = toolByName(tools, "write_workspace_editor");

    const blocked = await write.execute("write-1", {
      target_stage_id: "plot_design",
      mode: "replace",
      text: "覆盖内容"
    });
    const allowed = await write.execute("write-2", {
      target_stage_id: "plot_design",
      mode: "replace",
      text: "覆盖内容",
      allow_overwrite_existing: true
    });

    expect(blocked.details).toEqual({ kind: "none" });
    expect(resultText(blocked)).toContain("已有内容");
    expect(allowed.details).toMatchObject({
      kind: "workspace-editor-mutation",
      stageId: "plot_design",
      text: "覆盖内容"
    });
  });

  it("describes automatic approval without claiming the text is already saved", async () => {
    const tools = buildShortWorkspaceTools({
      workspace: workspace(),
      profile: profile("plot_design"),
      writeApprovalMode: "auto-approve"
    });
    const write = toolByName(tools, "write_workspace_editor");

    const result = await write.execute("write-auto", {
      target_stage_id: "plot_design",
      mode: "replace",
      text: "自动写入内容",
      allow_overwrite_existing: true
    });

    expect(resultText(result)).toContain("将在本轮完成后自动批准并保存");
    expect(resultText(result)).not.toContain("已经保存");
  });

  it("requires a unique original fragment for local replacement", async () => {
    const tools = buildShortWorkspaceTools({
      workspace: workspace(),
      profile: profile("plot_design")
    });
    const replace = toolByName(tools, "replace_current_stage_text");

    const missing = await replace.execute("replace-1", {
      target_stage_id: "plot_design",
      replacements: [{ original_text: "不存在", new_text: "新文本" }]
    });
    const replaced = await replace.execute("replace-2", {
      target_stage_id: "plot_design",
      replacements: [{ original_text: "唯一片段", new_text: "新片段" }]
    });

    expect(missing.details).toEqual({ kind: "none" });
    expect(resultText(missing)).toContain("没有找到原文片段");
    expect(replaced.details).toMatchObject({
      kind: "workspace-editor-mutation",
      text: "旧剧情的新片段。"
    });
  });

  it("shares the mutation overlay without sharing per-agent read evidence", async () => {
    const snapshot = workspace("draft");
    const sharedState = createShortWorkspaceToolSharedState(snapshot);
    const parentTools = buildShortWorkspaceTools({
      workspace: snapshot,
      profile: profile("expert_draft_coordinator"),
      sharedState
    });
    const childTools = buildShortWorkspaceTools({
      workspace: snapshot,
      profile: profile("expert_draft_coordinator"),
      sharedState
    });

    await toolByName(childTools, "read_expert_draft_section").execute(
      "child-read",
      { section_id: "section-1" }
    );
    const childWrite = await toolByName(
      childTools,
      "replace_expert_draft_section_text"
    ).execute("child-write", {
      section_id: "section-1",
      original_text: "迟到了七分钟",
      new_text: "提前了三分钟"
    });
    expect(childWrite.details).toMatchObject({
      kind: "workspace-expert-draft-file-mutation",
      text: "汽笛提前了三分钟。共同片段。"
    });

    const blockedParentWrite = await toolByName(
      parentTools,
      "replace_expert_draft_section_text"
    ).execute("parent-write", {
      section_id: "section-1",
      original_text: "共同片段",
      new_text: "独有片段"
    });
    expect(blockedParentWrite.details).toEqual({ kind: "none" });
    expect(resultText(blockedParentWrite)).toContain("请先读取");

    const parentRead = await toolByName(
      parentTools,
      "read_expert_draft_section"
    ).execute("parent-read", { section_id: "section-1" });
    expect(resultText(parentRead)).toContain("汽笛提前了三分钟");
  });

  it("refuses local replacement when the stage snapshot is truncated", async () => {
    const truncated = workspace();
    truncated.stages = truncated.stages.map((stage) =>
      stage.stageId === "plot_design"
        ? { ...stage, truncated: true, originalLength: stage.content.length + 20_000 }
        : stage
    );
    const replace = toolByName(
      buildShortWorkspaceTools({
        workspace: truncated,
        profile: profile("plot_design")
      }),
      "replace_current_stage_text"
    );
    const write = toolByName(
      buildShortWorkspaceTools({
        workspace: truncated,
        profile: profile("plot_design")
      }),
      "write_workspace_editor"
    );

    const result = await replace.execute("replace-truncated", {
      target_stage_id: "plot_design",
      replacements: [{ original_text: "唯一片段", new_text: "新片段" }]
    });

    expect(result.details).toEqual({ kind: "none" });
    expect(resultText(result)).toContain("超过本轮安全快照上限");

    const writeResult = await write.execute("write-truncated", {
      target_stage_id: "plot_design",
      mode: "replace",
      text: "整体重写",
      allow_overwrite_existing: true
    });
    expect(writeResult.details).toEqual({ kind: "none" });
    expect(resultText(writeResult)).toContain("超过本轮安全快照上限");
  });

  it("projects the draft route as a physical file index", async () => {
    const tools = buildShortWorkspaceTools({
      workspace: workspace("draft"),
      profile: profile("expert_draft_coordinator")
    });

    const result = await toolByName(tools, "read_workspace_content").execute(
      "read-draft-index",
      { stage_id: "draft" }
    );

    expect(resultText(result)).toContain("正文目录");
    expect(resultText(result)).toContain("draft:section-2:body");
    expect(resultText(result)).toContain("read_all_expert_draft");
    expect(resultText(result)).not.toContain("暗房里显出了照片");
  });

  it("shares create→write overlay across parent and child tool sets", async () => {
    const snapshot = workspace("draft");
    const sharedState = createShortWorkspaceToolSharedState(snapshot);
    const parentTools = buildShortWorkspaceTools({
      workspace: snapshot,
      profile: profile("expert_draft_coordinator"),
      sharedState
    });
    const childTools = buildShortWorkspaceTools({
      workspace: snapshot,
      profile: profile("expert_draft_coordinator"),
      sharedState
    });

    const created = await toolByName(parentTools, "create_expert_draft_sections").execute(
      "parent-create",
      { sections: [{ title: "第五节·尾声" }] }
    );
    const details = created.details as Extract<
      ShortWorkspaceToolDetails,
      { kind: "workspace-expert-draft-section-creation" }
    >;
    const sectionId = details.sections[0]!.provisionalSectionId;

    const written = await toolByName(childTools, "write_expert_draft_section").execute(
      "child-write",
      {
        section_id: sectionId,
        text: "尾声里只剩下潮水声。"
      }
    );
    expect(written.details).toMatchObject({
      kind: "workspace-expert-draft-file-mutation",
      sectionId,
      text: "尾声里只剩下潮水声。"
    });

    const readBack = await toolByName(parentTools, "read_expert_draft_section").execute(
      "parent-read",
      { section_id: sectionId }
    );
    expect(resultText(readBack)).toContain("尾声里只剩下潮水声。");
  });

  it("lets only the draft coordinator propose one batch of blank chapter files", async () => {
    const snapshot = workspace("draft");
    const coordinatorTools = buildShortWorkspaceTools({
      workspace: snapshot,
      profile: profile("expert_draft_coordinator")
    });
    const create = toolByName(
      coordinatorTools,
      "create_expert_draft_sections"
    );

    const result = await create.execute("create-sections", {
      sections: [
        { title: "第三节·钟楼", word_count_requirement: "1300 字" },
        { title: "第四节·回声" }
      ],
      after_section_id: "section-2"
    });

    expect(result.details).toMatchObject({
      kind: "workspace-expert-draft-section-creation",
      workspaceId: snapshot.id,
      stageId: "draft",
      sections: [
        {
          title: "第三节·钟楼",
          wordCountRequirement: "1300 字",
          provisionalSectionId: "pending:section:1"
        },
        {
          title: "第四节·回声",
          wordCountRequirement: "",
          provisionalSectionId: "pending:section:2"
        }
      ],
      afterSectionId: "section-2",
      baseRevision: snapshot.expertDraft.revision,
      summary: "已生成创建 2 个空白章节文件的变更，等待用户审阅。"
    });
    expect(resultText(result)).toContain("创建 2 个空白章节文件");
    expect(resultText(result)).toContain("section_id=pending:section:1");

    const directory = await toolByName(
      coordinatorTools,
      "read_workspace_content"
    ).execute("read-after-create", { stage_id: "draft" });
    expect(resultText(directory)).toContain("pending:section:1");
    expect(resultText(directory)).toContain("本轮待创建");

    const written = await toolByName(
      coordinatorTools,
      "write_expert_draft_section"
    ).execute("write-pending", {
      section_id: "pending:section:1",
      text: "钟楼的指针停在十三分。"
    });
    expect(written.details).toMatchObject({
      kind: "workspace-expert-draft-file-mutation",
      sectionId: "pending:section:1",
      fileKind: "body",
      text: "钟楼的指针停在十三分。"
    });

    const repeated = await create.execute("create-sections-again", {
      sections: [{ title: "第三节·钟楼" }]
    });
    expect(repeated.details).toEqual({ kind: "none" });
    expect(resultText(repeated)).toContain("同名章节");

    for (const agentId of [
      "character_design",
      "plot_design",
      "outline",
      "expert_section_writer"
    ] as const) {
      expect(
        buildShortWorkspaceTools({
          workspace: snapshot,
          profile: profile(agentId)
        }).map((tool) => tool.name)
      ).not.toContain("create_expert_draft_sections");
    }
  });

  it("does not expose untyped or out-of-scope attached material bodies", async () => {
    const tools = buildShortWorkspaceTools({
      workspace: workspace("character_design"),
      profile: profile("character_design"),
      attachedMaterials: [
        {
          id: "allowed",
          title: "人物卡",
          source: "attached-material",
          kind: "character",
          content: "人物素材正文"
        },
        {
          id: "blocked-kind",
          title: "剧情卡",
          source: "attached-material",
          kind: "plot",
          content: "剧情素材正文"
        },
        {
          id: "blocked-untyped",
          title: "旧素材",
          source: "attached-material",
          content: "未分类素材正文"
        }
      ]
    });
    const query = toolByName(tools, "query_linked_material_entries");

    const listed = await query.execute("material-list", { mode: "list" });
    const readBlocked = await query.execute("material-read", {
      mode: "read",
      entry_name: "旧素材"
    });

    expect(resultText(listed)).toContain("人物卡");
    expect(resultText(listed)).not.toContain("剧情卡");
    expect(resultText(listed)).not.toContain("旧素材");
    expect(resultText(readBlocked)).toContain("没有找到");
  });

  it("reads the complete draft tail and emits a body-file revision", async () => {
    const value = workspace("draft");
    const oldTail = "这是超过旧二万字符快照的全文尾部。";
    const longBody = `${"正".repeat(20_050)}${oldTail}`;
    value.expertDraft.sections[2] = expertSection(
      "section-2",
      "第二节·暗房",
      "1200 字",
      longBody,
      "不应混入全文读取的人物状态。"
    );
    const tools = buildShortWorkspaceTools({
      workspace: value,
      profile: profile("expert_draft_coordinator")
    });

    expect(tools.map((tool) => tool.name)).toEqual([
      "read_workspace_content",
      "search_workspace_text",
      "query_linked_material_entries",
      "load_skill",
      ...SHORT_WORKSPACE_TOOL_MANIFEST.coordinator
    ]);
    expect(tools.map((tool) => tool.name)).not.toContain("initialize_expert_draft");

    const blocked = await toolByName(
      tools,
      "replace_expert_draft_section_text"
    ).execute("replace-before-read", {
      section_id: "section-2",
      original_text: oldTail,
      new_text: "新尾部。"
    });
    expect(blocked.details).toEqual({ kind: "none" });
    expect(resultText(blocked)).toContain("请先读取");

    const readAll = await toolByName(tools, "read_all_expert_draft").execute(
      "read-all",
      {}
    );
    expect(resultText(readAll)).toContain(oldTail);
    expect(resultText(readAll)).not.toContain("不应混入全文读取的人物状态");

    const replaced = await toolByName(
      tools,
      "replace_expert_draft_section_text"
    ).execute("replace-after-read", {
      section_id: "section-2",
      original_text: oldTail,
      new_text: "新尾部。"
    });
    expect(replaced.details).toMatchObject({
      kind: "workspace-expert-draft-file-mutation",
      stageId: "draft",
      documentId: "draft:section-2:body",
      sectionId: "section-2",
      fileKind: "body",
      baseRevision: createShortWorkspaceContentRevision(longBody)
    });
  });

  it("scopes section-writer reads and writes to independent physical files", async () => {
    const writerWorkspace = sectionWriterWorkspace();
    const originalBody = writerWorkspace.expertDraft.sections[1]!.body;
    const originalState = writerWorkspace.expertDraft.sections[1]!.characterState;
    const tools = buildShortWorkspaceTools({
      workspace: writerWorkspace,
      profile: profile("expert_section_writer")
    });

    expect(tools.map((tool) => tool.name)).toEqual([
      "read_workspace_content",
      "search_workspace_text",
      "query_linked_material_entries",
      "load_skill",
      ...SHORT_WORKSPACE_TOOL_MANIFEST.sectionWriter
    ]);

    const blocked = await toolByName(tools, "replace_section_body_text").execute(
      "replace-before-read",
      {
        replacements: [
          { original_text: "共同片段", new_text: "只改第一节的片段" }
        ]
      }
    );
    expect(blocked.details).toEqual({ kind: "none" });
    expect(resultText(blocked)).toContain("请先读取");

    const readBody = await toolByName(tools, "read_expert_draft_section").execute(
      "read-section",
      { section_id: "section-1" }
    );
    expect(resultText(readBody)).toContain("汽笛迟到了七分钟");
    expect(resultText(readBody)).not.toContain("人物状态:");

    const replaced = await toolByName(tools, "replace_section_body_text").execute(
      "replace-section",
      {
        replacements: [
          { original_text: "共同片段", new_text: "只改第一节的片段" }
        ]
      }
    );
    expect(replaced.details).toMatchObject({
      kind: "workspace-expert-draft-file-mutation",
      documentId: originalBody.documentId,
      sectionId: "section-1",
      fileKind: "body",
      text: "汽笛迟到了七分钟。只改第一节的片段。",
      baseRevision: originalBody.revision
    });

    const state = await toolByName(tools, "write_character_state").execute(
      "write-empty-state",
      { text: "林默确认汽笛晚了七分钟。" }
    );
    expect(state.details).toMatchObject({
      kind: "workspace-expert-draft-file-mutation",
      documentId: originalState.documentId,
      sectionId: "section-1",
      fileKind: "characterState",
      baseRevision: originalState.revision
    });

    const readState = await toolByName(tools, "read_expert_character_state").execute(
      "read-state",
      { section_id: "section-1" }
    );
    expect(resultText(readState)).toContain("林默确认汽笛晚了七分钟");
  });

  it("does not let section-writer text search reveal future draft sections", async () => {
    const tools = buildShortWorkspaceTools({
      workspace: sectionWriterWorkspace(),
      profile: profile("expert_section_writer")
    });
    const search = toolByName(tools, "search_workspace_text");

    const current = await search.execute("search-current", {
      stage_id: "draft",
      query: "汽笛迟到了"
    });
    const future = await search.execute("search-future", {
      stage_id: "draft",
      query: "暗房里显出了照片"
    });

    expect(resultText(current)).toContain("第一节·迟到的汽笛");
    expect(resultText(future)).toBe("没有找到匹配文本。");
  });

  it("requires reading an existing file before whole-section overwrite", async () => {
    const tools = buildShortWorkspaceTools({
      workspace: sectionWriterWorkspace(),
      profile: profile("expert_section_writer")
    });
    const write = toolByName(tools, "write_section_body");

    const unread = await write.execute("write-unread", {
      text: "整节覆盖",
      allow_overwrite_existing: true
    });
    expect(resultText(unread)).toContain("请先读取");

    await toolByName(tools, "read_expert_draft_section").execute("read-current", {
      section_id: "section-1"
    });
    const unconfirmed = await write.execute("write-unconfirmed", {
      text: "整节覆盖"
    });
    expect(resultText(unconfirmed)).toContain("已有内容");

    const allowed = await write.execute("write-confirmed", {
      text: "整节覆盖",
      allow_overwrite_existing: true
    });
    expect(allowed.details).toMatchObject({
      kind: "workspace-expert-draft-file-mutation",
      documentId: "draft:section-1:body",
      baseRevision: createShortWorkspaceContentRevision("汽笛迟到了七分钟。共同片段。")
    });
  });
});
