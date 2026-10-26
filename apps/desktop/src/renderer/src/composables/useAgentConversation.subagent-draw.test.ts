import {
  createDeferredApi,
  createEnvelope,
  describe,
  document,
  eventOptions,
  expect,
  it,
  runtime,
  useAgentConversation
} from "./useAgentConversation.test-support";
import {
  subagentDrawGroupStatus,
  subagentRunListEntries
} from "../components/subagentDrawGroups";
import { otherPendingDrawCount } from "../components/subagentDrawCandidates";
import { cloneMessageForPersistence } from "./agent-conversation/clone";
import { parseStoredSubagentDraw } from "./agent-conversation/parse-subagent-draw";
import { parseStoredSubagentRun } from "./agent-conversation/parse-subagent";

const args = {
  tasks: [
    { key: "t1", subagent_id: "titler", task: "起标题" },
    { key: "t2", subagent_id: "writer", task: "写开头", depends_on: ["t1"] }
  ]
};

async function startedController(runId: string) {
  const deferred = createDeferredApi();
  const controller = useAgentConversation({
    api: () => deferred.api,
    idleTimeoutMs: 10_000
  });
  controller.draft.value = "起标题再写开头";
  const sessionId = controller.sessionId.value;
  const sending = controller.sendMessage(document);
  deferred.resolveAccepted(0, {
    sessionId,
    runId,
    acceptedAt: new Date().toISOString(),
    runtime
  });
  await sending;
  controller.handleEvent(
    createEnvelope(
      "tool.call_requested",
      {
        sessionId,
        runId,
        toolCallId: "spawn_draw",
        toolName: "spawn_subagent",
        args,
        runtime
      },
      eventOptions(sessionId, runId, `evt_${runId}_spawn`)
    )
  );
  return { controller, sessionId };
}

const batchTask = { index: 0, key: "t1", dependsOn: [] as string[] };

function candidate(index: number) {
  return {
    parentToolCallId: "spawn_draw",
    subagentRunId: `subrun_draw_${index}`,
    subagentId: "titler",
    name: "标题助手",
    runtime,
    draw: { role: "candidate" as const, index, count: 3 }
  };
}

