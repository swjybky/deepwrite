import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dialog, type BrowserWindow } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ExportAcademicManuscriptInputSchema,
  type ExportAcademicManuscriptInput
} from "@deepwrite/contracts";
import {
  buildAcademicDocxWithReport,
  buildAcademicMarkdown,
  exportAcademicManuscript
} from "./academic-manuscript-export";

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

function storedZipEntries(zip: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 30 <= zip.length && zip.readUInt32LE(offset) === 0x04034b50) {
    expect(zip.readUInt16LE(offset + 8)).toBe(0);
    const size = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = zip
      .subarray(nameStart, nameStart + nameLength)
      .toString("utf8");
    entries.set(name, zip.subarray(dataStart, dataStart + size));
    offset = dataStart + size;
  }
  return entries;
}

function sampleImageAssets() {
  return new Map([
    [
      "images/arch-01.png",
      {
        path: "images/arch-01.png",
        bytes: Buffer.from("png-arch-bytes"),
        ext: "png" as const,
        mimeType: "image/png" as const,
        width: 1200,
        height: 600
      }
    ]
  ]);
}

function chapteredInput(
  overrides: Partial<ExportAcademicManuscriptInput> = {}
): ExportAcademicManuscriptInput {
  return {
    book: { projectType: "academic", projectId: "acad-book-1" },
    title: "面向长上下文学术写作的智能体架构研究",
    format: "docx",
    includeChapterHeadings: true,
    items: [
      {
        sectionTitle: "摘要",
        content:
          "本文提出一种结构化防幻觉学术写作方法，收敛误差满足 $\\epsilon_t \\le O(1/\\sqrt{T})$。"
      },
      {
        chapterId: "ch-1",
        chapterTitle: "第一章 绪论",
        sectionTitle: "1.1 研究背景与问题定义",
        content: [
          "### 1.1.1 核心挑战",
          "",
          "现有方案在 **长篇一致性** 与引用核查上存在明显缺口。",
          "",
          "$$",
          "\\mathcal{L}_{\\text{total}}(\\theta) = \\sum_{i=1}^{N} \\| f_\\theta(x_i) - y_i \\|_2^2 + \\lambda \\|\\theta\\|_1",
          "$$",
          "",
          "```python",
          "def verify_cite(key: str) -> bool:",
          "    if not key:",
          "        return False",
          "",
          "    return key in VERIFIED_CARDS",
          "```"
        ].join("\n")
      },
      {
        chapterId: "ch-1",
        chapterTitle: "第一章 绪论",
        sectionTitle: "1.2 主要贡献",
        content: [
          "| 模型方案 | 准确率 (%) | 幻觉率 (%) |",
          "| :--- | :---: | ---: |",
          "| Baseline | 78.4 | 14.2 |",
          "| DeepWrite-Acad | 94.1 | 0.8 |",
          "",
          "![图 1 系统总体架构](images/arch-01.png)",
          "![图 2 缺失消融曲线](images/missing-plot.png)"
        ].join("\n")
      },
      {
        sectionTitle: "参考文献",
        content:
          "[1] Vaswani A, et al. Attention Is All You Need[C]. NeurIPS, 2017."
      }
    ],
    ...overrides
  };
}

describe("ExportAcademicManuscriptInputSchema validation", () => {
  it("rejects empty items, unknown formats, and unexpected fields", () => {
    expect(
      ExportAcademicManuscriptInputSchema.safeParse({
        ...chapteredInput(),
        items: []
      }).success
    ).toBe(false);

    expect(
      ExportAcademicManuscriptInputSchema.safeParse({
        ...chapteredInput(),
        format: "pdf"
      }).success
    ).toBe(false);

    expect(
      ExportAcademicManuscriptInputSchema.safeParse({
        ...chapteredInput(),
        extraField: true
      }).success
    ).toBe(false);
  });
});

