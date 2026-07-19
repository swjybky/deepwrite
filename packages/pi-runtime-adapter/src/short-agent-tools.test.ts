import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import {
  DEFAULT_SHORT_WORKSPACE_AGENT_PROFILES,
  SHORT_WORKSPACE_STAGE_IDS,
  createShortWorkspaceContentRevision,
  parseExpertDraftMarkdown,
  serializeExpertDraftMarkdown,
  type ShortWorkspaceAgentId,
  type ShortWorkspaceAgentProfile,
  type ShortWorkspaceSnapshot
} from "@deepwrite/contracts";
import { describe, expect, it } from "vitest";
import {
  buildShortWorkspaceTools,
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
    stages: SHORT_WORKSPACE_STAGE_IDS.map((stageId) => ({
      stageId,
      title: stageId,
      content: stageId === "plot_design" ? "旧剧情的唯一片段。" : "",
      revision: createShortWorkspaceContentRevision(
        stageId === "plot_design" ? "旧剧情的唯一片段。" : ""
      )
    }))
  };
}

function toolByName(tools: AgentTool[], name: string): AgentTool {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Missing tool: ${name}`);
  return tool;
}

function sectionWriterWorkspace(): ShortWorkspaceSnapshot {
  const draftContent = serializeExpertDraftMarkdown({
    sections: [
      {
        id: "intro",
        title: "导语",
        wordCountRequirement: "150 字",
        body: "雨夜名单出现了。",
        characterState: "林默尚未看清名单。"
      },
      {
        id: "section-1",
        title: "第一节·迟到的汽笛",
        wordCountRequirement: "1000 字",
        body: "汽笛迟到了七分钟。共同片段。",
        characterState: ""
      },
      {
        id: "section-2",
        title: "第二节·暗房",
        wordCountRequirement: "1200 字",
        body: "共同片段。暗房里显出了照片。",
        characterState: "苏遥拿着底片。"
      }
    ]
  });
  const value = workspace("draft");
  return {
    ...value,
    activeAgentId: "expert_section_writer",
    activeSectionId: "section-1",
    stages: value.stages.map((stage) =>
      stage.stageId === "draft"
        ? {
            ...stage,
            content: draftContent,
            revision: createShortWorkspaceContentRevision(draftContent)
          }
        : stage
    )
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

  it("refuses to rebuild a truncated expert draft", async () => {
    const truncated = workspace("draft");
    truncated.stages = truncated.stages.map((stage) =>
      stage.stageId === "draft"
        ? {
            ...stage,
            content: "正".repeat(20_000),
            revision: createShortWorkspaceContentRevision("正".repeat(20_010)),
            truncated: true,
            originalLength: 20_010
          }
        : stage
    );
    const initialize = toolByName(
      buildShortWorkspaceTools({
        workspace: truncated,
        profile: profile("expert_draft_coordinator")
      }),
      "initialize_expert_draft"
    );

    const result = await initialize.execute("init-truncated", {
      sections: [{ title: "第一节" }],
      allow_overwrite_existing: true
    });

    expect(result.details).toEqual({ kind: "none" });
    expect(resultText(result)).toContain("不能在未读取完整正文时重建");
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

  it("exposes only the implemented coordinator slice and emits a draft mutation", async () => {
    const tools = buildShortWorkspaceTools({
      workspace: workspace("draft"),
      profile: profile("expert_draft_coordinator")
    });

    expect(tools.map((tool) => tool.name)).toEqual([
      "read_workspace_content",
      "search_workspace_text",
      "query_linked_material_entries",
      "load_skill",
      "initialize_expert_draft",
      "edit_expert_draft_section"
    ]);
    expect(SHORT_WORKSPACE_TOOL_MANIFEST.coordinator).toContain(
      "start_expert_writing"
    );

    const initialized = await toolByName(tools, "initialize_expert_draft").execute(
      "init-1",
      {
        sections: [
          { title: "第一节", word_count_requirement: "1000 字" },
          { title: "第二节", body: "已有开头" }
        ]
      }
    );
    const details = initialized.details as ShortWorkspaceToolDetails;
    expect(details).toMatchObject({
      kind: "workspace-editor-mutation",
      stageId: "draft"
    });
    expect(details.kind === "workspace-editor-mutation" ? details.text : "").toContain(
      "## 第一节"
    );
  });

  it("scopes every section-writer mutation to the selected section", async () => {
    const tools = buildShortWorkspaceTools({
      workspace: sectionWriterWorkspace(),
      profile: profile("expert_section_writer")
    });

    expect(tools.map((tool) => tool.name)).toEqual([
      "read_workspace_content",
      "search_workspace_text",
      "query_linked_material_entries",
      "load_skill",
      ...SHORT_WORKSPACE_TOOL_MANIFEST.sectionWriter
    ]);

    const read = await toolByName(tools, "read_expert_draft_section").execute(
      "read-section",
      { section_id: "intro" }
    );
    expect(resultText(read)).toContain("雨夜名单出现了");
    expect(resultText(read)).toContain("林默尚未看清名单");

    const replaced = await toolByName(tools, "replace_section_body_text").execute(
      "replace-section",
      {
        replacements: [
          { original_text: "共同片段", new_text: "只改第一节的片段" }
        ]
      }
    );
    const replacementDetails = replaced.details as ShortWorkspaceToolDetails;
    expect(replacementDetails).toMatchObject({
      kind: "workspace-editor-mutation",
      stageId: "draft"
    });
    if (replacementDetails.kind !== "workspace-editor-mutation") {
      throw new Error("Expected a draft mutation.");
    }
    const afterReplace = parseExpertDraftMarkdown(replacementDetails.text);
    expect(afterReplace.sections.find(({ id }) => id === "section-1")?.body).toContain(
      "只改第一节的片段"
    );
    expect(afterReplace.sections.find(({ id }) => id === "section-2")?.body).toContain(
      "共同片段"
    );

    const state = await toolByName(tools, "write_character_state").execute(
      "write-state",
      { text: "林默确认汽笛晚了七分钟。" }
    );
    const stateDetails = state.details as ShortWorkspaceToolDetails;
    if (stateDetails.kind !== "workspace-editor-mutation") {
      throw new Error("Expected a character-state mutation.");
    }
    expect(stateDetails.baseRevision).toBe(
      createShortWorkspaceContentRevision(replacementDetails.text)
    );
    const afterState = parseExpertDraftMarkdown(stateDetails.text);
    expect(
      afterState.sections.find(({ id }) => id === "section-1")?.characterState
    ).toBe("林默确认汽笛晚了七分钟。");
    expect(afterState.sections.find(({ id }) => id === "section-2")?.characterState).toBe(
      "苏遥拿着底片。"
    );
  });

  it("protects existing section content and blocks all section writes on truncation", async () => {
    const writerWorkspace = sectionWriterWorkspace();
    const tools = buildShortWorkspaceTools({
      workspace: writerWorkspace,
      profile: profile("expert_section_writer")
    });
    const protectedWrite = await toolByName(tools, "write_section_body").execute(
      "write-protected",
      { text: "整节覆盖" }
    );
    expect(protectedWrite.details).toEqual({ kind: "none" });
    expect(resultText(protectedWrite)).toContain("已有内容");

    const truncated: ShortWorkspaceSnapshot = {
      ...writerWorkspace,
      stages: writerWorkspace.stages.map((stage) =>
        stage.stageId === "draft"
          ? {
              ...stage,
              truncated: true,
              originalLength: stage.content.length + 1
            }
          : stage
      )
    };
    const truncatedTools = buildShortWorkspaceTools({
      workspace: truncated,
      profile: profile("expert_section_writer")
    });
    const blocked = await toolByName(
      truncatedTools,
      "replace_character_state_text"
    ).execute("replace-state-truncated", {
      replacements: [
        { original_text: "苏遥", new_text: "林默" }
      ]
    });
    expect(blocked.details).toEqual({ kind: "none" });
    expect(resultText(blocked)).toContain("超过本轮安全快照上限");
  });
});
