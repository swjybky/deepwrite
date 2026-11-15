import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { describe, expect, it, vi } from "vitest";
import { buildShortWorkspaceTools } from "./short-agent-tools";
import {
  resultText,
  shortProfile,
  shortWorkspace,
  toolByName
} from "./short-agent-tools.test-support";
import {
  applySubagentWriteLock,
  askOutsideSubagentWriteLock,
  createSubagentWriteLock
} from "./subagent-write-lock";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function settled(promise: Promise<unknown>): Promise<boolean> {
  return Promise.race([
    promise.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5))
  ]);
}

function editTool(execute: () => Promise<string>): AgentTool {
  return {
    name: "edit",
    label: "edit",
    description: "edit",
    parameters: Type.Object({}),
    execute: async () => ({
      content: [{ type: "text", text: await execute() }],
      details: { kind: "workspace-mutation" }
    })
  };
}

describe("questions asked by locked subagent writes", () => {
  it("waits for the answer without the lock and redoes the write with it", async () => {
    const lock = createSubagentWriteLock();
    let version = 1;
    let attempts = 0;
    const answer = deferred<string>();
    const ask = vi.fn(() => answer.promise);
    const [editA] = applySubagentWriteLock(
      [
        editTool(async () => {
          attempts += 1;
          const seen = version;
          const reply = await askOutsideSubagentWriteLock("跨阶段？", ask);
          return `${reply}:${seen}`;
        })
      ],
      lock,
      "甲"
    );
    const [editB] = applySubagentWriteLock(
      [
        editTool(async () => {
          version += 1;
          return "乙已修改";
        })
      ],
      lock,
      "乙"
    );

    const first = editA!.execute("a", {});
    await vi.waitFor(() => expect(ask).toHaveBeenCalledTimes(1));
    // The other child's write is not held up by the open question.
    const second = editB!.execute("b", {});
    expect(await settled(second)).toBe(true);
    expect(await settled(first)).toBe(false);

    answer.resolve("继续");
    // The retried call sees the other child's change, and asks only once.
    expect(resultText(await first)).toBe("继续:2");
    expect(attempts).toBe(2);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("asks one question at a time when several children need an answer", async () => {
    const lock = createSubagentWriteLock();
    const answers = [deferred<string>(), deferred<string>()];
    let open = 0;
    let mostOpen = 0;
    const asked: string[] = [];
    const childEdit = (label: string, answer: Promise<string>) =>
      applySubagentWriteLock(
        [
          editTool(async () =>
            askOutsideSubagentWriteLock(label, async () => {
              asked.push(label);
              open += 1;
              mostOpen = Math.max(mostOpen, open);
              const reply = await answer;
              open -= 1;
              return reply;
            })
          )
        ],
        lock,
        label
      )[0]!;

    const first = childEdit("甲", answers[0]!.promise).execute("a", {});
    const second = childEdit("乙", answers[1]!.promise).execute("b", {});
    await vi.waitFor(() => expect(asked).toEqual(["甲"]));
    expect(await settled(second)).toBe(false);
    // Writes still go through while both questions wait.
    expect(
      await settled(
        applySubagentWriteLock(
          [editTool(async () => "丙已修改")],
          lock,
          "丙"
        )[0]!.execute("c", {})
      )
    ).toBe(true);

    answers[0]!.resolve("继续");
    expect(resultText(await first)).toBe("继续");
    await vi.waitFor(() => expect(asked).toEqual(["甲", "乙"]));
    answers[1]!.resolve("取消");
    expect(resultText(await second)).toBe("取消");
    expect(mostOpen).toBe(1);
  });

  it("asks directly outside a locked write", async () => {
    await expect(
      askOutsideSubagentWriteLock("问题", async () => "回答")
    ).resolves.toBe("回答");
  });

  it("keeps parallel short-form writes going while a plot structure change waits", async () => {
    const lock = createSubagentWriteLock();
    const answer = deferred<void>();
    const requestUserInput = vi.fn(async (request: { toolCallId: string }) => {
      await answer.promise;
      return {
        sessionId: "session-lock",
        runId: "run-lock",
        requestId: request.toolCallId,
        answers: [
          { id: "plot_structure_change", selectedOptionIds: ["allow_once"] }
        ]
      };
    });
    const childTools = (writer: string) =>
      applySubagentWriteLock(
        buildShortWorkspaceTools({
          workspace: shortWorkspace("character_design"),
          profile: shortProfile(),
          writeApprovalMode: "auto-approve",
          requestUserInput
        }),
        lock,
        writer
      );
    const plotWriter = childTools("剧情");
    const characterWriter = childTools("人物");
    await toolByName(characterWriter, "read").execute("read-overview", {
      kind: "character_overview",
      id: "character_design"
    });

    const plotEdit = toolByName(plotWriter, "edit").execute("edit-plot", {
      kind: "plot_stage",
      id: "plot_design",
      meta: { title: "新的剧情设计" },
      summary: "修改剧情结构标题"
    });
    await vi.waitFor(() => expect(requestUserInput).toHaveBeenCalledTimes(1));
    const overviewEdit = toolByName(characterWriter, "edit").execute(
      "edit-overview",
      {
        kind: "character_overview",
        id: "character_design",
        replacements: [{ original_text: "人物概览", new_text: "新的人物概览" }],
        summary: "修改人物概览"
      }
    );
    expect(await settled(overviewEdit)).toBe(true);
    expect(resultText(await overviewEdit)).not.toContain("未修改");

    answer.resolve();
    expect(resultText(await plotEdit)).not.toContain("未修改");
    expect(requestUserInput).toHaveBeenCalledTimes(1);
  });
});
