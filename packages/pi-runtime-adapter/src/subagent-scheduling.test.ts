import { SUBAGENT_TASK_BATCH_MAX_COUNT } from "@deepwrite/contracts";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import type {
  RuntimeSubagentDefinition,
  SubagentTaskOutcome,
  SubagentTaskRequest
} from "./subagent-types";
import { runSubagentTasks } from "./subagent-scheduler";
import { planSubagentTasks } from "./subagent-task-plan";
import {
  applySubagentWriteLock,
  createSubagentWriteLock
} from "./subagent-write-lock";

const writer: RuntimeSubagentDefinition = {
  id: "chapter_writer",
  name: "单章写手",
  description: "写一章正文。",
  systemPrompt: "只写指定章节。",
  enabled: true,
  modelMode: "inherit"
};
const reviewer: RuntimeSubagentDefinition = {
  ...writer,
  id: "reviewer",
  name: "审阅员",
  description: "审阅正文。"
};
const libraryManager: RuntimeSubagentDefinition = {
  ...writer,
  id: "material_manager",
  name: "素材管理",
  description: "管理素材库。"
};
const definitions = [writer, reviewer, libraryManager];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("subagent task plan", () => {
  it("numbers unnamed tasks and rejects invalid dependencies", () => {
    expect(
      planSubagentTasks(
        [
          { subagent_id: "chapter_writer", task: "写第一章" },
          { subagent_id: "reviewer", task: "审阅", depends_on: ["t1"] }
        ],
        definitions
      ).map(({ key, dependsOn }) => ({ key, dependsOn }))
    ).toEqual([
      { key: "t1", dependsOn: [] },
      { key: "t2", dependsOn: ["t1"] }
    ]);
    const plan = (tasks: unknown) => planSubagentTasks(tasks, definitions);
    expect(() =>
      plan([
        { key: "a", subagent_id: "chapter_writer", task: "x" },
        { key: "a", subagent_id: "reviewer", task: "y" }
      ])
    ).toThrow("任务 key 重复：a");
    expect(() =>
      plan([
        {
          key: "a",
          subagent_id: "chapter_writer",
          task: "x",
          depends_on: ["z"]
        }
      ])
    ).toThrow("依赖了不存在的任务：z");
    expect(() =>
      plan([
        {
          key: "a",
          subagent_id: "chapter_writer",
          task: "x",
          depends_on: ["b"]
        },
        { key: "b", subagent_id: "reviewer", task: "y", depends_on: ["a"] }
      ])
    ).toThrow("任务依赖形成循环");
    expect(() => plan([])).toThrow(
      `tasks 必须包含 1 到 ${SUBAGENT_TASK_BATCH_MAX_COUNT} 个子任务`
    );
    expect(() => plan([{ subagent_id: "unknown", task: "x" }])).toThrow(
      "未知或已停用的子智能体：unknown"
    );
  });

  it("keeps the order the parent gave and adds none of its own", () => {
    const tasks = planSubagentTasks(
      [
        { key: "c3", subagent_id: "chapter_writer", task: "写第三章" },
        { key: "polish", subagent_id: "chapter_writer", task: "润色第三章" },
        {
          key: "dir",
          subagent_id: "chapter_writer",
          task: "新增第五章",
          depends_on: ["c3", "polish"]
        }
      ],
      definitions
    );
    expect(tasks.map(({ key, dependsOn }) => [key, dependsOn])).toEqual([
      ["c3", []],
      ["polish", []],
      ["dir", ["c3", "polish"]]
    ]);
  });

  it("rejects library targets on team members", () => {
    expect(() =>
      planSubagentTasks(
        [{ subagent_id: "chapter_writer", task: "写", library_id: "lib-1" }],
        definitions
      )
    ).toThrow("普通团队成员不能指定资料库管理目标");
  });
});

function request(
  key: string,
  options: Partial<SubagentTaskRequest> = {}
): SubagentTaskRequest {
  return {
    index: 0,
    key,
    definition: writer,
    task: key,
    dependsOn: [],
    ...options
  };
}

