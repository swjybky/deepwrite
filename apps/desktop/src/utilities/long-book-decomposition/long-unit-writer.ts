import { writeLatestCharacterContinuity } from "./latest-character-continuity";
import {
  DecompositionReceiptSchema,
  LongWorkspaceIndexSnapshotSchema,
  type LongBookDecompositionJob,
  type DecompositionSubmissionData,
  type DecompositionReceipt,
  type DecompositionContentRef,
  type DecompositionRegistry,
  type DecompositionAsset,
  type DecompositionReadingCard
} from "@deepwrite/contracts";
import type { LongWorkspaceService } from "../long-workspace-service";
import { readSecureTextFile, readNoFollowFile } from "../long-project-store/io";
import type { ProjectTransactionFileOperation } from "../project-transaction";
import { decompositionResourceId } from "./identity";
import {
  assertDecompositionDocumentWritable,
  assertDecompositionObjectWritable
} from "./content-guard";
import {
  applyDecompositionNativeAsset,
  type NativeAssetWriter
} from "./long-native-assets";
import { sha256Hex } from "@deepwrite/shared/node";

type ChapterReading = DecompositionReadingCard["chapters"][number];

/** The chapter card a writer reads; segments of an oversized chapter share one card. */
export function decompositionChapterCard(readings: ChapterReading[]): string {
  const sorted = [...readings].sort(
    (a, b) => (a.segmentIndex ?? 0) - (b.segmentIndex ?? 0)
  );
  return `${sorted
    .map((reading, index) => {
      const body = [
        reading.summary,
        reading.events.length
          ? `**关键事件**\n\n${reading.events.map((event) => `- ${event}`).join("\n")}`
          : "",
        reading.characters.length
          ? `**出场人物**：${reading.characters.join("、")}`
          : "",
        reading.scene ? `**场景**：${reading.scene}` : "",
        reading.hook ? `**章末钩子**：${reading.hook}` : ""
      ]
        .filter(Boolean)
        .join("\n\n");
      return sorted.length > 1 ? `### 第 ${index + 1} 部分\n\n${body}` : body;
    })
    .join("\n\n")}\n`;
}

export async function writeDecompositionLongUnit(
  longs: LongWorkspaceService,
  job: LongBookDecompositionJob,
  unitId: string,
  data: DecompositionSubmissionData,
  receiptBase: Omit<DecompositionReceipt, "refs">,
  registry: DecompositionRegistry,
  options: {
    assets?: DecompositionAsset[];
    sourceBody?: string;
    /** Every saved reading of this chapter, the submitted one included. */
    chapterReadings?: ChapterReading[];
  } = {}
): Promise<DecompositionReceipt> {
  if (job.target?.kind !== "long") throw new Error("长篇目标未绑定。");
  const { projectDirectory } = await longs.catalog.open(job.target.bookId);
  return longs.store.transactManaged(projectDirectory, async (loaded) => {
    const saved = loaded.index.writeReceipts?.find(
      ({ id }) => id === receiptBase.id
    );
    if (saved)
      return {
        operations: [],
        result: DecompositionReceiptSchema.parse(
          JSON.parse(
            (
              await readNoFollowFile(
                `${projectDirectory}/${saved.path}`,
                4 * 1024 * 1024,
                "长篇保存回执",
                projectDirectory
              )
            ).bytes.toString("utf8")
          )
        )
      };
    const now = new Date().toISOString();
    const operations: ProjectTransactionFileOperation[] = [];
    const refs: DecompositionContentRef[] = [];
    const projectId = loaded.manifest.id;
    const replace = !!job.units[unitId]!.regenerateApproved;
    const priorObjects = new Map(
      [
        ...loaded.index.characters,
        ...loaded.index.worldbuilding,
        ...loaded.index.plot.volumes,
        ...loaded.index.plot.arcs,
        ...loaded.index.plot.storyPlots,
        ...loaded.index.plot.foreshadowing
      ].map((value) => [value.id, sha256Hex(JSON.stringify(value))])
    );
    const revision =
      (job.target?.kind === "long" ? job.target.baseRevision : 0) + 1;
    const current = async (path: string) => {
      try {
        return (
          await readSecureTextFile(projectDirectory, path, 32 * 1024 * 1024)
        ).content;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        return undefined;
      }
    };
    const writer: NativeAssetWriter = {
      file: async (reference, content) => {
        const old = await current(reference.path);
        assertDecompositionDocumentWritable(
          job,
          reference.id,
          old,
          content,
          replace
        );
        reference.updatedAt = now;
        operations.push({
          path: reference.path,
          content,
          expectedSha256: old === undefined ? null : sha256Hex(old)
        });
        refs.push({
          projectId,
          resourceId: reference.id,
          fileId: reference.id,
          revision,
          sha256: sha256Hex(content)
        });
      },
      object: (id, value) => {
        assertDecompositionObjectWritable(
          job,
          id,
          priorObjects.get(id),
          replace
        );
        refs.push({
          projectId,
          resourceId: id,
          revision,
          sha256: sha256Hex(JSON.stringify(value))
        });
      },
      // A removed object leaves no ref; edits made since the job wrote it
      // stop the removal the same way they stop a rewrite.
      remove: async (id, file) => {
        assertDecompositionObjectWritable(
          job,
          id,
          priorObjects.get(id),
          replace
        );
        const old = file && (await current(file.path));
        if (!file || old === undefined) return;
        assertDecompositionDocumentWritable(job, file.id, old, "", replace);
        operations.push({
          action: "delete",
          path: file.path,
          expectedSha256: sha256Hex(old)
        });
      }
    };
    if (data.kind === "reading") {
      const chapter = data.card.chapters[0]!;
      const chapterId = decompositionResourceId(
        "chapter",
        job.id,
        chapter.chapterId
      );
      const entry = loaded.index.chapters.find(
        ({ chapterCardId }) => chapterCardId === chapterId
      );
      if (!entry) throw new Error("源文章卡不存在。");
      await writer.file(
        entry.card,
        decompositionChapterCard(options.chapterReadings ?? [chapter])
      );
      if (options.sourceBody !== undefined) {
        const body = await readSecureTextFile(
          projectDirectory,
          entry.body.path,
          32 * 1024 * 1024
        );
        if (body.sha256 !== sha256Hex(options.sourceBody))
          throw new Error(
            "decomposition.conflict: 目标源文正文已经修改，请恢复原文或按新来源建立任务。"
          );
        operations.push({
          action: "check",
          path: entry.body.path,
          expectedSha256: body.sha256
        });
        refs.push({
          projectId,
          resourceId: entry.body.id,
          fileId: entry.body.id,
          revision,
          sha256: body.sha256
        });
      }
    }
    if (data.kind === "asset") {
      await applyDecompositionNativeAsset(
        job,
        loaded.index,
        data.asset,
        registry,
        writer,
        unitId
      );
      if (data.asset.kind === "continuity")
        await writeLatestCharacterContinuity(
          job,
          loaded.index,
          registry,
          options.assets ?? [],
          writer
        );
    }
    const parsed = LongWorkspaceIndexSnapshotSchema.safeParse(loaded.index);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .slice(0, 3)
        .map(
          (issue) =>
            `${issue.path.join(".")}：${issue.code}${"maximum" in issue ? `，上限 ${String(issue.maximum)}` : ""}`
        )
        .join("；");
      // Core built this index, so no change to the submission can fix it.
      throw new Error(
        `系统侧保存失败：长篇索引未通过校验（${issues}）。这不是提交内容的问题，修改后重交也无法解决；请停止提交此单元，并在最终回复中报告。`
      );
    }
    const canonical = parsed.data;
    const objects = [
      ...canonical.characters,
      ...canonical.worldbuilding,
      ...canonical.plot.volumes,
      ...canonical.plot.arcs,
      ...canonical.plot.storyPlots,
      ...canonical.plot.foreshadowing
    ];
    for (const ref of refs.filter((ref) => !ref.fileId)) {
      const object = objects.find(({ id }) => id === ref.resourceId);
      if (!object) throw new Error("成品对象未注册到长篇索引。");
      ref.sha256 = sha256Hex(JSON.stringify(object));
    }
    const receipt = DecompositionReceiptSchema.parse({ ...receiptBase, refs });
    const receiptFile = {
      id: receipt.id,
      path: `long/analysis/receipts/${receipt.id}.md`,
      updatedAt: now
    };
    loaded.index.writeReceipts = [
      ...(loaded.index.writeReceipts ?? []),
      receiptFile
    ];
    operations.push({
      path: receiptFile.path,
      content: JSON.stringify(receipt),
      expectedSha256: null
    });
    return { operations, result: receipt };
  });
}
