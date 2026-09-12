import { validateToolArguments } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { screenplayWorkspace, scriptAgentProfile } from "./index.test-support";
import {
  buildScriptWorkspaceTools,
  buildShortWorkspaceTools
} from "./short-agent-tools";
import {
  details,
  resultText,
  shortProfile,
  shortWorkspace,
  toolByName
} from "./short-agent-tools.test-support";

function workspaceTools(workspaceType: "short" | "script") {
  const workspace = shortWorkspace("draft");
  return workspaceType === "short"
    ? buildShortWorkspaceTools({ workspace, profile: shortProfile() })
    : buildScriptWorkspaceTools({
        workspace: {
          ...screenplayWorkspace(),
          expertDraft: workspace.expertDraft,
          activeSectionId: "section-1"
        },
        profile: scriptAgentProfile()
      });
}

describe.each(["short", "script"] as const)(
  "%s omitted mutation kind",
  (workspaceType) => {
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
        "allow_overwrite_existing=true"
      );
      expect(
        details(
          await tool.execute("allowed", {
            ...args,
            allow_overwrite_existing: true
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
      ).rejects.toThrow("不接受 document");
    });
  }
);
