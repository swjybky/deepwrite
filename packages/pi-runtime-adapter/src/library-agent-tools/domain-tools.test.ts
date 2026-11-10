import { describe, it, expect, vi } from "vitest";
import { LibraryAgentWorkspaceSnapshotSchema } from "@deepwrite/contracts";
import { buildDomainLibraryAgentTools } from "./domain-tools";
import { buildLibraryAgentTools } from "../library-agent-tools";
import {
  materialWorkspace,
  skillWorkspace,
  profile,
  toolByName,
  resultText
} from "./test-fixtures";

function fixture() {
  const other = materialWorkspace({
    libraryId: "other",
    title: "Other",
    projectRevision: 19
  });
  const workspace = materialWorkspace({
    readableLibraries: [
      {
        libraryId: "material-library-1",
        title: "Focus",
        kind: "plot",
        readOnly: false,
        entryCount: 2
      },
      {
        libraryId: "other",
        title: "Other",
        kind: "plot",
        readOnly: false,
        entryCount: 2
      }
    ]
  });
  const execute = vi.fn(async () => ({
    status: "accepted" as const,
    requestId: "read",
    payload: other
  }));
  const tools = buildDomainLibraryAgentTools(
    { workspace, profile: profile("material") },
    {
      runId: "run",
      sessionId: "session",
      prompt: "manage",
      libraryAgentCommandExecutor: execute
    }
  );
  const call = (name: string, params: Record<string, unknown>) =>
    toolByName(tools, name).execute("call", params);
  return { call, execute, workspace };
}
describe("domain library tools", () => {
  it.each([materialWorkspace(), skillWorkspace()])(
    "preserves tool-specific descriptions and adds domain targeting for $domain",
    (workspace) => {
      const input = { workspace, profile: profile(workspace.domain) };
      const innerTools = buildLibraryAgentTools(input);
      const tools = buildDomainLibraryAgentTools(input, {
        runId: "run",
        sessionId: "session",
        prompt: "manage"
      });
      const domain = workspace.domain;
      for (const tool of tools.filter(
        (item) =>
          item.name !== "load_skill" &&
          !["manage_library", "manage_group", "organize_entries"].includes(
            item.name
          )
      )) {
        expect(tool.description).toContain(
          toolByName(innerTools, tool.name).description
        );
        expect(tool.description).toContain("library_id 缺省为当前位置");
        expect(tool.description).toContain("可指定本领域其它库");
        expect(tool.description).toContain("内置技能库只读");
      }
      const create = toolByName(tools, `create_${domain}_entry`);
      expect(create.description).toContain(
        "name 和 description 写入 Markdown 顶部 --- 说明头部"
      );
      expect(create.description).toContain("缺失则补充，已存在则覆盖");
      expect(create.description).toContain("不新增 JSON 清单字段");
      expect(create.description).toContain("body 保留正式正文与其他头部字段");
      for (const name of [
        `list_${domain}_entries`,
        `read_${domain}_entry`,
        `search_${domain}_entries`,
        `edit_${domain}_library_overview`
      ]) {
        const description = toolByName(tools, name).description;
        expect(description).not.toContain("replace_fragments");
        expect(description).not.toContain("read/search");
      }
      expect(
        toolByName(tools, `search_${domain}_entries`).description
      ).toContain("搜索缺省范围为本轮已加载的库");
      expect(toolByName(tools, `edit_${domain}_entry`).description).toContain(
        "必须先 read/search；局部修改用 replace_fragments"
      );
      for (const tool of innerTools) {
        expect(tool.description).not.toContain("本领域其它库");
        expect(tool.description).not.toContain("同分组其它库只读");
      }
    }
  );

  it("defaults writes to focus and lazily loads another library once with its revision", async () => {
    const { call, execute } = fixture();
    const create = {
      stage_id: "pacing",
      title: "New",
      name: "New",
      description: "Usage",
      body: "Body"
    };
    expect((await call("create_material_entry", create)).details).toMatchObject(
      { libraryId: "material-library-1", baseProjectRevision: 7 }
    );
    expect(execute).not.toHaveBeenCalled();
    const otherCreate = await call("create_material_entry", {
      ...create,
      library_id: "other"
    });
    expect(otherCreate.details).toMatchObject({
      libraryId: "other",
      baseProjectRevision: 19
    });
    await call("read_material_entry", {
      library_id: "other",
      entry_id: "material-entry-1"
    });
    const edited = await call("edit_material_entry", {
      library_id: "other",
      entry_id: "material-entry-1",
      mode: "append",
      body: "More"
    });
    expect(edited.details).toMatchObject({
      libraryId: "other",
      baseProjectRevision: 19,
      operation: "edit"
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]).toBeDefined();
  });
  it("rejects unknown libraries and edits before reading", async () => {
    const { call, execute } = fixture();
    expect(
      resultText(await call("list_material_entries", { library_id: "unknown" }))
    ).toContain("不属于本领域");
    expect(execute).not.toHaveBeenCalled();
    expect(
      resultText(
        await call("edit_material_entry", {
          library_id: "other",
          entry_id: "material-entry-1",
          mode: "append",
          body: "More"
        })
      )
    ).toContain("请先调用");
  });
  it("exposes writable libraries while focus is built-in, but rejects built-in writes", async () => {
    const workspace = skillWorkspace({
      readOnly: true,
      entries: skillWorkspace().entries.map((entry) => ({
        ...entry,
        readOnly: true
      })),
      readableLibraries: [
        {
          libraryId: "skill-library-1",
          title: "Built-in",
          kind: "style",
          readOnly: true,
          entryCount: 1
        },
        {
          libraryId: "writable",
          title: "Writable",
          kind: "general",
          readOnly: false,
          entryCount: 0
        }
      ]
    });
    const tools = buildDomainLibraryAgentTools(
      { workspace, profile: profile("skill") },
      {
        runId: "run",
        sessionId: "session",
        prompt: "manage",
        libraryAgentCommandExecutor: async () => ({
          status: "accepted",
          requestId: "read",
          payload: skillWorkspace({
            libraryId: "writable",
            kind: "general",
            entries: [],
            activeEntryId: undefined
          })
        })
      }
    );
    const result = await toolByName(tools, "create_skill_entry").execute(
      "call",
      {}
    );
    expect(resultText(result)).toContain("只读");
    const created = await toolByName(tools, "create_skill_entry").execute(
      "create",
      {
        library_id: "writable",
        stage_id: "outline",
        title: "Method",
        name: "Method",
        description: "Usage",
        body: "Steps"
      }
    );
    expect(created.details).toMatchObject({
      libraryId: "writable",
      operation: "create"
    });
  });
  it("accepts a full index and writable peer entries, rejects entries outside the index", () => {
    const { workspace } = fixture();
    const peer = {
      ...workspace.entries[0]!,
      id: "other/peer",
      documentId: "other-doc",
      sourceLibraryId: "other",
      sourceLibraryTitle: "Other",
      readOnly: false
    };
    expect(
      LibraryAgentWorkspaceSnapshotSchema.safeParse({
        ...workspace,
        entries: [...workspace.entries, peer]
      }).success
    ).toBe(true);
    expect(
      LibraryAgentWorkspaceSnapshotSchema.safeParse({
        ...workspace,
        entries: [...workspace.entries, { ...peer, sourceLibraryId: "unknown" }]
      }).success
    ).toBe(false);
  });
});
