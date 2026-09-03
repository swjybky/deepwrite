import { describe, expect, it, vi } from "vitest";
import {
  buildShortWorkspaceTools,
  createShortWorkspaceToolSharedState
} from "./short-agent-tools";
import {
  details,
  resultText,
  shortProfile,
  shortWorkspace,
  toolByName
} from "./short-agent-tools.test-support";

describe("unified short workspace delete tool", () => {
  it("clears text-style character content without deleting its structure", async () => {
    const workspace = shortWorkspace("character_design");
    const sharedState = createShortWorkspaceToolSharedState(workspace);
    const tools = buildShortWorkspaceTools({
      workspace,
      profile: shortProfile(),
      sharedState
    });
    const remove = toolByName(tools, "delete");

    const cleared = await remove.execute("clear-character-overview", {
      kind: "character_overview",
      id: "character_design"
    });
    expect(details(cleared)).toMatchObject({
      kind: "workspace-editor-mutation",
      stageId: "character_design",
      text: ""
    });
    expect(sharedState.stageBodies.get("character_design")).toBe("");
    expect(workspace.characterStructure).toEqual({ format: "text" });
    expect(
      resultText(
        await toolByName(tools, "read").execute("read-cleared-character", {
          kind: "character_overview",
          id: "character_design"
        })
      )
    ).toContain("（正文为空）");

    const repeated = await remove.execute("clear-character-again", {
      kind: "character_overview",
      id: "character_design"
    });
    expect(resultText(repeated)).toContain("内容已经为空");
    expect(details(repeated)).toEqual({ kind: "none" });
  });

  it("deletes a list-style character item and rejects mismatched addressing", async () => {
    const workspace = shortWorkspace("character_design", {
      characterList: true
    });
    const sharedState = createShortWorkspaceToolSharedState(workspace);
    const tools = buildShortWorkspaceTools({
      workspace,
      profile: shortProfile(),
      sharedState
    });
    const remove = toolByName(tools, "delete");

    const deleted = await remove.execute("delete-character", {
      kind: "character",
      id: "character-lin",
      summary: "删除不再使用的人物"
    });
    expect(details(deleted)).toMatchObject({
      kind: "workspace-character-structure-mutation",
      mutation: {
        type: "deleteItem",
        itemId: "character-lin",
        title: "林默",
        deletedText: "林默害怕迟到。"
      }
    });
    expect(sharedState.characterItems.has("character-lin")).toBe(false);
    expect(sharedState.characterItemOrder).toEqual(["character-su"]);
    await expect(
      toolByName(tools, "read").execute("read-deleted-character", {
        kind: "character",
        id: "character-lin"
      })
    ).rejects.toThrow("不存在人物条目");
    await expect(
      remove.execute("clear-list-overview", {
        kind: "character_overview",
        id: "character_design"
      })
    ).rejects.toThrow("当前人物为条目样式");

    const textTools = buildShortWorkspaceTools({
      workspace: shortWorkspace("character_design"),
      profile: shortProfile()
    });
    await expect(
      toolByName(textTools, "delete").execute("delete-text-character", {
        kind: "character",
        id: "character-lin"
      })
    ).rejects.toThrow("当前人物为文本样式");
  });

  it("clears plot content while preserving the configured plot stage", async () => {
    const workspace = shortWorkspace("plot_design");
    const sharedState = createShortWorkspaceToolSharedState(workspace);
    const originalStage = sharedState.plotStages.get("plot_design");
    const tools = buildShortWorkspaceTools({
      workspace,
      profile: shortProfile(),
      sharedState
    });

    const cleared = await toolByName(tools, "delete").execute(
      "clear-plot-content",
      {
        kind: "plot_stage",
        id: "plot_design"
      }
    );
    expect(details(cleared)).toMatchObject({
      kind: "workspace-editor-mutation",
      stageId: "plot_design",
      text: ""
    });
    expect(sharedState.stageBodies.get("plot_design")).toBe("");
    expect(sharedState.plotStages.get("plot_design")).toEqual(originalStage);
    expect(sharedState.plotStageOrder).toContain("plot_design");

    const repeated = await toolByName(tools, "delete").execute(
      "clear-plot-content-again",
      { kind: "plot_stage", id: "plot_design" }
    );
    expect(resultText(repeated)).toContain("内容已经为空");
    expect(details(repeated)).toEqual({ kind: "none" });
  });

  it("deletes a whole draft section but keeps the final section", async () => {
    const workspace = shortWorkspace("draft");
    const sharedState = createShortWorkspaceToolSharedState(workspace);
    const tools = buildShortWorkspaceTools({
      workspace,
      profile: shortProfile(),
      sharedState
    });
    const remove = toolByName(tools, "delete");

    const deleted = await remove.execute("delete-section", {
      kind: "draft_section",
      id: "section-2"
    });
    expect(details(deleted)).toMatchObject({
      kind: "workspace-expert-draft-section-deletion",
      sectionId: "section-2",
      title: "第二节"
    });
    expect(sharedState.expertSections.has("section-2")).toBe(false);
    expect(sharedState.expertSectionOrder).toEqual(["section-1"]);
    await expect(
      toolByName(tools, "read").execute("read-deleted-section", {
        kind: "draft_section",
        id: "section-2",
        document: "body"
      })
    ).rejects.toThrow("不存在章节");

    const finalSection = await remove.execute("delete-final-section", {
      kind: "draft_section",
      id: "section-1"
    });
    expect(resultText(finalSection)).toContain("正文至少需要保留一个章节");
    expect(details(finalSection)).toEqual({ kind: "none" });
    expect(sharedState.expertSections.has("section-1")).toBe(true);
  });

  it("rejects deletion of provisional objects created in the same run", async () => {
    const characterWorkspace = shortWorkspace("character_design", {
      characterList: true
    });
    const characterTools = buildShortWorkspaceTools({
      workspace: characterWorkspace,
      profile: shortProfile()
    });
    const createdCharacter = await toolByName(characterTools, "create").execute(
      "create-character",
      {
        kind: "character",
        meta: { title: "临时人物" }
      }
    );
    const characterId =
      resultText(createdCharacter).match(/item_id=(.+)/u)?.[1];
    await expect(
      toolByName(characterTools, "delete").execute("delete-pending-character", {
        kind: "character",
        id: characterId!
      })
    ).rejects.toThrow("待创建人物条目尚未落盘");

    const plotTools = buildShortWorkspaceTools({
      workspace: shortWorkspace("plot_design"),
      profile: shortProfile()
    });
    const createdPlot = await toolByName(plotTools, "create").execute(
      "create-plot",
      {
        kind: "plot_stage",
        meta: { title: "临时剧情", description: "临时阶段" }
      }
    );
    const plotId = resultText(createdPlot).match(/stage_id=(.+)/u)?.[1];
    await expect(
      toolByName(plotTools, "delete").execute("delete-pending-plot", {
        kind: "plot_stage",
        id: plotId!
      })
    ).rejects.toThrow("待创建剧情阶段尚未落盘");

    const draftTools = buildShortWorkspaceTools({
      workspace: shortWorkspace("draft"),
      profile: shortProfile()
    });
    const createdSection = await toolByName(draftTools, "create").execute(
      "create-section",
      {
        kind: "draft_section",
        meta: { title: "临时章节" }
      }
    );
    const sectionId = resultText(createdSection).match(/section_id=(.+)/u)?.[1];
    await expect(
      toolByName(draftTools, "delete").execute("delete-pending-section", {
        kind: "draft_section",
        id: sectionId!
      })
    ).rejects.toThrow("待创建章节尚未落盘");
  });

  it("uses cross-stage confirmation and the current approval mode", async () => {
    const workspace = shortWorkspace("character_design");
    const cancelledState = createShortWorkspaceToolSharedState(workspace);
    const requestUserInput = vi.fn(async (request) => ({
      sessionId: "session-delete",
      runId: "run-delete",
      requestId: request.requestId ?? "delete-confirmation",
      answers: [{ id: "cross_stage_write", selectedOptionIds: ["cancel"] }]
    }));
    const cancelledTools = buildShortWorkspaceTools({
      workspace,
      profile: shortProfile(),
      sharedState: cancelledState,
      requestUserInput
    });
    const cancelled = await toolByName(cancelledTools, "delete").execute(
      "cancel-cross-stage-delete",
      { kind: "plot_stage", id: "plot_design" }
    );
    expect(resultText(cancelled)).toContain("用户取消");
    expect(cancelledState.stageBodies.get("plot_design")).toBe(
      "旧剧情的唯一片段。"
    );
    expect(requestUserInput).toHaveBeenCalledTimes(1);

    const autoRequest = vi.fn(async () => {
      throw new Error("automatic cross-stage deletion should not ask");
    });
    const automaticTools = buildShortWorkspaceTools({
      workspace,
      profile: shortProfile(),
      autoApproveCrossStageOperations: true,
      writeApprovalMode: "auto-approve",
      requestUserInput: autoRequest
    });
    const automatic = await toolByName(automaticTools, "delete").execute(
      "automatic-cross-stage-delete",
      { kind: "plot_stage", id: "plot_design" }
    );
    expect(autoRequest).not.toHaveBeenCalled();
    expect(details(automatic)).toMatchObject({
      kind: "workspace-editor-mutation",
      text: "",
      summary: expect.stringContaining("自动保存队列")
    });
  });
});
