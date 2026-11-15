import { describe, expect, it } from "vitest";
import { DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES } from "@deepwrite/contracts";
import {
  buildScriptWorkspaceTools,
  buildShortWorkspaceTools,
  createShortWorkspaceToolSharedState
} from "./short-agent-tools";
import { settleWritingMutations } from "./short-agent-tools/settlement";
import {
  shortWorkspace,
  shortProfile,
  resultText,
  toolByName
} from "./short-agent-tools.test-support";

describe.each(["short", "script"] as const)("%s authoring tools", (kind) => {
  function setup(locale: "en-US" | "zh-CN") {
    const workspace = shortWorkspace("draft", { characterList: true });
    const sharedState = createShortWorkspaceToolSharedState(workspace);
    const options = {
      sharedState,
      promptLocale: locale,
      writeApprovalMode: "request-approval" as const
    };
    const tools =
      kind === "short"
        ? buildShortWorkspaceTools({
            ...options,
            workspace,
            profile: shortProfile()
          })
        : buildScriptWorkspaceTools({
            ...options,
            workspace: { ...workspace, activeAgentId: "script" },
            profile: DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES[0]!
          });
    return {
      state: sharedState,
      create: toolByName(tools, "create"),
      edit: toolByName(tools, "edit"),
      read: toolByName(tools, "read")
    };
  }

  it.each(["en-US", "zh-CN"] as const)(
    "validates the entire ordered batch before publishing it (%s)",
    async (locale) => {
      const { state, create, read } = setup(locale);
      const createItems = (items: object[]) =>
        create.execute("batch", {
          kind: "draft_section",
          after_id: "section-1",
          items
        });
      await expect(
        createItems([{ title: "Alpha" }, { title: "alpha" }])
      ).rejects.toThrow();
      await expect(
        createItems([{ title: "Alpha" }, { title: " " }])
      ).rejects.toThrow();
      expect(state.pendingSectionSeq).toBe(0);
      const result = await createItems([
        {
          title: "Alpha",
          word_count_requirement: "3–5",
          content: "AB",
          state: "fear"
        },
        { title: "Beta", content: "1. INT. ROOM - NIGHT\n△ Rain." }
      ]);
      expect(result.details).toMatchObject({
        sections: [
          { title: "Alpha", bodyContent: "AB", characterStateContent: "fear" },
          { title: "Beta" }
        ]
      });
      const text = resultText(result);
      expect(text).toContain(locale === "en-US" ? "below target" : "低于要求");
      expect(
        text.includes(locale === "en-US" ? "Format note:" : "格式提示：")
      ).toBe(kind === "script");
      expect(state.expertSectionOrder).toEqual([
        "section-1",
        "pending:section:1",
        "pending:section:2",
        "section-2"
      ]);
      const directory = resultText(
        await read.execute("dir", { kind: "workspace", id: "workspace" })
      );
      expect(directory).toContain(
        locale === "en-US" ? "[provisional id]" : "［临时 id］"
      );
      expect(
        resultText(
          await read.execute("note", {
            kind: "draft_section",
            id: "pending:section:1",
            document: "state"
          })
        )
      ).toContain("fear");
      settleWritingMutations(state, ["batch"], {
        items: [{ title: "Batch", status: "rejected", toolCallIds: ["batch"] }]
      });
      expect([...state.expertSections.keys()]).toEqual([
        "section-1",
        "section-2"
      ]);
    }
  );

  it("uses new section ids for later length and order proposals in the same run", async () => {
    const { create, edit, state } = setup("en-US");
    await create.execute("batch", {
      kind: "draft_section",
      items: [{ title: "A" }, { title: "B" }]
    });
    const id = state.expertSectionOrder.at(-1)!;
    const result = await edit.execute("move", {
      kind: "draft_section",
      id,
      meta: { after_id: "section-1" }
    });
    expect(result.details).toMatchObject({
      sectionId: id,
      change: {
        field: "afterSectionId",
        before: "pending:section:1",
        after: "section-1"
      }
    });
    expect(
      (
        await edit.execute("length", {
          kind: "draft_section",
          id,
          meta: { word_count_requirement: "5" }
        })
      ).details
    ).toMatchObject({ sectionId: id, change: { before: "", after: "5" } });
  });
  it("preserves body and State, checks reads and exact unique anchors, skips no-ops", async () => {
    const { edit, read, state } = setup("en-US");
    const target = {
      kind: "draft_section",
      id: "section-1",
      document: "state"
    };
    expect(
      (await edit.execute("unread", { ...target, append: "late" })).details
    ).toEqual({ kind: "none" });
    await read.execute("read", target);
    const initial = state.expertSections.get("section-1")!;
    await edit.execute("append", { ...target, append: "\nAAA" });
    for (const anchor of ["AA", "missing"]) {
      expect(
        (
          await edit.execute("invalid", {
            ...target,
            insert: { anchor, position: "before", text: "!" }
          })
        ).details
      ).toEqual({ kind: "none" });
    }
    const insert = (position: string, text: string) =>
      edit.execute(position, {
        ...target,
        insert: { anchor: "AAA", position, text }
      });
    await insert("before", "<");
    const changed = await insert("after", ">");
    expect(changed.details).toMatchObject({
      text: initial.characterState.content + "\n<AAA>",
      fileKind: "characterState"
    });
    expect(resultText(changed)).not.toMatch(/Format note|Length target/u);
    expect(state.expertSections.get(target.id)!.body).toEqual(initial.body);
    expect((await insert("after", "")).details).toEqual({ kind: "none" });
    await expect(
      edit.execute("mixed", {
        ...target,
        append: "again",
        meta: { title: "other" }
      })
    ).rejects.toThrow("exactly one");
  });

  it("applies supported directory edits and replays only accepted changes", async () => {
    const { edit, read, state } = setup("zh-CN");
    const target = { kind: "draft_section", id: "section-2" };
    const change = (id: string, meta: object) =>
      edit.execute(id, { ...target, meta });
    await expect(change("bad", { after_id: "missing" })).rejects.toThrow(
      "kind=workspace"
    );
    await expect(
      change("bad", { move: "up", word_count_requirement: "5" })
    ).rejects.toThrow();
    await change("move", { move: "up" });
    expect(state.expertSectionOrder[0]).toBe(target.id);
    expect((await change("same", { move: "up" })).details).toEqual({
      kind: "none"
    });
    await change("length", { word_count_requirement: "两分钟" });
    settleWritingMutations(state, ["move", "length"], {
      items: [
        { title: "move", status: "rejected", toolCallIds: ["move"] },
        { title: "length", status: "saved", toolCallIds: ["length"] }
      ]
    });
    expect(state.expertSectionOrder).toEqual(["section-1", "section-2"]);
    expect((await change("same", { after_id: "section-1" })).details).toEqual({
      kind: "none"
    });
    expect(
      resultText(
        await read.execute("dir", { kind: "workspace", id: "workspace" })
      )
    ).toContain("两分钟");
    const file = { ...target, document: "body" };
    await read.execute("read", file);
    const result = resultText(
      await edit.execute("append", { ...file, append: "!" })
    );
    expect(result).toContain("篇幅要求：两分钟");
    expect(result).not.toMatch(/低于要求|高于要求/u);
  });
});
