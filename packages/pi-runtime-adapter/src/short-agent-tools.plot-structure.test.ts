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

function answering(optionId: string) {
  return vi.fn(async (request: { toolCallId: string }) => ({
    sessionId: "session-plot-structure",
    runId: "run-plot-structure",
    requestId: request.toolCallId,
    answers: [{ id: "plot_structure_change", selectedOptionIds: [optionId] }]
  }));
}

function autoSaveTools(requestUserInput: ReturnType<typeof answering>) {
  // The plot stage is the open one: no stage boundary is crossed.
  const workspace = shortWorkspace("plot_design");
  const sharedState = createShortWorkspaceToolSharedState(workspace);
  const tools = buildShortWorkspaceTools({
    workspace,
    profile: shortProfile(),
    sharedState,
    writeApprovalMode: "auto-approve",
    requestUserInput
  });
  return { tools, sharedState };
}

const rename = {
  kind: "plot_stage",
  id: "plot_design",
  meta: { title: "新的剧情设计" }
};

describe("shared plot structure confirmation", () => {
  it("asks before auto-save changes a plot stage title and keeps it on refusal", async () => {
    const requestUserInput = answering("cancel");
    const { tools, sharedState } = autoSaveTools(requestUserInput);

    const refused = await toolByName(tools, "edit").execute("rename", rename);

    expect(requestUserInput).toHaveBeenCalledTimes(1);
    expect(requestUserInput.mock.calls[0]?.[0]).toMatchObject({
      toolCallId: "rename",
      source: "plot_structure_change"
    });
    expect(JSON.stringify(requestUserInput.mock.calls[0]?.[0])).toContain(
      "所有短篇和剧本作品共用"
    );
    expect(resultText(refused)).toContain("未修改：用户没有允许");
    expect(details(refused)).toEqual({ kind: "none" });
    expect(sharedState.plotStages.get("plot_design")?.title).toBe("剧情设计");
  });

  it("asks before auto-save creates a plot stage", async () => {
    const requestUserInput = answering("allow_once");
    const { tools } = autoSaveTools(requestUserInput);
    const create = toolByName(tools, "create");
    const first = await create.execute("create-1", {
      kind: "plot_stage",
      meta: { title: "反转设计", description: "安排反转。" }
    });
    await create.execute("create-2", {
      kind: "plot_stage",
      meta: { title: "结局设计", description: "安排结局。" }
    });

    expect(details(first)).toMatchObject({
      kind: "workspace-plot-structure-mutation",
      mutation: { type: "create", title: "反转设计" }
    });
    // "Allow once" covers one change only.
    expect(requestUserInput).toHaveBeenCalledTimes(2);
  });

  it("requires a separate confirmation for each structural change", async () => {
    const requestUserInput = answering("allow_once");
    const { tools } = autoSaveTools(requestUserInput);

    const renamed = await toolByName(tools, "edit").execute("rename", rename);
    await toolByName(tools, "create").execute("create", {
      kind: "plot_stage",
      meta: { title: "反转设计", description: "安排反转。" }
    });

    expect(details(renamed)).toMatchObject({
      kind: "workspace-plot-structure-mutation",
      mutation: { type: "update", title: "新的剧情设计" }
    });
    expect(requestUserInput).toHaveBeenCalledTimes(2);
  });

  it("validates before asking, so a rejected call never reaches the user", async () => {
    const requestUserInput = answering("allow_once");
    const { tools } = autoSaveTools(requestUserInput);

    await expect(
      toolByName(tools, "create").execute("duplicate", {
        kind: "plot_stage",
        meta: { title: "剧情设计", description: "重名。" }
      })
    ).rejects.toThrow("已存在同名剧情结构");
    await expect(
      toolByName(tools, "create").execute("no-description", {
        kind: "plot_stage",
        meta: { title: "反转设计" }
      })
    ).rejects.toThrow("必须提供 meta.description");
    await expect(
      toolByName(tools, "edit").execute("move", {
        kind: "plot_stage",
        id: "plot_design",
        meta: { move: "up" }
      })
    ).rejects.toThrow("不接受 move");
    expect(requestUserInput).not.toHaveBeenCalled();
  });

  it("does not ask for plot stage text, which belongs to this work only", async () => {
    const requestUserInput = answering("cancel");
    const { tools } = autoSaveTools(requestUserInput);
    await toolByName(tools, "read").execute("read", {
      kind: "plot_stage",
      id: "plot_design"
    });

    const edited = await toolByName(tools, "edit").execute("edit-text", {
      kind: "plot_stage",
      id: "plot_design",
      replacements: [{ original_text: "唯一片段", new_text: "新片段" }]
    });

    expect(details(edited)).toMatchObject({
      kind: "workspace-editor-mutation"
    });
    expect(requestUserInput).not.toHaveBeenCalled();
  });

  it("leaves the confirmation to the approval card in user-review mode", async () => {
    const requestUserInput = answering("cancel");
    const tools = buildShortWorkspaceTools({
      workspace: shortWorkspace("plot_design"),
      profile: shortProfile(),
      writeApprovalMode: "request-approval",
      requestUserInput
    });

    const renamed = await toolByName(tools, "edit").execute("rename", rename);

    expect(details(renamed)).toMatchObject({
      kind: "workspace-plot-structure-mutation"
    });
    expect(requestUserInput).not.toHaveBeenCalled();
  });
});
