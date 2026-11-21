import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { BrowserWindow } from "electron";
import { dialog } from "electron";
import { ExportLongManuscriptInputSchema } from "@deepwrite/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  combinedLongManuscriptText,
  exportLongManuscript,
  safeLongExportName,
  writeLongManuscriptExport
} from "./long-manuscript-export";

vi.mock("electron", () => ({
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn()
  }
}));

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 20
      })
    )
  );
});

describe("long manuscript folder export", () => {
  it("uses display labels, creates list folders, and resolves duplicate names", async () => {
    const parent = await mkdtemp(join(tmpdir(), "deepwrite-long-export-"));
    temporaryDirectories.push(parent);
    const result = await writeLongManuscriptExport(parent, {
      book: { projectType: "long", projectId: "longbook-export" },
      title: "雾港:/长篇",
      sections: ["worldbuilding", "manuscript"],
      files: [
        { path: ["世界观", "势力", "巡夜司"], content: "第一份设定" },
        { path: ["世界观", "势力", "巡夜司"], content: "第二份设定" },
        { path: ["正文", "第一节"], content: "正文内容" }
      ]
    });

    expect(result.fileCount).toBe(3);
    expect(result.directoryPath).toContain("雾港 长篇-导出");
    expect(
      (await readdir(join(result.directoryPath, "世界观", "势力"))).sort()
    ).toEqual(["巡夜司 (2).txt", "巡夜司.txt"]);
    expect(
      await readFile(join(result.directoryPath, "正文", "第一节.txt"), "utf8")
    ).toBe("\ufeff正文内容");
  });

  it("sanitizes reserved and unsafe filename characters", () => {
    expect(safeLongExportName('  第一节:/\\*?<>|" ...  ')).toBe("第一节");
    expect(safeLongExportName("CON", "备用名")).toBe("备用名");
  });
});

describe("long manuscript single-file export", () => {
  it("merges selected entries in order with their visible headings", () => {
    const text = combinedLongManuscriptText({
      book: { projectType: "long", projectId: "longbook-export" },
      title: "雾港",
      mode: "single-txt",
      sections: ["worldbuilding", "manuscript"],
      files: [
        { path: ["世界观", "势力", "巡夜司"], content: "设定内容\n" },
        { path: ["正文", "第一章"], content: "第一章正文\n" },
        { path: ["正文", "第二章"], content: "第二章正文" }
      ]
    });

    expect(text).toBe(
      "\ufeff雾港\n\n【世界观】\n\n〔势力 / 巡夜司〕\n\n设定内容\n\n" +
        "【正文】\n\n〔第一章〕\n\n第一章正文\n\n〔第二章〕\n\n第二章正文\n"
    );
  });

  it("saves one TXT file at the selected path", async () => {
    const parent = await mkdtemp(join(tmpdir(), "deepwrite-long-export-"));
    temporaryDirectories.push(parent);
    const filePath = join(parent, "雾港.txt");
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: false,
      filePath
    });

    const result = await exportLongManuscript({} as BrowserWindow, {
      book: { projectType: "long", projectId: "longbook-export" },
      title: "雾港",
      mode: "single-txt",
      sections: ["manuscript"],
      files: [{ path: ["正文", "第一章"], content: "正文" }]
    });

    expect(dialog.showSaveDialog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ defaultPath: "雾港.txt" })
    );
    expect(result).toEqual({
      status: "saved",
      filePath,
      fileCount: 1,
      missingImages: 0
    });
    expect(await readFile(filePath, "utf8")).toBe(
      "\ufeff雾港\n\n【正文】\n\n〔第一章〕\n\n正文\n"
    );
  });
});

