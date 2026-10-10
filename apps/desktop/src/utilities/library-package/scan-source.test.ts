import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TextEncoder } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { decodeLibraryText, scanLibraryPackageSource } from "./scan-source";

const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-package-scan-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

/** A stored ZIP whose names are raw bytes without the UTF-8 flag. */
function legacyZip(entries: readonly { name: Buffer; data: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

// "人设/阿明.txt" and "你好" in GBK, as Chinese Windows writes them.
const GBK_NAME = Buffer.from([
  0xc8, 0xcb, 0xc9, 0xe8, 0x2f, 0xb0, 0xa2, 0xc3, 0xf7, 0x2e, 0x74, 0x78, 0x74
]);
const GBK_TEXT = Buffer.from([0xc4, 0xe3, 0xba, 0xc3]);

describe("decodeLibraryText", () => {
  it("reads UTF-8, UTF-16 and GB18030, normalising line endings", () => {
    expect(decodeLibraryText(Buffer.from("\uFEFF甲\r\n乙", "utf8"))).toBe(
      "甲\n乙"
    );
    expect(
      decodeLibraryText(
        Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("丙", "utf16le")])
      )
    ).toBe("丙");
    expect(decodeLibraryText(GBK_TEXT)).toBe("你好");
    expect(decodeLibraryText(new TextEncoder().encode("a\u0000b"))).toBeNull();
  });
});

describe("scanLibraryPackageSource", () => {
  it("decodes GBK names from ZIPs without the UTF-8 flag", async () => {
    const root = await temporaryRoot();
    const path = join(root, "资料.zip");
    await writeFile(
      path,
      legacyZip([
        { name: GBK_NAME, data: GBK_TEXT },
        { name: Buffer.from("__MACOSX/._x.txt"), data: Buffer.from("x") }
      ])
    );
    const scanned = await scanLibraryPackageSource(path, "zip");
    expect(scanned.tree).toEqual({
      rootName: "资料",
      files: [{ path: "人设/阿明.txt", text: "你好" }]
    });
  });

  it("skips hidden files and symlinks and fingerprints content", async () => {
    const root = await temporaryRoot();
    const source = join(root, "资料");
    await mkdir(join(source, "人设"), { recursive: true });
    await writeFile(join(source, "人设", "阿明.md"), "主角");
    await writeFile(join(source, "封面.png"), "png");
    await writeFile(join(source, ".DS_Store"), "x");
    await symlink(join(source, "人设", "阿明.md"), join(source, "链接.md"));
    const first = await scanLibraryPackageSource(source, "directory");
    expect(first.tree.files).toEqual([
      { path: "人设/阿明.md", text: "主角" },
      { path: "封面.png", skip: "unsupported" }
    ]);
    await writeFile(join(source, "人设", "阿明.md"), "改过");
    const second = await scanLibraryPackageSource(source, "directory");
    expect(second.fingerprint).not.toBe(first.fingerprint);
  });
});