describe("academic Markdown (.md) export", () => {
  it("builds chapter + section hierarchy and preserves formulas, tables, and code blocks verbatim", () => {
    const { markdown } = buildAcademicMarkdown(
      chapteredInput({ format: "md", imageMode: "single_file" })
    );

    expect(markdown).toContain("# 面向长上下文学术写作的智能体架构研究");
    expect(markdown).toContain("## 摘要");
    expect(markdown.match(/^# 第一章 绪论$/gmu)).toHaveLength(1);
    expect(markdown).toContain("## 1.1 研究背景与问题定义");
    expect(markdown).toContain("### 1.1.1 核心挑战");
    expect(markdown).toContain("## 1.2 主要贡献");
    expect(markdown).toContain("## 参考文献");
    expect(markdown).toContain("$\\epsilon_t \\le O(1/\\sqrt{T})$");
    expect(markdown).toContain(
      "\\mathcal{L}_{\\text{total}}(\\theta) = \\sum_{i=1}^{N} \\| f_\\theta(x_i) - y_i \\|_2^2 + \\lambda \\|\\theta\\|_1"
    );
    expect(markdown).toContain("| DeepWrite-Acad | 94.1 | 0.8 |");
    expect(markdown).toContain(
      "    if not key:\n        return False\n\n    return key in VERIFIED_CARDS"
    );
  });

  it("flattens sections when includeChapterHeadings is false", () => {
    const { markdown } = buildAcademicMarkdown(
      chapteredInput({ format: "md", includeChapterHeadings: false })
    );
    expect(markdown).not.toContain("# 第一章 绪论");
    expect(markdown).toContain("## 1.1 研究背景与问题定义");
    expect(markdown).toContain("## 1.2 主要贡献");
  });

  it("copies loaded images into <baseName>.assets/ and rewrites paths in assets_folder mode, while writing a single file in single_file mode", async () => {
    const dir = await mkdtemp(join(tmpdir(), "deepwrite-academic-md-"));
    temporaryDirectories.push(dir);
    const mdPath = join(dir, "paper.md");
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: false,
      filePath: mdPath
    });

    const loader = vi.fn(async () => ({
      assets: sampleImageAssets(),
      missingImages: 1
    }));

    const folderResult = await exportAcademicManuscript(
      {} as BrowserWindow,
      chapteredInput({ format: "md", imageMode: "assets_folder" }),
      loader
    );

    expect(folderResult).toEqual({
      status: "saved",
      filePath: mdPath,
      assetsDirectory: join(dir, "paper.assets"),
      missingImages: 1
    });

    const writtenMd = await readFile(mdPath, "utf8");
    expect(writtenMd).toContain(
      "![图 1 系统总体架构](./paper.assets/arch-01.png)"
    );
    expect(writtenMd).toContain(
      "![图 2 缺失消融曲线](images/missing-plot.png)"
    );
    expect(await readdir(join(dir, "paper.assets"))).toEqual(["arch-01.png"]);
    expect(await readFile(join(dir, "paper.assets", "arch-01.png"))).toEqual(
      Buffer.from("png-arch-bytes")
    );

    const singleDir = await mkdtemp(
      join(tmpdir(), "deepwrite-academic-single-")
    );
    temporaryDirectories.push(singleDir);
    const singlePath = join(singleDir, "single-paper.md");
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: false,
      filePath: singlePath
    });
    const singleLoader = vi.fn();
    const singleResult = await exportAcademicManuscript(
      {} as BrowserWindow,
      chapteredInput({ format: "md", imageMode: "single_file" }),
      singleLoader
    );
    expect(singleResult).toEqual({
      status: "saved",
      filePath: singlePath,
      missingImages: 0
    });
    expect(singleLoader).not.toHaveBeenCalled();
    expect(await readdir(singleDir)).toEqual(["single-paper.md"]);
    const singleMd = await readFile(singlePath, "utf8");
    expect(singleMd).toContain("![图 1 系统总体架构](images/arch-01.png)");
  });
});

