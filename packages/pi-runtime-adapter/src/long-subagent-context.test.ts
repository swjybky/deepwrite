import { describe, expect, it } from "vitest";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import {
  fixtureIndex,
  documentExecutor,
  createLongWorkspaceNavigationSnapshot,
  profile,
  resultText,
  toolByName
} from "./long-agent-tools.test-support";
import {
  handoffRuntime,
  lastToolText
} from "./subagent-workspace-handoff.test-support";
import type { AgentRunInput } from "./runtime-types";

function input() {
  const index = fixtureIndex();
  const run: AgentRunInput = {
    sessionId: "long-handoff-session",
    runId: "long-handoff-run",
    prompt: "此处的主对话内容不应自动进入成员上下文。",
    longAgentProfile: profile("long"),
    longCommandExecutor: documentExecutor(index),
    writeApprovalMode: "auto-approve",
    workspaceContext: {
      longWorkspace: {
        bookId: index.bookId,
        title: "长篇交接合成书",
        activeAgentId: "long",
        activeRoot: "draft",
        agentsMd: "角色不能在雾中看清远处。",
        navigation: createLongWorkspaceNavigationSnapshot(index)
      }
    },
    subagentDefinitions: ["planner", "writer"].map((id) => ({
      id,
      name: id,
      description: "长篇交接测试",
      systemPrompt: "完成委派。",
      enabled: true,
      modelMode: "inherit",
      agentMode: "standard"
    }))
  };
  return { index, run };
}

function newChapterId(systemPrompt = ""): string {
  const line = systemPrompt
    .split("\n")
    .find((line) => line.includes("「交接新章」"));
  const id = line?.match(/\((chapter_[^)]+)\)/u)?.[1];
  if (!id) throw new Error("The child directory is missing the new chapter");
  return id;
}

describe("long subagent live workspace context", () => {
  it.each(["standard", "pure-read"] as const)(
    "passes rules and a preceding member's new chapter to a %s member",
    async (mode) => {
      const { run } = input();
      run.subagentDefinitions![1]!.agentMode = mode;
      let id = "";
      const runtime = handoffRuntime(run, (context, turn) => {
        if (turn === 0) {
          expect(context.systemPrompt).toContain("【对象定位】");
          expect(context.systemPrompt).toContain("volume_one");
          expect(context.systemPrompt).toContain("角色不能在雾中看清远处。");
          expect(context.systemPrompt).toContain("【创建】");
          expect(context.systemPrompt).not.toMatch(
            /ask_user_question|load_skill|spawn_subagent/u
          );
          return fauxAssistantMessage(
            fauxToolCall("create", {
              kind: "chapter_card",
              meta: { title: "交接新章", volume_id: "volume_one" },
              content: "林岚走进灯塔，听见三声敲击。"
            })
          );
        }
        if (turn === 1)
          return fauxAssistantMessage("章卡已提交。正文交给下一位成员。");
        if (turn === 2) {
          id = newChapterId(context.systemPrompt);
          expect(context.systemPrompt).toContain("【list 与 read】");
          expect(context.systemPrompt).toContain("document");
          expect(JSON.stringify(context.messages)).not.toContain(run.prompt);
          if (mode === "pure-read") {
            expect(context.systemPrompt).not.toMatch(
              /【创建】|【修改与删除】|【连续性账本】|【写入审批方式/u
            );
            expect(context.tools?.map(({ name }) => name).sort()).toEqual([
              "list",
              "query_linked_material_entries",
              "read",
              "search"
            ]);
          }
          return fauxAssistantMessage(
            fauxToolCall("read", { id, document: "card" })
          );
        }
        if (turn === 3) {
          expect(lastToolText(context)).toContain("林岚走进灯塔");
          return mode === "standard"
            ? fauxAssistantMessage(
                fauxToolCall("edit", {
                  id,
                  document: "body",
                  content: "林岚推开门，三声轻敲戛然而止。"
                })
              )
            : fauxAssistantMessage("已核对章卡，交回审校意见。");
        }
        return fauxAssistantMessage("已提交本章正文。");
      });
      const result = await toolByName(runtime.tools, "spawn_subagent").execute(
        "spawn-long",
        {
          tasks: [
            { subagent_id: "planner", task: "新建下一张章卡。" },
            {
              subagent_id: "writer",
              task:
                mode === "standard"
                  ? "根据刚建的章卡写正文。"
                  : "核对刚建的章卡。"
            }
          ]
        }
      );
      expect(resultText(result)).toContain("完成 2 个");
      expect(id).not.toBe("");
      expect(runtime.contexts).toHaveLength(mode === "standard" ? 5 : 4);
      expect(
        run.workspaceContext!.longWorkspace!.navigation.chapterCards
      ).toHaveLength(1);
    }
  );

  it("refreshes Core navigation between separate delegations", async () => {
    const { index, run } = input();
    const runtime = handoffRuntime(run, (context, turn) => {
      expect(context.systemPrompt).toContain(
        turn === 0 ? "「第一卷」" : "「刚改名的卷」"
      );
      return fauxAssistantMessage("已核对目录。");
    });
    const spawn = toolByName(runtime.tools, "spawn_subagent");
    await spawn.execute("first", {
      tasks: [{ subagent_id: "writer", task: "查看分卷。" }]
    });
    index.plot.volumes[0]!.title = "刚改名的卷";
    await spawn.execute("second", {
      tasks: [{ subagent_id: "writer", task: "再次查看分卷。" }]
    });
    expect(runtime.contexts).toHaveLength(2);
  });
});
