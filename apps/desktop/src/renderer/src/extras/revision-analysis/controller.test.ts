import { describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import {
  DEFAULT_REVISION_METHOD,
  type DeepWriteApi,
  type ExtrasAgentRunRequest,
  type ModelConfig,
  type SystemEventEnvelope,
  type SkillLibrary
} from "@deepwrite/contracts/renderer";
import {
  createExtrasAgentsFake,
  outputEvent,
  runEvent
} from "../agent-runtime/extrasAgent.test-support";
import { useRevisionAnalysis } from "./useRevisionAnalysis";
const model = {
  id: "model",
  reasoning: false,
  defaultThinkingLevel: "off",
  thinkingLevelOptions: ["medium"],
  contextWindow: 200000,
  maxTokens: 16000
} as ModelConfig;
const result = {
  report: "修改报告",
  title: "修改方向",
  description: "根据修改前后的差异学习可复用的修改规则。",
  body: "适用场景与执行规则"
};
const library = {
  id: "skills",
  isBuiltin: false,
  projectRevision: 3
} as SkillLibrary;
const defaultProfile = {
  id: "default",
  name: "修改分析",
  description: "测试方法",
  systemPrompt: DEFAULT_REVISION_METHOD
};
function fixture() {
  const fake = createExtrasAgentsFake({
    "revision-analysis": [defaultProfile]
  });
  const abort = vi.fn(async () => ({})),
    createLibraryEntry = vi.fn(async () => ({ id: "saved-skill" }));
  const api = {
    session: { abort },
    extrasAgents: fake.extrasAgents,
    catalog: { createLibraryEntry }
  } as unknown as DeepWriteApi;
  const c = useRevisionAnalysis({ api: () => api });
  c.setConfiguredModels([model]);
  c.beforeText.value = "开头\n原句\n结尾";
  c.afterText.value = "开头\n改句\n结尾";
  return { c, run: fake.run, save: fake.save, abort, createLibraryEntry };
}
function event(
  type: string,
  request: ExtrasAgentRunRequest,
  payload: Record<string, unknown> = {}
): SystemEventEnvelope {
  return runEvent(type, request, payload);
}
function draft(request: ExtrasAgentRunRequest, value = result) {
  return outputEvent(request, {
    kind: "revision-analysis-result",
    result: value
  });
}
function finish(
  f: ReturnType<typeof fixture>,
  request = f.run.mock.calls.at(-1)![0]
) {
  f.c.handleEvent(draft(request));
  f.c.handleEvent(event("agent.message_completed", request));
}
function revisionInput(request: ExtrasAgentRunRequest) {
  if (request.task.agentId !== "revision-analysis")
    throw new Error("unexpected agent");
  return request.task.input;
}
describe("revision analysis controller", () => {
  it("clears local documents, differences and output without changing the selected model", () => {
    const f = fixture();
    f.c.compare();
    f.c.overallReason.value = "修订目标";
    f.c.result.value = result;
    f.c.savedKey.value = "old-save";
    f.c.status.value = "completed";
    f.c.resetWorkspace();
    expect(f.c.beforeText.value).toBe("");
    expect(f.c.afterText.value).toBe("");
    expect(f.c.overallReason.value).toBe("");
    expect(f.c.changes.value).toEqual([]);
    expect(f.c.result.value).toBeNull();
    expect(f.c.savedKey.value).toBe("");
    expect(f.c.status.value).toBe("idle");
    expect(f.c.selectedModelId.value).toBe(model.id);
    f.c.status.value = "running";
    f.c.beforeText.value = "仍在分析";
    expect(() => f.c.resetWorkspace()).toThrow();
    expect(f.c.beforeText.value).toBe("仍在分析");
    f.c.dispose();
  });
  it("compares the documents on start and submits the selected level in temperature mode", async () => {
    const f = fixture();
    await nextTick();
    f.c.selectedThinkingLevel.value = "medium";
    expect(f.c.changes.value).toEqual([]);
    expect(f.c.canStart.value).toBe(true);
    await f.c.start();
    expect(f.c.comparisonCurrent.value).toBe(true);
    const request = f.run.mock.calls[0]![0];
    expect(request).toMatchObject({
      modelId: model.id,
      thinkingLevel: "medium"
    });
    expect(revisionInput(request).changes).toMatchObject([
      { before: "原句", after: "改句", reason: "" }
    ]);
    f.c.dispose();
  });
  it("does not submit a model task when the documents have no paragraph differences", async () => {
    const f = fixture();
    f.c.afterText.value = f.c.beforeText.value;
    await expect(f.c.start()).rejects.toThrow("未发现正文段落差异");
    expect(f.run).not.toHaveBeenCalled();
    expect(f.save).not.toHaveBeenCalled();
    expect(f.c.status.value).toBe("idle");
    expect(f.c.comparisonCurrent.value).toBe(true);
    f.c.dispose();
  });
  it.each(["before", "after", "none"])(
    "accepts a three-field draft with report text %s the tool call",
    async (order) => {
      const f = fixture();
      await f.c.start();
      await nextTick();
      const request = f.run.mock.calls[0]![0];
      expect(request.task).toMatchObject({
        agentId: "revision-analysis",
        profileId: "default"
      });
      expect(request.task.input).not.toHaveProperty("systemPrompt");
      const report = "# 修改报告\n\n差异 1：删去重复解释。";
      if (order === "before") {
        f.c.handleEvent(
          event("agent.message_delta", request, { delta: report })
        );
      }
      f.c.handleEvent(
        draft(
          { ...request, sessionId: "another-session" },
          { ...result, report: "错误报告" }
        )
      );
      f.c.handleEvent(draft(request, { ...result, report: "" }));
      if (order === "before") {
        f.c.handleEvent(
          event("agent.message_delta", request, { delta: "草稿已生成。" })
        );
      }
      f.c.handleEvent(
        event("agent.message_completed", request, {
          content:
            order === "after"
              ? report
              : order === "before"
                ? "草稿已生成。"
                : ""
        })
      );
      await nextTick();
      expect(f.c.status.value).toBe("completed");
      expect(f.c.error.value).toBeNull();
      expect(f.c.result.value).toEqual({
        ...result,
        report: order === "none" ? "" : report
      });
      expect(f.createLibraryEntry).not.toHaveBeenCalled();
      await f.c.persistSkill(library);
      expect(f.createLibraryEntry).toHaveBeenCalledOnce();
      f.c.dispose();
    }
  );
  it("freezes evidence, permits empty reasons and retains result until next success", async () => {
    const f = fixture();
    const starting = f.c.start();
    expect(() => f.c.compare()).toThrow("正在处理");
    await starting;
    const first = f.run.mock.calls[0]![0];
    expect(revisionInput(first).overallReason).toBe("");
    expect(() => f.c.compare()).toThrow("正在处理");
    await nextTick();
    finish(f);
    await nextTick();
    expect(f.c.result.value).toEqual(result);
    expect(f.c.isStale.value).toBe(false);
    f.c.changes.value[0]!.reason = "更凝练";
    expect(f.c.isStale.value).toBe(true);
    expect(revisionInput(first).changes[0]!.reason).toBe("");
    await f.c.start();
    expect(f.c.result.value).toEqual(result);
    await nextTick();
    f.c.handleEvent(
      event("agent.error", f.run.mock.calls[1]![0], { message: "测试失败" })
    );
    await nextTick();
    expect(f.c.result.value).toEqual(result);
    expect(f.c.status.value).toBe("error");
    f.c.dispose();
  });
  it("refreshes differences after editing text, and ignores obsolete events after stop/retry", async () => {
    const f = fixture();
    f.c.compare();
    f.c.changes.value[0]!.reason = "更凝练";
    f.c.beforeText.value += "\n新增";
    expect(f.c.canStart.value).toBe(true);
    expect(f.c.comparisonCurrent.value).toBe(false);
    await f.c.start();
    await nextTick();
    const old = f.run.mock.calls[0]![0];
    expect(revisionInput(old).changes).toMatchObject([
      { before: "原句", after: "改句", reason: "更凝练" },
      { before: "新增", after: "", reason: "" }
    ]);
    await f.c.stop();
    await nextTick();
    expect(f.c.status.value).toBe("stopped");
    f.c.retry();
    await nextTick();
    finish(f, old);
    await nextTick();
    expect(f.c.status.value).toBe("running");
    finish(f);
    await nextTick();
    expect(f.c.status.value).toBe("completed");
    expect(f.abort).toHaveBeenCalledOnce();
    f.c.dispose();
  });
  it("labels a retained result during same-input reruns and blocks saving it until the run ends", async () => {
    const f = fixture();
    await f.c.start();
    await nextTick();
    finish(f);
    await nextTick();
    expect(f.c.isPreviousResult.value).toBe(false);
    await f.c.start();
    expect(f.c.isStale.value).toBe(false);
    expect(f.c.isPreviousResult.value).toBe(true);
    expect(f.c.result.value).toEqual(result);
    await expect(f.c.persistSkill(library)).rejects.toThrow("分析运行中");
    expect(f.createLibraryEntry).not.toHaveBeenCalled();
    await nextTick();
    f.c.handleEvent(
      event("agent.error", f.run.mock.calls[1]![0], { message: "测试失败" })
    );
    await nextTick();
    expect(f.c.isPreviousResult.value).toBe(true);
    expect(f.c.result.value).toEqual(result);
    f.c.retry();
    await nextTick();
    const next = f.run.mock.calls[2]![0];
    f.c.handleEvent(draft(next, { ...result, title: "新修改方向" }));
    f.c.handleEvent(event("agent.message_completed", next));
    await nextTick();
    expect(f.c.isPreviousResult.value).toBe(false);
    await f.c.persistSkill(library);
    expect(f.createLibraryEntry).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "新修改方向" })
    );
    f.c.dispose();
  });
  it("fails cleanly for missing structured output and worker restarts", async () => {
    const f = fixture();
    await f.c.start();
    await nextTick();
    f.c.handleEvent(event("agent.message_completed", f.run.mock.calls[0]![0]));
    await nextTick();
    expect(f.c.error.value).toContain("新建技能草稿");
    f.c.retry();
    await nextTick();
    f.c.handleEvent({
      type: "system.worker_restarted",
      payload: { worker: "agent" }
    } as SystemEventEnvelope);
    await nextTick();
    expect(f.c.status.value).toBe("error");
    expect(f.c.error.value).toContain("重启");
    f.c.dispose();
  });
  it("preserves editable drafts on save failure and blocks duplicate saves", async () => {
    const f = fixture();
    await f.c.start();
    await nextTick();
    finish(f);
    await nextTick();
    f.c.result.value!.body = "编辑后的技能";
    f.createLibraryEntry.mockRejectedValueOnce(new Error("版本冲突"));
    await expect(f.c.persistSkill(library)).rejects.toThrow("版本冲突");
    expect(f.c.result.value!.body).toBe("编辑后的技能");
    expect(f.c.savedKey.value).toBe("");
    expect(f.c.savedEntry.value).toBeNull();
    await f.c.persistSkill(library);
    expect(f.c.savedEntry.value).toEqual({
      libraryId: "skills",
      entryId: "saved-skill"
    });
    await f.c.persistSkill(library);
    expect(f.createLibraryEntry).toHaveBeenCalledTimes(2);
    expect(f.createLibraryEntry.mock.calls[1]).toEqual([
      {
        domain: "skill",
        libraryId: "skills",
        title: "修改方向",
        content: `---\nname: 修改方向\ndescription: ${result.description}\n---\n\n编辑后的技能`,
        baseProjectRevision: 3
      }
    ]);
    await expect(
      f.c.persistSkill({ ...library, isBuiltin: true })
    ).rejects.toThrow("非内置");
    f.c.result.value!.description = "用于修订时检查人物动作与情绪表达。";
    expect(f.c.savedKey.value).not.toBe(f.c.skillKey());
    await f.c.persistSkill(library);
    expect(f.createLibraryEntry).toHaveBeenCalledTimes(3);
    expect(f.createLibraryEntry).toHaveBeenLastCalledWith(
      expect.objectContaining({
        content: `---\nname: 修改方向\ndescription: ${f.c.result.value!.description}\n---\n\n编辑后的技能`
      })
    );
    f.c.dispose();
  });
  it("updates existing skill metadata without duplicating its header or changing the draft", async () => {
    const f = fixture();
    const body =
      "---\nname: 旧标题\ndescription: 旧描述\n---\n\n# 执行规则\n保持事实。";
    f.c.result.value = {
      ...result,
      body,
      description: "适用于修订。\n保留事实。"
    };
    await f.c.persistSkill(library);
    expect(f.createLibraryEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        content:
          "---\nname: 修改方向\ndescription: 适用于修订。 保留事实。\n---\n\n# 执行规则\n保持事实。"
      })
    );
    expect(f.c.result.value.body).toBe(body);
    f.c.dispose();
  });
  it("does not save incomplete descriptions or malformed skill headers", async () => {
    const f = fixture();
    f.c.result.value = { ...result, description: " " };
    await expect(f.c.persistSkill(library)).rejects.toThrow();
    f.c.result.value = { ...result, body: "---\nname: 未闭合头部" };
    await expect(f.c.persistSkill(library)).rejects.toThrow("结束分隔符");
    expect(f.createLibraryEntry).not.toHaveBeenCalled();
    expect(f.c.saving.value).toBe(false);
    expect(f.c.savedKey.value).toBe("");
    f.c.dispose();
  });
  it("loads, saves and restores the method without persisting source documents", async () => {
    const f = fixture();
    await f.c.loadSettings();
    expect(f.c.systemPrompt.value).toBe(DEFAULT_REVISION_METHOD);
    f.c.systemPrompt.value = "只分析对白";
    await f.c.saveSettings();
    expect(f.c.systemPrompt.value).toBe("只分析对白");
    expect(f.save).toHaveBeenCalledWith({
      agentId: "revision-analysis",
      baseProfiles: [defaultProfile],
      profiles: [{ ...defaultProfile, systemPrompt: "只分析对白" }]
    });
    await f.c.saveSettings(true);
    expect(f.c.systemPrompt.value).toBe(DEFAULT_REVISION_METHOD);
    expect(f.c.beforeText.value).toContain("原句");
    f.c.dispose();
  });
});

describe("revision analysis method profile", () => {
  it("saves an edited method before the run so Main resolves it by id", async () => {
    const f = fixture();
    await f.c.loadSettings();
    f.c.systemPrompt.value = "只看删改";
    await f.c.start();
    expect(f.save).toHaveBeenCalledOnce();
    expect(f.save.mock.invocationCallOrder[0]!).toBeLessThan(
      f.run.mock.invocationCallOrder[0]!
    );
    expect(f.run.mock.calls[0]![0].task.profileId).toBe("default");
    f.c.dispose();
  });
});
