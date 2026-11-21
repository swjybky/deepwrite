import type { BrowserWindow } from "electron";
import { join } from "node:path";
import type { DeepWriteApi } from "@deepwrite/contracts";
import { exerciseRichMarkdownPreview } from "./smoke-rich-markdown-preview";

async function prepareLongImageChapter() {
  const api = (globalThis as unknown as { deepwrite: DeepWriteApi }).deepwrite;
  const settings = (await api.generalSettings.list()).settings;
  await api.generalSettings.save({
    ...settings,
    autoSave: true,
    defaultTextViewMode: "preview",
    workspacePaneLayout: "editor-agent"
  });
  const opened = await api.long.create({
    title: "长篇插图十万字冒烟样书",
    genre: "其他"
  });
  if (!opened) throw new Error("Long image chapter smoke creation canceled.");
  const { id: bookId, workspaceIndex } = opened.book;
  const chapter = workspaceIndex.chapters[0];
  const card = workspaceIndex.plot.chapterCards.find(
    (entry) => entry.id === chapter?.chapterCardId
  );
  if (!chapter || !card)
    throw new Error("Long image chapter smoke initial chapter missing.");
  const picked = await api.bookImages.pick({
    book: { projectType: "long", projectId: bookId }
  });
  if (picked.status !== "saved" || !picked.images[0])
    throw new Error("Long image chapter smoke image missing.");
  const image = picked.images[0];
  const content =
    `## 对齐正文\n\n长篇开场。**粗体**继续。\n\n- 第一项\n- 第二项\n\n| 名称 | 地点 |\n| :--- | ---: |\n| 开场 | 庭院 |\n\n![${image.alt}](${image.path})\n\n` +
    Array.from(
      { length: 400 },
      (_, index) => `第${index}段${"长篇正文".repeat(63)}。`
    ).join("\n\n") +
    `\n\n![${image.alt}](${image.path})`;
  if (content.length < 100_000)
    throw new Error("Long image chapter smoke must exceed 100,000 characters.");
  await api.long.writeDocument({
    bookId,
    fileId: chapter.body.id,
    content,
    expectedUpdatedAt: chapter.body.updatedAt
  });
  const exportInput = {
    book: { projectType: "long" as const, projectId: bookId },
    title: opened.book.title,
    format: "md" as const,
    sections: ["manuscript" as const],
    files: [{ path: ["正文", "第一卷", "第一章"], content }]
  };
  const single = await api.manuscript.exportLong({
    ...exportInput,
    mode: "single-file"
  });
  const folder = await api.manuscript.exportLong({
    ...exportInput,
    mode: "folder"
  });
  if (
    single.status !== "saved" ||
    !("filePath" in single) ||
    single.missingImages ||
    folder.status !== "saved" ||
    !("directoryPath" in folder) ||
    folder.missingImages
  ) {
    throw new Error("Long Markdown export smoke failed.");
  }
  return {
    bookId,
    volumeId: card.volumeId,
    chapterCardId: card.id,
    fileId: chapter.body.id,
    characters: content.length,
    singleExportPath: single.filePath,
    folderExportPath: folder.directoryPath
  };
}

type LongImageChapterFixture = Awaited<
  ReturnType<typeof prepareLongImageChapter>
>;

async function exerciseLongImageChapter(
  fixture: LongImageChapterFixture,
  exercise: typeof exerciseRichMarkdownPreview
) {
  const api = (globalThis as unknown as { deepwrite: DeepWriteApi }).deepwrite;
  const frame = () =>
    new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  async function until<T>(
    read: () => T | Promise<T>,
    reason: string
  ): Promise<NonNullable<T>> {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      document
        .querySelector<HTMLButtonElement>(".startup-alert-close")
        ?.click();
      const value = await read();
      if (value) return value as NonNullable<T>;
      await new Promise<void>((resolve) => setTimeout(resolve, 40));
    }
    throw new Error(
      `Long image chapter smoke timed out: ${reason}; ${document.body.textContent?.slice(0, 1000)}`
    );
  }
  async function expand(resourceId: string) {
    const button = await until(
      () =>
        document.querySelector<HTMLButtonElement>(
          `[data-resource-id="${CSS.escape(resourceId)}"]`
        ),
      `tree item ${resourceId}`
    );
    if (button.getAttribute("aria-expanded") !== "true") button.click();
    await frame();
    return button;
  }
  const prefix = `long-book:${fixture.bookId}`;
  await expand(prefix);
  await until(
    () => document.querySelector(".long-workspace-editor"),
    "opened long workspace"
  );
  await expand(`${prefix}:root:draft`);
  await expand(`${prefix}:volume:${fixture.volumeId}`);
  const chapter = await until(
    () =>
      document.querySelector<HTMLButtonElement>(
        `[data-resource-id="${CSS.escape(`${prefix}:chapter:${fixture.chapterCardId}`)}"]`
      ),
    "chapter manuscript tree item"
  );
  chapter.click();
  const preview = await until(() => {
    const surface = document.querySelector<HTMLElement>(
      ".long-manuscript-editor .long-document-preview .editable-markdown-preview"
    );
    return surface?.querySelector(
      ".editable-markdown-document[contenteditable=true] .markdown-image img"
    ) && surface.textContent?.startsWith("对齐正文")
      ? surface
      : null;
  }, "chapter body image preview");
  const result = await exercise(
    preview,
    async () =>
      (
        await api.long.readDocument({
          bookId: fixture.bookId,
          fileId: fixture.fileId,
          offset: 0,
          maxCharacters: 256 * 1024
        })
      ).content
  );
  return { status: "ok", documentKind: "long-chapter-body", ...result };
}

/** Runs in the existing isolated image smoke window while its file-picker fixture is installed. */
export async function runBookImageLongEditorSmoke(window: BrowserWindow) {
  window.webContents.setBackgroundThrottling(false);
  const fixture: LongImageChapterFixture =
    await window.webContents.executeJavaScript(
      `(${prepareLongImageChapter.toString()})()`
    );
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Long image chapter fixture reload timed out.")),
      8_000
    );
    window.webContents.once("did-finish-load", () => {
      clearTimeout(timer);
      resolve();
    });
    window.webContents.reload();
  });
  const result = await window.webContents.executeJavaScript(
    `(${exerciseLongImageChapter.toString()})(${JSON.stringify(fixture)}, ${exerciseRichMarkdownPreview.toString()})`
  );
  return {
    ...result,
    characters: fixture.characters,
    markdownExports: [
      fixture.singleExportPath,
      join(fixture.folderExportPath, "正文", "第一卷", "第一章.md")
    ]
  };
}
