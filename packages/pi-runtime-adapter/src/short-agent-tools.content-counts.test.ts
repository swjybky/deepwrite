import { DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES } from "@deepwrite/contracts";
import { describe, expect, it } from "vitest";
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

const countLabel = "目标内容字数（本次提案）：";
const body = "# 甲 A，\n\t乙\u3000🙂";

function writingTools(
  type: "short" | "script",
  autoApprove = false,
  cancel = false
) {
  const workspace = shortWorkspace("draft", { characterList: true });
  const input = {
    autoApproveCrossStageOperations: !cancel,
    ...(cancel
      ? {
          requestUserInput: async () => ({
            sessionId: "session_counts",
            runId: "run_counts",
            requestId: "cancel",
            answers: []
          })
        }
      : {}),
    writeApprovalMode: autoApprove
      ? ("auto-approve" as const)
      : ("request-approval" as const)
  };
  return type === "short"
    ? buildShortWorkspaceTools({ ...input, workspace, profile: shortProfile() })
    : buildScriptWorkspaceTools({
        ...input,
        workspace: { ...workspace, activeAgentId: "script" },
        profile: DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES[0]!
      });
}

const targets = [
  { kind: "character_overview", id: "character_design" },
  { kind: "character", id: "character-lin" },
  { kind: "plot_stage", id: "plot_design" },
  { kind: "draft_section", id: "section-1", document: "body" },
  { kind: "draft_section", id: "section-1", document: "character_state" }
];

describe.each(["short", "script"] as const)(
  "%s tool content counts",
  (type) => {
    it.each([
      { kind: "character", meta: { title: "新人物" } },
      { kind: "plot_stage", meta: { title: "新剧情", description: "剧情说明" } }
    ])("counts $kind creation and preserves its proposal", async (args) => {
      const create = toolByName(writingTools(type), "create");
      expect(create.description).toContain("完整内容的字数");
      const result = await create.execute("create", { ...args, content: body });
      expect(resultText(result)).toContain(`${countLabel}7 字`);
      expect(resultText(result)).toContain(args.meta.title);
      expect(resultText(result)).toMatch(/(?:item|stage)_id=/u);
      expect(details(result).kind).not.toBe("none");
    });

    it.each([false, true])(
      "counts both created draft files (auto approve: %s)",
      async (auto) => {
        const tools = writingTools(type, auto);
        const result = await toolByName(tools, "create").execute(
          "create-draft",
          {
            kind: "draft_section",
            meta: { title: "第三节" },
            content: body,
            character_state: "人物 状态。",
            summary: "新建正文，等待用户审阅。"
          }
        );
        const text = resultText(result);
        expect(text).toMatch(
          /第三节 · 正文（文档标识=.+:body）目标内容字数（本次提案）：7 字/u
        );
        expect(text).toMatch(
          /第三节 · 人物状态（文档标识=.+:character-state）目标内容字数（本次提案）：5 字/u
        );
        expect(text).toContain("section_id=pending:section:");
        expect(text).toContain(
          auto ? "以审批卡的落盘状态为准" : "等待用户审阅"
        );
        expect(details(result)).toMatchObject({
          kind: "workspace-expert-draft-section-creation",
          sections: [
            { bodyContent: body, characterStateContent: "人物 状态。" }
          ]
        });

        const empty = await toolByName(tools, "create").execute(
          "create-empty",
          {
            kind: "draft_section",
            meta: { title: "第四节" }
          }
        );
        expect(
          resultText(empty).match(/目标内容字数（本次提案）：0 字/gu)
        ).toHaveLength(2);
      }
    );

    it.each(targets)(
      "counts full content across consecutive edits of $kind $document",
      async (target) => {
        const tools = writingTools(type);
        const edit = toolByName(tools, "edit");
        expect(edit.description).toContain("完整内容的字数");
        await toolByName(tools, "read").execute("read", target);
        const written = await edit.execute("write", {
          ...target,
          content: body,
          allow_overwrite_existing: true,
          summary: "改写"
        });
        expect(resultText(written)).toContain(`${countLabel}7 字`);
        expect(details(written)).toMatchObject({ text: body });

        const replaced = await edit.execute("replace", {
          ...target,
          replacements: [{ original_text: "甲", new_text: "甲乙丙" }],
          summary: "扩写"
        });
        expect(resultText(replaced)).toContain(`${countLabel}9 字`);
        expect(details(replaced)).toMatchObject({
          text: body.replace("甲", "甲乙丙")
        });

        const cleared = await edit.execute("clear", {
          ...target,
          content: "",
          allow_overwrite_existing: true,
          summary: "清空"
        });
        expect(resultText(cleared)).toContain(`${countLabel}0 字`);
        const rewritten = await edit.execute("rewrite", {
          ...target,
          content: "新 正文。",
          summary: "写入空文档"
        });
        expect(resultText(rewritten)).toContain(`${countLabel}4 字`);
      }
    );

    it("omits counts for metadata-only changes and unsuccessful edits", async () => {
      const tools = writingTools(type);
      const edit = toolByName(tools, "edit");
      const target = {
        kind: "draft_section",
        id: "section-1",
        document: "body"
      };
      const args = { ...target, content: body, summary: "改写" };
      expect(resultText(await edit.execute("unread", args))).not.toContain(
        countLabel
      );
      await toolByName(tools, "read").execute("read", target);
      expect(resultText(await edit.execute("unconfirmed", args))).not.toContain(
        countLabel
      );
      expect(
        resultText(
          await edit.execute("no-match", {
            ...target,
            replacements: [{ original_text: "不存在", new_text: "替换" }],
            summary: "替换"
          })
        )
      ).not.toContain(countLabel);
      expect(
        resultText(
          await edit.execute("rename", {
            kind: "draft_section",
            id: "section-1",
            meta: { title: "新标题" },
            summary: "改名"
          })
        )
      ).not.toContain(countLabel);
    });

    it("omits counts when create or edit is cancelled", async () => {
      const tools = writingTools(type, false, true);
      const results = [
        await toolByName(tools, "create").execute("cancel-create", {
          kind: "character",
          meta: { title: "新人物" },
          content: body
        }),
        await toolByName(tools, "edit").execute("cancel-edit", {
          kind: "character",
          id: "character-lin",
          content: body,
          summary: "改写"
        })
      ];
      for (const result of results) {
        expect(resultText(result)).toContain("用户取消");
        expect(resultText(result)).not.toContain(countLabel);
        expect(details(result)).toEqual({ kind: "none" });
      }
    });
  }
);
