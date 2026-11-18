import { validateToolArguments } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
  buildEffectiveSystemPrompt,
  screenplayWorkspace,
  scriptAgentProfile
} from "./index.test-support";
import {
  buildScriptWorkspaceTools,
  buildShortWorkspaceTools
} from "./short-agent-tools";
import {
  details,
  expertSection,
  resultText,
  shortProfile,
  shortWorkspace,
  toolByName
} from "./short-agent-tools.test-support";

function workspaceTools(
  workspaceType: "short" | "script",
  workspace = shortWorkspace("draft")
) {
  return workspaceType === "short"
    ? buildShortWorkspaceTools({ workspace, profile: shortProfile() })
    : buildScriptWorkspaceTools({
        workspace: {
          ...screenplayWorkspace(),
          activeStageId: workspace.activeStageId,
          characterStructure: workspace.characterStructure,
          expertDraft: workspace.expertDraft,
          activeSectionId: "section-1"
        },
        profile: scriptAgentProfile()
      });
}

describe.each(["short", "script"] as const)(
  "%s omitted mutation kind",
  (workspaceType) => {
    it("provides an executable rename example even with a custom agent prompt", async () => {
      const tools = workspaceTools(workspaceType);
      const edit = toolByName(tools, "edit");
      const input = {
        runId: "rename-example",
        sessionId: "rename-example",
        prompt: "修改小节名称",
        ...(workspaceType === "short"
          ? {
              agentProfile: {
                ...shortProfile(),
                systemPrompt: "自定义创作要求。"
              },
              workspaceContext: { shortWorkspace: shortWorkspace() }
            }
          : {
              scriptAgentProfile: {
                ...scriptAgentProfile(),
                systemPrompt: "自定义创作要求。"
              },
              workspaceContext: { scriptWorkspace: screenplayWorkspace() }
            })
      };
      const example = buildEffectiveSystemPrompt("DeepWrite base", input).match(
        /edit\((\{.*?\})\)/u
      )?.[1];
      if (!example) throw new Error("Missing rename tool-call example.");
      const parameters = JSON.stringify(edit.parameters);
      expect(parameters).toContain("edit 只用 meta.title 改名时可省略");
      expect(parameters).toContain("标题时使用 draft_section");
      const args = validateToolArguments(edit, {
        type: "toolCall",
        id: "example-rename",
        name: "edit",
        arguments: { ...JSON.parse(example), id: "section-2" }
      });
      expect(details(await edit.execute("example-rename", args))).toMatchObject(
        {
          kind: "workspace-expert-draft-section-rename",
          sectionId: "section-2",
          title: "新标题"
        }
      );
    });

    it.each([undefined, "draft_section"] as const)(
      "renames a section with kind=%s and no document or manuscript write",
      async (kind) => {
        const workspace = shortWorkspace("draft");
        workspace.expertDraft.sections[1] = expertSection(
          "section-2",
          "第二节",
          "暗房显出了照片。",
          "苏遥发现了底片。"
        );
        const tools = workspaceTools(workspaceType, workspace);
        const tool = toolByName(tools, "edit");
        const args = validateToolArguments(tool, {
          type: "toolCall",
          id: "rename-section",
          name: "edit",
          arguments: {
            ...(kind ? { kind } : {}),
            id: "section-2",
            meta: { title: "照片里的来客" }
          }
        });

        expect(
          details(await tool.execute("rename-section", args))
        ).toMatchObject({
          kind: "workspace-expert-draft-section-rename",
          sectionId: "section-2",
          previousTitle: "第二节",
          title: "照片里的来客",
          baseRevision: shortWorkspace("draft").expertDraft.revision
        });
        const read = toolByName(tools, "read");
        const directory = resultText(
          await read.execute("directory", { kind: "draft", id: "draft" })
        );
        expect(directory).toContain("照片里的来客");
        expect(directory).toContain("第一节");
        const body = resultText(
          await read.execute("body", {
            kind: "draft_section",
            id: "section-2",
            document: "body"
          })
        );
        expect(body).toContain("暗房显出了照片。");
        expect(body).not.toContain("汽笛迟到了七分钟。");
        const state = resultText(
          await read.execute("state", {
            kind: "draft_section",
            id: "section-2",
            document: "character_state"
          })
        );
        expect(state).toContain("苏遥发现了底片。");
        expect(state).not.toContain("暗房显出了照片。");
      }
    );

    it("requires an explicit kind when a stable id belongs to multiple kinds", async () => {
      const workspace = shortWorkspace("draft", { characterList: true });
      if (workspace.characterStructure?.format !== "list") {
        throw new Error("Expected character list fixture.");
      }
      workspace.characterStructure.items[0]!.id = "section-2";
      const edit = toolByName(workspaceTools(workspaceType, workspace), "edit");
      await expect(
        edit.execute("ambiguous-rename", {
          id: "section-2",
          meta: { title: "新标题" }
        })
      ).rejects.toThrow("kind");
      expect(
        details(
          await edit.execute("explicit-rename", {
            kind: "draft_section",
            id: "section-2",
            meta: { title: "新标题" }
          })
        )
      ).toMatchObject({
        kind: "workspace-expert-draft-section-rename",
        sectionId: "section-2"
      });
    });

    it("renames an inferred section from another stage without asking", async () => {
      const tools = workspaceTools(
        workspaceType,
        shortWorkspace("plot_design")
      );
      expect(
        details(
          await toolByName(tools, "edit").execute("cross-stage-rename", {
            id: "section-2",
            meta: { title: "新标题" }
          })
        )
      ).toMatchObject({
        kind: "workspace-expert-draft-section-rename",
        sectionId: "section-2"
      });
      const directory = resultText(
        await toolByName(tools, "read").execute("directory", {
          kind: "draft",
          id: "draft"
        })
      );
      expect(directory).toContain("新标题");
    });

    it.each(["missing-section", "第二节", "plot_design", "character_design"])(
      "does not infer a section rename from an unrelated id %s",
      async (id) => {
        const edit = toolByName(workspaceTools(workspaceType), "edit");
        await expect(
          edit.execute("invalid-rename", { id, meta: { title: "新标题" } })
        ).rejects.toThrow("kind");
      }
    );

    it("keeps metadata edits separate from manuscript changes", async () => {
      const edit = toolByName(workspaceTools(workspaceType), "edit");
      await expect(
        edit.execute("mixed-rename", {
          id: "section-2",
          meta: { title: "新标题" },
          content: "不能顺便覆盖正文。"
        })
      ).rejects.toThrow(
        "只能选择 content、replacements、append、insert 或 meta"
      );
      await expect(
        edit.execute("duplicate-title", {
          id: "section-2",
          meta: { title: "第一节" }
        })
      ).rejects.toThrow("同名");
    });

    it("edit validates and proposes the requested character state", async () => {
      const name = "edit";
      const tools = workspaceTools(workspaceType);
      const tool = toolByName(tools, name);
      const args = {
        id: "section-2",
        document: "character_state",
        content: "林默确认了线索。",
        summary: "初始化人物状态"
      };
      const validated = validateToolArguments(tool, {
        type: "toolCall",
        id: "state-write",
        name,
        arguments: args
      });
      const result = await tool.execute("state-write", validated);
      expect(details(result)).toMatchObject({
        kind: "workspace-expert-draft-file-mutation",
        sectionId: "section-2",
        documentId: "draft:section-2:state",
        fileKind: "characterState",
        text: args.content
      });
      const body = await toolByName(tools, "read").execute("body", {
        kind: "draft_section",
        id: "section-2",
        document: "body"
      });
      expect(resultText(body)).toContain("暗房显出了照片。");
      expect(resultText(body)).not.toContain(args.content);
    });

    it("edit preserves targeting and overwrite guards", async () => {
      const name = "edit";
      const tools = workspaceTools(workspaceType);
      const tool = toolByName(tools, name);
      const args = {
        id: "section-1",
        document: "character_state",
        content: "新的状态。",
        summary: "更新状态"
      };
      expect(resultText(await tool.execute("unread", args))).toContain(
        "请先用 read 完整读取"
      );
      await toolByName(tools, "read").execute("read-state", {
        kind: "draft_section",
        id: args.id,
        document: args.document
      });
      expect(resultText(await tool.execute("overwrite", args))).toContain(
        "overwrite_mode=replace_all"
      );
      expect(
        details(
          await tool.execute("allowed", {
            ...args,
            overwrite_mode: "replace_all"
          })
        )
      ).toMatchObject({ fileKind: "characterState", text: args.content });
      await expect(
        tool.execute("missing-document", {
          id: args.id,
          content: args.content,
          summary: args.summary
        })
      ).rejects.toThrow("省略 kind 时必须指定 document");
      await expect(
        tool.execute("unknown", { ...args, id: "missing-section" })
      ).rejects.toThrow("missing-section");
      await expect(
        tool.execute("conflicting-kind", {
          ...args,
          kind: "plot_stage",
          id: "plot_design"
        })
      ).rejects.toThrow("不要传 document");
    });

    it("tolerates a redundant body document and mixed id separators", async () => {
      const read = toolByName(workspaceTools(workspaceType), "read");
      for (const request of [
        { kind: "plot_stage", id: "plot_design", document: "body" },
        { kind: "plot_stage", id: "plot-design" },
        { kind: "character_overview", id: "character_design", document: "body" }
      ])
        expect(resultText(await read.execute("lenient", request))).toContain(
          `id: ${request.id.replace("-", "_")}`
        );
      await expect(
        read.execute("by-title", { kind: "plot_stage", id: "剧情设计" })
      ).rejects.toThrow("「剧情设计」的 id 是 plot_design");
    });
  }
);
