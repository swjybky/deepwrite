import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readExternalLibraryEntries } from "./external-library-import";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true }))
  );
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-external-library-"));
  roots.push(root);
  return root;
}

function skill(name?: string): string {
  return `---\n${name ? `name: ${name}\n` : ""}description: 示例\n---\n\n执行步骤。\n`;
}

function storedDocx(documentXml: string): Uint8Array {
  const encoder = new TextEncoder();
  const nameBytes = encoder.encode("word/document.xml");
  const contentBytes = encoder.encode(documentXml);
  const local = new Uint8Array(30 + nameBytes.length + contentBytes.length);
  const localView = new DataView(local.buffer);
  localView.setUint32(0, 0x04034b50, true);
  localView.setUint16(8, 0, true);
  localView.setUint32(18, contentBytes.length, true);
  localView.setUint32(22, contentBytes.length, true);
  localView.setUint16(26, nameBytes.length, true);
  local.set(nameBytes, 30);
  local.set(contentBytes, 30 + nameBytes.length);
  const central = new Uint8Array(46 + nameBytes.length);
  const centralView = new DataView(central.buffer);
  centralView.setUint32(0, 0x02014b50, true);
  centralView.setUint16(10, 0, true);
  centralView.setUint32(20, contentBytes.length, true);
  centralView.setUint32(24, contentBytes.length, true);
  centralView.setUint16(28, nameBytes.length, true);
  central.set(nameBytes, 46);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, 1, true);
  endView.setUint16(10, 1, true);
  endView.setUint32(12, central.length, true);
  endView.setUint32(16, local.length, true);
  const result = new Uint8Array(local.length + central.length + end.length);
  result.set(local);
  result.set(central, local.length);
  result.set(end, local.length + central.length);
  return result;
}

function utf16Le(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length * 2);
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    bytes[index * 2] = code & 0xff;
    bytes[index * 2 + 1] = code >> 8;
  }
  return bytes;
}

describe("readExternalLibraryEntries", () => {
  it("uses SKILL.md name and preserves its complete source", async () => {
    const root = await temporaryRoot();
    const path = join(root, "SKILL.md");
    const content = skill("单项技能");
    await writeFile(path, content, "utf8");

    const result = await readExternalLibraryEntries("file", [path]);

    expect(result.candidates).toEqual([
      {
        id: "external-library-entry-1",
        title: "单项技能",
        sourceName: "SKILL.md",
        content
      }
    ]);
    expect(result.scanned).toBe(1);
  });

  it("recursively scans supported files and excludes generated directories", async () => {
    const root = await temporaryRoot();
    await mkdir(join(root, "nested", "child"), { recursive: true });
    await mkdir(join(root, "node_modules", "ignored"), { recursive: true });
    await writeFile(join(root, "人物设定.txt"), "人物正文", "utf8");
    await writeFile(
      join(root, "nested", "child", "桥段.md"),
      "桥段正文",
      "utf8"
    );
    await writeFile(
      join(root, "node_modules", "ignored", "README.md"),
      "忽略",
      "utf8"
    );

    const result = await readExternalLibraryEntries("directory", [root]);

    expect(result.candidates.map(({ title }) => title).sort()).toEqual([
      "人物设定",
      "桥段"
    ]);
    expect(result.scanned).toBe(2);
  });

  it("falls back to the parent directory for SKILL.md without name", async () => {
    const root = await temporaryRoot();
    const directory = join(root, "回退技能名");
    await mkdir(directory);
    const path = join(directory, "SKILL.md");
    await writeFile(path, skill(), "utf8");

    const result = await readExternalLibraryEntries("file", [path]);

    expect(result.candidates[0]?.title).toBe("回退技能名");
  });

  it("reports empty and unsupported selected files", async () => {
    const root = await temporaryRoot();
    const emptyPath = join(root, "empty.txt");
    const unsupportedPath = join(root, "data.json");
    await writeFile(emptyPath, "", "utf8");
    await writeFile(unsupportedPath, "{}", "utf8");

    const result = await readExternalLibraryEntries("file", [
      emptyPath,
      unsupportedPath
    ]);

    expect(result.candidates).toEqual([]);
    expect(result.skipped.empty).toBe(1);
    expect(result.skipped.unsupported).toBe(1);
  });

  it("extracts readable text from DOCX and legacy DOC files", async () => {
    const root = await temporaryRoot();
    const docxPath = join(root, "现代文档.docx");
    const docPath = join(root, "旧版文档.doc");
    await writeFile(
      docxPath,
      storedDocx(
        "<w:document><w:body><w:p><w:r><w:t>雾港 &amp; 回声</w:t></w:r></w:p></w:body></w:document>"
      )
    );
    await writeFile(docPath, utf16Le("第一章\n雨夜归来，旧案重启。"));

    const result = await readExternalLibraryEntries("file", [
      docxPath,
      docPath
    ]);

    expect(
      result.candidates.find(({ title }) => title === "现代文档")?.content
    ).toContain("雾港 & 回声");
    expect(
      result.candidates.find(({ title }) => title === "旧版文档")?.content
    ).toContain("雨夜归来，旧案重启");
  });
});
