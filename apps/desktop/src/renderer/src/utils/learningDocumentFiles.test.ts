import { describe, expect, it } from "vitest";
import {
  LEARNING_DOCUMENT_ACCEPT,
  readLearningDocumentFile
} from "./learningDocumentFiles";

function storedZipEntry(name: string, content: string): Uint8Array {
  const encoder = new TextEncoder();
  const nameBytes = encoder.encode(name);
  const contentBytes = encoder.encode(content);
  const local = new Uint8Array(30 + nameBytes.length + contentBytes.length);
  const localView = new DataView(local.buffer);
  localView.setUint32(0, 0x04034b50, true);
  localView.setUint16(4, 20, true);
  localView.setUint16(8, 0, true);
  localView.setUint32(18, contentBytes.length, true);
  localView.setUint32(22, contentBytes.length, true);
  localView.setUint16(26, nameBytes.length, true);
  local.set(nameBytes, 30);
  local.set(contentBytes, 30 + nameBytes.length);

  const central = new Uint8Array(46 + nameBytes.length);
  const centralView = new DataView(central.buffer);
  centralView.setUint32(0, 0x02014b50, true);
  centralView.setUint16(4, 20, true);
  centralView.setUint16(6, 20, true);
  centralView.setUint16(10, 0, true);
  centralView.setUint32(20, contentBytes.length, true);
  centralView.setUint32(24, contentBytes.length, true);
  centralView.setUint16(28, nameBytes.length, true);
  centralView.setUint32(42, 0, true);
  central.set(nameBytes, 46);

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, 1, true);
  endView.setUint16(10, 1, true);
  endView.setUint32(12, central.length, true);
  endView.setUint32(16, local.length, true);

  const zip = new Uint8Array(local.length + central.length + end.length);
  zip.set(local, 0);
  zip.set(central, local.length);
  zip.set(end, local.length + central.length);
  return zip;
}

function utf16Le(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length * 2);
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    bytes[index * 2] = code & 0xff;
    bytes[index * 2 + 1] = code >> 8;
  }
  return bytes;
}

describe("learning document files", () => {
  it("keeps novel-sized plain text beyond the ordinary chat preview limit", async () => {
    const content = `第一章\n${"雨".repeat(120_000)}`;
    const result = await readLearningDocumentFile(
      new File([content], "长篇.md", { type: "text/markdown" })
    );

    expect(result.document.text).toBe(content);
    expect(result.document.truncated).toBeUndefined();
    expect(result.document.charCount).toBeGreaterThan(100_000);
  });

  it("extracts paragraphs, tabs, line breaks, and entities from docx", async () => {
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<w:document xmlns:w="urn:test"><w:body>',
      "<w:p><w:r><w:t>雾港 &amp; 回声</w:t></w:r></w:p>",
      "<w:p><w:r><w:t>第一行</w:t><w:br/><w:t>第二行</w:t><w:tab/><w:t>尾声</w:t></w:r></w:p>",
      "</w:body></w:document>"
    ].join("");
    const file = new File(
      [storedZipEntry("word/document.xml", xml).buffer as ArrayBuffer],
      "雾港.docx",
      {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      }
    );

    const result = await readLearningDocumentFile(file);

    expect(result.document.text).toContain("雾港 & 回声\n第一行\n第二行\t尾声");
    expect(result.document.mediaType).toContain("wordprocessingml");
  });

  it("recovers readable UTF-16 text from legacy doc files", async () => {
    const result = await readLearningDocumentFile(
      new File([utf16Le("第一章\n雨夜归来，旧案重启。").buffer as ArrayBuffer], "旧稿.doc", {
        type: "application/msword"
      })
    );

    expect(result.document.text).toContain("雨夜归来，旧案重启");
  });

  it("advertises Word support and rejects unrelated binary formats", async () => {
    expect(LEARNING_DOCUMENT_ACCEPT).toContain(".docx");
    await expect(
      readLearningDocumentFile(
        new File(["{}"], "data.json", { type: "application/json" })
      )
    ).rejects.toThrow("Word（.doc/.docx）");
  });
});
