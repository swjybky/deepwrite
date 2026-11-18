import { describe, expect, it } from "vitest";
import {
  createShortWorkspaceContentRevision,
  type AgentWriteApprovalResult
} from "@deepwrite/contracts";
import {
  buildShortWorkspaceTools,
  createShortWorkspaceToolSharedState
} from "./short-agent-tools";
import { settleWritingMutations } from "./short-agent-tools/settlement";
import {
  shortWorkspace,
  shortProfile,
  toolByName,
  resultText
} from "./short-agent-tools.test-support";

function harness() {
  const workspace = shortWorkspace("draft", { characterList: true });
  const sharedState = createShortWorkspaceToolSharedState(workspace);
  const build = () =>
    buildShortWorkspaceTools({
      workspace,
      sharedState,
      profile: shortProfile(),
      writeApprovalMode: "request-approval"
    });
  const tools = build();
  const target = { kind: "plot_stage", id: "plot_design" };
  const read = () => toolByName(tools, "read").execute("read", target);
  const edit = (id: string, text: string) =>
    toolByName(tools, "edit").execute(id, {
      ...target,
      content: text,
      overwrite_mode: "replace_all"
    });
  const settle = (id: string, result: Partial<AgentWriteApprovalResult>) =>
    settleWritingMutations(sharedState, [id], {
      items: [{ title: "修改", status: "saved", toolCallIds: [id], ...result }]
    });
  return { sharedState, tools, build, target, read, edit, settle };
}

describe("writing proposal settlement", () => {
  it("restores rejected text and the original base revision", async () => {
    const h = harness();
    await h.read();
    await h.edit("first", "被拒绝的文本");
    h.settle("first", { status: "rejected" });
    expect(resultText(await h.read())).toContain("旧剧情的唯一片段");
    const next = await h.edit("second", "下一次修改");
    expect(next.details).toMatchObject({
      baseRevision: createShortWorkspaceContentRevision("旧剧情的唯一片段。")
    });
  });

  it("uses the user's saved version and requires a fresh read", async () => {
    const h = harness();
    await h.read();
    await h.edit("first", "智能体文本");
    h.settle("first", { edited: true, editedText: "用户保存的文本" });
    expect(resultText(await h.edit("no-read", "错误覆盖"))).toContain(
      "请先用 read"
    );
    expect(resultText(await h.read())).toContain("用户保存的文本");
    expect((await h.edit("second", "新文本")).details).toMatchObject({
      baseRevision: createShortWorkspaceContentRevision("用户保存的文本")
    });
  });

  it("rolls back rejected creations without reusing their ids or blocking their titles", async () => {
    const h = harness();
    const create = toolByName(h.tools, "create");
    await create.execute("first", {
      kind: "draft_section",
      meta: { title: "新小节" }
    });
    const previous = h.sharedState.expertSectionOrder.at(-1);
    h.settle("first", { status: "rejected" });
    expect(h.sharedState.expertSections.has(previous!)).toBe(false);
    await create.execute("second", {
      kind: "draft_section",
      meta: { title: "新小节" }
    });
    expect(h.sharedState.expertSectionOrder.at(-1)).not.toBe(previous);
  });

  it("restores a rejected deletion while retaining another child's saved edit", async () => {
    const h = harness();
    await toolByName(h.tools, "delete").execute("delete", {
      kind: "character",
      id: "character-lin"
    });
    const child = h.build();
    await toolByName(child, "read").execute("read", h.target);
    await toolByName(child, "edit").execute("child", {
      ...h.target,
      content: "子智能体已保存",
      overwrite_mode: "replace_all"
    });
    h.settle("child", {});
    h.settle("delete", { status: "rejected" });
    expect(h.sharedState.characterItems.has("character-lin")).toBe(true);
    expect(resultText(await h.read())).toContain("子智能体已保存");
  });

  it("does not expose stale text when the edited saved version was truncated", async () => {
    const h = harness();
    await h.read();
    await h.edit("first", "旧提案");
    h.settle("first", {
      edited: true,
      editedText: "用户文本的片段",
      editedTextTruncated: true
    });
    await expect(h.read()).rejects.toThrow("完整保存版本");
    await expect(h.edit("second", "覆盖")).rejects.toThrow("完整保存版本");
  });

  it("keeps an accepted move when an earlier deletion is rejected", async () => {
    const h = harness();
    const template = h.sharedState.characterItems.get("character-su")!;
    h.sharedState.characterItems.set("character-third", {
      ...template,
      id: "character-third",
      title: "第三人"
    });
    h.sharedState.characterItemOrder.push("character-third");
    await toolByName(h.tools, "delete").execute("delete", {
      kind: "character",
      id: "character-lin"
    });
    await toolByName(h.tools, "edit").execute("move", {
      kind: "character",
      id: "character-third",
      meta: { move: "up" }
    });
    h.settle("move", {});
    h.settle("delete", { status: "rejected" });
    expect(h.sharedState.characterItemOrder).toEqual([
      "character-lin",
      "character-third",
      "character-su"
    ]);
  });

  it("blocks further access when approval results omit a mutation", async () => {
    const h = harness();
    await h.read();
    await h.edit("first", "未收到完整审批结果的文本");
    settleWritingMutations(h.sharedState, ["first"], {
      items: [],
      omittedCount: 1
    });
    await expect(h.read()).rejects.toThrow("完整保存版本");
    await expect(
      toolByName(h.tools, "create").execute("create", {
        kind: "draft_section",
        meta: { title: "新小节" }
      })
    ).rejects.toThrow("完整保存版本");
  });
});
