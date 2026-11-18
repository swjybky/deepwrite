import {
  ExportAcademicManuscriptInputSchema,
  type ExportAcademicManuscriptInput
} from "@deepwrite/contracts";
import {
  imagePlaceholder,
  normalizeText,
  parseBookImageLine,
  xmlEscape,
  type ManuscriptImageAssets
} from "./manuscript-export-images";
import { createStoredZip } from "./zip-writer";

type ParagraphStyleId =
  | "Title"
  | "Heading1"
  | "Heading2"
  | "Heading3"
  | "Normal"
  | "CodeBlock"
  | "Caption";

type TableAlign = "left" | "center" | "right";

type AtomicInlineToken =
  | { kind: "code"; text: string }
  | { kind: "math"; text: string }
  | { kind: "text"; text: string };

function tokenizeProtectedInlines(source: string): AtomicInlineToken[] {
  const tokens: AtomicInlineToken[] = [];
  let cursor = 0;
  let plainStart = 0;

  const flushPlain = (end: number): void => {
    if (end > plainStart) {
      tokens.push({ kind: "text", text: source.slice(plainStart, end) });
    }
  };

  while (cursor < source.length) {
    const ch = source[cursor];
    if (ch === "`") {
      let tickEnd = cursor;
      while (tickEnd < source.length && source[tickEnd] === "`") tickEnd += 1;
      const fence = source.slice(cursor, tickEnd);
      const closeIdx = source.indexOf(fence, tickEnd);
      if (closeIdx > tickEnd) {
        flushPlain(cursor);
        tokens.push({ kind: "code", text: source.slice(tickEnd, closeIdx) });
        cursor = closeIdx + fence.length;
        plainStart = cursor;
        continue;
      }
      cursor = tickEnd;
      continue;
    }

    if (ch === "$" && source[cursor + 1] !== "$") {
      let search = cursor + 1;
      let closeIdx = -1;
      while (search < source.length) {
        if (source[search] === "\\" && search + 1 < source.length) {
          search += 2;
          continue;
        }
        if (source[search] === "$") {
          if (source[search + 1] !== "$") {
            closeIdx = search;
          }
          break;
        }
        search += 1;
      }
      if (closeIdx > cursor + 1) {
        flushPlain(cursor);
        tokens.push({
          kind: "math",
          text: source.slice(cursor, closeIdx + 1)
        });
        cursor = closeIdx + 1;
        plainStart = cursor;
        continue;
      }
    }
    cursor += 1;
  }

  flushPlain(source.length);
  return tokens;
}

function makeRun(text: string, rPrInner = ""): string {
  const rPr = rPrInner ? `<w:rPr>${rPrInner}</w:rPr>` : "";
  return `<w:r>${rPr}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`;
}

function renderPlainSegmentWithBold(text: string, baseRPr: string): string {
  const parts: string[] = [];
  const boldPattern = /\*\*([^*]+)\*\*/gu;
  let lastIndex = 0;
  for (
    let match = boldPattern.exec(text);
    match !== null;
    match = boldPattern.exec(text)
  ) {
    if (match.index > lastIndex) {
      parts.push(makeRun(text.slice(lastIndex, match.index), baseRPr));
    }
    const boldRPr = baseRPr.includes("<w:b/>") ? baseRPr : `${baseRPr}<w:b/>`;
    parts.push(makeRun(match[1]!, boldRPr));
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(makeRun(text.slice(lastIndex), baseRPr));
  }
  return parts.length > 0 ? parts.join("") : makeRun("", baseRPr);
}

function inlineWordRuns(value: string, baseRPr = ""): string {
  const normalized = normalizeText(value);
  if (!normalized) return makeRun("", baseRPr);
  const tokens = tokenizeProtectedInlines(normalized);
  return tokens
    .map((token) => {
      if (token.kind === "code") {
        return makeRun(
          token.text,
          `${baseRPr}<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>`
        );
      }
      if (token.kind === "math") {
        return makeRun(
          token.text,
          `${baseRPr}<w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/>`
        );
      }
      return renderPlainSegmentWithBold(token.text, baseRPr);
    })
    .join("");
}

