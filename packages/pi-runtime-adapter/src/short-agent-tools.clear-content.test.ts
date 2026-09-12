import { DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES } from "@deepwrite/contracts";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
  buildScriptWorkspaceTools,
  buildShortWorkspaceTools,
  createShortWorkspaceToolSharedState
} from "./short-agent-tools";
import {
  resultText,
  shortProfile,
  shortWorkspace,
  toolByName
} from "./short-agent-tools.test-support";

function workspaceTools(workspaceType: "short" | "script") {
  const workspace = shortWorkspace("draft", { characterList: true });
  const sharedState = createShortWorkspaceToolSharedState(workspace);
  const input = { sharedState, autoApproveCrossStageOperations: true };
  const tools =
    workspaceType === "short"
      ? buildShortWorkspaceTools({
          ...input,
          workspace,
          profile: shortProfile()
        })
      : buildScriptWorkspaceTools({
          ...input,
          workspace: { ...workspace, activeAgentId: "script" },
          profile: DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES[0]!
        });
  return { tools, sharedState };
}

const targets = [
  {
    target: { kind: "character_overview", id: "character_design" },
    mutation: {
      kind: "workspace-editor-mutation",
      stageId: "character_design"
    }
  },
  {
    target: { kind: "character", id: "character-lin" },
    mutation: {
      kind: "workspace-character-file-mutation",
      itemId: "character-lin"
    }
  },
  {
    target: { kind: "plot_stage", id: "plot_design" },
    mutation: { kind: "workspace-editor-mutation", stageId: "plot_design" }
  },
  {
    target: { kind: "draft_section", id: "section-1", document: "body" },
    mutation: {
      kind: "workspace-expert-draft-file-mutation",
      sectionId: "section-1",
      fileKind: "body"
    }
  },
  {
    target: {
      kind: "draft_section",
      id: "section-1",
      document: "character_state"
    },
    mutation: {
      kind: "workspace-expert-draft-file-mutation",
      sectionId: "section-1",
      fileKind: "characterState"
    }
  }
] as const;

describe.each(["short", "script"] as const)(
  "%s empty content writes",
  (workspaceType) => {
    it("edit clears every target while retaining its identity and read evidence", async () => {
      const name = "edit";
      const { tools, sharedState } = workspaceTools(workspaceType);
      const tool = toolByName(tools, name);
      const read = toolByName(tools, "read");
      expect(tool.description).toContain("空字符串表示清空目标正文");
      expect(JSON.stringify(tool.parameters)).toContain("表示清空目标正文");

      for (const { target, mutation } of targets) {
        await read.execute("read-before-clear", target);
        const args = validateToolArguments(tool, {
          type: "toolCall",
          id: "clear-content",
          name,
          arguments: {
            ...target,
            content: "",
            allow_overwrite_existing: true,
            summary: "清空正文"
          }
        });
        const result = await tool.execute("clear-content", args);
        expect(result.details).toMatchObject({ ...mutation, text: "" });
        // A subsequent write must see the empty overlay, not the old text.
        expect(
          (
            await tool.execute("write-after-clear", {
              ...target,
              content: "重新写入的正文。",
              summary: "重新写入"
            })
          ).details
        ).toMatchObject({ ...mutation, text: "重新写入的正文。" });
      }

      expect(sharedState.characterItemOrder).toEqual([
        "character-lin",
        "character-su"
      ]);
      expect(sharedState.plotStageOrder).toContain("plot_design");
      expect(sharedState.expertSectionOrder).toEqual([
        "section-1",
        "section-2"
      ]);
      expect(sharedState.expertSections.get("section-2")?.body.content).toBe(
        "暗房显出了照片。"
      );
    });

    it("edit still requires a full read and explicit overwrite permission to clear text", async () => {
      const name = "edit";
      const { tools } = workspaceTools(workspaceType);
      const tool = toolByName(tools, name);
      const target = targets[3]!.target;
      const args = { ...target, content: "", summary: "清空正文" };
      expect(
        resultText(
          await tool.execute("clear-unread", {
            ...args,
            allow_overwrite_existing: true
          })
        )
      ).toContain("请先用 read 完整读取");
      await toolByName(tools, "read").execute("read-body", target);
      expect(
        resultText(await tool.execute("clear-unconfirmed", args))
      ).toContain("allow_overwrite_existing=true");
    });

    it("edit accepts an already empty document without overwrite permission", async () => {
      const name = "edit";
      const { tools } = workspaceTools(workspaceType);
      const tool = toolByName(tools, name);
      const args = {
        id: "section-2",
        document: "character_state",
        content: "",
        summary: "清空人物状态"
      };
      expect((await tool.execute("clear-empty", args)).details).toMatchObject({
        kind: "workspace-expert-draft-file-mutation",
        text: ""
      });
    });

    it("rejects edits without a content, replacements or metadata intent", async () => {
      const { tools } = workspaceTools(workspaceType);
      const tool = toolByName(tools, "edit");
      await expect(
        tool.execute("missing-content", {
          ...targets[3]!.target,
          summary: "清空正文"
        })
      ).rejects.toThrow("edit 必须且只能选择 content、replacements 或 meta。");
    });
  }
);
