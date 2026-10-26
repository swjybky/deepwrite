import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { createConcurrencyLimiter } from "./concurrency-limiter";
import {
  EVALUATOR_MARK,
  deferred,
  drawMember,
  drawUpdates,
  follower,
  harness,
  run
} from "./subagent-draw-harness.test-support";

describe("draw mode", () => {
  it("runs every draw at once and hands only the user's pick to the parent", async () => {
    // Three arrivals must meet at the gate although the team is serial.
    const { tool, requests } = harness({
      definitions: [drawMember()],
      gate: 3,
      answer: () => ({
        id: "draw",
        selectedOptionIds: ["c2"],
        text: "结尾再短一点"
      })
    });

    const { text, progress } = await run(tool, [
      { subagent_id: "titler", task: "给第三章起标题" }
    ]);

    expect(requests).toHaveLength(1);
    const draw = requests[0]!.draw!;
    expect(requests[0]).toMatchObject({
      source: "subagent_draw",
      toolCallId: "parent-call"
    });
    expect(draw.candidates.map((candidate) => candidate.id)).toEqual([
      "c1",
      "c2",
      "c3"
    ]);
    const picked = draw.candidates[1]!;
    expect(text).toContain("用户选择第 2 份");
    expect(text).toContain("用户附言：结尾再短一点");
    expect(text).toContain(picked.text);
    for (const other of [draw.candidates[0]!, draw.candidates[2]!]) {
      expect(text).not.toContain(other.text);
    }
    const started = progress.filter((item) => item.type === "started");
    expect(started.map((item) => item.draw)).toEqual([
      { role: "candidate", index: 0, count: 3 },
      { role: "candidate", index: 1, count: 3 },
      { role: "candidate", index: 2, count: 3 }
    ]);
    expect(drawUpdates(progress).map((item) => item.phase)).toEqual([
      "selecting",
      "selected"
    ]);
    expect(drawUpdates(progress)[1]).toMatchObject({
      selectedBy: "user",
      selectedIndex: 1,
      selectedSubagentRunId: picked.subagentRunId,
      note: "结尾再短一点"
    });
  });

  it("returns a rejection as an unfinished task and skips its dependents", async () => {
    const { tool } = harness({
      definitions: [drawMember({ count: 2 }), follower],
      answer: () => ({
        id: "draw",
        selectedOptionIds: ["reject"],
        text: "都太长"
      })
    });

    const { text, progress } = await run(tool, [
      { key: "t1", subagent_id: "titler", task: "起标题" },
      { key: "t2", subagent_id: "follower", task: "用标题", depends_on: ["t1"] }
    ]);

    expect(text).toContain("用户没有采用这次抽卡的 2 份候选");
    expect(text).toContain("用户附言：都太长");
    expect(text).toMatch(/【t2｜后续成员｜已跳过】/u);
    expect(drawUpdates(progress).at(-1)).toMatchObject({
      phase: "rejected",
      note: "都太长"
    });
  });

  it("lets the evaluator choose through its select tool", async () => {
    const { tool, requestUserInput, contexts } = harness({
      definitions: [drawMember({ selection: "auto" })],
      evaluator: () =>
        fauxAssistantMessage(
          fauxToolCall("select_candidate", {
            candidate: 3,
            reason: "节奏最好"
          }),
          { stopReason: "toolUse" }
        )
    });

    const { text, progress } = await run(tool, [
      { subagent_id: "titler", task: "起标题" }
    ]);

    expect(requestUserInput).not.toHaveBeenCalled();
    expect(text).toContain("评估助手选择第 3 份");
    expect(text).toContain("理由：节奏最好");
    const evaluatorContext = contexts.find((context) =>
      context.systemPrompt?.includes(EVALUATOR_MARK)
    )!;
    const taskMessage = JSON.stringify(evaluatorContext.messages[0]);
    expect(taskMessage).toMatch(
      /^.{0,40}【评估任务】.*必须调用 select_candidate/u
    );
    expect(evaluatorContext.tools?.map((tool) => tool.name)).toEqual([
      "select_candidate"
    ]);
    expect(drawUpdates(progress).map((item) => item.phase)).toEqual([
      "evaluating",
      "selected"
    ]);
    const evaluatorDone = progress.find(
      (item) => item.type === "completed" && item.draw?.role === "evaluator"
    );
    expect(evaluatorDone).toMatchObject({ status: "completed" });
  });

  it("reminds the evaluator once, then hands the choice to the user", async () => {
    const { tool, requests, contexts } = harness({
      definitions: [drawMember({ selection: "auto", count: 2 })],
      evaluator: () => fauxAssistantMessage("我觉得第二份更好。")
    });

    const { text, progress } = await run(tool, [
      { subagent_id: "titler", task: "起标题" }
    ]);

    const evaluatorTurns = contexts.filter((context) =>
      context.systemPrompt?.includes(EVALUATOR_MARK)
    );
    expect(evaluatorTurns).toHaveLength(2);
    expect(JSON.stringify(evaluatorTurns[1]!.messages.at(-1))).toContain(
      "你还没有调用 select_candidate"
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]!.draw?.fallbackReason).toContain("没有调用");
    expect(text).toContain("用户选择第 2 份");
    expect(drawUpdates(progress).map((item) => item.phase)).toEqual([
      "evaluating",
      "selecting",
      "selected"
    ]);
  });

  it("adopts the only successful draw and fails when none succeeds", async () => {
    const failing = (arrival: number) =>
      fauxAssistantMessage("", {
        stopReason: "error",
        errorMessage: `invalid_request_error: 草稿${arrival}被拒绝`
      });
    const one = harness({
      definitions: [drawMember()],
      draft: (arrival) =>
        arrival === 2 ? fauxAssistantMessage("唯一成功") : failing(arrival)
    });
    const adopted = await run(one.tool, [
      { subagent_id: "titler", task: "起标题" }
    ]);
    expect(one.requestUserInput).not.toHaveBeenCalled();
    expect(adopted.text).toContain("只有第");
    expect(adopted.text).toContain("唯一成功");

    const none = harness({ definitions: [drawMember()], draft: failing });
    const failed = await run(none.tool, [
      { subagent_id: "titler", task: "起标题" }
    ]);
    expect(failed.text).toContain("抽卡 3 份全部失败");
    expect(drawUpdates(failed.progress).at(-1)).toMatchObject({
      phase: "failed"
    });
  });

  it("never draws for a standard member, whatever its settings say", async () => {
    const { tool, requestUserInput, contexts } = harness({
      definitions: [drawMember({}, "standard")]
    });

    const { text, progress } = await run(tool, [
      { subagent_id: "titler", task: "起标题" }
    ]);

    expect(contexts).toHaveLength(1);
    expect(requestUserInput).not.toHaveBeenCalled();
    expect(text).toBe("草稿1");
    expect(drawUpdates(progress)).toEqual([]);
  });

  it("tells the parent which members draw", () => {
    const { tool } = harness({ definitions: [drawMember({ count: 5 })] });
    expect(tool.description).toContain("［抽卡×5：");
  });
});

describe("createConcurrencyLimiter", () => {
  it("keeps at most `capacity` tasks running", async () => {
    const limiter = createConcurrencyLimiter(2);
    let running = 0;
    let peak = 0;
    const gates = Array.from({ length: 5 }, () => deferred());
    const done = gates.map((gate) =>
      limiter.run(async () => {
        running += 1;
        peak = Math.max(peak, running);
        await gate.promise;
        running -= 1;
      })
    );
    for (const gate of gates) {
      await Promise.resolve();
      gate.resolve();
    }
    await Promise.all(done);
    expect(peak).toBe(2);
  });
});