function styledParagraph(value: string, style: ParagraphStyleId): string {
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>${inlineWordRuns(value)}</w:p>`;
}

function codeBlockParagraph(lines: readonly string[]): string {
  const safeLines = lines.length > 0 ? lines : [""];
  const runs = safeLines
    .map(
      (line, index) =>
        `${index > 0 ? "<w:br/>" : ""}<w:t xml:space="preserve">${xmlEscape(line)}</w:t>`
    )
    .join("");
  return `<w:p><w:pPr><w:pStyle w:val="CodeBlock"/></w:pPr><w:r>${runs}</w:r></w:p>`;
}

function displayMathParagraph(lines: readonly string[]): string {
  const runs = lines
    .map(
      (line, index) =>
        `${index > 0 ? "<w:br/>" : ""}<w:t xml:space="preserve">${xmlEscape(line)}</w:t>`
    )
    .join("");
  return `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="120" w:after="120"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/></w:rPr>${runs}</w:r></w:p>`;
}

function wordImageParagraph(
  asset: { width: number; height: number },
  relationshipId: string,
  alt: string,
  id: number
): string {
  const originalWidth = asset.width * 9525;
  const width = Math.min(originalWidth, 5_731_510);
  const height = Math.round((asset.height * 9525 * width) / originalWidth);
  const caption = alt
    ? `<w:p><w:pPr><w:pStyle w:val="Caption"/></w:pPr><w:r><w:t xml:space="preserve">${xmlEscape(alt)}</w:t></w:r></w:p>`
    : "";
  return `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${width}" cy="${height}"/><wp:docPr id="${id}" name="Image ${id}" descr="${xmlEscape(alt)}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="Image ${id}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>${caption}`;
}

function parseTableCells(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|") && !trimmed.endsWith("\\|")) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed
    .split(/(?<!\\)\|/u)
    .map((cell) => cell.replaceAll("\\|", "|").trim());
}

function parseDelimiterAlignments(line: string): TableAlign[] | undefined {
  if (!line.includes("|")) return undefined;
  const cells = parseTableCells(line);
  if (cells.length === 0) return undefined;
  const alignments: TableAlign[] = [];
  for (const cell of cells) {
    if (!/^:?-+:?$/u.test(cell)) return undefined;
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    alignments.push(left && right ? "center" : right ? "right" : "left");
  }
  return alignments;
}

function normalizeRowCells(
  cells: readonly string[],
  columnCount: number
): string[] {
  if (cells.length === columnCount) return [...cells];
  if (cells.length > columnCount) return cells.slice(0, columnCount);
  return [
    ...cells,
    ...Array.from({ length: columnCount - cells.length }, () => "")
  ];
}

function renderOoxmlTable(
  headerCells: readonly string[],
  alignments: readonly TableAlign[],
  bodyRows: ReadonlyArray<readonly string[]>
): string {
  const columnCount = headerCells.length;
  const normalizedHeader = normalizeRowCells(headerCells, columnCount);
  const gridCols = Array.from(
    { length: columnCount },
    () => "<w:gridCol/>"
  ).join("");

  const headerRowXml = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${normalizedHeader
    .map((cell, colIndex) => {
      const align = alignments[colIndex] ?? "left";
      return `<w:tc><w:tcPr><w:tcBorders><w:bottom w:val="single" w:sz="4" w:space="0" w:color="000000"/></w:tcBorders></w:tcPr><w:p><w:pPr><w:jc w:val="${align}"/><w:spacing w:before="40" w:after="40"/></w:pPr>${inlineWordRuns(cell, "<w:b/>")}</w:p></w:tc>`;
    })
    .join("")}</w:tr>`;

  const bodyRowsXml = bodyRows
    .map((row) => {
      const normalized = normalizeRowCells(row, columnCount);
      return `<w:tr>${normalized
        .map((cell, colIndex) => {
          const align = alignments[colIndex] ?? "left";
          return `<w:tc><w:tcPr/><w:p><w:pPr><w:jc w:val="${align}"/><w:spacing w:before="40" w:after="40"/></w:pPr>${inlineWordRuns(cell)}</w:p></w:tc>`;
        })
        .join("")}</w:tr>`;
    })
    .join("");

  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:jc w:val="center"/><w:tblBorders><w:top w:val="single" w:sz="8" w:space="0" w:color="000000"/><w:left w:val="none"/><w:bottom w:val="single" w:sz="8" w:space="0" w:color="000000"/><w:right w:val="none"/><w:insideH w:val="none"/><w:insideV w:val="none"/></w:tblBorders><w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${gridCols}</w:tblGrid>${headerRowXml}${bodyRowsXml}</w:tbl>`;
}

