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
  it("does not clear the character overview and points to edit instead", async () => {
    const workspace = shortWorkspace("character_design");
    const sharedState = createShortWorkspaceToolSharedState(workspace);
    const before = sharedState.stageBodies.get("character_design");
    const tools = buildShortWorkspaceTools({
      workspace,
      profile: shortProfile(),
      sharedState
    });

    const refused = await toolByName(tools, "delete").execute(
      "clear-character-overview",
      { kind: "character_overview", id: "character_design" }
    );
    expect(resultText(refused)).toContain("未修改");
    expect(resultText(refused)).toContain('content=""');
    expect(details(refused)).toEqual({ kind: "none" });
    expect(sharedState.stageBodies.get("character_design")).toBe(before);
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
    expect(
      resultText(
        await remove.execute("clear-list-overview", {
          kind: "character_overview",
          id: "character_design"
        })
      )
    ).toContain("未修改");

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

  it("does not clear plot content: the stage and its text stay untouched", async () => {
    const workspace = shortWorkspace("plot_design");
    const sharedState = createShortWorkspaceToolSharedState(workspace);
    const originalStage = sharedState.plotStages.get("plot_design");
    const tools = buildShortWorkspaceTools({
      workspace,
      profile: shortProfile(),
      sharedState
    });

    const refused = await toolByName(tools, "delete").execute(
      "clear-plot-content",
      { kind: "plot_stage", id: "plot_design" }
    );
    expect(resultText(refused)).toContain("未修改");
    expect(resultText(refused)).toContain("请用 edit");
    expect(details(refused)).toEqual({ kind: "none" });
    expect(sharedState.stageBodies.get("plot_design")).toBe(
      "旧剧情的唯一片段。"
    );
    expect(sharedState.plotStages.get("plot_design")).toEqual(originalStage);
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
    ).rejects.toThrow("不存在小节");

    const finalSection = await remove.execute("delete-final-section", {
      kind: "draft_section",
      id: "section-1"
    });
    expect(resultText(finalSection)).toContain("正文至少需要保留一个小节");
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
    ).rejects.toThrow("待创建小节尚未落盘");
  });

  it("deletes in another stage without asking and follows the approval mode", async () => {
    const requestUserInput = vi.fn(async () => {
      throw new Error("a cross-stage deletion must not ask the user");
    });
    const tools = buildShortWorkspaceTools({
      workspace: shortWorkspace("character_design"),
      profile: shortProfile(),
      writeApprovalMode: "auto-approve",
      requestUserInput
    });
    const deleted = await toolByName(tools, "delete").execute(
      "cross-stage-delete",
      { kind: "draft_section", id: "section-2" }
    );
    expect(requestUserInput).not.toHaveBeenCalled();
    expect(details(deleted)).toMatchObject({
      kind: "workspace-expert-draft-section-deletion",
      sectionId: "section-2",
      summary: expect.not.stringContaining("自动保存")
    });
    expect(resultText(deleted)).toContain("已提交自动保存，这一步已完成");
  });
});
