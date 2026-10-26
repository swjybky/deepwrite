import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
  EVALUATOR_MARK,
  drawMember,
  drawUpdates,
  follower,
  harness,
  run
} from "./subagent-draw-harness.test-support";

const VARIANTS = ["冷峻克制", "热烈直白", "短句为主", "长句铺陈"];

function autoMember(selection: "manual" | "auto" = "manual") {
  return drawMember({ countMode: "auto", count: 3, selection });
}

function childText(context: { messages: unknown[] }): string {
  return JSON.stringify(context.messages);
}

describe("auto-count draws", () => {
  it("runs one draw per requirement and shows each child only its own", async () => {
    const { tool, contexts, requests } = harness({
      definitions: [autoMember()],
      gate: VARIANTS.length,
      answer: () => ({ id: "draw", selectedOptionIds: ["c3"] })
    });

    const { text, progress } = await run(tool, [
      { subagent_id: "titler", task: "给第三章起标题", draw_variants: VARIANTS }
    ]);

    expect(contexts).toHaveLength(VARIANTS.length);
    for (const context of contexts) {
      const message = childText(context);
      expect(message).toContain("【本份侧重】");
      expect(
        VARIANTS.filter((variant) => message.includes(variant))
      ).toHaveLength(1);
    }
    const started = progress.filter((item) => item.type === "started");
    expect(started.map((item) => item.task)).toEqual(
      VARIANTS.map(() => "给第三章起标题")
    );
    expect(started.map((item) => item.draw)).toEqual(
      VARIANTS.map((variant, index) => ({
        role: "candidate",
        index,
        count: VARIANTS.length,
        variant
      }))
    );
    expect(requests[0]!.draw!.count).toBe(VARIANTS.length);
    expect(requests[0]!.draw!.candidates.map((item) => item.variant)).toEqual(
      VARIANTS
    );
    expect(text).toContain(
      "共 4 份（成功 4 份），用户选择第 3 份（侧重：短句为主）"
    );
    expect(drawUpdates(progress).at(-1)).toMatchObject({
      phase: "selected",
      count: VARIANTS.length,
      selectedIndex: 2
    });
  });

  it("runs once without requirements and joins a single one into the task", async () => {
    const plain = harness({ definitions: [autoMember()] });
    const once = await run(plain.tool, [
      { subagent_id: "titler", task: "起标题" }
    ]);
    expect(plain.contexts).toHaveLength(1);
    expect(plain.requestUserInput).not.toHaveBeenCalled();
    expect(once.text).toBe("草稿1");
    expect(drawUpdates(once.progress)).toEqual([]);

    const single = harness({ definitions: [autoMember()] });
    const joined = await run(single.tool, [
      { subagent_id: "titler", task: "起标题", draw_variants: [" ", "冷峻"] }
    ]);
    expect(single.contexts).toHaveLength(1);
    expect(childText(single.contexts[0]!)).toContain("【补充要求】冷峻");
    expect(joined.text).toBe("草稿1");
    const started = joined.progress.find((item) => item.type === "started");
    expect(started).toMatchObject({ task: "起标题\n\n【补充要求】冷峻" });
    expect(started?.draw).toBeUndefined();
  });

  it("rejects the whole call before any child runs", async () => {
    const cases: [ReturnType<typeof drawMember>, unknown[], RegExp][] = [
      [drawMember(), ["甲", "乙"], /每次固定抽 3 份，不接受 draw_variants/u],
      [follower, ["甲", "乙"], /只有按需抽卡成员接受 draw_variants/u],
      [
        autoMember(),
        Array.from({ length: 11 }, (_, index) => `方向${index}`),
        /有 11 条，超过上限 10/u
      ],
      [
        autoMember(),
        ["长".repeat(1_001), "短"],
        /第 1 条 draw_variants 超过 1000 字/u
      ]
    ];
    for (const [member, variants, message] of cases) {
      const { tool, contexts } = harness({ definitions: [member] });
      await expect(
        run(tool, [
          { subagent_id: member.id, task: "起标题", draw_variants: variants }
        ])
      ).rejects.toThrow(message);
      expect(contexts).toHaveLength(0);
    }
  });

  it("shows the evaluator each candidate's focus", async () => {
    const { tool, contexts } = harness({
      definitions: [autoMember("auto")],
      evaluator: () =>
        fauxAssistantMessage(
          fauxToolCall("select_candidate", { candidate: 2, reason: "更有力" }),
          { stopReason: "toolUse" }
        )
    });

    const { text } = await run(tool, [
      {
        subagent_id: "titler",
        task: "起标题",
        draw_variants: VARIANTS.slice(0, 2)
      }
    ]);

    const evaluator = contexts.find((context) =>
      context.systemPrompt?.includes(EVALUATOR_MARK)
    )!;
    expect(evaluator.systemPrompt).toContain(
      "候选标注的“侧重”是有意安排的差异方向"
    );
    const message = childText(evaluator);
    expect(message).toContain("【候选 1｜侧重：冷峻克制】");
    expect(message).toContain("【候选 2｜侧重：热烈直白】");
    expect(text).toContain("评估助手选择第 2 份（侧重：热烈直白）");
    expect(text).toContain("理由：更有力");
  });

  it("lists every direction when the user adopts none", async () => {
    const { tool } = harness({
      definitions: [autoMember()],
      answer: () => ({ id: "draw", selectedOptionIds: ["reject"] })
    });

    const { text } = await run(tool, [
      {
        subagent_id: "titler",
        task: "起标题",
        draw_variants: VARIANTS.slice(0, 2)
      }
    ]);

    expect(text).toContain("侧重依次为：1 冷峻克制；2 热烈直白");
  });

  it("offers draw_variants only where an auto-count member is", async () => {
    const fixed = harness({ definitions: [drawMember({ count: 5 })] });
    expect(JSON.stringify(fixed.tool.parameters)).not.toContain(
      "draw_variants"
    );

    const auto = harness({ definitions: [autoMember(), follower] });
    expect(JSON.stringify(auto.tool.parameters)).toContain("draw_variants");
    expect(auto.tool.description).toContain("［按需抽卡：最多 10 份");
    expect(auto.tool.description).toContain("带［按需抽卡］标记的成员由你决定");

    const { progress } = await run(auto.tool, [
      {
        key: "a",
        subagent_id: "titler",
        task: "起标题",
        draw_variants: ["甲", "乙"]
      },
      { key: "b", subagent_id: "titler", task: "起副标题" }
    ]);
    const planned = progress.find((item) => item.type === "planned");
    expect(
      planned?.type === "planned" && planned.tasks.map((task) => task.drawCount)
    ).toEqual([2, undefined]);
  });
});
