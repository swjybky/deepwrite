import { afterEach, expect, it } from "vitest";
import {
  LongBookDecompositionJobSchema,
  readyDecompositionUnitIds,
  type LongBookDecompositionJob
} from "@deepwrite/contracts";
import { decompositionFixture } from "./test-support";
import { cleanupDecompositionRoots } from "./fixture-cleanup.test-support";
import { queryDecomposition } from "./query";
import { addDecompositionUnit } from "./workflow";
import { requeueDecompositionUnit } from "./unit-retry";

const roots: string[] = [];
afterEach(async () => {
  await cleanupDecompositionRoots(roots);
});

async function reachIntegratePhase() {
  const f = await decompositionFixture("continuation", 2, (order) =>
    order === 1
      ? "林青与陈默在茶馆里商量修缮古桥的预算。"
      : "林青独自前往石桥勘察旧柱。"
  );
  roots.push(f.root);
  const service = f.service;
  let job = (await service.control({ jobId: f.job.id, action: "resume" }))!;
  expect(job.phase).toBe("read");

  const openedRead = await service.open(
    { jobId: job.id, phase: "read", unitIds: ["chunk:1"] },
    job.profile.id,
    "ldattempt_read_1"
  );
  for (const [index, chapter] of f.source.chapters.entries()) {
    const order = index + 1;
    const unitId = `reading:${chapter.id}`;
    await service.submit({
      jobId: job.id,
      outputVersion: job.outputVersion,
      attemptId: openedRead.input.attemptId,
      unitId,
      inputRevision: openedRead.job.units[unitId]!.inputRevision,
      data: {
        kind: "reading",
        card: {
          chunkId: "chunk:1",
          chapters: [
            {
              chapterId: chapter.id,
              order,
              title: chapter.title,
              summary: `第 ${order} 章梗概。`,
              events: [`第 ${order} 章事件`],
              characters: order === 1 ? ["林青", "陈默"] : ["林青"]
            }
          ],
          characters:
            order === 1
              ? [
                  {
                    name: "林青",
                    aliases: [],
                    facts: [{ text: "商议修桥预算", chapterOrder: 1 }]
                  },
                  {
                    name: "陈默",
                    aliases: [],
                    facts: [{ text: "参与修桥预算", chapterOrder: 1 }]
                  }
                ]
              : [
                  {
                    name: "林青",
                    aliases: [],
                    facts: [{ text: "勘察古桥旧柱", chapterOrder: 2 }]
                  }
                ],
          world:
            order === 1
              ? [
                  {
                    categoryId: "rules",
                    name: "修桥规约",
                    aliases: [],
                    facts: [{ text: "先定预算再动工", chapterOrder: 1 }]
                  }
                ]
              : [],
          plot: {
            events: [{ text: "商定修桥步骤", chapterOrder: order }],
            foreshadowing: []
          },
          style: {
            notes: ["简练白描"],
            excerpts: [
              {
                chapterOrder: order,
                text: chapter.text,
                why: "推进事务"
              }
            ]
          }
        }
      }
    });
  }
  await service.submit({
    jobId: job.id,
    outputVersion: job.outputVersion,
    attemptId: openedRead.input.attemptId,
    unitId: "chunk:1",
    inputRevision: openedRead.job.units["chunk:1"]!.inputRevision,
    data: { kind: "finish-card" }
  });
  await service.control({
    jobId: job.id,
    action: "finish-package",
    attemptId: openedRead.input.attemptId
  });
  job = (await service.control({ jobId: job.id, action: "advance" }))!;
  expect(job.phase).toBe("registry");

  const openedReg = await service.open(
    { jobId: job.id, phase: "registry", unitIds: ["registry:part:1"] },
    job.profile.id,
    "ldattempt_reg_1"
  );
  const regBrief = (
    await queryDecomposition(openedReg.job, f.root, service.reader, {
      kind: "brief",
      unitIds: ["registry:part:1"]
    })
  ).content;
  const groups: Array<{
    refs: string[];
    tier: "protagonist" | "major_supporting";
  }> = [];
  for (const line of regBrief.split("\n")) {
    const match = /^(c\d+)\b/u.exec(line.trim());
    if (!match) continue;
    if (line.includes("林青"))
      groups.push({ refs: [match[1]!], tier: "protagonist" });
    else if (line.includes("陈默"))
      groups.push({ refs: [match[1]!], tier: "major_supporting" });
  }
  await service.submit({
    jobId: job.id,
    outputVersion: job.outputVersion,
    attemptId: openedReg.input.attemptId,
    unitId: "registry:part:1",
    inputRevision: openedReg.job.units["registry:part:1"]!.inputRevision,
    data: {
      kind: "registry-plan",
      plan: { groups, ignored: [] }
    }
  });
  await service.control({
    jobId: job.id,
    action: "finish-package",
    attemptId: openedReg.input.attemptId
  });
  job = (await service.control({ jobId: job.id, action: "advance" }))!;
  expect(job.phase).toBe("integrate");

  const registry = await service.reader.record(job, "registry:merge");
  if (registry.data.kind !== "registry") throw new Error("名册无效");
  const linId = `character:${registry.data.registry.characters.find(({ name }) => name === "林青")!.id}`;
  const chenId = `character:${registry.data.registry.characters.find(({ name }) => name === "陈默")!.id}`;
  return { ...f, job, linId, chenId };
}

