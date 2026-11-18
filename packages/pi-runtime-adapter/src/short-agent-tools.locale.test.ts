import { expect, it } from "vitest";
import {
  buildShortWorkspaceTools,
  buildScriptWorkspaceTools
} from "./short-agent-tools";
import {
  shortProfile,
  shortWorkspace,
  toolByName,
  resultText
} from "./short-agent-tools.test-support";
import { screenplayWorkspace, scriptAgentProfile } from "./index.test-support";

it.each(["short", "script"] as const)(
  "%s exposes English tools and both state selectors address one file",
  async (kind) => {
    const tools =
      kind === "short"
        ? buildShortWorkspaceTools({
            workspace: shortWorkspace(),
            profile: shortProfile(),
            promptLocale: "en-US"
          })
        : buildScriptWorkspaceTools({
            workspace: screenplayWorkspace(),
            profile: scriptAgentProfile(),
            promptLocale: "en-US"
          });
    for (const tool of tools)
      expect(
        JSON.stringify([tool.label, tool.description, tool.parameters])
      ).not.toMatch(/\p{Script=Han}/u);
    const create = toolByName(tools, "create");
    await expect(
      create.execute("ambiguous", {
        kind: "draft_section",
        meta: { title: "尾声" },
        state: "A",
        character_state: "B"
      })
    ).rejects.toThrow("Supply only one");
    const result = await create.execute("create", {
      kind: "draft_section",
      meta: { title: "尾声" },
      state: "剧情已反转，众人仍在悲伤。"
    });
    const id = resultText(result).match(/section_id=(\S+)/u)?.[1];
    expect(id).toBeTruthy();
    const read = toolByName(tools, "read");
    const directory = resultText(
      await read.execute("directory", { kind: "workspace", id: "workspace" })
    );
    expect(directory).toContain(
      `Each ${kind === "script" ? "episode" : "section"}`
    );
    for (const document of ["state", "character_state"]) {
      const text = resultText(
        await read.execute("read", { kind: "draft_section", id, document })
      );
      expect(text).toContain("尾声 · State");
      expect(text).toContain("剧情已反转，众人仍在悲伤。");
    }
    const edit = await toolByName(tools, "edit").execute("edit", {
      kind: "draft_section",
      id,
      document: "state",
      content: "新的情感状态",
      overwrite_mode: "replace_all"
    });
    expect(edit.details).toMatchObject({
      fileKind: "characterState",
      text: "新的情感状态"
    });
  }
);
