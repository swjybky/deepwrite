import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { extname } from "node:path";
import { dialog, type BrowserWindow, type SaveDialogOptions } from "electron";
import {
  ExportShortManuscriptInputSchema,
  ExportShortManuscriptResultSchema,
  type ExportShortManuscriptInput,
  type ExportShortManuscriptResult,
  type ShortManuscriptExportFormat
} from "@deepwrite/contracts";

interface ZipEntry {
  name: string;
  data: Buffer;
}

const CRC32_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) !== 0
      ? 0xedb88320 ^ (value >>> 1)
      : value >>> 1;
  }
  return value >>> 0;
});

function crc32(buffer: Buffer): number {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value = CRC32_TABLE[(value ^ byte) & 0xff]! ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function zipDateTime(date = new Date()): { date: number; time: number } {
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time:
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      Math.floor(date.getSeconds() / 2)
  };
}

/** Builds a standards-compliant stored ZIP without adding a runtime dependency. */
export function createStoredZip(entries: readonly ZipEntry[]): Buffer {
  if (entries.length === 0 || entries.length > 0xffff) {
    throw new Error("ZIP entry count is outside the supported range.");
  }
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  const { date, time } = zipDateTime();
  let localOffset = 0;

  for (const entry of entries) {
    if (!entry.name || entry.name.includes("\0")) {
      throw new Error("ZIP entry name is invalid.");
    }
    const name = Buffer.from(entry.name, "utf8");
    const checksum = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, name);

    localOffset += local.length + name.length + entry.data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function textBlocks(value: string): string[] {
  const normalized = normalizeText(value).trim();
  return normalized ? normalized.split(/\n{2,}/) : [];
}

function wordTextRuns(value: string): string {
  return normalizeText(value)
    .split("\n")
    .map(
      (line, index) =>
        `${index > 0 ? "<w:br/>" : ""}<w:t xml:space="preserve">${xmlEscape(line)}</w:t>`
    )
    .join("");
}

function wordParagraph(value: string, style?: "Title" | "Heading1"): string {
  const properties = style
    ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>`
    : '<w:pPr><w:spacing w:after="160" w:line="360" w:lineRule="auto"/><w:ind w:firstLineChars="200"/></w:pPr>';
  return `<w:p>${properties}<w:r>${wordTextRuns(value)}</w:r></w:p>`;
}

export function buildDocx(input: ExportShortManuscriptInput): Buffer {
  const validated = ExportShortManuscriptInputSchema.parse({ ...input, format: "docx" });
  const body = [
    wordParagraph(validated.title, "Title"),
    ...validated.sections.flatMap((section) => [
      wordParagraph(section.title, "Heading1"),
      ...textBlocks(section.content).map((block) => wordParagraph(block))
    ])
  ].join("");
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="宋体"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/><w:spacing w:before="240" w:after="480"/></w:pPr><w:rPr><w:rFonts w:eastAsia="黑体"/><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="240"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:rFonts w:eastAsia="黑体"/><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>
</w:styles>`;
  const timestamp = new Date().toISOString();
  return createStoredZip([
    {
      name: "[Content_Types].xml",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`, "utf8")
    },
    {
      name: "_rels/.rels",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`, "utf8")
    },
    { name: "word/document.xml", data: Buffer.from(documentXml, "utf8") },
    {
      name: "word/_rels/document.xml.rels",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`, "utf8")
    },
    { name: "word/styles.xml", data: Buffer.from(stylesXml, "utf8") },
    {
      name: "docProps/core.xml",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEscape(validated.title)}</dc:title><dc:creator>DeepWrite</dc:creator><cp:lastModifiedBy>DeepWrite</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:modified></cp:coreProperties>`, "utf8")
    },
    {
      name: "docProps/app.xml",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>DeepWrite</Application><AppVersion>1.0</AppVersion></Properties>`, "utf8")
    }
  ]);
}

function xhtmlParagraphs(content: string): string {
  return textBlocks(content)
    .map(
      (block) =>
        `<p>${normalizeText(block).split("\n").map(xmlEscape).join("<br />")}</p>`
    )
    .join("\n");
}

function epubXhtml(title: string, body: string): Buffer {
  return Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh-CN" lang="zh-CN"><head><meta charset="utf-8"/><title>${xmlEscape(title)}</title><link rel="stylesheet" type="text/css" href="styles.css"/></head><body>${body}</body></html>`, "utf8");
}

export function buildEpub(input: ExportShortManuscriptInput): Buffer {
  const validated = ExportShortManuscriptInputSchema.parse({ ...input, format: "epub" });
  const identifier = `urn:uuid:${randomUUID()}`;
  const sectionItems = validated.sections.map((section, index) => ({
    section,
    id: `section-${index + 1}`,
    fileName: `section-${String(index + 1).padStart(3, "0")}.xhtml`
  }));
  const modified = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const manifest = sectionItems
    .map(({ id, fileName }) => `<item id="${id}" href="${fileName}" media-type="application/xhtml+xml"/>`)
    .join("");
  const spine = sectionItems.map(({ id }) => `<itemref idref="${id}"/>`).join("");
  const navigation = sectionItems
    .map(({ section, fileName }) => `<li><a href="${fileName}">${xmlEscape(section.title)}</a></li>`)
    .join("");

  const entries: ZipEntry[] = [
    { name: "mimetype", data: Buffer.from("application/epub+zip", "ascii") },
    {
      name: "META-INF/container.xml",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`, "utf8")
    },
    {
      name: "OEBPS/content.opf",
      data: Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="zh-CN"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">${identifier}</dc:identifier><dc:title>${xmlEscape(validated.title)}</dc:title><dc:language>zh-CN</dc:language><dc:creator>DeepWrite</dc:creator><meta property="dcterms:modified">${modified}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="styles.css" media-type="text/css"/><item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>${manifest}</manifest><spine><itemref idref="title"/>${spine}</spine></package>`, "utf8")
    },
    {
      name: "OEBPS/nav.xhtml",
      data: epubXhtml(
        `${validated.title} · 目录`,
        `<nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops"><h1>目录</h1><ol><li><a href="title.xhtml">${xmlEscape(validated.title)}</a></li>${navigation}</ol></nav>`
      )
    },
    {
      name: "OEBPS/styles.css",
      data: Buffer.from("body{font-family:serif;line-height:1.8;margin:5%;}h1{text-align:center;}h2{margin-top:1.5em;}p{text-indent:2em;margin:.7em 0;}nav ol{line-height:2;}nav a{text-decoration:none;}", "utf8")
    },
    {
      name: "OEBPS/title.xhtml",
      data: epubXhtml(validated.title, `<section class="title-page"><h1>${xmlEscape(validated.title)}</h1></section>`)
    },
    ...sectionItems.map(({ section, fileName }) => ({
      name: `OEBPS/${fileName}`,
      data: epubXhtml(
        section.title,
        `<section><h2>${xmlEscape(section.title)}</h2>${xhtmlParagraphs(section.content)}</section>`
      )
    }))
  ];
  return createStoredZip(entries);
}