async function submitBatch1WithBlockedChen(
  f: Awaited<ReturnType<typeof reachIntegratePhase>>
) {
  const { service, linId, chenId } = f;
  const ready = readyDecompositionUnitIds(f.job);
  expect(ready).toContain(linId);
  expect(ready).toContain(chenId);
  const opened = await service.open(
    { jobId: f.job.id, phase: "integrate", unitIds: ready },
    f.job.profile.id,
    "ldattempt_int_1"
  );
  const submitUnit = (
    unitId: string,
    data: Parameters<typeof service.submit>[0]["data"]
  ) =>
    service.submit({
      jobId: f.job.id,
      outputVersion: f.job.outputVersion,
      attemptId: opened.input.attemptId,
      unitId,
      inputRevision: opened.job.units[unitId]!.inputRevision,
      data
    });

  await submitUnit("chronicle:1", {
    kind: "asset",
    asset: {
      kind: "chronicle",
      summary: "商量并勘察修桥。",
      points: [
        {
          title: "议事与勘察",
          summary: "先议预算后看桥柱。",
          startOrder: 1,
          endOrder: 2
        }
      ]
    }
  });
  await submitUnit(linId, {
    kind: "asset",
    asset: {
      kind: "character",
      registryId: linId.slice(10),
      summary: "林青主导修桥统筹。",
      coreProfile: "务实负责人。",
      relationships: "与陈默协力修桥。",
      latestState: "正在石桥勘察旧柱。",
      history: "第1章议预算，第2章勘桥柱。"
    }
  });
  await submitUnit("world:rules", {
    kind: "asset",
    asset: {
      kind: "world",
      categoryId: "rules",
      overview: "修桥先核预算。",
      items: [{ title: "修桥规约", content: "先定预算再动工。" }]
    }
  });
  await submitUnit("style:profile", {
    kind: "asset",
    asset: {
      kind: "style",
      content: "平实白描。",
      excerpts: [
        {
          chapterOrder: 1,
          text: "林青与陈默在茶馆里商量修缮古桥的预算。",
          comment: "交代协作关系。"
        }
      ]
    }
  });

  // Simulate陈默 blocked by model content policy while world:rules had no error
  const failed = (await service.control({
    jobId: f.job.id,
    action: "finish-package",
    attemptId: opened.input.attemptId,
    failed: true,
    error: "工作包存在未完成单元",
    unitErrors: {
      [chenId]: "Provider finish_reason: content_filter"
    }
  }))!;
  return failed;
}

