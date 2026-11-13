import type { BrowserWindow } from "electron";
import type { DeepWriteApi } from "@deepwrite/contracts";
import { exerciseRichMarkdownPreview } from "./smoke-rich-markdown-preview";

async function prepareBookImageEditor() {
  const api = (globalThis as unknown as { deepwrite: DeepWriteApi }).deepwrite;
  const snapshot = await api.generalSettings.list();
  await api.generalSettings.save({
    ...snapshot.settings,
    autoSave: true,
    defaultTextViewMode: "preview",
    workspacePaneLayout: "editor-agent"
  });
  const source = await api.catalog.createShortBook({
    title: "插图预览编辑冒烟样书",
    genre: "其他"
  });
  if (!source) throw new Error("Book image editor smoke creation canceled.");
  const picked = await api.bookImages.pick({
    book: { projectType: "short", projectId: source.id }
  });
  if (picked.status !== "saved" || !picked.images[0])
    throw new Error("Book image editor smoke image missing.");
  const image = picked.images[0];
  const content =
    `## 对齐正文\n\n开场。**粗体**继续。\n\n- 第一项\n- 第二项\n\n| 名称 | 地点 |\n| :--- | ---: |\n| 开场 | 庭院 |\n\n![${image.alt}](${image.path})\n\n` +
    Array.from(
      { length: 400 },
      (_, index) => `第${index}段${"预览正文".repeat(63)}。`
    ).join("\n\n") +
    `\n\n![${image.alt}](${image.path})`;
  await api.catalog.saveDocument({
    bookId: source.id,
    documentId: "plot_design",
    content,
    force: true
  });
  return { bookId: source.id, characters: content.length };
}

async function exerciseBookImageEditor(
  bookId: string,
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
      `Book image editor smoke timed out: ${reason}; ${document.body.textContent?.slice(0, 800)}`
    );
  }
  const book = await until(
    () =>
      document.querySelector<HTMLButtonElement>(
        `[data-resource-id="${CSS.escape(bookId)}"]`
      ),
    "book in tree"
  );
  if (book.getAttribute("aria-expanded") !== "true") book.click();
  const plotCategoryId = `catalog:book-category:${encodeURIComponent(bookId)}:plot`;
  const plotCategory = await until(
    () =>
      document.querySelector<HTMLButtonElement>(
        `[data-resource-id="${CSS.escape(plotCategoryId)}"]`
      ),
    "plot category containing additional Markdown documents"
  );
  if (plotCategory.getAttribute("aria-expanded") !== "true")
    plotCategory.click();
  const documentId = `catalog:book-document:${encodeURIComponent(bookId)}:plot_design`;
  const documentButton = await until(
    () =>
      document.querySelector<HTMLButtonElement>(
        `[data-resource-id="${CSS.escape(documentId)}"]`
      ),
    "plot_design document"
  );
  documentButton.click();
  const preview = await until(
    () =>
      document.querySelector<HTMLElement>(
        ".document-preview .editable-markdown-preview:has(.editable-markdown-document[contenteditable=true])"
      ),
    "Markdown preview"
  );
  const result = await exercise(
    preview,
    async () =>
      (
        await api.catalog.readDocument({
          projectId: bookId,
          target: "document",
          documentId: "plot_design"
        })
      ).content
  );
  const surface = preview;
  const appearance = (await api.appearance.list()).settings;
  const layouts = [];
  const root = document.documentElement;
  const originalStyle = root.style.cssText;
  const originalTheme = root.dataset.theme;
  for (const [mode, uiFontSize, editorFontSize] of [
    ["light", 10, 10],
    ["dark", 24, 40]
  ] as const) {
    root.dataset.theme = mode;
    root.style.setProperty("--ui-font-size", `${uiFontSize}px`);
    root.style.setProperty("--editor-font-size", `${editorFontSize}px`);
    root.style.setProperty("--surface-main", appearance[mode].background);
    root.style.setProperty("--text-primary", appearance[mode].foreground);
    await until(
      () =>
        document.documentElement.dataset.theme === mode &&
        Math.abs(
          parseFloat(getComputedStyle(surface).fontSize) - editorFontSize
        ) < 1,
      "appearance variables applied"
    );
    await frame();
    const currentImage = surface.querySelector<HTMLImageElement>(
      ".markdown-image img"
    )!;
    await currentImage.decode();
    const imageBounds = currentImage.getBoundingClientRect();
    const contentBounds = surface.getBoundingClientRect();
    if (
      imageBounds.width > contentBounds.width + 1 ||
      surface.scrollWidth > surface.clientWidth + 1 ||
      Math.abs(
        imageBounds.height -
          (imageBounds.width * currentImage.naturalHeight) /
            currentImage.naturalWidth
      ) > 1
    )
      throw new Error(
        "Book image preview overflows at an appearance font-size limit."
      );
    layouts.push({
      mode,
      uiFontSize,
      editorFontSize,
      contentWidth: contentBounds.width,
      imageWidth: imageBounds.width
    });
  }
  root.style.cssText = originalStyle;
  if (originalTheme === undefined) delete root.dataset.theme;
  else root.dataset.theme = originalTheme;
  return {
    status: "ok",
    ...result,
    layoutScope: "theme-variables",
    layouts
  };
}

/** Exercise the actual workspace component and save/history flows in an isolated smoke window. */
export async function runBookImageEditorSmoke(window: BrowserWindow) {
  window.webContents.setBackgroundThrottling(false);
  const fixture: Awaited<ReturnType<typeof prepareBookImageEditor>> =
    await window.webContents.executeJavaScript(
      `(${prepareBookImageEditor.toString()})()`
    );
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Book image editor fixture reload timed out.")),
      8_000
    );
    window.webContents.once("did-finish-load", () => {
      clearTimeout(timer);
      resolve();
    });
    window.webContents.reload();
  });
  const result = await window.webContents.executeJavaScript(
    `(${exerciseBookImageEditor.toString()})(${JSON.stringify(fixture.bookId)}, ${exerciseRichMarkdownPreview.toString()})`
  );
  return { ...result, characters: fixture.characters };
}
