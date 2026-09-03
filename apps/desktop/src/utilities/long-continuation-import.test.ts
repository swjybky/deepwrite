import { link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  previewContinuationImportSource,
  scanContinuationImportSource
} from "./long-continuation-import";
import { LongProjectStore } from "./long-project-store";

const roots: string[] = [];

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-continuation-import-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(async (root) => {
      await rm(root, { recursive: true, force: true });
    })
  );
});

describe("long continuation TXT import", () => {
  it("sorts flat Arabic and Chinese chapter ordinals and leaves one pending chapter", async () => {
    const root = await fixture();
    const source = join(root, "我的长篇");
    const target = join(root, "books");
    await mkdir(source);
    await mkdir(target);
    await writeFile(join(source, "第十章.txt"), "第十章正文", "utf8");
    await writeFile(join(source, "第2章.txt"), "第二章正文", "utf8");
    await writeFile(join(source, "第1章.txt"), "第一章正文", "utf8");

    const preview = await previewContinuationImportSource(source);
    expect(preview.mode).toBe("flat");
    expect(preview.defaultTitle).toBe("我的长篇");
    expect(preview.volumes[0]!.chapters.map(({ title }) => title)).toEqual([
      "第1章",
      "第2章",
      "第十章"
    ]);
    expect(preview.warnings).toContain(
      "第一卷章节编号存在缺口，已按识别到的编号顺序导入。"
    );

    const store = new LongProjectStore({
      now: () => "2026-08-04T00:00:00.000Z"
    });
    const imported = await store.importContinuationBook(target, {
      sourcePath: source,
      expectedFingerprint: preview.sourceFingerprint,
      title: preview.defaultTitle,
      genre: "其他"
    });
    const index = imported.book.workspaceIndex;
    expect(index.plot.volumes.map(({ title }) => title)).toEqual(["第一卷"]);
    expect(index.plot.arcs).toEqual([]);
    expect(index.plot.chapterCards.map(({ title }) => title)).toEqual([
      "第1章",
      "第2章",
      "第十章"
    ]);
    expect(
      index.plot.chapterCards.every(({ primaryArcId }) => primaryArcId === null)
    ).toBe(true);
    expect(index.ledger.commits).toHaveLength(2);
    expect(
      index.ledger.commits.every(({ mode }) => mode === "import_checkpoint")
    ).toBe(true);
    expect(index.ledger.committedThroughChapterId).toBe(
      index.plot.chapterCards[1]!.id
    );
    const latestImportCheckpoint = index.ledger.commits.at(-1)!;
    expect(index.chapters[2]!.commitId).toBeNull();
    expect(imported.pendingChapterCardId).toBe(index.plot.chapterCards[2]!.id);
    const body = await store.readDocument(imported.projectDirectory, {
      fileId: index.chapters[2]!.body.id
    });
    expect(body.content).toBe("第十章正文");

    const stateWrite = await store.writeDocument(imported.projectDirectory, {
      fileId: index.chapters[2]!.characterState.id,
      content: "章末状态：等待作者补录人物设定。"
    });
    const stateIndex = stateWrite.book.workspaceIndex;
    const handoffWrite = await store.writeDocument(imported.projectDirectory, {
      fileId: stateIndex.chapters[2]!.handoff.id,
      content: "接续包：从导入正文继续创作。"
    });
    const readyIndex = handoffWrite.book.workspaceIndex;
    const readyChapter = readyIndex.chapters[2]!;
    const committed = await store.commitChapter(imported.projectDirectory, {
      mode: "text_files",
      chapterCardId: readyChapter.chapterCardId,
      foreshadowingBeatDecisions: {},
      commitMessage: "提交续写导入的最后一章"
    });
    expect(committed.record.sequence).toBe(3);
    const committedBook = await store.openBook(imported.projectDirectory);
    expect(committedBook.book.workspaceIndex.ledger.commits.at(-1)?.mode).toBe(
      "text_files"
    );
    await store.writeDocument(imported.projectDirectory, {
      fileId: readyChapter.body.id,
      content: "提交后仍可直接改写正文。"
    });
    await expect(
      store.readDocument(imported.projectDirectory, {
        fileId: readyChapter.body.id
      })
    ).resolves.toMatchObject({ content: "提交后仍可直接改写正文。" });

    await store.deleteLedgerCommit(imported.projectDirectory, {
      commitId: committed.record.id
    });
    const deletedCheckpoint = await store.deleteLedgerCommit(
      imported.projectDirectory,
      { commitId: latestImportCheckpoint.id }
    );
    expect(deletedCheckpoint.chapterCardIds).toEqual([
      index.plot.chapterCards[1]!.id
    ]);
    const afterCheckpointDeletion = await store.openBook(
      imported.projectDirectory
    );
    expect(
      afterCheckpointDeletion.book.workspaceIndex.chapters[1]!.commitId
    ).toBeNull();
    expect(
      afterCheckpointDeletion.book.workspaceIndex.ledger
        .committedThroughChapterId
    ).toBe(index.plot.chapterCards[0]!.id);
    await expect(
      store.readDocument(imported.projectDirectory, {
        fileId: readyChapter.body.id
      })
    ).resolves.toMatchObject({ content: "提交后仍可直接改写正文。" });
  });

  it("imports ordered volume folders and decodes UTF-16 and GB18030 text", async () => {
    const root = await fixture();
    const source = join(root, "分卷作品");
    await mkdir(join(source, "第二卷"), { recursive: true });
    await mkdir(join(source, "第一卷"), { recursive: true });
    await writeFile(
      join(source, "第一卷", "第一章.txt"),
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("前章", "utf16le")])
    );
    const utf16beBody = Buffer.from("后章", "utf16le");
    for (let index = 0; index < utf16beBody.length; index += 2) {
      const left = utf16beBody[index]!;
      utf16beBody[index] = utf16beBody[index + 1]!;
      utf16beBody[index + 1] = left;
    }
    await writeFile(
      join(source, "第一卷", "第二章.txt"),
      Buffer.concat([Buffer.from([0xfe, 0xff]), utf16beBody])
    );
    await writeFile(
      join(source, "第二卷", "第二章.txt"),
      Buffer.from([0xd6, 0xd0, 0xce, 0xc4])
    );

    const preview = await previewContinuationImportSource(source);
    expect(preview.mode).toBe("volume_folders");
    expect(preview.volumes.map(({ title }) => title)).toEqual([
      "第一卷",
      "第二卷"
    ]);
    expect(preview.volumes[0]!.chapters[0]!.encoding).toBe("utf-16le");
    expect(preview.volumes[0]!.chapters[1]!.encoding).toBe("utf-16be");
    expect(preview.volumes[1]!.chapters[0]!.encoding).toBe("gb18030");
  });

  it("uses natural filename order when sibling ordinals are incomplete", async () => {
    const root = await fixture();
    const source = join(root, "自然排序");
    await mkdir(source);
    await writeFile(join(source, "正文10.txt"), "十", "utf8");
    await writeFile(join(source, "正文2.txt"), "二", "utf8");
    const preview = await previewContinuationImportSource(source);
    expect(preview.volumes[0]!.chapters.map(({ title }) => title)).toEqual([
      "正文2",
      "正文10"
    ]);
    expect(preview.warnings[0]).toContain("自然文件名排序");
  });

  it("rejects mixed layouts, nested folders, symlinks, hardlinks and changed sources", async () => {
    const root = await fixture();
    const mixed = join(root, "mixed");
    await mkdir(join(mixed, "第一卷"), { recursive: true });
    await writeFile(join(mixed, "第一章.txt"), "正文", "utf8");
    await expect(scanContinuationImportSource(mixed)).rejects.toThrow(
      "不能混放"
    );

    const nested = join(root, "nested");
    await mkdir(join(nested, "第一卷", "子目录"), { recursive: true });
    await expect(scanContinuationImportSource(nested)).rejects.toThrow(
      "只能直接包含"
    );

    const linked = join(root, "linked");
    await mkdir(linked);
    const original = join(root, "original.txt");
    await writeFile(original, "正文", "utf8");
    await symlink(original, join(linked, "第一章.txt"));
    await expect(scanContinuationImportSource(linked)).rejects.toThrow();

    const hardlinked = join(root, "hardlinked");
    await mkdir(hardlinked);
    await link(original, join(hardlinked, "第一章.txt"));
    await expect(scanContinuationImportSource(hardlinked)).rejects.toThrow(
      "硬链接"
    );

    const blank = join(root, "blank");
    await mkdir(blank);
    await writeFile(join(blank, "第一章.txt"), " \n\t", "utf8");
    await expect(scanContinuationImportSource(blank)).rejects.toThrow(
      "内容为空"
    );

    const changed = join(root, "changed");
    const target = join(root, "target");
    await mkdir(changed);
    await mkdir(target);
    await writeFile(join(changed, "第一章.txt"), "旧正文", "utf8");
    const preview = await previewContinuationImportSource(changed);
    await writeFile(join(changed, "第一章.txt"), "新正文", "utf8");
    const store = new LongProjectStore();
    await expect(
      store.importContinuationBook(target, {
        sourcePath: changed,
        expectedFingerprint: preview.sourceFingerprint,
        title: "变化来源",
        genre: "其他"
      })
    ).rejects.toThrow("发生变化");
  });

  it("creates no checkpoint when importing a single chapter", async () => {
    const root = await fixture();
    const source = join(root, "single");
    const target = join(root, "target");
    await mkdir(source);
    await mkdir(target);
    await writeFile(join(source, "第一章.txt"), "唯一正文", "utf8");
    const preview = await previewContinuationImportSource(source);
    const store = new LongProjectStore();
    const imported = await store.importContinuationBook(target, {
      sourcePath: source,
      expectedFingerprint: preview.sourceFingerprint,
      title: "单章",
      genre: "其他"
    });
    expect(imported.book.workspaceIndex.ledger.commits).toEqual([]);
    expect(
      imported.book.workspaceIndex.ledger.committedThroughChapterId
    ).toBeNull();
    expect(imported.book.workspaceIndex.chapters[0]!.commitId).toBeNull();
  });

  it("creates 49 checkpoints for a 50-chapter continuation import", async () => {
    const root = await fixture();
    const source = join(root, "fifty");
    const target = join(root, "target-fifty");
    await mkdir(source);
    await mkdir(target);
    await Promise.all(
      Array.from({ length: 50 }, (_, index) => {
        const number = index + 1;
        return writeFile(
          join(source, `${String(number).padStart(3, "0")}-第${number}章.txt`),
          `第 ${number} 章正文`,
          "utf8"
        );
      })
    );
    const preview = await previewContinuationImportSource(source);
    const store = new LongProjectStore();
    const imported = await store.importContinuationBook(target, {
      sourcePath: source,
      expectedFingerprint: preview.sourceFingerprint,
      title: "五十章",
      genre: "其他"
    });
    expect(imported.importedChapterCount).toBe(50);
    expect(imported.checkpointCount).toBe(49);
    expect(imported.book.workspaceIndex.ledger.commits).toHaveLength(49);
    expect(imported.book.workspaceIndex.chapters.at(-1)?.commitId).toBeNull();
  }, 20_000);
});
