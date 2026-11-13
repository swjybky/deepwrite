import { expect, it, vi } from "vitest";
import {
  LongBookAnalysisSourceSchema,
  type DeepWriteApi
} from "@deepwrite/contracts/renderer";
import { useLongBookDecomposition } from "./useLongBookDecomposition";
import { reactive } from "vue";

it("运行结束后的检查失败显示跨进程错误消息，不把错误对象转成字符串", async () => {
  const failure = {
    code: "decomposition.command_failed",
    message: "完成记录超过大小限制。"
  };
  const job = { id: "ldjob_ui", phase: "done", units: {} } as NonNullable<
    ReturnType<typeof useLongBookDecomposition>["job"]["value"]
  >;
  const getJob = vi.fn().mockRejectedValue(failure);
  const controller = useLongBookDecomposition({
    api: () =>
      ({
        longBookDecomposition: {
          control: vi.fn(async () => job),
          getJob
        }
      }) as unknown as DeepWriteApi
  });
  controller.job.value = job;
  await controller.run();
  expect(getJob).toHaveBeenCalledTimes(1);
  expect(controller.error.value).toBe(failure.message);
  controller.dispose();
});

it("保存中与未确认不能建任务；确认使用持久化版本，后续章节编辑使确认失效", async () => {
  const source = LongBookAnalysisSourceSchema.parse({
    id: "long_book_analysis_source_ui",
    kind: "txt",
    name: "合成来源",
    revision: 1,
    fingerprint: "a".repeat(64),
    diagnostics: [],
    chapters: [
      {
        id: "chapter_ui",
        order: 1,
        title: "第一章",
        text: "自写正文",
        charCount: 4,
        sourceName: "自写样书.txt"
      }
    ]
  });
  let resolveSave!: (value: typeof source) => void;
  const save = vi.fn(
    () =>
      new Promise<typeof source>((resolve) => {
        resolveSave = resolve;
      })
  );
  const confirm = vi.fn(async (input) => ({
    ...input,
    id: "confirmation_ui",
    confirmedAt: new Date().toISOString()
  }));
  const createJob = vi.fn();
  const api = {
    longBookAnalysis: {
      sources: { save, confirm, list: vi.fn(async () => ({ sources: [] })) }
    },
    longBookDecomposition: { createJob }
  } as unknown as DeepWriteApi;
  const controller = useLongBookDecomposition({ api: () => api });
  controller.source.value = source;
  const request = {
    mode: "materials",
    targetSelection: {
      kind: "material-group",
      action: "create",
      title: "合成资料"
    },
    autoContinue: false,
    maxConcurrency: 5
  } as const;
  await expect(controller.create(request)).rejects.toThrow("确认");
  controller.replaceChapters([{ ...source.chapters[0]!, title: "校对标题" }]);
  const confirming = controller.confirm(reactive({ start: 1, end: 1 }));
  expect(controller.sourceSaving.value).toBe(true);
  await expect(controller.create(request)).rejects.toThrow("确认");
  resolveSave({
    ...controller.source.value!,
    revision: 2,
    fingerprint: "b".repeat(64)
  });
  await confirming;
  expect(confirm).toHaveBeenCalledWith(
    expect.objectContaining({ sourceRevision: 2, fingerprint: "b".repeat(64) })
  );
  expect(() => structuredClone(confirm.mock.calls[0]![0])).not.toThrow();
  expect(controller.confirmation.value?.sourceRevision).toBe(2);
  expect(createJob).not.toHaveBeenCalled();
  controller.replaceChapters([
    { ...controller.source.value!.chapters[0]!, title: "再次校对" }
  ]);
  expect(controller.confirmation.value).toBeNull();
  expect(controller.sourceDirty.value).toBe(true);
  expect(controller.source.value!.chapters[0]!.text).toBe("自写正文");
  controller.dispose();
});

it("名册和方案的响应式草稿在跨进程前转换为可复制的数据", async () => {
  const saveRegistry = vi.fn(async (input) => {
    structuredClone(input);
    return null;
  });
  const save = vi.fn(async (input) => {
    structuredClone(input);
    return { profiles: input.profiles };
  });
  const controller = useLongBookDecomposition({
    api: () =>
      ({
        longBookDecomposition: { saveRegistry },
        extrasAgents: { profiles: { save } }
      }) as unknown as DeepWriteApi
  });
  controller.job.value = { id: "ldjob_ui", units: {} } as NonNullable<
    typeof controller.job.value
  >;
  controller.registry.value = { version: 1 } as NonNullable<
    typeof controller.registry.value
  >;
  const draft = reactive({ characters: [], terms: [] });
  await controller.saveRegistry(draft, false);
  expect(saveRegistry).toHaveBeenCalledWith({
    jobId: "ldjob_ui",
    baseRevision: 1,
    registry: draft,
    confirm: false
  });
  const profiles = reactive(controller.profiles.value);
  await controller.saveProfiles(profiles);
  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0]![0].profiles[0].builtin).toBeUndefined();
  controller.dispose();
});