describe("academic Word (.docx) OOXML export", () => {
  it("packages Heading1–3 styles, three-line <w:tbl> tables, verbatim code & LaTeX formulas, embedded figures with captions, and missing image counts", () => {
    const { buffer, missingImages } = buildAcademicDocxWithReport(
      chapteredInput({ format: "docx", includeChapterHeadings: true }),
      sampleImageAssets()
    );
    expect(missingImages).toBe(1);

    const entries = storedZipEntries(buffer);
    expect([...entries.keys()]).toEqual(
      expect.arrayContaining([
        "[Content_Types].xml",
        "_rels/.rels",
        "word/document.xml",
        "word/_rels/document.xml.rels",
        "word/styles.xml",
        "word/media/image1.png"
      ])
    );

    const stylesXml = entries.get("word/styles.xml")!.toString("utf8");
    expect(stylesXml).toContain('w:styleId="Heading1"');
    expect(stylesXml).toContain('<w:outlineLvl w:val="0"/>');
    expect(stylesXml).toContain('w:styleId="Heading2"');
    expect(stylesXml).toContain('<w:outlineLvl w:val="1"/>');
    expect(stylesXml).toContain('w:styleId="Heading3"');
    expect(stylesXml).toContain('<w:outlineLvl w:val="2"/>');
    expect(stylesXml).toContain('w:styleId="CodeBlock"');
    expect(stylesXml).toContain('w:styleId="Caption"');

    const documentXml = entries.get("word/document.xml")!.toString("utf8");

    // Chapter = Heading1 (once), Section under chapter = Heading2, ### inside section = Heading3
    expect(documentXml).toContain(
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t xml:space="preserve">第一章 绪论</w:t></w:r></w:p>'
    );
    expect(documentXml).toContain(
      '<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t xml:space="preserve">1.1 研究背景与问题定义</w:t></w:r></w:p>'
    );
    expect(documentXml).toContain(
      '<w:p><w:pPr><w:pStyle w:val="Heading3"/></w:pPr><w:r><w:t xml:space="preserve">1.1.1 核心挑战</w:t></w:r></w:p>'
    );
    // Unchaptered Abstract & References = Heading1
    expect(documentXml).toContain(
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t xml:space="preserve">摘要</w:t></w:r></w:p>'
    );
    expect(documentXml).toContain(
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t xml:space="preserve">参考文献</w:t></w:r></w:p>'
    );

    // Inline & display math backslashes, subscripts, superscripts, braces intact
    expect(documentXml).toContain("$\\epsilon_t \\le O(1/\\sqrt{T})$");
    expect(documentXml).toContain(
      "\\mathcal{L}_{\\text{total}}(\\theta) = \\sum_{i=1}^{N} \\| f_\\theta(x_i) - y_i \\|_2^2 + \\lambda \\|\\theta\\|_1"
    );

    // Multi-line code block preserves indentation and blank lines
    expect(documentXml).toContain('<w:pStyle w:val="CodeBlock"/>');
    expect(documentXml).toContain(
      '<w:t xml:space="preserve">    if not key:</w:t><w:br/><w:t xml:space="preserve">        return False</w:t><w:br/><w:t xml:space="preserve"></w:t><w:br/><w:t xml:space="preserve">    return key in VERIFIED_CARDS</w:t>'
    );

    // Academic 3-line OOXML table with <w:tblHeader/>
    expect(documentXml).toContain("<w:tbl>");
    expect(documentXml).toContain(
      '<w:top w:val="single" w:sz="8" w:space="0" w:color="000000"/>'
    );
    expect(documentXml).toContain(
      '<w:bottom w:val="single" w:sz="8" w:space="0" w:color="000000"/>'
    );
    expect(documentXml).toContain("<w:tblHeader/>");
    expect(documentXml).toContain(
      '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="000000"/>'
    );
    expect(documentXml).toContain("DeepWrite-Acad");
    expect(documentXml).toContain("94.1");

    // Embedded figure <w:drawing> + Caption + missing image placeholder
    expect(documentXml).toContain("<w:drawing>");
    expect(documentXml).toContain('r:embed="rIdImage1"');
    expect(documentXml).toContain(
      '<w:p><w:pPr><w:pStyle w:val="Caption"/></w:pPr><w:r><w:t xml:space="preserve">图 1 系统总体架构</w:t></w:r></w:p>'
    );
    expect(documentXml).toContain("[图片：图 2 缺失消融曲线]");
  });

  it("maps flat section headings to Heading1 and ###/#### subheadings to Heading2/Heading3", () => {
    const { buffer } = buildAcademicDocxWithReport({
      book: { projectType: "academic", projectId: "acad-flat" },
      title: "单层论文",
      format: "docx",
      includeChapterHeadings: false,
      items: [
        {
          sectionTitle: "3 方法设计",
          content: "### 3.1 模型架构\n\n#### 3.1.1 编码器细节\n\n正文段落。"
        }
      ]
    });
    const documentXml = storedZipEntries(buffer)
      .get("word/document.xml")!
      .toString("utf8");
    expect(documentXml).toContain(
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t xml:space="preserve">3 方法设计</w:t></w:r></w:p>'
    );
    expect(documentXml).toContain(
      '<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t xml:space="preserve">3.1 模型架构</w:t></w:r></w:p>'
    );
    expect(documentXml).toContain(
      '<w:p><w:pPr><w:pStyle w:val="Heading3"/></w:pPr><w:r><w:t xml:space="preserve">3.1.1 编码器细节</w:t></w:r></w:p>'
    );
  });

  it("writes DOCX to disk via exportAcademicManuscript and reports missingImages", async () => {
    const dir = await mkdtemp(join(tmpdir(), "deepwrite-academic-docx-"));
    temporaryDirectories.push(dir);
    const docxPath = join(dir, "thesis.docx");
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: false,
      filePath: docxPath
    });
    const loader = vi.fn(async () => ({
      assets: sampleImageAssets(),
      missingImages: 1
    }));

    const result = await exportAcademicManuscript(
      {} as BrowserWindow,
      chapteredInput({ format: "docx" }),
      loader
    );
    expect(result).toEqual({
      status: "saved",
      filePath: docxPath,
      missingImages: 1
    });
    const savedBytes = await readFile(docxPath);
    expect(storedZipEntries(savedBytes).has("word/document.xml")).toBe(true);
  });
});
