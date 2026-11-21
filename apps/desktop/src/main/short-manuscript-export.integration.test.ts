import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dialog, type BrowserWindow } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ExportShortManuscriptInputSchema,
  type ExportShortManuscriptInput
} from "@deepwrite/contracts";
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

  it.each(["txt", "md"] as const)(
    "does not read or write %s images when the save dialog is cancelled",
    async (format) => {
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({
        canceled: true,
        filePath: ""
      });
      const loader = vi.fn();
      expect(
        await exportShortManuscript(
          {} as BrowserWindow,
          { ...input, format },
          loader
        )
      ).toEqual({ status: "cancelled" });
      expect(loader).not.toHaveBeenCalled();
    }
  );
});

describe("short and script Markdown export", () => {
  it("accepts Markdown and rejects unsupported formats", () => {
    expect(
      ExportShortManuscriptInputSchema.safeParse({ ...input, format: "md" })
        .success
    ).toBe(true);
    expect(
      ExportShortManuscriptInputSchema.safeParse({ ...input, format: "pdf" })
        .success
    ).toBe(false);
  });

  it.each(["short", "script"] as const)(
    "preserves the %s manuscript's formatting and writes portable image links",
    async (projectType) => {
      const directory = await mkdtemp(
        join(tmpdir(), "deepwrite-short-export-")
      );
      temporaryDirectories.push(directory);
      const filePath = join(directory, "插图 (修订稿).md");
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({
        canceled: false,
        filePath
      });
      const oldAssets = join(directory, "插图 (修订稿).assets");
      await mkdir(oldAssets);
      await writeFile(join(oldAssets, "原有图片.png"), "existing");
      const imagePath = "images/map-1234abcd.png";
      const image = `![地图](${imagePath})`;
      const missing = "![缺失](images/missing-1234abcd.png)";
      const literal = "![示例](images/code-example.png)";
      const code = ["```md", literal, "```"].join("\n");
      const body = `- **列表**\n\n| 地点 |\n| --- |\n| 庭院 |\n\n${code}`;
      const bytes = Buffer.from("test-png");
      const loader = vi.fn(async () => ({
        assets: new Map([
          [
            imagePath,
            {
              path: imagePath,
              bytes,
              ext: "png" as const,
              mimeType: "image/png" as const,
              width: 1,
              height: 1
            }
          ]
        ]),
        missingImages: 1
      }));
      const book = { ...input.book, projectType };
      expect(
        await exportShortManuscript(
          {} as BrowserWindow,
          {
            ...input,
            book,
            format: "md",
            sections: [
              { title: "开场 #", content: `${body}\n\n${image}\n\n${missing}` },
              { title: "第二节", content: "结尾  " }
            ]
          },
          loader
        )
      ).toEqual({ status: "saved", filePath, missingImages: 1 });
      expect(loader).toHaveBeenCalledWith(book, [image, missing]);
      expect(dialog.showSaveDialog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          defaultPath: "插图作品-正文.md",
          filters: [expect.objectContaining({ extensions: ["md"] })]
        })
      );
      const markdown = await readFile(filePath, "utf8");
      const link = /!\[地图\]\(([^()\s]+)\)/u.exec(markdown)![1]!;
      const assetPath = decodeURIComponent(link);
      expect(assetPath).toBe("./插图 (修订稿) (2).assets/map-1234abcd.png");
      expect(markdown).toBe(
        `# 插图作品\n\n## 开场 \\#\n\n${body}\n\n![地图](${link})\n\n[图片：缺失]\n\n## 第二节\n\n结尾  \n`
      );
      expect(await readFile(join(oldAssets, "原有图片.png"), "utf8")).toBe(
        "existing"
      );
      expect(await readFile(join(directory, assetPath))).toEqual(bytes);
    }
  );
});
