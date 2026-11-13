import { describe, expect, it } from "vitest";
import type { ExportShortManuscriptInput } from "@deepwrite/contracts";
import {
  buildDocx,
  buildEpub,
  buildTxt,
  safeManuscriptFileName
} from "./short-manuscript-export";

function fixture(
  format: ExportShortManuscriptInput["format"]
): ExportShortManuscriptInput {
  return {
    book: { projectType: "short", projectId: "book-export" },
    title: "雨夜<&来信",
    format,
    sections: [
      { title: "导语", content: "雨落下来。\n\n门外有人。" },
      { title: "第一节", content: "她打开了门。" }
    ]
  };
}

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

describe("short manuscript file builders", () => {
  it("creates a real DOCX package containing title, intro, and all section text", () => {
    const entries = storedZipEntries(buildDocx(fixture("docx")));
    expect([...entries.keys()]).toEqual(
      expect.arrayContaining([
        "[Content_Types].xml",
        "_rels/.rels",
        "word/document.xml",
        "word/styles.xml"
      ])
    );
    const document = entries.get("word/document.xml")!.toString("utf8");
    expect(document).toContain("雨夜&lt;&amp;来信");
    expect(document).toContain("导语");
    expect(document).toContain("第一节");
    expect(document).toContain("她打开了门。");
  });

  it.each([
    ["single newlines", "第一段。\n第二段。", ["第一段。", "第二段。"]],
    ["one blank line", "第一段。\n\n第二段。", ["第一段。", "第二段。"]],
    [
      "multiple blank lines",
      "第一段。\n\n\n第二段。",
      ["第一段。", "第二段。"]
    ],
    [
      "leading and trailing whitespace",
      "\n　　第一段。\n \n第二段。  \n\n",
      ["第一段。", "第二段。"]
    ],
    [
      "mixed platform newlines",
      "第一段。\r\n\r\n第二段。\r第三段。\n第四段。",
      ["第一段。", "第二段。", "第三段。", "第四段。"]
    ],
    ["only blank lines", "\n\n", []],
    ["whitespace-only lines", " \n\t\r\n　　\n", []],
    [
      "manual indentation and inline spaces",
      "　　第一段有 two words。\n\t第二段  保留间隔。 ",
      ["第一段有 two words。", "第二段  保留间隔。"]
    ],
    ["empty content", "", []]
  ])(
    "normalizes %s into nonempty, consistently formatted DOCX paragraphs",
    (_, content, lines) => {
      const entries = storedZipEntries(
        buildDocx({
          book: { projectType: "short", projectId: "book-export" },
          title: "测试作品",
          format: "docx",
          sections: [
            { title: "第一节", content },
            { title: "第二节", content: "下一节正文。" }
          ]
        })
      );
      const document = entries.get("word/document.xml")!.toString("utf8");
      const paragraphs = [...document.matchAll(/<w:p>(.*?)<\/w:p>/gu)].map(
        (match) => match[1]!
      );
      const paragraphTexts = paragraphs.map((paragraph) =>
        [...paragraph.matchAll(/<w:t\b[^>]*>(.*?)<\/w:t>/gu)]
          .map((match) => match[1])
          .join("")
      );
      expect(paragraphTexts).toEqual([
        "测试作品",
        "第一节",
        ...lines,
        "第二节",
        "下一节正文。"
      ]);
      const bodyParagraphs = paragraphs.filter(
        (paragraph) => !paragraph.includes("<w:pStyle")
      );
      for (const paragraph of bodyParagraphs) {
        expect(paragraph).toContain(
          '<w:spacing w:after="0" w:line="360" w:lineRule="auto"/>'
        );
        expect(paragraph).toContain('<w:ind w:firstLineChars="200"/>');
        expect(paragraph).not.toContain("<w:br/>");
      }
    }
  );

  it("creates an EPUB 3 package with an uncompressed mimetype first and one file per section", () => {
    const epub = buildEpub(fixture("epub"));
    const entries = storedZipEntries(epub);
    expect([...entries.keys()][0]).toBe("mimetype");
    expect(entries.get("mimetype")?.toString("ascii")).toBe(
      "application/epub+zip"
    );
    expect(entries.get("OEBPS/content.opf")?.toString("utf8")).toContain(
      'version="3.0"'
    );
    expect(entries.get("OEBPS/section-001.xhtml")?.toString("utf8")).toContain(
      "门外有人。"
    );
    expect(entries.get("OEBPS/section-002.xhtml")?.toString("utf8")).toContain(
      "她打开了门。"
    );
  });

  it("creates UTF-8 BOM plain text with reader-visible headings", () => {
    const text = buildTxt(fixture("txt")).toString("utf8");
    expect(text.startsWith("\ufeff《雨夜<&来信》")).toBe(true);
    expect(text).toContain("\n\n导语\n\n雨落下来。");
    expect(text).toContain("\n\n第一节\n\n她打开了门。");
  });

  it("removes path separators and Windows-reserved filename characters", () => {
    expect(safeManuscriptFileName('  雨夜:/\\*?<>|" 来信...  ')).toBe(
      "雨夜 来信"
    );
  });
});

