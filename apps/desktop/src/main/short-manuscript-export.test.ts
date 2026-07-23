import { describe, expect, it } from "vitest";
import type { ExportShortManuscriptInput } from "@deepwrite/contracts";
import {
  buildDocx,
  buildEpub,
  buildTxt,
  safeManuscriptFileName
} from "./short-manuscript-export";

function fixture(format: ExportShortManuscriptInput["format"]): ExportShortManuscriptInput {
  return {
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
    const name = zip.subarray(nameStart, nameStart + nameLength).toString("utf8");
    entries.set(name, zip.subarray(dataStart, dataStart + size));
    offset = dataStart + size;
  }
  return entries;
}

describe("short manuscript file builders", () => {
  it("creates a real DOCX package containing title, intro, and all section text", () => {
    const entries = storedZipEntries(buildDocx(fixture("docx")));
    expect([...entries.keys()]).toEqual(expect.arrayContaining([
      "[Content_Types].xml",
      "_rels/.rels",
      "word/document.xml",
      "word/styles.xml"
    ]));
    const document = entries.get("word/document.xml")!.toString("utf8");
    expect(document).toContain("雨夜&lt;&amp;来信");
    expect(document).toContain("导语");
    expect(document).toContain("第一节");
    expect(document).toContain("她打开了门。");
  });

  it("creates an EPUB 3 package with an uncompressed mimetype first and one file per section", () => {
    const epub = buildEpub(fixture("epub"));
    const entries = storedZipEntries(epub);
    expect([...entries.keys()][0]).toBe("mimetype");
    expect(entries.get("mimetype")?.toString("ascii")).toBe("application/epub+zip");
    expect(entries.get("OEBPS/content.opf")?.toString("utf8")).toContain('version="3.0"');
    expect(entries.get("OEBPS/section-001.xhtml")?.toString("utf8")).toContain("门外有人。");
    expect(entries.get("OEBPS/section-002.xhtml")?.toString("utf8")).toContain("她打开了门。");
  });

  it("creates UTF-8 BOM plain text with reader-visible headings", () => {
    const text = buildTxt(fixture("txt")).toString("utf8");
    expect(text.startsWith("\ufeff《雨夜<&来信》")).toBe(true);
    expect(text).toContain("\n\n导语\n\n雨落下来。");
    expect(text).toContain("\n\n第一节\n\n她打开了门。");
  });

  it("removes path separators and Windows-reserved filename characters", () => {
    expect(safeManuscriptFileName('  雨夜:/\\*?<>|" 来信...  ')).toBe("雨夜 来信");
  });
});