it("内容拦截保留原始拒因并立即置失败，跳过失败人物后全流程闭环且审校不复活已跳过人物", async () => {
  const f = await reachIntegratePhase();
  const { service, longs, linId, chenId } = f;

  const failed = await submitBatch1WithBlockedChen(f);
  expect(failed.status).toBe("failed");
  expect(failed.lastError).toBe("Provider finish_reason: content_filter");
  expect(failed.units[linId]?.status).toBe("done");
  expect(failed.units[chenId]).toMatchObject({
    status: "failed",
    attempts: 1,
    lastError: "Provider finish_reason: content_filter"
  });

  // Non-content-block failures still wait until 3 attempts.
  const openedTimeout = await service.open(
    { jobId: f.job.id, phase: "integrate", unitIds: ["plot:book-line"] },
    f.job.profile.id,
    "ldattempt_int_timeout"
  );
  // Reset failed job status only for testing unit attempts accumulation on plot:book-line:
  const afterTimeout = (await service.control({
    jobId: f.job.id,
    action: "finish-package",
    attemptId: openedTimeout.input.attemptId,
    failed: true,
    error: "请求超时"
  }))!;
  expect(afterTimeout.units["plot:book-line"]).toMatchObject({
    status: "pending",
    attempts: 1,
    lastError: "请求超时"
  });

  // Cannot skip non-skippable units like continuity:latest.
  await expect(
    service.control({
      jobId: f.job.id,
      action: "skip",
      unitId: "continuity:latest"
    })
  ).rejects.toThrow("当前仅支持跳过阅读块或人物建档单元。");

  // Skip the content-blocked character.
  const afterSkip = (await service.control({
    jobId: f.job.id,
    action: "skip",
    unitId: chenId
  }))!;
  expect(afterSkip.status).toBe("idle");
  expect(afterSkip.lastError).toBeUndefined();
  expect(afterSkip.units[chenId]?.status).toBe("skipped");
  expect(afterSkip.units[chenId]?.lastError).toBe(
    "Provider finish_reason: content_filter"
  );

  // Resume and finish remaining integration units (plot + continuity:latest).
  let current = (await service.control({ jobId: f.job.id, action: "resume" }))!;
  expect(current.units[chenId]?.status).toBe("skipped");
  expect(current.units[linId]?.status).toBe("done");

  const rem1 = readyDecompositionUnitIds(current);
  expect(rem1).toEqual(["plot:book-line", "plot:foreshadowing"]);
  const openedRem = await service.open(
    { jobId: current.id, phase: "integrate", unitIds: rem1 },
    current.profile.id,
    "ldattempt_int_2"
  );
  await service.submit({
    jobId: current.id,
    outputVersion: current.outputVersion,
    attemptId: openedRem.input.attemptId,
    unitId: "plot:book-line",
    inputRevision: openedRem.job.units["plot:book-line"]!.inputRevision,
    data: {
      kind: "asset",
      asset: {
        kind: "book-line",
        content: "修桥主线。",
        volumes: [],
        gimmick: "古桥工程。"
      }
    }
  });
  await service.submit({
    jobId: current.id,
    outputVersion: current.outputVersion,
    attemptId: openedRem.input.attemptId,
    unitId: "plot:foreshadowing",
    inputRevision: openedRem.job.units["plot:foreshadowing"]!.inputRevision,
    data: { kind: "asset", asset: { kind: "foreshadowing", lines: [] } }
  });
  current = (await service.control({
    jobId: current.id,
    action: "finish-package",
    attemptId: openedRem.input.attemptId
  }))!;

  const rem2 = readyDecompositionUnitIds(current);
  expect(rem2).toEqual(["continuity:latest"]);
  const openedCont = await service.open(
    { jobId: current.id, phase: "integrate", unitIds: rem2 },
    current.profile.id,
    "ldattempt_int_3"
  );
  await service.submit({
    jobId: current.id,
    outputVersion: current.outputVersion,
    attemptId: openedCont.input.attemptId,
    unitId: "continuity:latest",
    inputRevision: openedCont.job.units["continuity:latest"]!.inputRevision,
    data: {
      kind: "asset",
      asset: {
        kind: "continuity",
        characterState: "林青在石桥勘察。",
        handoff: "第2章结束于勘察完成。",
        foreshadowingChanges: "无"
      }
    }
  });
  await service.control({
    jobId: current.id,
    action: "finish-package",
    attemptId: openedCont.input.attemptId
  });
  current = (await service.control({ jobId: current.id, action: "advance" }))!;
  expect(current.phase).toBe("review");

  // Review brief excludes skipped陈默 from expected list and explicitly lists it as skipped.
  const reviewBrief = (
    await queryDecomposition(current, f.root, service.reader, {
      kind: "brief",
      unitIds: ["review:character"]
    })
  ).content;
  expect(reviewBrief).toContain(
    "【确认名册中的人物】\ncharacter:c1｜林青｜主角"
  );
  expect(reviewBrief).toContain(
    "【用户已跳过的人物（无需审校或修复）】\ncharacter:c2｜陈默｜主要配角"
  );

  const reviewReady = readyDecompositionUnitIds(current);
  const openedRev = await service.open(
    { jobId: current.id, phase: "review", unitIds: reviewReady },
    current.profile.id,
    "ldattempt_rev_1"
  );
  for (const unitId of reviewReady) {
    const domain = unitId.slice(7) as
      "character" | "world" | "plot" | "style" | "continuity";
    await service.submit({
      jobId: current.id,
      outputVersion: current.outputVersion,
      attemptId: openedRev.input.attemptId,
      unitId,
      inputRevision: openedRev.job.units[unitId]!.inputRevision,
      data: {
        kind: "review",
        review: {
          domain,
          // Even if the reviewer mistakenly sends repair for the skipped character, Core ignores it.
          issues:
            domain === "character"
              ? [
                  {
                    id: "issue_skipped_repair",
                    unitId: chenId,
                    description: "缺少陈默档案",
                    chapterOrders: [1],
                    suggestion: "补写",
                    resolution: "repair"
                  }
                ]
              : []
        }
      }
    });
  }
  await service.control({
    jobId: current.id,
    action: "finish-package",
    attemptId: openedRev.input.attemptId
  });
  const done = (await service.control({
    jobId: current.id,
    action: "advance"
  }))!;
  expect(done.phase).toBe("done");
  expect(done.status).toBe("completed");
  expect(done.units[chenId]?.status).toBe("skipped");
  expect(done.units[chenId]?.phase).toBe("integrate");
  expect(done.units["summary:characters"]?.status).toBe("done");

  if (done.target?.kind !== "long") throw new Error("长篇目标丢失");
  const openedBook = await longs.catalog.open(done.target.bookId);
  expect(
    openedBook.book.workspaceIndex.characters.map(({ name }) => name)
  ).toEqual(["林青"]);
  expect(openedBook.book.workspaceIndex.ledger.commits).toHaveLength(1);
  const overview = await longs.store.readDocument(openedBook.projectDirectory, {
    fileId: openedBook.book.workspaceIndex.characterOverview!.id
  });
  expect(overview.content).toContain("林青");
  expect(overview.content).not.toContain("陈默");
}, 30_000);

