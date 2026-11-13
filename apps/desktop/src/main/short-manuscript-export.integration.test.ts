import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dialog, type BrowserWindow } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExportShortManuscriptInput } from "@deepwrite/contracts";
import { exportShortManuscript } from "./short-manuscript-export";

vi.mock("electron", () => ({ dialog: { showSaveDialog: vi.fn() } }));
const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 20
      })
    )
  );
});
const input: ExportShortManuscriptInput = {
  book: { projectType: "short", projectId: "book-export" },
  title: "插图作品",
  format: "txt",
  sections: [
    {
      title: "正文",
      content:
        "前文\n![地图](images/map-1234abcd.png)\n![缺失](images/missing-1234abcd.png)\n后文"
    }
  ]
};

describe("short manuscript export image preflight", () => {
  it("writes TXT placeholders without reading book images", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deepwrite-short-export-"));
    temporaryDirectories.push(directory);
    const filePath = join(directory, "插图.txt");
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: false,
      filePath
    });
    const loader = vi.fn();
    expect(
      await exportShortManuscript({} as BrowserWindow, input, loader)
    ).toEqual({ status: "saved", filePath, missingImages: 0 });
    expect(loader).not.toHaveBeenCalled();
    const text = await readFile(filePath, "utf8");
    expect(text).toContain("前文\n[图片：地图]\n[图片：缺失]\n后文");
    expect(await readdir(directory)).toEqual(["插图.txt"]);
  });

  it("resolves book images before writing DOCX and returns missing references", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deepwrite-short-export-"));
    temporaryDirectories.push(directory);
    const filePath = join(directory, "插图.docx");
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: false,
      filePath
    });
    const loader = vi.fn(async () => ({
      assets: new Map([
        [
          "images/map-1234abcd.png",
          {
            path: "images/map-1234abcd.png",
            bytes: Buffer.from("test-png"),
            ext: "png" as const,
            mimeType: "image/png" as const,
            width: 1,
            height: 1
          }
        ]
      ]),
      missingImages: 1
    }));
    expect(
      await exportShortManuscript(
        {} as BrowserWindow,
        { ...input, format: "docx" },
        loader
      )
    ).toEqual({ status: "saved", filePath, missingImages: 1 });
    expect(loader).toHaveBeenCalledWith(input.book, [
      input.sections[0]!.content
    ]);
    expect(await readdir(directory)).toEqual(["插图.docx"]);
  });

  it("preserves an existing destination if image size preflight fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deepwrite-short-export-"));
    temporaryDirectories.push(directory);
    const filePath = join(directory, "原稿.epub");
    await writeFile(filePath, "原有导出内容");
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: false,
      filePath
    });
    const loader = vi.fn(async () => {
      throw Object.assign(new Error("Export image limit exceeded"), {
        code: "book_image.export_too_large"
      });
    });
    await expect(
      exportShortManuscript(
        {} as BrowserWindow,
        { ...input, format: "epub" },
        loader
      )
    ).rejects.toMatchObject({ code: "book_image.export_too_large" });
    expect(await readFile(filePath, "utf8")).toBe("原有导出内容");
  });

  it("does not read or write images when the save dialog is cancelled", async () => {
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: true,
      filePath: ""
    });
    const loader = vi.fn();
    expect(
      await exportShortManuscript({} as BrowserWindow, input, loader)
    ).toEqual({ status: "cancelled" });
    expect(loader).not.toHaveBeenCalled();
  });
});
