import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DecompositionSubmitInput } from "@deepwrite/contracts";
import { decompositionFixture } from "./test-support";
import { locateDecompositionExcerpt } from "./excerpt-match";

const roots: string[] = [];
vi.setConfig({ testTimeout: 30_000 });
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

const chapterText = (order: number) =>
  `“铜铃响了。”她低声说……\n\n 第 ${order} 夜，风从西窗进来,吹灭了灯。`;

describe("excerpt matching", () => {
  it("maps copy drift back to the exact source span", () => {
    const source = chapterText(1);
    expect(locateDecompositionExcerpt(source, "她低声说……")).toBe("她低声说……");
    // Paragraph break dropped, "..." for "……", straight quotes.
    expect(
      locateDecompositionExcerpt(source, '"铜铃响了。"她低声说...第 1 夜')
    ).toBe("“铜铃响了。”她低声说……\n\n 第 1 夜");
    // Full-width comma where the source has a half-width one.
    expect(locateDecompositionExcerpt(source, "风从西窗进来，吹灭了灯")).toBe(
      "风从西窗进来,吹灭了灯"
    );
  });

  it("does not accept rewritten or elided text", () => {
    const source = chapterText(1);
    expect(locateDecompositionExcerpt(source, "铜铃又响了")).toBeNull();
    expect(locateDecompositionExcerpt(source, "铜铃……吹灭了灯")).toBeNull();
    expect(locateDecompositionExcerpt(source, "  \n")).toBeNull();
  });
});

async function readingFixture() {
  const fixture = await decompositionFixture("materials", 3, chapterText);
  roots.push(fixture.root);
  const attemptId = "ldattempt_reading";
  const { job } = await fixture.service.open(
    { jobId: fixture.job.id, phase: "read", unitIds: ["chunk:1"] },
    fixture.job.profile.id,
    attemptId
  );
  const unitId = "reading:source_chapter_2";
  const input = (
    chapter: Partial<{ chapterId: string; order: number; title: string }>,
    excerpt: string
  ): DecompositionSubmitInput => ({
    jobId: job.id,
    outputVersion: job.outputVersion,
    attemptId,
    unitId,
    inputRevision: job.units[unitId]!.inputRevision,
    data: {
      kind: "reading",
      card: {
        chunkId: "chunk:9",
        chapters: [
          {
            chapterId: "source_chapter_2",
            order: 2,
            title: "第二章",
            summary: "铜铃在夜里响起。",
            events: ["铜铃响起。"],
            characters: ["她"],
            ...chapter
          }
        ],
        characters: [],
        world: [],
        plot: { events: [], foreshadowing: [] },
        style: {
          notes: [],
          excerpts: [{ chapterOrder: 2, text: excerpt, why: "短句收束。" }]
        }
      }
    }
  });
  return { ...fixture, job, unitId, input };
}

describe("reading submissions take identity and excerpts from the source", () => {
  it("fills echoed fields and stores the exact excerpt", async () => {
    const f = await readingFixture();
    await f.service.submit(f.input({}, '"铜铃响了。"她低声说...'));
    const job = await f.service.state.load(f.job.id);
    expect(job.units[f.unitId]!.status).toBe("done");
    const record = await f.service.reader.record(job, f.unitId);
    if (record.data.kind !== "reading") throw new Error("reading record");
    expect(record.data.card.chunkId).toBe("chunk:1");
    expect(record.data.card.chapters[0]!.title).toBe("第 2 章");
    expect(record.data.card.style.excerpts[0]!.text).toBe(
      "“铜铃响了。”她低声说……"
    );
  });

  it("saves writing state and receipt requirements together", async () => {
    const f = await readingFixture();
    const snapshots: Array<Awaited<ReturnType<typeof f.service.state.load>>> =
      [];
    const save = f.service.state.save.bind(f.service.state);
    const saving = vi
      .spyOn(f.service.state, "save")
      .mockImplementation(async (job) => {
        snapshots.push(structuredClone(job));
        return save(job);
      });

    await f.service.submit(f.input({}, '"铜铃响了。"她低声说...'));

    expect(saving).toHaveBeenCalledTimes(2);
    expect(snapshots[0]?.units[f.unitId]).toMatchObject({
      status: "writing",
      requiredReceiptIds: expect.any(Array)
    });
  });

  it("names the expected chapter when the identity is wrong", async () => {
    const f = await readingFixture();
    await expect(
      f.service.submit(f.input({ order: 3 }, "她低声说"))
    ).rejects.toThrow(
      "reading:source_chapter_2 是第 2 章“第 2 章”（chapterId=source_chapter_2，order=2），收到 chapterId=source_chapter_2、order=3。"
    );
  });

  it("points at the excerpt that is not in the chapter", async () => {
    const f = await readingFixture();
    await expect(
      f.service.submit(f.input({}, "铜铃又响了一次"))
    ).rejects.toThrow("style.excerpts.0 “铜铃又响了一次”不在指定章节原文中");
    const job = await f.service.state.load(f.job.id);
    expect(job.units[f.unitId]!.status).toBe("running");
  });
});