it("跳过多卷人物时连带跳过未完成小传、禁止审校拉回小传，且上游重试不丢失已跳过人物", async () => {
  const f = await reachIntegratePhase();
  const { service, job, chenId } = f;
  addDecompositionUnit(job, "character-volume:c2:1", "integrate");
  addDecompositionUnit(job, "character-volume:c2:2", "integrate");
  job.units["character-volume:c2:1"]!.status = "done";
  job.units["character-volume:c2:1"]!.biography = {
    registryId: "c2",
    volume: "第一卷",
    startOrder: 1,
    endOrder: 1
  };
  job.units["character-volume:c2:2"]!.status = "failed";
  job.units["character-volume:c2:2"]!.biography = {
    registryId: "c2",
    volume: "第二卷",
    startOrder: 2,
    endOrder: 2
  };
  job.units[chenId]!.dependencies = [
    "character-volume:c2:1",
    "character-volume:c2:2"
  ];
  job.units[chenId]!.status = "failed";
  await service.state.save(job);

  const afterSkip = (await service.control({
    jobId: job.id,
    action: "skip",
    unitId: chenId
  }))!;
  expect(afterSkip.units[chenId]?.status).toBe("skipped");
  expect(afterSkip.units["character-volume:c2:1"]?.status).toBe("done");
  expect(afterSkip.units["character-volume:c2:2"]?.status).toBe("skipped");

  // Upstream retry on chunk:1 must not reset skipped character or skipped biography.
  const cloned = LongBookDecompositionJobSchema.parse(
    structuredClone(afterSkip)
  ) as LongBookDecompositionJob;
  requeueDecompositionUnit(cloned, "chunk:1");
  expect(cloned.units[chenId]?.status).toBe("skipped");
  expect(cloned.units["character-volume:c2:2"]?.status).toBe("skipped");

  // Review repair targeting a volume biography of a skipped character must not resurrect it.
  afterSkip.phase = "review";
  afterSkip.status = "running";
  afterSkip.activeAttemptId = "ldattempt_rev_bio";
  addDecompositionUnit(afterSkip, "review:character", "review");
  afterSkip.units["review:character"]!.status = "running";
  afterSkip.units["review:character"]!.attemptId = "ldattempt_rev_bio";
  await service.state.save(afterSkip);
  await service.submit({
    jobId: afterSkip.id,
    outputVersion: afterSkip.outputVersion,
    attemptId: "ldattempt_rev_bio",
    unitId: "review:character",
    inputRevision: afterSkip.units["review:character"]!.inputRevision,
    data: {
      kind: "review",
      review: {
        domain: "character",
        issues: [
          {
            id: "issue_bio",
            unitId: "character-volume:c2:1",
            description: "小传待补",
            chapterOrders: [1],
            suggestion: "补写",
            resolution: "repair"
          }
        ]
      }
    }
  });
  const saved = await service.state.load(afterSkip.id);
  expect(saved.units["character-volume:c2:1"]?.phase).toBe("integrate");
  expect(saved.units["character-volume:c2:1"]?.status).toBe("done");
}, 30_000);