interface ImageSlot {
  asset: {
    bytes: Buffer;
    ext: "png" | "jpg";
    width: number;
    height: number;
  };
  filename: string;
  relationshipId: string;
}

function renderSectionContentBlocks(
  content: string,
  sectionHeadingStyle: "Heading1" | "Heading2",
  images: ReadonlyMap<string, ImageSlot>,
  state: { drawingId: number; missingImages: number }
): string[] {
  const blocks: string[] = [];
  const lines = normalizeText(content).split("\n");
  let index = 0;

  while (index < lines.length) {
    const rawLine = lines[index]!;
    const trimmed = rawLine.trim();

    if (trimmed.length === 0) {
      index += 1;
      continue;
    }

    const fenceMatch = /^\s*(`{3,}|~{3,})(.*)$/u.exec(rawLine);
    if (fenceMatch) {
      const fenceChar = fenceMatch[1]![0]!;
      const fenceLength = fenceMatch[1]!.length;
      const closingFence = new RegExp(
        `^\\s*${fenceChar}{${fenceLength},}\\s*$`,
        "u"
      );
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !closingFence.test(lines[index]!)) {
        codeLines.push(lines[index]!);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(codeBlockParagraph(codeLines));
      continue;
    }

    if (trimmed.startsWith("$$")) {
      if (trimmed.length > 2 && trimmed.endsWith("$$")) {
        blocks.push(displayMathParagraph([trimmed]));
        index += 1;
        continue;
      }
      const mathLines = [rawLine.trimEnd()];
      index += 1;
      while (index < lines.length) {
        const current = lines[index]!;
        mathLines.push(current.trimEnd());
        index += 1;
        if (current.trim().endsWith("$$")) break;
      }
      blocks.push(displayMathParagraph(mathLines));
      continue;
    }

    if (rawLine.includes("|") && index + 1 < lines.length) {
      const alignments = parseDelimiterAlignments(lines[index + 1]!);
      const headerCells = parseTableCells(rawLine);
      if (
        alignments &&
        headerCells.length > 0 &&
        headerCells.length === alignments.length
      ) {
        const bodyRows: string[][] = [];
        index += 2;
        while (index < lines.length) {
          const candidate = lines[index]!;
          const candidateTrimmed = candidate.trim();
          if (
            !candidateTrimmed ||
            !candidate.includes("|") ||
            candidateTrimmed.startsWith("```") ||
            candidateTrimmed.startsWith("~~~") ||
            candidateTrimmed.startsWith("$$") ||
            /^#{1,6}\s+/u.test(candidateTrimmed)
          ) {
            break;
          }
          bodyRows.push(parseTableCells(candidate));
          index += 1;
        }
        blocks.push(renderOoxmlTable(headerCells, alignments, bodyRows));
        continue;
      }
    }

    const image = parseBookImageLine(trimmed);
    if (image) {
      const slot = images.get(image.path);
      if (slot) {
        state.drawingId += 1;
        blocks.push(
          wordImageParagraph(
            slot.asset,
            slot.relationshipId,
            image.alt,
            state.drawingId
          )
        );
      } else {
        state.missingImages += 1;
        blocks.push(styledParagraph(imagePlaceholder(image.alt), "Caption"));
      }
      index += 1;
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.+?)\s*#*$/u.exec(trimmed);
    if (headingMatch) {
      const level = headingMatch[1]!.length;
      const headingText = headingMatch[2]!;
      const style: "Heading2" | "Heading3" =
        sectionHeadingStyle === "Heading2"
          ? "Heading3"
          : level <= 3
            ? "Heading2"
            : "Heading3";
      blocks.push(styledParagraph(headingText, style));
      index += 1;
      continue;
    }

    blocks.push(styledParagraph(trimmed, "Normal"));
    index += 1;
  }

  return blocks;
}

