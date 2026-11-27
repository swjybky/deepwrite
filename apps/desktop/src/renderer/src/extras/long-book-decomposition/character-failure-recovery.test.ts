import { afterEach, expect, it, vi } from "vitest";
import { createSSRApp, shallowRef } from "vue";
import { renderToString } from "vue/server-renderer";
import {
  getModelContentBlockReason,
  type DecompositionRegistry,
  type LongBookDecompositionJob
} from "@deepwrite/contracts/renderer";
import { runEvent } from "../agent-runtime/extrasAgent.test-support";
import { decompositionEngineFixture as fixture } from "./engine.test-support";
import { createScopedTranslator } from "../../i18n";
import DecompositionProgress from "./DecompositionProgress.vue";
import type { LongBookDecompositionController } from "./useLongBookDecomposition";

const t = createScopedTranslator("extras.longBookDecomposition");
afterEach(() => vi.restoreAllMocks());

function makeIntegrateJob(
  job: LongBookDecompositionJob
): LongBookDecompositionJob {
  const now = new Date().toISOString();
  const baseUnit = {
    phase: "integrate" as const,
    status: "pending" as const,
    attempts: 0,
    inputRevision: "a".repeat(64),
    dependencies: [] as string[],
    outputRefs: [],
    receiptIds: [],
    updatedAt: now
  };
  return {
    ...job,
    mode: "continuation",
    targetSelection: {
      kind: "long",
      action: "create",
      title: "合成长篇"
    },
    target: {
      kind: "long",
      bookId: "long_ui",
      baseRevision: 1,
      state: "writing"
    },
    phase: "integrate",
    status: "idle",
    units: {
      "chunk:1": {
        ...baseUnit,
        phase: "read",
        status: "done"
      },
      "registry:merge": {
        ...baseUnit,
        phase: "registry",
        status: "done"
      },
      "character:c1": { ...baseUnit },
      "character:c2": { ...baseUnit },
      "continuity:latest": {
        ...baseUnit,
        dependencies: ["character:c1", "character:c2"]
      }
    }
  };
}

it("人物建档触发内容拦截后只运行一轮即保留原因停下，跳过人物后不重跑已完成项完成收尾", async () => {
  const f = fixture();
  f.replace(makeIntegrateJob(f.stored()));
  f.engine.job.value = structuredClone(f.stored());

  f.control.mockImplementation(async (input) => {
    const job = f.stored();
    if (input.action === "resume") {
      job.status = "idle";
      delete job.lastError;
      for (const unit of Object.values(job.units)) {
        if (unit.phase === job.phase && unit.status === "failed") {
          unit.status = "pending";
          unit.attempts = 0;
          delete unit.lastError;
        }
      }
    } else if (input.action === "finish-package") {
      for (const [id, unit] of Object.entries(job.units)) {
        if (unit.attemptId === input.attemptId && unit.status === "running") {
          const msg =
            input.unitErrors?.[id] ?? input.error ?? "工作包未提交此单元。";
          unit.attempts++;
          unit.status =
            getModelContentBlockReason(msg) || unit.attempts >= 3
              ? "failed"
              : "pending";
          unit.lastError = msg;
          delete unit.attemptId;
        }
      }
      const failed = Object.values(job.units).find(
        ({ status }) => status === "failed"
      );
      job.status = failed ? "failed" : "idle";
      if (failed?.lastError) job.lastError = failed.lastError;
      delete job.activeAttemptId;
    } else if (input.action === "skip") {
      job.units[input.unitId!]!.status = "skipped";
      job.status = "idle";
      delete job.lastError;
    } else if (input.action === "advance") {
      job.phase = "done";
      job.status = "completed";
    }
    return structuredClone(job);
  });

  let call = 0;
  f.extras.run.mockImplementation(async (request) => {
    call++;
    const job = f.stored();
    job.status = "running";
    job.activeAttemptId = `attempt_${call}`;
    if (call === 1) {
      job.units["character:c1"]!.status = "done";
      job.units["character:c2"]!.status = "running";
      job.units["character:c2"]!.attemptId = `attempt_${call}`;
      setTimeout(() => {
        f.engine.handleEvent(
          runEvent("subagent.started", request, {
            parentToolCallId: "call_chars",
            subagentRunId: "sub_c2",
            subagentId: "character_archivist",
            name: "人物档案师",
            task: "完成 character:c2",
            runtime: { provider: "test", model: "test", mode: "provider" }
          })
        );
        f.engine.handleEvent(
          runEvent("subagent.completed", request, {
            parentToolCallId: "call_chars",
            subagentRunId: "sub_c2",
            subagentId: "character_archivist",
            name: "人物档案师",
            status: "error",
            summary: "子智能体执行失败：Provider finish_reason: content_filter",
            errorMessage: "Provider finish_reason: content_filter",
            runtime: { provider: "test", model: "test", mode: "provider" }
          })
        );
        f.engine.handleEvent(
          runEvent("agent.message_completed", request, {
            content: "陈默被内容拦截，已完成林青。",
            stopReason: "stop"
          })
        );
      }, 0);
    } else {
      job.units["continuity:latest"]!.status = "done";
      setTimeout(() => {
        f.engine.handleEvent(
          runEvent("agent.message_completed", request, {
            content: "连续性已完成。",
            stopReason: "stop"
          })
        );
      }, 0);
    }
    return {
      sessionId: request.sessionId,
      runId: `${request.sessionId}-run`,
      acceptedAt: new Date().toISOString(),
      runtime: { provider: "test", model: "test", mode: "provider" }
    };
  });

  try {
    await f.engine.run();
    // Stopped immediately on attempt 1 without 3x retry loop
    expect(f.extras.run).toHaveBeenCalledTimes(1);
    expect(f.control).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "finish-package",
        unitErrors: { "character:c2": "Provider finish_reason: content_filter" }
      })
    );
    expect(f.engine.job.value?.status).toBe("failed");
    expect(f.engine.job.value?.units["character:c2"]).toMatchObject({
      status: "failed",
      attempts: 1,
      lastError: "Provider finish_reason: content_filter"
    });
    expect(f.engine.error.value).toContain("CONTENT_FILTER");

    await f.engine.control("skip", "character:c2");
    expect(f.engine.job.value?.units["character:c2"]?.status).toBe("skipped");
    expect(f.engine.error.value).toBeNull();

    await f.engine.run();
    expect(f.extras.run).toHaveBeenCalledTimes(2);
    expect(f.engine.job.value?.phase).toBe("done");
    expect(f.engine.job.value?.status).toBe("completed");
    expect(f.engine.job.value?.units["character:c1"]?.status).toBe("done");
    expect(f.engine.job.value?.units["character:c2"]?.status).toBe("skipped");
    expect(f.engine.error.value).toBeNull();
  } finally {
    f.engine.dispose();
  }
});