describe("subagent scheduler", () => {
  it("never runs more than the concurrency limit at once", async () => {
    let active = 0;
    let peak = 0;
    const tasks = Array.from({ length: 7 }, (_, index) =>
      request(`t${index + 1}`, { index })
    );
    const outcomes = await runSubagentTasks({
      tasks,
      maxConcurrency: 5,
      runTask: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return { status: "completed", summary: "ok" };
      },
      settleUnstarted: () => {
        throw new Error("no task should be left unstarted");
      }
    });
    expect(peak).toBe(5);
    expect([...outcomes.values()].every((o) => o.status === "completed")).toBe(
      true
    );
  });

  it("runs an exclusive task alone", async () => {
    const run = async (tasks: SubagentTaskRequest[]): Promise<string[]> => {
      const events: string[] = [];
      let active = 0;
      await runSubagentTasks({
        tasks,
        maxConcurrency: 5,
        runTask: async (task) => {
          active += 1;
          events.push(`${task.key}:start:${active}`);
          await new Promise((resolve) => setTimeout(resolve, 5));
          events.push(`${task.key}:end`);
          active -= 1;
          return { status: "completed", summary: "ok" };
        },
        settleUnstarted: () => {}
      });
      return events;
    };
    // Waits for the tasks already running, then nothing joins it.
    expect(
      await run([
        request("a"),
        request("lib", { exclusive: true }),
        request("b")
      ])
    ).toEqual([
      "a:start:1",
      "b:start:2",
      "a:end",
      "b:end",
      "lib:start:1",
      "lib:end"
    ]);
    // Starting first, it keeps the later tasks waiting until it ends.
    expect(
      await run([request("lib", { exclusive: true }), request("a")])
    ).toEqual(["lib:start:1", "lib:end", "a:start:1", "a:end"]);
  });

  it("skips the dependents of a failure, even through a chain", async () => {
    const started: string[] = [];
    const unstarted: Array<[string, SubagentTaskOutcome]> = [];
    const handoffKeys: Record<string, string[]> = {};
    const outcomes = await runSubagentTasks({
      tasks: [
        request("dependent", { dependsOn: ["broken"] }),
        request("broken"),
        request("ok"),
        request("after_ok", { dependsOn: ["ok", "dependent"] })
      ],
      maxConcurrency: 5,
      runTask: async (task, handoffs) => {
        started.push(task.key);
        handoffKeys[task.key] = handoffs.map((handoff) => handoff.key);
        return task.key === "broken"
          ? { status: "error", summary: "失败" }
          : { status: "completed", summary: `${task.key} done` };
      },
      settleUnstarted: (task, outcome) => unstarted.push([task.key, outcome])
    });
    expect(started.sort()).toEqual(["broken", "ok"]);
    expect(handoffKeys.ok).toEqual([]);
    expect(unstarted.map(([key, outcome]) => [key, outcome.status])).toEqual([
      ["dependent", "skipped"],
      ["after_ok", "skipped"]
    ]);
    expect(outcomes.get("after_ok")?.summary).toContain("dependent");
  });

  it("hands completed dependency summaries to the waiting task", async () => {
    const received: string[] = [];
    await runSubagentTasks({
      tasks: [request("draft"), request("review", { dependsOn: ["draft"] })],
      maxConcurrency: 5,
      runTask: async (task, handoffs) => {
        if (task.key === "review") {
          received.push(...handoffs.map((handoff) => handoff.summary));
        }
        return { status: "completed", summary: `${task.key} summary` };
      },
      settleUnstarted: () => {}
    });
    expect(received).toEqual(["draft summary"]);
  });

  it("does not start queued tasks after the parent aborts", async () => {
    const controller = new AbortController();
    const unstarted: string[] = [];
    const outcomes = await runSubagentTasks({
      tasks: [request("first"), request("second", { dependsOn: ["first"] })],
      maxConcurrency: 5,
      signal: controller.signal,
      runTask: async () => {
        controller.abort();
        return { status: "aborted", summary: "已中止" };
      },
      settleUnstarted: (task, outcome) => {
        unstarted.push(`${task.key}:${outcome.status}`);
      }
    });
    expect(unstarted).toEqual(["second:aborted"]);
    expect(outcomes.size).toBe(2);
  });
});

/** A write tool whose outcome the test decides per call. */
function writeTool(
  name: string,
  respond: (args: Record<string, unknown>) => "proposal" | "refusal" | "throw"
): AgentTool {
  return {
    name,
    label: name,
    description: name,
    parameters: Type.Object({}),
    execute: async (_id, args) => {
      const outcome = respond(args as Record<string, unknown>);
      if (outcome === "throw") throw new Error("不存在该对象");
      return {
        content: [{ type: "text", text: outcome }],
        details: {
          kind: outcome === "proposal" ? "workspace-mutation" : "none"
        }
      };
    }
  };
}

