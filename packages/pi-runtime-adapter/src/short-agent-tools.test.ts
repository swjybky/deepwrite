import { createShortWorkspaceContentRevision } from "@deepwrite/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  SHORT_WORKSPACE_TOOL_MANIFEST,
  buildShortWorkspaceTools,
  createShortWorkspaceToolSharedState
} from "./short-agent-tools";
import {
  details,
  expertSection,
  resultText,
  shortProfile,
  shortWorkspace,
  toolByName
} from "./short-agent-tools.test-support";

describe("unified short workspace tools", () => {
  it("exposes four workspace tools plus on-demand resources", () => {
    const tools = buildShortWorkspaceTools({
      workspace: shortWorkspace(),
      profile: shortProfile()
    });
    const names = tools.map(({ name }) => name);
    expect(names).toEqual([
      ...SHORT_WORKSPACE_TOOL_MANIFEST.unified,
      "query_linked_material_entries",
      "load_skill",
      "ask_user_question"
    ]);
    expect(names).not.toContain("switch_storyline_stage");
    expect(names).not.toContain("delete_expert_draft_section");
    expect(names).toContain("delete");
    expect(JSON.stringify(toolByName(tools, "read").parameters)).not.toMatch(
      /offset|max_characters|page_size/u
    );
    expect(JSON.stringify(toolByName(tools, "create").parameters)).toContain(
      '"required":["title"]'
    );
    expect(toolByName(tools, "create").description).toContain(
      "创建一项全局剧情结构"
    );
    expect(toolByName(tools, "read").description).toContain(
      "kind=draft_section 必须同时给出 document=body 或 character_state"
    );
    expect(names).not.toContain("write");
    expect(toolByName(tools, "edit").description).toContain(
      "kind=draft_section 修改正文或人物状态时必须同时给出 document=body 或 character_state"
    );
    expect(JSON.stringify(toolByName(tools, "read").parameters)).toContain(
      "读取、写入或修改 draft_section 必须指定"
    );
    expect(JSON.stringify(toolByName(tools, "read").parameters)).toContain(
      "不传 document 时默认 body"
    );
    expect(
      JSON.stringify(toolByName(tools, "delete").parameters)
    ).not.toContain('"document"');
  });

  it("reads every target kind and asks before a cross-stage mutation", async () => {
    const snapshot = shortWorkspace("character_design", {
      characterList: true
    });
    const requestUserInput = vi.fn(async (request) => ({
      sessionId: "session-tools",
      runId: "run-tools",
      requestId: request.requestId ?? "cross-stage-request",
      answers: [{ id: "cross_stage_write", selectedOptionIds: ["cancel"] }]
    }));
    const tools = buildShortWorkspaceTools({
      workspace: snapshot,
      profile: shortProfile(),
      requestUserInput
    });
    const read = toolByName(tools, "read");
    const plot = resultText(
      await read.execute("read-plot", {
        kind: "plot_stage",
        id: "plot_design"
      })
    );
    expect(plot).toContain("【剧情设计】");
    expect(plot).toContain("kind: plot_stage");
    expect(plot).toContain("id: plot_design");
    expect(plot).toContain("旧剧情的唯一片段");
    expect(plot).not.toMatch(/^revision:/mu);
    expect(plot).not.toContain("revision:");
    expect(
      resultText(
        await read.execute("read-character", {
          kind: "character",
          id: "character-lin"
        })
      )
    ).toContain("林默害怕迟到");
    const draftSection = resultText(
      await read.execute("read-draft", {
        kind: "draft_section",
        id: "section-1",
        document: "body"
      })
    );
    expect(draftSection).toContain("汽笛迟到了七分钟");
    expect(draftSection).not.toContain("revision:");
    const draftDirectory = resultText(
      await read.execute("read-draft-directory", {
        kind: "draft",
        id: "draft"
      })
    );
    expect(draftDirectory).toContain("kind: draft");
    expect(draftDirectory).toContain("id: draft");
    expect(draftDirectory).toContain("第一节");
    expect(draftDirectory).not.toContain("revision:");
    expect(
      resultText(
        await toolByName(tools, "edit").execute("edit-other-stage", {
          kind: "plot_stage",
          id: "plot_design",
          replacements: [{ original_text: "唯一片段", new_text: "新片段" }],
          summary: "修改剧情"
        })
      )
    ).toContain("用户取消");
    expect(requestUserInput).toHaveBeenCalledTimes(1);
    expect(requestUserInput.mock.calls[0]?.[0]).toMatchObject({
      source: "cross_stage_write"
    });
  });

  it("confirms every cross-stage mutation separately", async () => {
    const requestUserInput = vi.fn(async (request) => ({
      sessionId: "session-tools",
      runId: "run-tools",
      requestId: request.requestId ?? "cross-stage-request",
      answers: [
        {
          id: "cross_stage_write",
          selectedOptionIds: ["continue_once"]
        }
      ]
    }));
    const tools = buildShortWorkspaceTools({
      workspace: shortWorkspace("character_design"),
      profile: shortProfile(),
      requestUserInput
    });
    const read = toolByName(tools, "read");
    await read.execute("read-plot", {
      kind: "plot_stage",
      id: "plot_design"
    });
    const edit = toolByName(tools, "edit");
    await edit.execute("edit-plot-1", {
      kind: "plot_stage",
      id: "plot_design",
      replacements: [{ original_text: "唯一片段", new_text: "第一版" }],
      summary: "第一次跨阶段修改"
    });
    await edit.execute("edit-plot-2", {
      kind: "plot_stage",
      id: "plot_design",
      replacements: [{ original_text: "第一版", new_text: "第二版" }],
      summary: "第二次跨阶段修改"
    });
    expect(requestUserInput).toHaveBeenCalledTimes(2);
  });

  it("auto-approves cross-stage mutations without requesting user input", async () => {
    const requestUserInput = vi.fn(async () => {
      throw new Error("cross-stage input should have been auto-approved");
    });
    const tools = buildShortWorkspaceTools({
      workspace: shortWorkspace("character_design"),
      profile: shortProfile(),
      autoApproveCrossStageOperations: true,
      requestUserInput
    });
    const read = toolByName(tools, "read");
    await read.execute("read-auto-approved-plot", {
      kind: "plot_stage",
      id: "plot_design"
    });
    const result = await toolByName(tools, "edit").execute(
      "edit-auto-approved-plot",
      {
        kind: "plot_stage",
        id: "plot_design",
        replacements: [{ original_text: "唯一片段", new_text: "自动允许" }],
        summary: "自动允许跨阶段修改"
      }
    );

    expect(requestUserInput).not.toHaveBeenCalled();
    expect(details(result)).toMatchObject({
      kind: "workspace-editor-mutation",
      stageId: "plot_design",
      summary: "自动允许跨阶段修改"
    });
  });

  it("reads whole objects and can return the complete manuscript", async () => {
    const content = "甲".repeat(40_000);
    const snapshot = shortWorkspace("plot_design", { plotContent: content });
    snapshot.expertDraft.sections = [
      expertSection("section-1", "第一节", `${"甲".repeat(30_000)}甲尾`),
      expertSection("section-2", "第二节", `${"乙".repeat(30_000)}乙尾`)
    ];
    const tools = buildShortWorkspaceTools({
      workspace: snapshot,
      profile: shortProfile()
    });
    const read = toolByName(tools, "read");
    const fullPlot = await read.execute("read-plot", {
      kind: "plot_stage",
      id: "plot_design"
    });
    expect(resultText(fullPlot)).toContain(content);
    expect(resultText(fullPlot)).not.toContain("next_offset");

    await expect(
      read.execute("read-draft-missing-document", {
        kind: "draft_section",
        id: "section-1"
      })
    ).rejects.toThrow(
      "读取 draft_section 必须指定 document=body 或 character_state。"
    );
    await expect(
      toolByName(tools, "edit").execute("edit-draft-missing-document", {
        kind: "draft_section",
        id: "section-1",
        content: "新正文",
        summary: "修改正文"
      })
    ).rejects.toThrow(
      "修改 draft_section 正文时必须指定 document=body 或 character_state。"
    );

    const manuscript = await read.execute("read-manuscript", {
      kind: "draft",
      id: "draft",
      include_all_sections: true
    });
    expect(resultText(manuscript)).toContain("甲尾");
    expect(resultText(manuscript)).toContain("乙尾");
    expect(resultText(manuscript)).toContain("超过 50000 字");

    const proposal = await toolByName(tools, "edit").execute("write-allowed", {
      kind: "plot_stage",
      id: "plot_design",
      content: "新剧情",
      allow_overwrite_existing: true,
      summary: "重写剧情"
    });
    expect(details(proposal)).toMatchObject({
      kind: "workspace-editor-mutation",
      stageId: "plot_design",
      text: "新剧情",
      baseRevision: createShortWorkspaceContentRevision(content)
    });
  });

  it("requires explicit overwrite and performs only unique replacements", async () => {
    const tools = buildShortWorkspaceTools({
      workspace: shortWorkspace("plot_design", {
        plotContent: "重复。重复。唯一。"
      }),
      profile: shortProfile()
    });
    const read = toolByName(tools, "read");
    await read.execute("read-all", {
      kind: "plot_stage",
      id: "plot_design"
    });
    const edit = toolByName(tools, "edit");
    expect(
      resultText(
        await edit.execute("overwrite-without-flag", {
          kind: "plot_stage",
          id: "plot_design",
          content: "整篇新稿",
          summary: "重写"
        })
      )
    ).toContain("allow_overwrite_existing=true");

    expect(
      resultText(
        await edit.execute("duplicate", {
          kind: "plot_stage",
          id: "plot_design",
          replacements: [{ original_text: "重复", new_text: "修改" }],
          summary: "局部修改"
        })
      )
    ).toContain("原文片段出现多次");
    const replaced = await edit.execute("unique", {
      kind: "plot_stage",
      id: "plot_design",
      replacements: [{ original_text: "唯一", new_text: "独有" }],
      summary: "局部修改"
    });
    expect(details(replaced)).toMatchObject({
      kind: "workspace-editor-mutation",
      text: "重复。重复。独有。"
    });
  });

  it("edits allowed metadata without exposing stage switching", async () => {
    const characterTools = buildShortWorkspaceTools({
      workspace: shortWorkspace("character_design", { characterList: true }),
      profile: shortProfile()
    });
    const renamed = await toolByName(characterTools, "edit").execute(
      "rename-character",
      {
        kind: "character",
        id: "character-lin",
        meta: { title: "林墨" },
        summary: "人物改名"
      }
    );
    expect(details(renamed)).toMatchObject({
      kind: "workspace-character-structure-mutation",
      mutation: { type: "updateItem", title: "林墨" }
    });
    const moved = await toolByName(characterTools, "edit").execute(
      "move-character",
      {
        kind: "character",
        id: "character-su",
        meta: { move: "up" },
        summary: "上移人物"
      }
    );
    expect(details(moved)).toMatchObject({
      mutation: { type: "moveItem", direction: "up" }
    });

    const draftTools = buildShortWorkspaceTools({
      workspace: shortWorkspace("draft"),
      profile: shortProfile()
    });
    const draftRenamed = await toolByName(draftTools, "edit").execute(
      "rename-draft",
      {
        kind: "draft_section",
        id: "section-1",
        document: "body",
        meta: { title: "迟到的汽笛" },
        summary: "正文改名"
      }
    );
    expect(details(draftRenamed)).toMatchObject({
      kind: "workspace-expert-draft-section-rename",
      sectionId: "section-1",
      title: "迟到的汽笛"
    });
  });

  it("shares proposal overlays but isolates parent and child read evidence", async () => {
    const snapshot = shortWorkspace("plot_design");
    const sharedState = createShortWorkspaceToolSharedState(snapshot);
    const parent = buildShortWorkspaceTools({
      workspace: snapshot,
      profile: shortProfile(),
      sharedState
    });
    const child = buildShortWorkspaceTools({
      workspace: snapshot,
      profile: shortProfile(),
      sharedState
    });
    await toolByName(child, "read").execute("child-read", {
      kind: "plot_stage",
      id: "plot_design"
    });
    await toolByName(child, "edit").execute("child-write", {
      kind: "plot_stage",
      id: "plot_design",
      content: "子智能体的新剧情。",
      allow_overwrite_existing: true,
      summary: "子智能体修改"
    });
    expect(
      resultText(
        await toolByName(parent, "read").execute("parent-see-overlay", {
          kind: "plot_stage",
          id: "plot_design"
        })
      )
    ).toContain("子智能体的新剧情");
    const parentEdit = await toolByName(parent, "edit").execute(
      "parent-edit-overlay",
      {
        kind: "plot_stage",
        id: "plot_design",
        replacements: [{ original_text: "新剧情", new_text: "修订剧情" }],
        summary: "父智能体修订"
      }
    );
    expect(details(parentEdit)).toMatchObject({
      kind: "workspace-editor-mutation",
      baseRevision: createShortWorkspaceContentRevision("子智能体的新剧情。"),
      text: "子智能体的修订剧情。"
    });

    const isolatedParent = buildShortWorkspaceTools({
      workspace: snapshot,
      profile: shortProfile(),
      sharedState
    });
    expect(
      resultText(
        await toolByName(isolatedParent, "edit").execute("parent-blocked", {
          kind: "plot_stage",
          id: "plot_design",
          content: "父智能体覆盖。",
          allow_overwrite_existing: true,
          summary: "父智能体修改"
        })
      )
    ).toContain("请先用 read 完整读取");
  });

  it("rejects mutations against truncated snapshots", async () => {
    const tools = buildShortWorkspaceTools({
      workspace: shortWorkspace("plot_design", { truncatedPlot: true }),
      profile: shortProfile()
    });
    await toolByName(tools, "read").execute("read-truncated", {
      kind: "plot_stage",
      id: "plot_design"
    });
    await expect(
      toolByName(tools, "edit").execute("edit-truncated", {
        kind: "plot_stage",
        id: "plot_design",
        replacements: [{ original_text: "唯一片段", new_text: "新片段" }],
        summary: "修改"
      })
    ).rejects.toThrow("快照已截断");

    const characterTools = buildShortWorkspaceTools({
      workspace: shortWorkspace("character_design", {
        characterList: true,
        truncatedCharacter: true
      }),
      profile: shortProfile()
    });
    await toolByName(characterTools, "read").execute("read-character", {
      kind: "character",
      id: "character-lin"
    });
    await expect(
      toolByName(characterTools, "edit").execute("edit-character", {
        kind: "character",
        id: "character-lin",
        replacements: [{ original_text: "害怕迟到", new_text: "从不迟到" }],
        summary: "修改人物"
      })
    ).rejects.toThrow("快照已截断");
  });

  it("filters linked resources by the current stage and loads bodies on demand", async () => {
    const tools = buildShortWorkspaceTools({
      workspace: shortWorkspace("character_design"),
      profile: shortProfile(),
      attachedMaterials: [
        {
          id: "character-entry",
          source: "attached-material",
          title: "人物素材",
          kind: "character",
          content: "人物素材正文"
        },
        {
          id: "plot-entry",
          source: "attached-material",
          title: "剧情素材",
          kind: "plot",
          content: "剧情素材正文"
        },
        {
          id: "character-entry-duplicate",
          source: "attached-material",
          title: "人物素材",
          kind: "character",
          content: "另一个人物素材正文"
        }
      ],
      attachedSkills: [
        {
          id: "general-skill",
          source: "attached-skill",
          title: "通用检查",
          kind: "general",
          content: "通用技能正文"
        },
        {
          id: "style-skill",
          source: "attached-skill",
          title: "风格润色",
          kind: "style",
          content: "风格技能正文"
        }
      ]
    });
    const materialList = await toolByName(
      tools,
      "query_linked_material_entries"
    ).execute("list-material", { mode: "list" });
    expect(resultText(materialList)).toContain("人物素材");
    expect(resultText(materialList)).not.toContain("剧情素材");
    const ambiguousMaterial = await toolByName(
      tools,
      "query_linked_material_entries"
    ).execute("read-ambiguous-material", {
      mode: "read",
      entry_name: "人物素材"
    });
    expect(resultText(ambiguousMaterial)).toContain("匹配到多个素材条目");
    const materialById = await toolByName(
      tools,
      "query_linked_material_entries"
    ).execute("read-material-by-id", {
      mode: "read",
      entry_name: "character-entry"
    });
    expect(resultText(materialById)).toContain("人物素材正文");
    const loaded = await toolByName(tools, "load_skill").execute(
      "load-general",
      { name: "通用检查" }
    );
    expect(resultText(loaded)).toContain("通用技能正文");
    const blocked = await toolByName(tools, "load_skill").execute(
      "load-style",
      { name: "风格润色" }
    );
    expect(resultText(blocked)).not.toContain("风格技能正文");
  });
});
