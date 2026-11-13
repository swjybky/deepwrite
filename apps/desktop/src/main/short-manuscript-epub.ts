import { randomUUID } from "node:crypto";
import {
  ExportShortManuscriptInputSchema,
  type ExportShortManuscriptInput
} from "@deepwrite/contracts";
import { createStoredZip, type ZipEntry } from "./zip-writer";
import {
  normalizeText,
  xmlEscape,
  parseBookImageLine,
  type ManuscriptImageAssets
} from "./manuscript-export-images";

function xhtmlParagraphs(
  content: string,
  images: ReadonlyMap<string, string>
): string {
  const blocks: string[] = [];
  let paragraph: string[] = [];
  const flush = (): void => {
    if (paragraph.length)
      blocks.push(`<p>${paragraph.map(xmlEscape).join("<br />")}</p>`);
    paragraph = [];
  };
  for (const line of normalizeText(content).trim().split("\n")) {
    const image = parseBookImageLine(line);
    if (image) {
      flush();
      const path = images.get(image.path);
      if (path)
        blocks.push(
          `<figure><img src="${path}" alt="${xmlEscape(image.alt)}"/>${image.alt ? `<figcaption>${xmlEscape(image.alt)}</figcaption>` : ""}</figure>`
        );
    } else if (line === "") flush();
    else paragraph.push(line);
  }
  flush();
  return blocks.join("\n");
}

function epubXhtml(title: string, body: string): Buffer {
  return Buffer.from(
    `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh-CN" lang="zh-CN"><head><meta charset="utf-8"/><title>${xmlEscape(title)}</title><link rel="stylesheet" type="text/css" href="styles.css"/></head><body>${body}</body></html>`,
    "utf8"
  );
}

export function buildEpub(
  input: ExportShortManuscriptInput,
  assets: ManuscriptImageAssets = new Map()
): Buffer {
  const validated = ExportShortManuscriptInputSchema.parse({
    ...input,
    format: "epub"
  });
  const images = new Map(
    [...assets].map(([path, asset], index) => [
      path,
      `images/${index + 1}.${asset.ext}`
    ])
  );
  const imageManifest = [...assets]
    .map(
      ([path, asset], index) =>
        `<item id="image-${index + 1}" href="${images.get(path)}" media-type="${asset.mimeType}"/>`
    )
    .join("");
  const identifier = `urn:uuid:${randomUUID()}`;
  const sectionItems = validated.sections.map((section, index) => ({
    section,
    id: `section-${index + 1}`,
    fileName: `section-${String(index + 1).padStart(3, "0")}.xhtml`
  }));
  const modified = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const manifest = sectionItems
    .map(
      ({ id, fileName }) =>
        `<item id="${id}" href="${fileName}" media-type="application/xhtml+xml"/>`
    )
    .join("");
  const spine = sectionItems
    .map(({ id }) => `<itemref idref="${id}"/>`)
    .join("");
  const navigation = sectionItems
    .map(
      ({ section, fileName }) =>
        `<li><a href="${fileName}">${xmlEscape(section.title)}</a></li>`
    )
    .join("");

  const entries: ZipEntry[] = [
    { name: "mimetype", data: Buffer.from("application/epub+zip", "ascii") },
    {
      name: "META-INF/container.xml",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
        "utf8"
      )
    },
    {
      name: "OEBPS/content.opf",
      data: Buffer.from(
        `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="zh-CN"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">${identifier}</dc:identifier><dc:title>${xmlEscape(validated.title)}</dc:title><dc:language>zh-CN</dc:language><dc:creator>DeepWrite</dc:creator><meta property="dcterms:modified">${modified}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="styles.css" media-type="text/css"/><item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>${manifest}${imageManifest}</manifest><spine><itemref idref="title"/>${spine}</spine></package>`,
        "utf8"
      )
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
      data: Buffer.from(
        "body{font-family:serif;line-height:1.8;margin:5%;}h1{text-align:center;}h2{margin-top:1.5em;}p{text-indent:2em;margin:.7em 0;}nav ol{line-height:2;}nav a{text-decoration:none;}figure{margin:1em 0;text-align:center;text-indent:0}img{max-width:100%;height:auto}figcaption{font-size:.9em}",
        "utf8"
      )
    },
    {
      name: "OEBPS/title.xhtml",
      data: epubXhtml(
        validated.title,
        `<section class="title-page"><h1>${xmlEscape(validated.title)}</h1></section>`
      )
    },
    ...sectionItems.map(({ section, fileName }) => ({
      name: `OEBPS/${fileName}`,
      data: epubXhtml(
        section.title,
        `<section><h2>${xmlEscape(section.title)}</h2>${xhtmlParagraphs(section.content, images)}</section>`
      )
    }))
  ];
  entries.push(
    ...[...assets].map(([path, asset]) => ({
      name: `OEBPS/${images.get(path)}`,
      data: asset.bytes
    }))
  );
  return createStoredZip(entries);
}
