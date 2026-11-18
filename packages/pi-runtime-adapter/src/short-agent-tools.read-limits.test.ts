import { describe, expect, it } from "vitest";
import { buildShortWorkspaceTools } from "./short-agent-tools";
import {
  expertSection,
  shortWorkspace,
  shortProfile,
  toolByName,
  resultText
} from "./short-agent-tools.test-support";

describe("writing read limits", () => {
  it("counts whitespace, withholds oversized reads and never grants overwrite evidence for a page", async () => {
    const workspace = shortWorkspace("draft");
    workspace.expertDraft.sections = [
      expertSection("large", "大节", "首" + " ".repeat(50_000) + "尾")
    ];
    const tools = buildShortWorkspaceTools({
      workspace,
      profile: shortProfile()
    });
    const read = toolByName(tools, "read");
    const target = { kind: "draft_section", id: "large", document: "body" };
    const all = resultText(
      await read.execute("all", {
        kind: "draft",
        id: "draft",
        section_scope: "all_sections"
      })
    );
    expect(all).toContain("未返回全文");
    expect(all.length).toBeLessThan(1000);
    expect(resultText(await read.execute("single", target))).toContain(
      "未返回全文"
    );
    const page = resultText(
      await read.execute("page", { ...target, offset: 50_001, limit: 1 })
    );
    expect(page).toContain("已到末尾");
    expect(page).toContain("尾");
    const edit = await toolByName(tools, "edit").execute("edit", {
      ...target,
      content: "新",
      overwrite_mode: "replace_all"
    });
    expect(resultText(edit)).toContain("请先用 read 完整读取");
  });

  it("names the unread ranges after head and tail slices", async () => {
    const workspace = shortWorkspace("draft");
    workspace.expertDraft.sections = [
      expertSection("large", "大节", "字".repeat(60_000))
    ];
    const read = toolByName(
      buildShortWorkspaceTools({ workspace, profile: shortProfile() }),
      "read"
    );
    const target = { kind: "draft_section", id: "large", document: "body" };
    await read.execute("head", { ...target, offset: 0, limit: 4_000 });
    const tail = resultText(
      await read.execute("tail", { ...target, offset: 56_000, limit: 4_000 })
    );
    expect(tail).toContain(
      "已读 0–4000、56000–60000；未读 4000–56000（约 87%）"
    );
    await read.execute("middle", { ...target, offset: 3_000, limit: 50_000 });
    const rest = resultText(
      await read.execute("rest", { ...target, offset: 53_000, limit: 3_000 })
    );
    expect(rest).toContain("已分段读完全文");
  });
});