export function buildTxt(input: ExportShortManuscriptInput): Buffer {
  const validated = ExportShortManuscriptInputSchema.parse({ ...input, format: "txt" });
  const content = [
    `《${validated.title}》`,
    ...validated.sections.flatMap((section) => [
      section.title,
      normalizeText(section.content).trim()
    ])
  ].join("\n\n");
  return Buffer.from(`\ufeff${content}\n`, "utf8");
}

export function buildShortManuscriptFile(
  input: ExportShortManuscriptInput
): Buffer {
  const validated = ExportShortManuscriptInputSchema.parse(input);
  if (validated.format === "docx") return buildDocx(validated);
  if (validated.format === "epub") return buildEpub(validated);
  return buildTxt(validated);
}

export function safeManuscriptFileName(title: string): string {
  const safe = Array.from(
    title
      .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, " ")
      .replace(/\s+/gu, " ")
      .trim()
      .replace(/[. ]+$/gu, "")
  ).slice(0, 80).join("");
  return safe || "短篇正文";
}

function ensureFormatExtension(
  filePath: string,
  format: ShortManuscriptExportFormat
): string {
  const current = extname(filePath).toLowerCase();
  const desired = `.${format}`;
  if (current === desired) return filePath;
  if ([".docx", ".txt", ".epub"].includes(current)) {
    return `${filePath.slice(0, -current.length)}${desired}`;
  }
  return `${filePath}${desired}`;
}

const FORMAT_DIALOG: Record<
  ShortManuscriptExportFormat,
  Pick<SaveDialogOptions, "title" | "filters">
> = {
  docx: { title: "导出正文为 DOCX", filters: [{ name: "Word 文档", extensions: ["docx"] }] },
  txt: { title: "导出正文为 TXT", filters: [{ name: "纯文本文档", extensions: ["txt"] }] },
  epub: { title: "导出正文为 EPUB", filters: [{ name: "EPUB 电子书", extensions: ["epub"] }] }
};

export async function exportShortManuscript(
  window: BrowserWindow,
  rawInput: ExportShortManuscriptInput
): Promise<ExportShortManuscriptResult> {
  const input = ExportShortManuscriptInputSchema.parse(rawInput);
  const selection = await dialog.showSaveDialog(window, {
    ...FORMAT_DIALOG[input.format],
    buttonLabel: "导出",
    defaultPath: `${safeManuscriptFileName(input.title)}-正文.${input.format}`,
    properties: ["createDirectory", "showOverwriteConfirmation"]
  });
  if (selection.canceled || !selection.filePath) {
    return ExportShortManuscriptResultSchema.parse({ status: "cancelled" });
  }
  const filePath = ensureFormatExtension(selection.filePath, input.format);
  await writeFile(filePath, buildShortManuscriptFile(input));
  return ExportShortManuscriptResultSchema.parse({ status: "saved", filePath });
}