function imageAssets() {
  return new Map([
    [
      "images/map-1234abcd.png",
      {
        path: "images/map-1234abcd.png",
        bytes: Buffer.from("test-png-image"),
        ext: "png" as const,
        mimeType: "image/png" as const,
        width: 1200,
        height: 600
      }
    ],
    [
      "images/portrait-8765abcd.jpg",
      {
        path: "images/portrait-8765abcd.jpg",
        bytes: Buffer.from("test-jpeg-image"),
        ext: "jpg" as const,
        mimeType: "image/jpeg" as const,
        width: 100,
        height: 200
      }
    ]
  ]);
}

function illustratedFixture(): ExportShortManuscriptInput {
  return {
    ...fixture("docx"),
    sections: [
      {
        title: "插图",
        content: [
          "前文",
          '![地图<"&>](images/map-1234abcd.png)',
          "后文",
          "![](images/portrait-8765abcd.jpg)",
          "![再次使用](images/map-1234abcd.png)",
          "![丢失](images/missing-abcd1234.png)",
          "外链 ![说明](https://example.test/image.png)"
        ].join("\n")
      }
    ]
  };
}

describe("illustrated manuscript builders", () => {
  it("embeds unique DOCX media, relationships, dimensions, accessible captions and types", () => {
    const entries = storedZipEntries(
      buildDocx(illustratedFixture(), imageAssets())
    );
    expect(
      [...entries.keys()].filter((path) => path.startsWith("word/media/"))
    ).toEqual(["word/media/image1.png", "word/media/image2.jpg"]);
    expect(entries.get("word/media/image1.png")).toEqual(
      Buffer.from("test-png-image")
    );
    const relationships = entries
      .get("word/_rels/document.xml.rels")!
      .toString();
    expect(relationships.match(/relationships\/image/g)).toHaveLength(2);
    expect(relationships).toContain('Id="rIdImage1"');
    expect(relationships).toContain('Target="media/image2.jpg"');
    const types = entries.get("[Content_Types].xml")!.toString();
    expect(types).toContain('Extension="png" ContentType="image/png"');
    expect(types).toContain('Extension="jpg" ContentType="image/jpeg"');
    const document = entries.get("word/document.xml")!.toString();
    expect(document.match(/<w:drawing>/g)).toHaveLength(3);
    expect(document.match(/r:embed="rIdImage1"/g)).toHaveLength(2);
    expect(document).toContain('<wp:extent cx="5731510" cy="2865755"/>');
    expect(document).toContain('descr="地图&lt;&quot;&amp;&gt;"');
    expect(document).toContain('id="3" name="Image 3"');
    expect(document).not.toContain("丢失");
    expect(document).not.toContain("![再次使用]");
    expect(document).toContain("https://example.test/image.png");
  });

  it("embeds EPUB media once and references manifest paths from figures outside text paragraphs", () => {
    const entries = storedZipEntries(
      buildEpub(illustratedFixture(), imageAssets())
    );
    expect(
      [...entries.keys()].filter((path) => path.startsWith("OEBPS/images/"))
    ).toEqual(["OEBPS/images/1.png", "OEBPS/images/2.jpg"]);
    const manifest = entries.get("OEBPS/content.opf")!.toString();
    expect(manifest).toContain('href="images/1.png" media-type="image/png"');
    expect(manifest).toContain('href="images/2.jpg" media-type="image/jpeg"');
    const content = entries.get("OEBPS/section-001.xhtml")!.toString();
    expect(content).toContain("<p>前文</p>\n<figure>");
    expect(content).toContain(
      '<img src="images/1.png" alt="地图&lt;&quot;&amp;&gt;"/>'
    );
    expect(content).toContain(
      "<figcaption>地图&lt;&quot;&amp;&gt;</figcaption>"
    );
    expect(content).toContain(
      '<figure><img src="images/2.jpg" alt=""/></figure>'
    );
    expect(content.match(/src="images\/1.png"/g)).toHaveLength(2);
    expect(content).not.toContain("丢失");
    expect(content).toContain("https://example.test/image.png");
  });

  it("uses TXT placeholders for every valid image line without image assets", () => {
    const text = buildTxt(illustratedFixture()).toString();
    expect(text).toContain('[图片：地图<"&>]');
    expect(text).toContain("[图片]\n[图片：再次使用]");
    expect(text).toContain("[图片：丢失]");
    expect(text).toContain("外链 ![说明](https://example.test/image.png)");
  });
});