it("失败态与保留进度结束态在进度页清楚展示拦截原因、跳过人物与结束保留进度入口", async () => {
  const f = fixture();
  const base = makeIntegrateJob(f.stored());
  base.status = "failed";
  base.lastError = "Provider finish_reason: content_filter";
  base.units["character:c1"]!.status = "done";
  base.units["character:c2"]!.status = "failed";
  base.units["character:c2"]!.attempts = 1;
  base.units["character:c2"]!.lastError =
    "Provider finish_reason: content_filter";

  const registry: DecompositionRegistry = {
    version: 1,
    updatedAt: new Date().toISOString(),
    editedByUser: false,
    nameIndex: {
      "character:林青": "c1",
      "character:陈默": "c2"
    },
    characters: [
      {
        id: "c1",
        name: "林青",
        aliases: [],
        tier: "protagonist",
        firstChapterOrder: 1,
        chunkCount: 1,
        ignored: false
      },
      {
        id: "c2",
        name: "陈默",
        aliases: [],
        tier: "major_supporting",
        firstChapterOrder: 1,
        chunkCount: 1,
        ignored: false
      }
    ],
    terms: []
  };

  f.engine.job.value = structuredClone(base);
  const failedHtml = await renderToString(
    createSSRApp(DecompositionProgress, {
      controller: {
        ...f.engine,
        registry: shallowRef(registry)
      } as unknown as LongBookDecompositionController,
      disabled: false
    })
  );
  expect(failedHtml).toContain(t("contentBlockedFailed"));
  expect(failedHtml).toContain(t("failedContentBlockTitle", { count: 1 }));
  expect(failedHtml).toContain("人物档案：陈默");
  expect(failedHtml).toContain("CONTENT_FILTER");
  expect(failedHtml).toContain(t("skipCharacter"));
  expect(failedHtml).toContain(t("endAndKeepProgress"));
  expect(failedHtml).toContain(t("resume"));
  expect(failedHtml).toContain(t("unitFilter_failed", { count: 1 }));

  const endedJob = structuredClone(base);
  endedJob.status = "ended";
  delete endedJob.lastError;
  f.engine.job.value = endedJob;
  const endedHtml = await renderToString(
    createSSRApp(DecompositionProgress, {
      controller: {
        ...f.engine,
        registry: shallowRef(registry)
      } as unknown as LongBookDecompositionController,
      disabled: false
    })
  );
  expect(endedHtml).toContain(t("endedStatus"));
  expect(endedHtml).toContain(t("endedBannerTitle"));
  expect(endedHtml).toContain("人物档案：陈默");
  expect(endedHtml).toContain(t("continuityLabel"));
  expect(endedHtml).toContain(t("openTarget"));
  expect(endedHtml).toContain(t("resume"));
  expect(endedHtml).not.toContain(t("endAndKeepProgress"));
  f.engine.dispose();
});
