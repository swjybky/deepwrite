import { rm } from "node:fs/promises";
import { afterEach, expect, it } from "vitest";
import { decompositionFixture } from "./test-support";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

async function completeChunk(
  f: Awaited<ReturnType<typeof decompositionFixture>>,
  chunkId: string
) {
  const chunk = f.job.chunks.find(({ id }) => id === chunkId)!;
  const receipt = await f.service.write(f.job, chunkId, {
    kind: "reading",
    card: {
      chunkId,
      chapters: chunk.chapterIds.map((chapterId, index) => ({
        chapterId,
        order: chunk.startOrder + index,
        title: `第 ${chunk.startOrder + index} 章`,
        summary: "合成梗概",
        events: ["合成事件"],
        characters: []
      })),
      characters: [],
      world: [],
      plot: { events: [], foreshadowing: [] },
      style: { notes: [], excerpts: [] }
    }
  });
  Object.assign(f.job.units[chunkId]!, {
    status: "done",
    outputRefs: receipt.refs,
    receiptIds: [receipt.id]
  });
}

it("停止或暂停后可切换主模型与备选链，保留已完成进度并清除旧额度错误", async () => {
  const f = await decompositionFixture("materials", 2);
  roots.push(f.root);
  const job = f.job;
  job.status = "stopped";
  job.lastError = "429 insufficient_quota";
  await completeChunk(f, "chunk:1");
  await f.service.state.save(job);

  const updated = await f.service.updateModels(job.id, {
    reading: {
      modelId: "reader_2",
      thinkingLevel: "low",
      contextWindow: 128_000,
      maxTokens: 8192
    },
    readingFallbacks: [
      {
        modelId: "reader_3",
        thinkingLevel: "off",
        contextWindow: 128_000,
        maxTokens: 8192
      }
    ],
    integration: {
      modelId: "integrator_2",
      thinkingLevel: "medium",
      contextWindow: 128_000,
      maxTokens: 8192
    }
  });

  expect(updated.lastError).toBeUndefined();
  expect(updated.units["chunk:1"]?.status).toBe("done");
  expect(updated.models.reading.modelId).toBe("reader_2");
  expect(updated.models.readingFallbacks).toHaveLength(1);
  const persisted = await f.service.state.load(job.id);
  expect(persisted.models).toEqual(updated.models);
  expect(persisted.lastError).toBeUndefined();
});

it("运行中或已完成任务拒绝切换模型", async () => {
  const f = await decompositionFixture("materials", 1);
  roots.push(f.root);
  const nextModels = {
    reading: {
      modelId: "reader_2",
      thinkingLevel: "off" as const,
      contextWindow: 128_000,
      maxTokens: 8192
    },
    integration: {
      modelId: "integrator_2",
      thinkingLevel: "off" as const,
      contextWindow: 128_000,
      maxTokens: 8192
    }
  };

  f.job.status = "running";
  await f.service.state.save(f.job);
  await expect(f.service.updateModels(f.job.id, nextModels)).rejects.toThrow(
    "请先停止任务再切换模型。"
  );

  f.job.status = "completed";
  f.job.phase = "done";
  await f.service.state.save(f.job);
  await expect(f.service.updateModels(f.job.id, nextModels)).rejects.toThrow(
    "任务已完成，无需切换模型。"
  );
});

it("通读阶段新主模型或备选模型装不下未完成阅读块时拒绝切换，该块完成后允许切换", async () => {
  const f = await decompositionFixture("materials", 2, (order) =>
    order === 1 ? "长章".repeat(19_900) : "短章".repeat(500)
  );
  roots.push(f.root);
  expect(f.job.chunks).toHaveLength(2);
  expect(f.job.chunks[0]!.estimatedTokens).toBeGreaterThan(20_000);
  expect(f.job.chunks[1]!.estimatedTokens).toBeLessThan(2_000);

  await expect(
    f.service.updateModels(f.job.id, {
      reading: {
        modelId: "small_reader",
        thinkingLevel: "off",
        contextWindow: 16_000,
        maxTokens: 4096
      },
      integration: f.job.models.integration
    })
  ).rejects.toThrow("未完成阅读块");

  await expect(
    f.service.updateModels(f.job.id, {
      reading: f.job.models.reading,
      readingFallbacks: [
        {
          modelId: "small_fallback",
          thinkingLevel: "off",
          contextWindow: 16_000,
          maxTokens: 4096
        }
      ],
      integration: f.job.models.integration
    })
  ).rejects.toThrow("未完成阅读块");

  // Once the oversized chunk is finished, smaller models can read remaining short chunks.
  await completeChunk(f, f.job.chunks[0]!.id);
  await f.service.state.save(f.job);
  const updated = await f.service.updateModels(f.job.id, {
    reading: {
      modelId: "small_reader",
      thinkingLevel: "off",
      contextWindow: 16_000,
      maxTokens: 4096
    },
    integration: f.job.models.integration
  });
  expect(updated.models.reading.modelId).toBe("small_reader");
});