export function buildAcademicDocxWithReport(
  input: ExportAcademicManuscriptInput,
  assets: ManuscriptImageAssets = new Map()
): { buffer: Buffer; missingImages: number } {
  const validated = ExportAcademicManuscriptInputSchema.parse({
    ...input,
    format: "docx"
  });
  const images = new Map<string, ImageSlot>(
    [...assets].map(([path, asset], index) => [
      path,
      {
        asset,
        filename: `image${index + 1}.${asset.ext}`,
        relationshipId: `rIdImage${index + 1}`
      }
    ])
  );

  const state = { drawingId: 0, missingImages: 0 };
  const bodyBlocks: string[] = [styledParagraph(validated.title, "Title")];
  let lastChapterKey: string | undefined;

  for (const item of validated.items) {
    const hasChapterHeading = Boolean(
      validated.includeChapterHeadings && item.chapterTitle
    );
    if (hasChapterHeading) {
      const chapterKey = item.chapterId ?? `title:${item.chapterTitle}`;
      if (chapterKey !== lastChapterKey) {
        bodyBlocks.push(styledParagraph(item.chapterTitle!, "Heading1"));
        lastChapterKey = chapterKey;
      }
      bodyBlocks.push(styledParagraph(item.sectionTitle, "Heading2"));
      bodyBlocks.push(
        ...renderSectionContentBlocks(item.content, "Heading2", images, state)
      );
    } else {
      lastChapterKey = undefined;
      bodyBlocks.push(styledParagraph(item.sectionTitle, "Heading1"));
      bodyBlocks.push(
        ...renderSectionContentBlocks(item.content, "Heading1", images, state)
      );
    }
  }

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${bodyBlocks.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr></w:body></w:document>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="宋体"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="120" w:line="312" w:lineRule="auto"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/><w:spacing w:before="240" w:after="360"/></w:pPr><w:rPr><w:rFonts w:eastAsia="黑体"/><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="320" w:after="160"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:rFonts w:eastAsia="黑体"/><w:b/><w:sz w:val="30"/><w:szCs w:val="30"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:rFonts w:eastAsia="黑体"/><w:b/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="180" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:rFonts w:eastAsia="黑体"/><w:b/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="CodeBlock"><w:name w:val="Code Block"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F5F5F5"/><w:spacing w:before="100" w:after="120" w:line="260" w:lineRule="auto"/><w:ind w:left="160" w:right="160"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="等线"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/><w:spacing w:before="60" w:after="160"/></w:pPr><w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style>
</w:styles>`;

  const timestamp = new Date().toISOString();
  const buffer = createStoredZip([
    {
      name: "[Content_Types].xml",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${[...new Set([...images.values()].map(({ asset }) => asset.ext))].map((ext) => `<Default Extension="${ext}" ContentType="image/${ext === "jpg" ? "jpeg" : "png"}"/>`).join("")}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
        "utf8"
      )
    },
    {
      name: "_rels/.rels",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
        "utf8"
      )
    },
    { name: "word/document.xml", data: Buffer.from(documentXml, "utf8") },
    {
      name: "word/_rels/document.xml.rels",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${[...images.values()].map(({ filename, relationshipId }) => `<Relationship Id="${relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${filename}"/>`).join("")}</Relationships>`,
        "utf8"
      )
    },
    { name: "word/styles.xml", data: Buffer.from(stylesXml, "utf8") },
    ...[...images.values()].map(({ asset, filename }) => ({
      name: `word/media/${filename}`,
      data: asset.bytes
    })),
    {
      name: "docProps/core.xml",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEscape(validated.title)}</dc:title><dc:creator>DeepWrite</dc:creator><cp:lastModifiedBy>DeepWrite</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:modified></cp:coreProperties>`,
        "utf8"
      )
    },
    {
      name: "docProps/app.xml",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>DeepWrite</Application><AppVersion>1.0</AppVersion></Properties>`,
        "utf8"
      )
    }
  ]);

  return { buffer, missingImages: state.missingImages };
}

export function buildAcademicDocx(
  input: ExportAcademicManuscriptInput,
  assets: ManuscriptImageAssets = new Map()
): Buffer {
  return buildAcademicDocxWithReport(input, assets).buffer;
}