it("失败后选择结束并保留进度，落盘成果完整保留，且仍可通过继续恢复", async () => {
  const f = await reachIntegratePhase();
  const { service, longs, linId, chenId } = f;

  const failed = await submitBatch1WithBlockedChen(f);
  expect(failed.status).toBe("failed");

  // Cannot end while running.
  failed.status = "running";
  await service.state.save(failed);
  await expect(
    service.control({ jobId: failed.id, action: "end" })
  ).rejects.toThrow("请先停止任务。");

  failed.status = "failed";
  await service.state.save(failed);
  const ended = (await service.control({ jobId: failed.id, action: "end" }))!;
  expect(ended.status).toBe("ended");
  expect(ended.lastError).toBeUndefined();
  expect(ended.units[linId]?.status).toBe("done");
  expect(ended.units[chenId]).toMatchObject({
    status: "failed",
    lastError: "Provider finish_reason: content_filter"
  });
  expect(ended.units["continuity:latest"]?.status).toBe("pending");

  // Completed writes remain intact in the target long book.
  if (ended.target?.kind !== "long") throw new Error("长篇目标丢失");
  const openedBook = await longs.catalog.open(ended.target.bookId);
  expect(
    openedBook.book.workspaceIndex.characters.map(({ name }) => name)
  ).toEqual(["林青"]);
  expect(openedBook.book.workspaceIndex.chapters).toHaveLength(2);

  // Resume recovery path stays functional and does not re-run completed 林青.
  const resumed = (await service.control({
    jobId: ended.id,
    action: "resume"
  }))!;
  expect(resumed.status).toBe("idle");
  expect(resumed.units[linId]?.status).toBe("done");
  expect(resumed.units[chenId]).toMatchObject({
    status: "pending",
    attempts: 0
  });
  expect(resumed.units[chenId]?.lastError).toBeUndefined();
}, 30_000);