function textOf(result: Awaited<ReturnType<AgentTool["execute"]>>): string {
  return result.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n");
}

describe("subagent write lock", () => {
  it("wraps only the tools that change the work", () => {
    const tools = ["read", "edit", "create", "delete", "list"].map((name) =>
      writeTool(name, () => "proposal")
    );
    const guarded = applySubagentWriteLock(
      tools,
      createSubagentWriteLock(),
      "A"
    );
    expect(guarded.map((tool) => tool.name)).toEqual([
      "read",
      "edit",
      "create",
      "delete",
      "list"
    ]);
    expect(guarded[0]).toBe(tools[0]);
    expect(guarded[4]).toBe(tools[4]);
    expect(guarded[1]).not.toBe(tools[1]);
  });

  it("names the child that changed an object first when a write is refused", async () => {
    const lock = createSubagentWriteLock();
    const accepted = new Set<string>(["chapter_3"]);
    const decide = (args: Record<string, unknown>) =>
      accepted.has(String(args.chapter_id ?? args.id)) ? "proposal" : "refusal";
    const [editA] = applySubagentWriteLock(
      [writeTool("edit", decide)],
      lock,
      "「写手甲」（a）"
    );
    const [editB] = applySubagentWriteLock(
      [writeTool("edit", decide)],
      lock,
      "「写手乙」（b）"
    );

    // A changes chapter 3, including through a chapter-scoped character file.
    await editA!.execute("1", { id: "chapter_3" });
    await editA!.execute("2", { id: "character_li", chapter_id: "chapter_3" });
    expect(lock.lastWriter.get("chapter_3")).toBe("「写手甲」（a）");

    accepted.clear();
    const refused = textOf(await editB!.execute("3", { id: "chapter_3" }));
    expect(refused).toContain("refusal");
    expect(refused).toContain("chapter_3 刚被并行子任务 「写手甲」（a） 修改");
    // Another object, or the author's own earlier change, gets no note.
    expect(textOf(await editB!.execute("4", { id: "chapter_9" }))).toBe(
      "refusal"
    );
    expect(textOf(await editA!.execute("5", { id: "chapter_3" }))).toBe(
      "refusal"
    );

    accepted.add("chapter_3");
    await editB!.execute("6", { id: "chapter_3" });
    accepted.clear();
    expect(textOf(await editA!.execute("7", { id: "chapter_3" }))).toContain(
      "刚被并行子任务 「写手乙」（b） 修改"
    );
  });

  it("annotates a failed delete or edit and still rethrows it", async () => {
    const lock = createSubagentWriteLock();
    const [createA, deleteA] = applySubagentWriteLock(
      [
        writeTool("create", () => "proposal"),
        writeTool("delete", () => "proposal")
      ],
      lock,
      "甲"
    );
    const [editB] = applySubagentWriteLock(
      [writeTool("edit", () => "throw")],
      lock,
      "乙"
    );
    // Creating names no existing object, so it leaves no trace.
    await createA!.execute("1", { kind: "chapter_card" });
    expect(lock.lastWriter.size).toBe(0);
    await deleteA!.execute("2", { id: "chapter_5" });
    await expect(editB!.execute("3", { id: "chapter_5" })).rejects.toThrow(
      /不存在该对象\n提示：chapter_5 刚被并行子任务 甲 修改/
    );
    await expect(editB!.execute("4", { id: "chapter_6" })).rejects.toThrow(
      /^不存在该对象$/
    );
  });

  it("serializes write calls of concurrent children", async () => {
    const lock = createSubagentWriteLock();
    const order: string[] = [];
    const firstGate = deferred<void>();
    const first = lock.run(undefined, async () => {
      order.push("first:start");
      await firstGate.promise;
      order.push("first:end");
    });
    const second = lock.run(undefined, async () => {
      order.push("second:start");
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(order).toEqual(["first:start"]);
    firstGate.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second:start"]);
  });

  it("gives up waiting for the lock when the child is aborted", async () => {
    const lock = createSubagentWriteLock();
    const gate = deferred<void>();
    const holder = lock.run(undefined, () => gate.promise);
    const controller = new AbortController();
    const waiting = lock.run(controller.signal, async () => "never");
    controller.abort();
    await expect(waiting).rejects.toThrow("子智能体运行已中止");
    const third: string[] = [];
    const next = lock.run(undefined, async () => {
      third.push("ran");
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(third).toEqual([]);
    gate.resolve();
    await Promise.all([holder, next]);
    expect(third).toEqual(["ran"]);
  });
});