describe("agent conversation controller: draw-mode tasks", () => {
  it("groups the draws of one task and records the selection", async () => {
    const runId = "run_draw";
    const { controller, sessionId } = await startedController(runId);
    const message = () => controller.messages.value.at(-1)!;
    let sequence = 0;
    const send = (type: string, payload: Record<string, unknown>) =>
      controller.handleEvent(
        createEnvelope(
          type as never,
          { sessionId, runId, ...payload } as never,
          eventOptions(sessionId, runId, `evt_draw_${++sequence}`)
        )
      );

    send("subagent.planned", {
      parentToolCallId: "spawn_draw",
      tasks: [
        {
          ...batchTask,
          subagentId: "titler",
          name: "标题助手",
          task: "起标题",
          runtime,
          drawCount: 3
        },
        {
          index: 1,
          key: "t2",
          dependsOn: ["t1"],
          subagentId: "writer",
          name: "写手",
          task: "写开头",
          runtime
        }
      ]
    });
    expect(message().subagentRuns?.[0]).toMatchObject({
      status: "queued",
      drawCount: 3
    });

    for (const index of [0, 1, 2]) {
      send("subagent.started", {
        ...candidate(index),
        batchTask,
        task: "起标题"
      });
    }
    // The first draw takes over the queued card; the others join it.
    expect(
      message().subagentRuns?.map((run) =>
        run.draw?.role === "candidate" ? run.draw.index : "plain"
      )
    ).toEqual([0, "plain", 1, 2]);
    let entries = subagentRunListEntries(
      message().subagentRuns!,
      message().subagentDraws
    );
    expect(entries.map((entry) => entry.kind)).toEqual(["draw", "run"]);

    for (const index of [0, 1, 2]) {
      send("subagent.completed", {
        ...candidate(index),
        batchTask,
        status: "completed",
        summary: `标题 ${index + 1}`
      });
    }
    send("subagent.draw_updated", {
      parentToolCallId: "spawn_draw",
      subagentId: "titler",
      name: "标题助手",
      batchTask,
      count: 3,
      phase: "selecting"
    });
    expect(
      otherPendingDrawCount([message()], {
        parentToolCallId: "spawn_draw",
        taskKey: "other"
      })
    ).toBe(1);
    expect(
      otherPendingDrawCount([message()], {
        parentToolCallId: "spawn_draw",
        taskKey: "t1"
      })
    ).toBe(0);

    send("subagent.draw_updated", {
      parentToolCallId: "spawn_draw",
      subagentId: "titler",
      name: "标题助手",
      batchTask,
      count: 3,
      phase: "selected",
      selectedBy: "user",
      selectedIndex: 1,
      selectedSubagentRunId: "subrun_draw_1",
      note: "短一点"
    });
    expect(message().subagentDraws).toEqual([
      expect.objectContaining({
        key: "spawn_draw:0",
        phase: "selected",
        selectedIndex: 1,
        note: "短一点"
      })
    ]);
    entries = subagentRunListEntries(
      message().subagentRuns!,
      message().subagentDraws
    );
    const group = entries[0]!.kind === "draw" ? entries[0]!.group : undefined;
    expect(group?.candidates.map((run) => run.summary)).toEqual([
      "标题 1",
      "标题 2",
      "标题 3"
    ]);
    expect(subagentDrawGroupStatus(group!)).toBe("completed");

    // History keeps the draw identity and the selection.
    const stored = JSON.parse(
      JSON.stringify(cloneMessageForPersistence(message()))
    ) as { subagentRuns: unknown[]; subagentDraws: unknown[] };
    expect(parseStoredSubagentRun(stored.subagentRuns[0])?.draw).toEqual({
      role: "candidate",
      index: 0,
      count: 3
    });
    expect(parseStoredSubagentDraw(stored.subagentDraws[0])).toMatchObject({
      phase: "selected",
      selectedSubagentRunId: "subrun_draw_1"
    });
  });

  it("keeps each candidate's focus through events and history", async () => {
    const runId = "run_draw_variant";
    const { controller, sessionId } = await startedController(runId);
    const draw = {
      role: "candidate" as const,
      index: 1,
      count: 2,
      variant: "热烈直白"
    };
    controller.handleEvent(
      createEnvelope(
        "subagent.started",
        { sessionId, runId, ...candidate(1), draw, batchTask, task: "起标题" },
        eventOptions(sessionId, runId, "evt_draw_variant")
      )
    );
    const message = controller.messages.value.at(-1)!;
    const run = message.subagentRuns?.find((item) => item.draw);
    expect(run?.draw).toEqual(draw);
    expect(run?.task).toBe("起标题");

    const stored = JSON.parse(
      JSON.stringify(cloneMessageForPersistence(message))
    ) as { subagentRuns: { draw?: unknown }[] };
    const storedRun = stored.subagentRuns.find((item) => item.draw);
    expect(parseStoredSubagentRun(storedRun)?.draw).toEqual(draw);
    expect(
      parseStoredSubagentRun({ ...storedRun, draw: { ...draw, variant: " " } })
        ?.draw
    ).toEqual({ role: "candidate", index: 1, count: 2 });
  });

  it("closes a pending selection when the parent run fails", async () => {
    const runId = "run_draw_stop";
    const { controller, sessionId } = await startedController(runId);
    controller.handleEvent(
      createEnvelope(
        "subagent.draw_updated",
        {
          sessionId,
          runId,
          parentToolCallId: "spawn_draw",
          subagentId: "titler",
          name: "标题助手",
          batchTask,
          count: 3,
          phase: "selecting" as const
        },
        eventOptions(sessionId, runId, "evt_draw_pending")
      )
    );
    controller.handleEvent(
      createEnvelope(
        "agent.error",
        {
          sessionId,
          runId,
          code: "agent.failed",
          message: "本地运行失败",
          runtime
        },
        eventOptions(sessionId, runId, "evt_draw_error")
      )
    );
    expect(controller.messages.value.at(-1)?.subagentDraws?.[0]?.phase).toBe(
      "failed"
    );
    expect(
      parseStoredSubagentDraw({
        key: "spawn_draw:0",
        parentToolCallId: "spawn_draw",
        subagentId: "titler",
        name: "标题助手",
        count: 3,
        phase: "selecting",
        updatedAt: new Date().toISOString()
      })?.phase
    ).toBe("failed");
  });
});