describe("long manuscript image export", () => {
  const imagePath = "images/map-1234abcd.png";
  const assets = new Map([
    [
      imagePath,
      {
        path: imagePath,
        bytes: Buffer.from("test-png-image"),
        ext: "png" as const,
        mimeType: "image/png" as const,
        width: 100,
        height: 100
      }
    ]
  ]);
  const input = {
    book: { projectType: "long" as const, projectId: "longbook-export" },
    title: "插图作品",
    sections: ["worldbuilding", "characters", "plot", "manuscript"] as const,
    files: ["世界观", "人物", "剧情", "正文"].map((section) => ({
      path: [section, "条目"],
      content: `文字\n![地图](${imagePath})\n![](images/missing-1234abcd.jpg)`
    }))
  };
  const exportInput = { ...input, sections: [...input.sections] };

  it("validates the format independently of the export mode", () => {
    expect(
      ExportLongManuscriptInputSchema.safeParse({
        ...exportInput,
        mode: "single-txt"
      }).success
    ).toBe(true);
    expect(
      ExportLongManuscriptInputSchema.safeParse({
        ...exportInput,
        mode: "single-file",
        format: "md"
      }).success
    ).toBe(true);
    expect(
      ExportLongManuscriptInputSchema.safeParse({
        ...exportInput,
        mode: "folder",
        format: "docx"
      }).success
    ).toBe(false);
  });

  it("writes separate Markdown files and resolves links from nested folders", async () => {
    const parent = await mkdtemp(join(tmpdir(), "deepwrite-long-markdown-"));
    temporaryDirectories.push(parent);
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({
      canceled: false,
      filePaths: [parent]
    });
    const loader = vi.fn(async () => ({ assets, missingImages: 1 }));
    const { content } = exportInput.files[0]!;
    const result = await exportLongManuscript(
      {} as BrowserWindow,
      {
        ...exportInput,
        format: "md",
        files: [
          { path: ["正文", "第一卷", "潮声"], content },
          { path: ["正文", "第一卷", "潮声"], content: "**后文**\n" }
        ]
      },
      loader
    );
    const directoryPath = join(parent, "插图作品-导出");
    expect(result).toEqual({
      status: "saved",
      directoryPath,
      fileCount: 2,
      missingImages: 1
    });
    expect(await readdir(join(directoryPath, "images"))).toEqual([
      "map-1234abcd.png"
    ]);
    expect(
      await readFile(join(directoryPath, "正文", "第一卷", "潮声.md"), "utf8")
    ).toBe("文字\n![地图](../../images/map-1234abcd.png)\n[图片]");
    expect(
      await readFile(
        join(directoryPath, "正文", "第一卷", "潮声 (2).md"),
        "utf8"
      )
    ).toBe("**后文**\n");
  });

  it("merges Markdown in section and chapter order with sibling image files", async () => {
    const parent = await mkdtemp(join(tmpdir(), "deepwrite-long-markdown-"));
    temporaryDirectories.push(parent);
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: false,
      filePath: join(parent, "export")
    });
    const filePath = join(parent, "export.md");
    const result = await exportLongManuscript(
      {} as BrowserWindow,
      {
        ...exportInput,
        mode: "single-file",
        format: "md",
        files: [
          exportInput.files[0]!,
          { path: ["正文", "第一卷", "第一章"], content: "**前文**" },
          { path: ["正文", "第一卷", "第二章"], content: "- 后文" }
        ]
      },
      async () => ({ assets, missingImages: 1 })
    );
    expect(result).toEqual({
      status: "saved",
      filePath,
      fileCount: 1,
      missingImages: 1
    });
    expect(dialog.showSaveDialog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        defaultPath: "插图作品.md",
        filters: [expect.objectContaining({ extensions: ["md"] })]
      })
    );
    expect(await readFile(filePath, "utf8")).toBe(
      "# 插图作品\n\n## 世界观\n\n### 条目\n\n文字\n![地图](./export.assets/map-1234abcd.png)\n[图片]\n\n" +
        "## 正文\n\n### 第一卷 / 第一章\n\n**前文**\n\n### 第一卷 / 第二章\n\n- 后文\n"
    );
    expect(
      await readFile(join(parent, "export.assets", "map-1234abcd.png"))
    ).toEqual(assets.get(imagePath)!.bytes);
  });

  it("copies each referenced image once and adds matching links in every folder section", async () => {
    const parent = await mkdtemp(join(tmpdir(), "deepwrite-long-images-"));
    temporaryDirectories.push(parent);
    const result = await writeLongManuscriptExport(parent, exportInput, assets);
    expect(await readdir(join(result.directoryPath, "images"))).toEqual([
      "map-1234abcd.png"
    ]);
    expect(await readFile(join(result.directoryPath, imagePath))).toEqual(
      Buffer.from("test-png-image")
    );
    for (const section of ["世界观", "人物", "剧情", "正文"]) {
      expect(
        await readFile(join(result.directoryPath, section, "条目.txt"), "utf8")
      ).toBe(`\ufeff文字\n[图片：地图](${imagePath})\n`);
    }
    expect(result.fileCount).toBe(4);
    const combined = combinedLongManuscriptText(exportInput);
    expect(combined.match(/\[图片：地图\]/g)).toHaveLength(4);
    expect(combined.match(/\[图片\]/g)).toHaveLength(4);
    expect(combined).not.toContain("images/");
  });

  it("writes a single TXT without reading book images", async () => {
    const parent = await mkdtemp(join(tmpdir(), "deepwrite-long-images-"));
    temporaryDirectories.push(parent);
    const filePath = join(parent, "插图作品.txt");
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: false,
      filePath
    });
    const loader = vi.fn();
    const result = await exportLongManuscript(
      {} as BrowserWindow,
      { ...exportInput, mode: "single-txt" },
      loader
    );
    expect(loader).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: "saved",
      filePath,
      fileCount: 1,
      missingImages: 0
    });
    expect(await readFile(filePath, "utf8")).toContain(
      "文字\n[图片：地图]\n[图片]"
    );
  });

  it("returns missing-image counts from the resolver after a folder export", async () => {
    const parent = await mkdtemp(join(tmpdir(), "deepwrite-long-images-"));
    temporaryDirectories.push(parent);
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({
      canceled: false,
      filePaths: [parent]
    });
    const loader = vi.fn(async () => ({ assets, missingImages: 4 }));
    const result = await exportLongManuscript(
      {} as BrowserWindow,
      exportInput,
      loader
    );
    expect(loader).toHaveBeenCalledWith(
      input.book,
      input.files.map((file) => file.content)
    );
    expect(result).toMatchObject({
      status: "saved",
      missingImages: 4,
      fileCount: 4
    });
  });

  it("writes no output if image preflight rejects the export size", async () => {
    const parent = await mkdtemp(join(tmpdir(), "deepwrite-long-images-"));
    temporaryDirectories.push(parent);
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({
      canceled: false,
      filePaths: [parent]
    });
    const loader = vi.fn(async () => {
      throw Object.assign(new Error("Export image limit exceeded"), {
        code: "book_image.export_too_large"
      });
    });
    await expect(
      exportLongManuscript({} as BrowserWindow, exportInput, loader)
    ).rejects.toMatchObject({ code: "book_image.export_too_large" });
    expect(await readdir(parent)).toEqual([]);
  });
});
