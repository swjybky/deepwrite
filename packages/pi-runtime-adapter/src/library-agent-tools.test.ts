import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import {
  DEFAULT_LIBRARY_AGENT_PROFILES,
  createShortWorkspaceContentRevision,
  type LibraryAgentDomain,
  type LibraryAgentProfile,
  type LibraryAgentWorkspaceSnapshot
} from "@deepwrite/contracts";
import { describe, expect, it } from "vitest";
import {
  LIBRARY_AGENT_TOOL_MANIFEST,
  buildLibraryAgentTools,
  isLibraryAgentToolDetails,
  type LibraryAgentToolDetails
} from "./library-agent-tools";

function profile(domain: LibraryAgentDomain): LibraryAgentProfile {
  const value = DEFAULT_LIBRARY_AGENT_PROFILES.find(
    (candidate) => candidate.domain === domain
  );
  if (!value) throw new Error(`Missing profile: ${domain}`);
  return value;
}

function materialWorkspace(
  overrides: Partial<Extract<LibraryAgentWorkspaceSnapshot, { domain: "material" }>> = {}
): Extract<LibraryAgentWorkspaceSnapshot, { domain: "material" }> {
  return {
    domain: "material",
    libraryId: "material-library-1",
    title: "雾港素材",
    libraryType: "short",
    kind: "plot",
    overview: "悬疑短篇剧情素材。",
    readOnly: false,
    activeEntryId: "material-entry-1",
    projectRevision: 7,
    entries: [
      {
        id: "material-entry-1",
        documentId: "material:material-library-1:material-entry-1",
        stageId: "pacing",
        title: "迟到的汽笛",
        content: "汽笛迟到了七分钟。共同片段。",
        revision: createShortWorkspaceContentRevision(
          "汽笛迟到了七分钟。共同片段。"
        ),
        readOnly: false
      },
      {
        id: "material-entry-2",
        documentId: "material:material-library-1:material-entry-2",
        stageId: "plot_refine",
        title: "暗房反转",
        content: "共同片段。暗房里显出了照片。",
        revision: createShortWorkspaceContentRevision(
          "共同片段。暗房里显出了照片。"
        ),
        readOnly: false
      }
    ],
    ...overrides
  };
}

function skillWorkspace(
  overrides: Partial<Extract<LibraryAgentWorkspaceSnapshot, { domain: "skill" }>> = {}
): Extract<LibraryAgentWorkspaceSnapshot, { domain: "skill" }> {
  return {
    domain: "skill",
    libraryId: "skill-library-1",
    title: "短篇方法库",
    libraryType: "short",
    kind: "style",
    overview: "正文与分节写作方法。",
    readOnly: false,
    activeEntryId: "skill-entry-1",
    projectRevision: 3,
    entries: [
      {
        id: "skill-entry-1",
        documentId: "skill:skill-library-1:skill-entry-1",
        stageId: "expert_section_writer",
        title: "悬疑分节写法",
        content: "先建立疑问，再用人物行动推进。",
        revision: createShortWorkspaceContentRevision(
          "先建立疑问，再用人物行动推进。"
        ),
        readOnly: false
      }
    ],
    ...overrides
  };
}

