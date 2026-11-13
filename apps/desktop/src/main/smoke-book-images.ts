import { app, dialog, nativeImage, type BrowserWindow } from "electron";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DeepWriteApi } from "@deepwrite/contracts";
import { runBookImageEditorSmoke } from "./smoke-book-images-editor";
import { runBookImageLongEditorSmoke } from "./smoke-book-images-long-editor";

async function insertAndExportInRenderer() {
  const api = (globalThis as unknown as { deepwrite: DeepWriteApi }).deepwrite;
  const source = await api.catalog.createShortBook({
    title: "插图冒烟样书",
    genre: "其他"
  });
  if (!source) throw new Error("Book image smoke creation canceled.");
  const book = { projectType: "short" as const, projectId: source.id };
  const picked = await api.bookImages.pick({ book });
  if (
    picked.status !== "saved" ||
    picked.images.length !== 3 ||
    picked.rejected.length
  ) {
    throw new Error(
      `Book image smoke picker failed: ${JSON.stringify(picked)}`
    );
  }
  if (
    !picked.images[1]!.path.endsWith(".jpg") ||
    !picked.images[2]!.path.endsWith(".png")
  ) {
    throw new Error("Book image smoke JPEG/WebP storage format invalid.");
  }
  const content = `开场。\n\n${picked.images.map((image) => `![${image.alt}](${image.path})`).join("\n\n")}\n\n结尾。`;
  await api.catalog.saveDocument({
    bookId: source.id,
    documentId: "worldbuilding",
    content,
    force: true
  });
  const saved = await api.catalog.readDocument({
    projectId: source.id,
    target: "document",
    documentId: "worldbuilding"
  });
  if (saved.content !== content)
    throw new Error("Book image smoke reference was not persisted.");
  for (const image of picked.images) {
    const filename = image.path.slice("images/".length);
    const rendered = document.createElement("img");
    rendered.src = `deepwrite-book-image://asset/short/${encodeURIComponent(source.id)}/${encodeURIComponent(filename)}`;
    document.body.append(rendered);
    try {
      await rendered.decode();
    } finally {
      rendered.remove();
    }
  }
  const paths: string[] = [];
  for (const format of ["docx", "epub", "txt"] as const) {
    const result = await api.manuscript.exportShort({
      book,
      title: source.title,
      format,
      sections: [{ title: "正文", content }]
    });
    if (result.status !== "saved" || result.missingImages !== 0)
      throw new Error(`Book image smoke ${format} export failed.`);
    paths.push(result.filePath);
  }
  return {
    status: "ok",
    inserted: true,
    displayed: true,
    selectedImages: picked.images.length,
    exports: paths
  };
}

/** Only native dialogs are stubbed; image bytes cross real Preload/Main/Core. */
export async function runBookImageSmoke(window: BrowserWindow) {
  const root = await mkdtemp(
    join(app.getPath("userData"), "book-images-smoke-")
  );
  const sourcePath = join(root, "地图.png");
  const bitmap = nativeImage.createFromBitmap(
    Buffer.alloc(1280 * 720 * 4).fill(Buffer.from([80, 120, 180, 255])),
    { width: 1280, height: 720 }
  );
  const sourceBytes = bitmap.toPNG();
  const jpegPath = join(root, "人物.jpg");
  const webpPath = join(root, "分镜.webp");
  const originalOpen = dialog.showOpenDialog;
  const originalSave = dialog.showSaveDialog;
  try {
    await writeFile(sourcePath, sourceBytes);
    await writeFile(jpegPath, bitmap.toJPEG(85));
    const webp = await window.webContents.executeJavaScript(`(() => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 2;
      const context = canvas.getContext('2d');
      context.fillStyle = '#5078b4';
      context.fillRect(0, 0, 2, 2);
      return canvas.toDataURL('image/webp').split(',')[1];
    })()`);
    await writeFile(webpPath, Buffer.from(webp, "base64"));
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [sourcePath, jpegPath, webpPath]
    });
    dialog.showSaveDialog = async (...args: unknown[]) => {
      const options = args.at(-1) as Electron.SaveDialogOptions;
      const extension = options.filters?.[0]?.extensions[0] ?? "txt";
      return { canceled: false, filePath: join(root, `export.${extension}`) };
    };
    const result = await window.webContents.executeJavaScript(
      `(${insertAndExportInRenderer.toString()})().catch(error => { throw new Error(error instanceof Error ? error.message : JSON.stringify(error)); })`
    );
    for (const path of result.exports as string[]) {
      const bytes = await readFile(path);
      if (path.endsWith(".txt")) {
        const text = bytes.toString("utf8");
        if (!text.includes("[图片：地图]") || text.includes("![地图]"))
          throw new Error("Book image smoke TXT placeholder missing.");
      } else {
        const mediaPath = path.endsWith(".docx")
          ? "word/media/"
          : "OEBPS/images/";
        if (
          !bytes.includes(Buffer.from(mediaPath)) ||
          !bytes.includes(sourceBytes)
        )
          throw new Error("Book image smoke embedded media missing.");
      }
    }
    const editor = await runBookImageEditorSmoke(window);
    const longEditor = await runBookImageLongEditorSmoke(window);
    return { ...result, exports: result.exports.length, editor, longEditor };
  } finally {
    dialog.showOpenDialog = originalOpen;
    dialog.showSaveDialog = originalSave;
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50
    });
  }
}
