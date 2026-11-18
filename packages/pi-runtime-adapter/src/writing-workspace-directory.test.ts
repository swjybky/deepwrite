import { describe, expect, it } from "vitest";
import {
  buildShortWorkspaceTools,
  createShortWorkspaceToolSharedState
} from "./short-agent-tools";
import {
  resultText,
  shortProfile,
  shortWorkspace,
  toolByName
} from "./short-agent-tools.test-support";

function harness() {
  const workspace = shortWorkspace("draft", { characterList: true });
  const sharedState = createShortWorkspaceToolSharedState(workspace);
  const build = () =>
    buildShortWorkspaceTools({
      workspace,
      sharedState,
      profile: shortProfile()
    });
  const tools = build();
  const directory = async () =>
    resultText(
      await toolByName(tools, "read").execute("directory", {
        kind: "workspace",
        id: "workspace"
      })
    );
  return { tools, build, directory, workspace };
}

describe("writing workspace directory reads", () => {
  it("tracks renames, ordering and deletions without mutating the original snapshot", async () => {
    const { tools, directory, workspace } = harness();
    const original = JSON.stringify(workspace);
    expect(await directory()).toContain("林默 (character-lin)");
    const edit = toolByName(tools, "edit");
    await edit.execute("rename-character", {
      kind: "character",
      id: "character-lin",
      meta: { title: "交接后的新人物名" }
    });
    await edit.execute("move-character", {
      kind: "character",
      id: "character-su",
      meta: { move: "up" }
    });
    await edit.execute("rename-plot", {
      kind: "plot_stage",
      id: "plot_design",
      meta: { title: "交接后的剧情", description: "新的交付标准。" }
    });
    await edit.execute("rename-draft", {
      kind: "draft_section",
      id: "section-1",
      meta: { title: "交接后的正文" }
    });
    const renamed = await directory();
    expect(renamed).toContain("交接后的新人物名 (character-lin)");
    expect(renamed).toContain(
      "交接后的剧情（kind=plot_stage，id=plot_design）"
    );
    expect(renamed).toContain("新的交付标准。");
    expect(renamed).toContain("交接后的正文 (section-1)");
    expect(renamed.indexOf("苏遥")).toBeLessThan(
      renamed.indexOf("交接后的新人物名")
    );
    const read = toolByName(tools, "read");
    await read.execute("read-character", {
      kind: "character",
      id: "character-lin"
    });
    await read.execute("read-section", {
      kind: "draft_section",
      id: "section-1",
      document: "body"
    });
    await read.execute("read-state", {
      kind: "draft_section",
      id: "section-1",
      document: "character_state"
    });
    const remove = toolByName(tools, "delete");
    await remove.execute("delete-character", {
      kind: "character",
      id: "character-lin"
    });
    await remove.execute("delete-section", {
      kind: "draft_section",
      id: "section-1"
    });
    const removed = await directory();
    expect(removed).not.toContain("character-lin");
    expect(removed).not.toContain("section-1");
    expect(removed).toContain("section-2");
    expect(JSON.stringify(workspace)).toBe(original);
  });

  it("does not treat directory discovery or a sibling's read as a full-body read", async () => {
    const { tools, build, directory } = harness();
    const index = await directory();
    expect(index).not.toContain("林默害怕迟到。");
    await toolByName(tools, "read").execute("parent-read", {
      kind: "character",
      id: "character-lin"
    });
    const childTools = build();
    await toolByName(childTools, "read").execute("child-directory", {
      kind: "workspace",
      id: "workspace"
    });
    const edit = await toolByName(childTools, "edit").execute("child-edit", {
      kind: "character",
      id: "character-lin",
      replacements: [{ original_text: "害怕迟到", new_text: "准时到达" }]
    });
    expect(resultText(edit)).toContain("请先用 read 完整读取");
    expect(edit.details).toMatchObject({ kind: "none" });
  });

  it.each([
    { id: "wrong-directory" },
    { id: "workspace", document: "body" },
    { id: "workspace", section_scope: "all_sections" }
  ])("rejects invalid directory addressing: %j", async (params) => {
    const { tools } = harness();
    await expect(
      toolByName(tools, "read").execute("invalid-directory", {
        kind: "workspace",
        ...params
      })
    ).rejects.toThrow("作品对象目录");
  });
});