function toolByName(tools: AgentTool[], name: string): AgentTool {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Missing tool: ${name}`);
  return tool;
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

describe("library agent tools", () => {
  it("assembles exact domain tool names and keeps only writes sequential", () => {
    const material = buildLibraryAgentTools({
      workspace: materialWorkspace(),
      profile: profile("material")
    });
    const skill = buildLibraryAgentTools({
      workspace: skillWorkspace(),
      profile: profile("skill")
    });

    expect(material.map((tool) => tool.name)).toEqual(
      LIBRARY_AGENT_TOOL_MANIFEST.material
    );
    expect(skill.map((tool) => tool.name)).toEqual(
      LIBRARY_AGENT_TOOL_MANIFEST.skill
    );
    expect(material.slice(0, 4).every((tool) => tool.executionMode === undefined)).toBe(
      true
    );
    expect(
      material.slice(4).every((tool) => tool.executionMode === "sequential")
    ).toBe(true);

    const editSchema = toolByName(material, "edit_material_entry").parameters as {
      properties?: { mode?: Record<string, unknown> };
    };
    expect(editSchema.properties?.mode).toMatchObject({
      enum: ["replace_fragments", "append", "replace"]
    });
    expect(editSchema.properties?.mode).not.toHaveProperty("anyOf");
  });

  it("exposes list, read, search, and load_skill for a read-only library", () => {
    const tools = buildLibraryAgentTools({
      workspace: skillWorkspace({ readOnly: true }),
      profile: profile("skill")
    });

    expect(tools.map((tool) => tool.name)).toEqual(
      LIBRARY_AGENT_TOOL_MANIFEST.skill.slice(0, 4)
    );
  });

  it("lists and reads only the current library with exact duplicate resolution", async () => {
    const workspace = materialWorkspace({
      entries: [
        ...materialWorkspace().entries,
        {
          id: "material-entry-3",
          documentId: "material:material-library-1:material-entry-3",
          stageId: "intro",
          title: "迟到的汽笛",
          content: "导语版本。",
          revision: createShortWorkspaceContentRevision("导语版本。"),
          readOnly: false
        }
      ]
    });
    const tools = buildLibraryAgentTools({ workspace, profile: profile("material") });
    const list = await toolByName(tools, "list_material_entries").execute("list-1", {
      stage_id: "pacing"
    });
    const ambiguous = await toolByName(tools, "read_material_entry").execute(
      "read-1",
      { name: "迟到的汽笛" }
    );
    const selected = await toolByName(tools, "read_material_entry").execute(
      "read-2",
      { name: "迟到的汽笛", stage_id: "intro" }
    );

    expect(resultText(list)).toContain("当前快照 1 条");
    expect(resultText(list)).toContain("material-entry-1");
    expect(resultText(list)).not.toContain("material-entry-2");
    expect(resultText(ambiguous)).toContain("2 个同名条目");
    expect(resultText(selected)).toContain("导语版本。");
    expect(resultText(selected)).toContain("版本：v1:");
  });

  it("searches snippets with positions and authorizes editing only matched entries", async () => {
    const tools = buildLibraryAgentTools({
      workspace: materialWorkspace(),
      profile: profile("material")
    });
    const edit = toolByName(tools, "edit_material_entry");
    const blocked = await edit.execute("edit-1", {
      entry_id: "material-entry-1",
      mode: "append",
      body: "补充内容。"
    });
    const searched = await toolByName(tools, "search_material_entries").execute(
      "search-1",
      { query: "七分钟", context_chars: 10, max_matches: 5 }
    );
    const allowed = await edit.execute("edit-2", {
      entry_id: "material-entry-1",
      mode: "append",
      body: "补充内容。"
    });
    const stillBlocked = await edit.execute("edit-3", {
      entry_id: "material-entry-2",
      mode: "append",
      body: "不能追加。"
    });

    expect(resultText(blocked)).toContain("请先调用 read_material_entry 或 search_material_entries");
    expect(resultText(searched)).toContain("L1:C");
    expect(resultText(searched)).toContain("七分钟");
    expect(allowed.details).toMatchObject({
      kind: "library-entry-mutation",
      operation: "edit",
      domain: "material",
      libraryId: "material-library-1",
      entryId: "material-entry-1",
      documentId: "material:material-library-1:material-entry-1",
      stageId: "pacing",
      text: "汽笛迟到了七分钟。共同片段。\n\n补充内容。",
      baseProjectRevision: 7
    });
    expect(resultText(stillBlocked)).toContain("请先调用");
  });

  it("requires unique fragments and composes sequential revisions", async () => {
    const tools = buildLibraryAgentTools({
      workspace: materialWorkspace(),
      profile: profile("material")
    });
    const read = toolByName(tools, "read_material_entry");
    const edit = toolByName(tools, "edit_material_entry");
    await read.execute("read-1", { entry_id: "material-entry-1" });

    const first = await edit.execute("edit-1", {
      entry_id: "material-entry-1",
      mode: "replace_fragments",
      replacements: [{ original_text: "七分钟", new_text: "九分钟" }]
    });
    const second = await edit.execute("edit-2", {
      entry_id: "material-entry-1",
      mode: "replace_fragments",
      replacements: [{ original_text: "九分钟", new_text: "十一分钟" }]
    });
    await read.execute("read-2", { entry_id: "material-entry-2" });
    const duplicate = await edit.execute("edit-3", {
      entry_id: "material-entry-2",
      mode: "replace_fragments",
      replacements: [{ original_text: "片", new_text: "替换" }]
    });

    const firstDetails = first.details as Extract<
      LibraryAgentToolDetails,
      { kind: "library-entry-mutation" }
    >;
    expect(second.details).toMatchObject({
      kind: "library-entry-mutation",
      text: "汽笛迟到了十一分钟。共同片段。",
      baseRevision: createShortWorkspaceContentRevision(
        "汽笛迟到了九分钟。共同片段。"
      )
    });
    expect(firstDetails.baseRevision).toBe(
      createShortWorkspaceContentRevision("汽笛迟到了七分钟。共同片段。")
    );
    expect(resultText(duplicate)).toContain("出现多次");
    expect(duplicate.details).toEqual({ kind: "none" });
  });

  it("requires explicit whole-body overwrite authorization", async () => {
    const tools = buildLibraryAgentTools({
      workspace: skillWorkspace(),
      profile: profile("skill")
    });
    const read = toolByName(tools, "read_skill_entry");
    const edit = toolByName(tools, "edit_skill_entry");
    await read.execute("read-1", { entry_id: "skill-entry-1" });

    const blocked = await edit.execute("edit-1", {
      entry_id: "skill-entry-1",
      mode: "replace",
      body: "新技能全文。"
    });
    const allowed = await edit.execute("edit-2", {
      entry_id: "skill-entry-1",
      mode: "replace",
      body: "新技能全文。",
      allow_overwrite_existing: true
    });

    expect(resultText(blocked)).toContain("allow_overwrite_existing=true");
    expect(allowed.details).toMatchObject({
      kind: "library-entry-mutation",
      operation: "edit",
      domain: "skill",
      title: "悬疑分节写法",
      text: "新技能全文。"
    });
  });

  it("blocks truncated and entry-level read-only writes", async () => {
    const current = materialWorkspace().entries[0]!;
    const tools = buildLibraryAgentTools({
      workspace: materialWorkspace({
        entries: [
          {
            ...current,
            truncated: true,
            originalLength: current.content.length + 100
          },
          {
            ...materialWorkspace().entries[1]!,
            readOnly: true
          }
        ]
      }),
      profile: profile("material")
    });
    const read = toolByName(tools, "read_material_entry");
    const edit = toolByName(tools, "edit_material_entry");
    await read.execute("read-1", { entry_id: "material-entry-1" });
    await read.execute("read-2", { entry_id: "material-entry-2" });
    const truncated = await edit.execute("edit-1", {
      entry_id: "material-entry-1",
      mode: "append",
      body: "追加"
    });
    const readOnly = await edit.execute("edit-2", {
      entry_id: "material-entry-2",
      mode: "append",
      body: "追加"
    });

    expect(resultText(truncated)).toContain("安全快照上限");
    expect(resultText(readOnly)).toContain("只读资料库");
  });

  it("creates a pending mutation and exposes it to later reads in the same run", async () => {
    const tools = buildLibraryAgentTools({
      workspace: skillWorkspace(),
      profile: profile("skill"),
      writeApprovalMode: "auto-approve"
    });
    const created = await toolByName(tools, "create_skill_entry").execute(
      "tool/call:new-skill",
      {
        stage_id: "draft",
        title: "去 AI 味检查",
        body: "逐句检查抽象总结和重复句式。"
      }
    );
    const details = created.details as Extract<
      LibraryAgentToolDetails,
      { kind: "library-entry-mutation"; operation: "create" }
    >;
    const read = await toolByName(tools, "read_skill_entry").execute("read-new", {
      name: "去 AI 味检查"
    });

    expect(details).toMatchObject({
      operation: "create",
      domain: "skill",
      libraryId: "skill-library-1",
      stageId: "draft",
      title: "去 AI 味检查",
      text: "逐句检查抽象总结和重复句式。",
      baseRevision: createShortWorkspaceContentRevision("")
    });
    expect(details).not.toHaveProperty("entryId");
    expect(details).not.toHaveProperty("documentId");
    expect(resultText(created)).toContain("将在本轮完成后自动批准并保存");
    expect(resultText(read)).toContain("逐句检查抽象总结和重复句式。");
    expect(isLibraryAgentToolDetails(created.details)).toBe(true);
  });

  it("rejects cross-domain profile assembly", () => {
    expect(() =>
      buildLibraryAgentTools({
        workspace: materialWorkspace(),
        profile: profile("skill")
      })
    ).toThrow("profile domain does not match");
  });

  it("lists and reads peer group libraries via the original tools without allowing writes", async () => {
    const workspace = materialWorkspace({
      kind: "character",
      groupId: "material-group-1",
      groupTitle: "雾港素材组",
      readableLibraries: [
        { libraryId: "material-library-1", title: "雾港素材", kind: "character" },
        { libraryId: "material-plot", title: "剧情素材", kind: "plot" }
      ],
      entries: [
        {
          id: "material-entry-1",
          documentId: "material:material-library-1:material-entry-1",
          stageId: "character",
          title: "雾港侦探",
          content: "当前库人物。",
          revision: createShortWorkspaceContentRevision("当前库人物。"),
          readOnly: false
        },
        {
          id: "material-plot/plot-entry-1",
          documentId: "material:material-plot:plot-entry-1",
          stageId: "pacing",
          title: "节奏钩子",
          content: "同组剧情素材。",
          revision: createShortWorkspaceContentRevision("同组剧情素材。"),
          readOnly: true,
          sourceLibraryId: "material-plot",
          sourceLibraryTitle: "剧情素材"
        }
      ]
    });
    const tools = buildLibraryAgentTools({
      workspace,
      profile: profile("material")
    });

    const list = await toolByName(tools, "list_material_entries").execute("list-group", {});
    const peerRead = await toolByName(tools, "read_material_entry").execute("read-peer", {
      name: "节奏钩子",
      library_id: "material-plot"
    });
    const peerReadByBareId = await toolByName(tools, "read_material_entry").execute(
      "read-peer-bare",
      {
        entry_id: "plot-entry-1",
        stage_id: "pacing",
        library_id: "material-plot"
      }
    );
    const peerReadByBareIdAlone = await toolByName(tools, "read_material_entry").execute(
      "read-peer-bare-alone",
      { entry_id: "plot-entry-1" }
    );
    const peerEdit = await toolByName(tools, "edit_material_entry").execute("edit-peer", {
      entry_id: "material-plot/plot-entry-1",
      mode: "append",
      body: "不应写入"
    });
    const created = await toolByName(tools, "create_material_entry").execute("create-current", {
      stage_id: "character",
      title: "新人物",
      body: "只写入当前库。"
    });

    expect(resultText(list)).toContain("雾港素材组");
    expect(resultText(list)).toContain("节奏钩子");
    expect(resultText(list)).toContain("material-plot");
    expect(resultText(peerRead)).toContain("同组剧情素材。");
    expect(resultText(peerRead)).toContain("同分组只读");
    expect(resultText(peerReadByBareId)).toContain("同组剧情素材。");
    expect(resultText(peerReadByBareId)).toContain("entry_id：material-plot/plot-entry-1");
    expect(resultText(peerReadByBareIdAlone)).toContain("同组剧情素材。");
    expect(resultText(peerEdit)).toContain("同分组其它库");
    expect(created.details).toMatchObject({
      kind: "library-entry-mutation",
      operation: "create",
      libraryId: "material-library-1",
      stageId: "character"
    });
  });

  it("reports ambiguity when the same bare entry_id exists in multiple peer libraries", async () => {
    const workspace = materialWorkspace({
      groupId: "material-group-1",
      groupTitle: "雾港素材组",
      readableLibraries: [
        { libraryId: "material-library-1", title: "雾港素材", kind: "character" },
        { libraryId: "material-plot", title: "剧情素材", kind: "plot" },
        { libraryId: "material-gimmick", title: "梗素材", kind: "gimmick" }
      ],
      entries: [
        {
          id: "material-entry-1",
          documentId: "material:material-library-1:material-entry-1",
          stageId: "character",
          title: "雾港侦探",
          content: "当前库人物。",
          revision: createShortWorkspaceContentRevision("当前库人物。"),
          readOnly: false
        },
        {
          id: "material-plot/shared-entry",
          documentId: "material:material-plot:shared-entry",
          stageId: "pacing",
          title: "剧情共享条目",
          content: "剧情侧。",
          revision: createShortWorkspaceContentRevision("剧情侧。"),
          readOnly: true,
          sourceLibraryId: "material-plot",
          sourceLibraryTitle: "剧情素材"
        },
        {
          id: "material-gimmick/shared-entry",
          documentId: "material:material-gimmick:shared-entry",
          stageId: "gimmick",
          title: "梗共享条目",
          content: "梗侧。",
          revision: createShortWorkspaceContentRevision("梗侧。"),
          readOnly: true,
          sourceLibraryId: "material-gimmick",
          sourceLibraryTitle: "梗素材"
        }
      ]
    });
    const tools = buildLibraryAgentTools({
      workspace,
      profile: profile("material")
    });

    const ambiguous = await toolByName(tools, "read_material_entry").execute(
      "read-ambiguous",
      { entry_id: "shared-entry" }
    );
    const disambiguated = await toolByName(tools, "read_material_entry").execute(
      "read-disambiguated",
      {
        entry_id: "shared-entry",
        library_id: "material-gimmick",
        stage_id: "gimmick"
      }
    );

    expect(resultText(ambiguous)).toContain("匹配到多个条目");
    expect(resultText(ambiguous)).toContain("material-plot/shared-entry");
    expect(resultText(ambiguous)).toContain("material-gimmick/shared-entry");
    expect(resultText(disambiguated)).toContain("梗侧。");
    expect(resultText(disambiguated)).not.toContain("剧情侧。");
  });
});
