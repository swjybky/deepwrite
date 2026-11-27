import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync, crc32 as zlibCrc32 } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import {
  BUILTIN_MATERIAL_BASIC_LONG_NAMING_ID,
  BUILTIN_SKILL_BASIC_LONG_TEAM_OPS_ID,
  BookIdentityRecordSchema,
  LOCAL_BACKUP_FILE_EXTENSION,
  createEnvelope,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import { toJsonFileText } from "@deepwrite/shared";
import { sha256Hex } from "@deepwrite/shared/node";
import { FolderCatalogStore } from "../folder-catalog-store";
import { LongWorkspaceService } from "../long-workspace-service";
import { MysteryWorkspaceService } from "../mystery-store";
import { exportLocalBackupAtPath, withLocalBackupCommands } from "./commands";
import { LocalBackupError } from "./errors";
import {
  LocalBackupSimulatedCrashError,
  commitStagedBackupImport,
  recoverInterruptedLocalBackupImport,
  type LocalBackupImportJournal
} from "./import-transaction";
import { getLocalBackupInventory, readAllRegistries } from "./inventory";
import { sanitizeBackupFolderName } from "./paths";
import {
  previewLocalBackupArchive,
  readAndValidateBackupArchive,
  stageLocalBackupImport
} from "./remap-and-validate";
import {
  openVerifiedBackupZipArchive,
  writeBackupZipArchive
} from "./zip-archive";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

async function makeWorkspaceEnv(prefix: string): Promise<{
  root: string;
  userDataPath: string;
  workspaceDir: string;
  catalog: FolderCatalogStore;
  long: LongWorkspaceService;
  mystery: MysteryWorkspaceService;
}> {
  const root = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  tempDirs.push(root);
  const userDataPath = join(root, "user-data");
  const workspaceDir = join(root, "workspace");
  await mkdir(userDataPath, { recursive: true });
  await mkdir(workspaceDir, { recursive: true });
  const catalog = new FolderCatalogStore({ userDataPath });
  const long = new LongWorkspaceService({ userDataPath });
  const mystery = new MysteryWorkspaceService({ userDataPath });
  return { root, userDataPath, workspaceDir, catalog, long, mystery };
}

function buildMinimalZip(
  entries: ReadonlyArray<{
    name: string;
    data: Buffer;
    crcOverride?: number;
    rawHeaderSizeOverride?: number;
  }>
): Buffer {
  const localChunks: Buffer[] = [];
  const cdChunks: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, "utf8");
    const compressed = deflateRawSync(entry.data);
    const crc = (entry.crcOverride ?? zlibCrc32(entry.data)) >>> 0;
    const declaredUncompressed =
      entry.rawHeaderSizeOverride ?? entry.data.length;

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(compressed.length, 18);
    lh.writeUInt32LE(declaredUncompressed, 22);
    lh.writeUInt16LE(nameBytes.length, 26);
    localChunks.push(lh, nameBytes, compressed);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(compressed.length, 20);
    cd.writeUInt32LE(declaredUncompressed, 24);
    cd.writeUInt16LE(nameBytes.length, 28);
    cd.writeUInt32LE(offset, 42);
    cdChunks.push(cd, nameBytes);

    offset += lh.length + nameBytes.length + compressed.length;
  }

  const cdBuffer = Buffer.concat(cdChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...localChunks, cdBuffer, eocd]);
}

describe("LocalBackup Core 引擎与事务验收", () => {
  it("跨电脑迁移五类作品、库、分组、空库与图片，且严格隔离敏感文件与绝对路径", async () => {
    const src = await makeWorkspaceEnv("dw-backup-src-");
    const dst = await makeWorkspaceEnv("dw-backup-dst-");

    // 1. 素材库（含空库）、技能库（自建+内置）、分组
    const matLib = await src.catalog.createLibrary({
      domain: "material",
      name: "侦探线索素材库",
      materialKind: "plot",
      parentDirectory: join(src.workspaceDir, "materials")
    });
    await src.catalog.createLibraryEntry({
      domain: "material",
      libraryId: matLib.resource.id,
      stageId: "intro",
      title: "关键物证",
      content: "铜钥匙刻字线索"
    });
    const emptyMatLib = await src.catalog.createLibrary({
      domain: "material",
      name: "预设空素材库",
      materialKind: "character",
      parentDirectory: join(src.workspaceDir, "materials")
    });
    const matGroup = await src.catalog.createLibraryGroup({
      domain: "material",
      name: "悬疑素材组",
      memberIds: [matLib.resource.id, emptyMatLib.resource.id],
      parentDirectory: join(src.workspaceDir, "material-groups")
    });

    const customSkill = await src.catalog.createLibrary({
      domain: "skill",
      name: "节奏推进技法库",
      skillKind: "plot",
      parentDirectory: join(src.workspaceDir, "skills")
    });
    await src.catalog.createLibraryEntry({
      domain: "skill",
      libraryId: customSkill.resource.id,
      stageId: "outline",
      title: "三幕反转",
      content: "在中点引入伪证"
    });
    const builtinSkill = await src.catalog.createLibrary({
      domain: "skill",
      name: "系统内置技能库",
      skillKind: "general",
      parentDirectory: join(src.workspaceDir, "skills")
    });
    // Mark as built-in on disk to match builtin skill library manifest
    const builtinManifest = JSON.parse(
      await readFile(
        join(builtinSkill.projectDirectory, "deepwrite.json"),
        "utf8"
      )
    ) as Record<string, unknown>;
    await writeFile(
      join(builtinSkill.projectDirectory, "deepwrite.json"),
      toJsonFileText({ ...builtinManifest, isBuiltin: true })
    );

    const skillGroup = await src.catalog.createLibraryGroup({
      domain: "skill",
      name: "自建技能组",
      memberIds: [customSkill.resource.id],
      parentDirectory: join(src.workspaceDir, "skill-groups")
    });

    // 五类作品：short / script / academic / long / mystery
    const shortBook = await src.catalog.createShortBook(
      { title: "短篇测试集", genre: "悬疑" },
      join(src.workspaceDir, "books")
    );
    await src.catalog.updateBook({
      bookId: shortBook.resource.id,
      linkedMaterialIdsByKind: {
        character: [],
        gimmick: [],
        plot: [matLib.resource.id],
        draft: [],
        other: []
      },
      linkedSkillIdsByKind: {
        general: [],
        plot: [customSkill.resource.id],
        style: [],
        other: []
      }
    });

    const scriptBook = await src.catalog.createScriptBook(
      { title: "剧本测试集", genre: "科幻" },
      join(src.workspaceDir, "books")
    );
    const academicBook = await src.catalog.createAcademicBook(
      { title: "学术论文集", subtype: "empirical_paper" },
      join(src.workspaceDir, "books")
    );
    await src.catalog.updateBook({
      bookId: academicBook.resource.id,
      linkedMaterialIds: [matLib.resource.id],
      linkedSkillIds: [customSkill.resource.id]
    });

    const longCreated = await src.long.create(join(src.workspaceDir, "books"), {
      title: "长篇巨著",
      genre: "悬疑"
    });
    const longOpened = await src.long.open({ bookId: longCreated.book.id });
    const firstChapter = longOpened.book.workspaceIndex.chapters[0]!;
    await src.long.writeChapter({
      bookId: longCreated.book.id,
      chapterCardId: firstChapter.chapterCardId,
      body: { content: "第一章夜雨敲窗，灯影摇曳。".repeat(40) },
      characterState: { content: "主角出场状态正常" },
      handoff: { content: "待查明地下室暗门" }
    });
    await src.long.commitChapter({
      mode: "text_files",
      bookId: longCreated.book.id,
      chapterCardId: firstChapter.chapterCardId,
      foreshadowingBeatDecisions: {},
      commitMessage: "提交第一章"
    });
    await src.long.updateBindings({
      bookId: longCreated.book.id,
      linkedMaterialIdsByKind: {
        character: [],
        gimmick: [],
        plot: [matLib.resource.id],
        draft: [],
        other: []
      },
      linkedSkillIdsByKind: {
        general: [],
        plot: [customSkill.resource.id],
        style: [],
        other: []
      }
    });

    const mysteryCreated = await src.mystery.createAtPath(
      join(src.workspaceDir, "mystery-books"),
      {
        title: "迷雾庄园剧本杀",
        genre: "硬核推理",
        linkedMaterialIds: [matLib.resource.id],
        linkedSkillIds: [customSkill.resource.id]
      }
    );

    // 添加图片与 book-identity，并放置敏感/临时/符号链接/嵌套目录
    const shortDir = shortBook.projectDirectory;
    const pngBytes = Buffer.from(
      "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
      "hex"
    );
    await mkdir(join(shortDir, "images"), { recursive: true });
    await writeFile(join(shortDir, "images", "scene.png"), pngBytes);

    await mkdir(join(shortDir, "book-identity"), { recursive: true });
    await writeFile(
      join(shortDir, "book-identity", "identity.json"),
      toJsonFileText(
        BookIdentityRecordSchema.parse({
          schemaVersion: 1,
          kind: "deepwrite.book-identity",
          bookId: shortBook.resource.id,
          revision: 1,
          updatedAt: new Date().toISOString(),
          adopted: {},
          rounds: []
        })
      )
    );

    await mkdir(join(shortDir, ".deepwrite", "versions"), { recursive: true });
    await writeFile(join(shortDir, ".deepwrite", "versions", "v1.json"), "{}");
    await writeFile(join(shortDir, ".DS_Store"), "junk");
    await writeFile(join(shortDir, ".draft-recovery.json"), "{}");
    await writeFile(
      join(src.userDataPath, "conversations.sqlite"),
      "secret-db"
    );
    await writeFile(
      join(src.userDataPath, "models.json"),
      '{"apiKey":"sk-secret"}'
    );
    await symlink(
      join(src.userDataPath, "models.json"),
      join(shortDir, "leak-link")
    ).catch(() => undefined);

    // 2. 盘点清单不应出现内置技能库
    const inventory = await getLocalBackupInventory(src.userDataPath);
    expect(inventory.counts).toEqual({ works: 5, materials: 2, skills: 1 });
    expect(
      inventory.items.some((item) => item.id === builtinSkill.resource.id)
    ).toBe(false);
    expect(
      inventory.items.some(
        (item) => item.id === emptyMatLib.resource.id && item.empty
      )
    ).toBe(true);

    // 3. 导出为单一 .dwbackup.zip 并检查档案纯洁性
    const archivePath = join(
      src.root,
      `DeepWrite-test${LOCAL_BACKUP_FILE_EXTENSION}`
    );
    const selectedKeys = inventory.items.map((item) => item.key);
    const exported = await exportLocalBackupAtPath({
      userDataPath: src.userDataPath,
      targetPath: archivePath,
      selectedKeys,
      appVersion: "1.9.0",
      platform: "darwin"
    });
    expect(exported.itemCount).toBe(inventory.items.length);

    const zip = await openVerifiedBackupZipArchive(archivePath);
    const entryList = [...zip.entryNames];
    await zip.close();
    expect(entryList.some((name) => name.includes(".DS_Store"))).toBe(false);
    expect(entryList.some((name) => name.includes(".deepwrite"))).toBe(false);
    expect(entryList.some((name) => name.includes("leak-link"))).toBe(false);
    expect(
      entryList.some((name) => name.includes("conversations.sqlite"))
    ).toBe(false);
    expect(entryList.some((name) => name.includes("models.json"))).toBe(false);
    expect(entryList.some((name) => name.includes("/images/"))).toBe(true);
    expect(
      entryList.some((name) => name.includes("book-identity/identity.json"))
    ).toBe(true);

    const bundle = await readAndValidateBackupArchive(archivePath);
    expect(JSON.stringify(bundle.manifest).includes(src.workspaceDir)).toBe(
      false
    );
    expect(JSON.stringify(bundle.manifest).includes(src.userDataPath)).toBe(
      false
    );

    // 4. 在空白目标机器上预览并导入
    const preview = await previewLocalBackupArchive({
      archivePath,
      userDataPath: dst.userDataPath,
      workspaceDirectory: dst.workspaceDir
    });
    expect(preview.preview.diskSpaceSufficient).toBe(true);
    expect(preview.preview.items.every((item) => item.status === "new")).toBe(
      true
    );

    const staged = await stageLocalBackupImport({
      archivePath,
      userDataPath: dst.userDataPath,
      workspaceDirectory: dst.workspaceDir,
      selectedKeys,
      conflictPolicy: "keep_both",
      expectedLocalHashes: preview.localHashes
    });
    await commitStagedBackupImport({
      userDataPath: dst.userDataPath,
      workspaceDirectory: dst.workspaceDir,
      batchId: staged.batchId,
      stagingRoot: staged.stagingRoot,
      backupPrevRoot: staged.backupPrevRoot,
      operations: staged.operations,
      nextRegistries: staged.nextRegistries
    });
    expect(staged.summary.added).toBe(inventory.items.length);
    expect(staged.summary.danglingBindingsRemoved).toBe(0);

    // 用真实 Store 打开五类作品和分组
    const dstCatalogSnap = await dst.catalog.snapshot();
    expect(dstCatalogSnap.books.map((b) => b.id)).toEqual(
      expect.arrayContaining([
        shortBook.resource.id,
        scriptBook.resource.id,
        academicBook.resource.id
      ])
    );
    expect(
      dstCatalogSnap.materials.some((m) => m.id === emptyMatLib.resource.id)
    ).toBe(true);
    expect(
      dstCatalogSnap.materialGroups.some((g) => g.id === matGroup.resource.id)
    ).toBe(true);
    expect(
      dstCatalogSnap.skillGroups.some((g) => g.id === skillGroup.resource.id)
    ).toBe(true);

    const dstLongList = await dst.long.list();
    expect(dstLongList.books.map((b) => b.id)).toContain(longCreated.book.id);
    const dstLongBook = await dst.long.open({ bookId: longCreated.book.id });
    expect(dstLongBook.book.linkedMaterialIdsByKind.plot).toEqual([
      matLib.resource.id
    ]);

    const dstMysteryList = await dst.mystery.list();
    expect(dstMysteryList.books.map((b) => b.id)).toContain(
      mysteryCreated.book.id
    );

    const dstShortDir = (
      await readAllRegistries(dst.userDataPath)
    ).catalog.projects.find(
      (p) => p.id === shortBook.resource.id
    )!.projectDirectory;
    expect(await readdir(join(dstShortDir, "images"))).toHaveLength(1);
    const identityJson = BookIdentityRecordSchema.parse(
      JSON.parse(
        await readFile(join(dstShortDir, "book-identity/identity.json"), "utf8")
      )
    );
    expect(identityJson.bookId).toBe(shortBook.resource.id);
    expect(identityJson.revision).toBe(1);

    // 5. 重复导入幂等：全部显示 identical
    const secondPreview = await previewLocalBackupArchive({
      archivePath,
      userDataPath: dst.userDataPath,
      workspaceDirectory: dst.workspaceDir
    });
    expect(
      secondPreview.preview.items.every((item) => item.status === "identical")
    ).toBe(true);
  });

  it("剥离悬空库引用后重导保持幂等，未归类条目自动合并而非新建冗余收纳区", async () => {
    const src = await makeWorkspaceEnv("dw-dangling-src-");
    const dst = await makeWorkspaceEnv("dw-dangling-dst-");

    const excludedMat = await src.catalog.createLibrary({
      domain: "material",
      name: "不被导出的素材库",
      materialKind: "plot",
      parentDirectory: join(src.workspaceDir, "materials")
    });
    const includedMat = await src.catalog.createLibrary({
      domain: "material",
      name: "一起导出的素材库",
      materialKind: "plot",
      parentDirectory: join(src.workspaceDir, "materials")
    });
    const book = await src.catalog.createShortBook(
      { title: "局部关联短篇", genre: "悬疑" },
      join(src.workspaceDir, "books")
    );
    await src.catalog.updateBook({
      bookId: book.resource.id,
      linkedMaterialIdsByKind: {
        character: [],
        gimmick: [],
        plot: [includedMat.resource.id, excludedMat.resource.id],
        draft: [],
        other: []
      }
    });

    await src.catalog.createUnboundEntry({
      domain: "material",
      title: "源端游离灵感",
      content: "旧电脑上的零碎灵感",
      stageId: "intro"
    });
    await dst.catalog.createUnboundEntry({
      domain: "material",
      title: "目标已有游离灵感",
      content: "新电脑上原有的灵感",
      stageId: "intro"
    });

    const srcInv = await getLocalBackupInventory(src.userDataPath);
    const selectedKeys = srcInv.items
      .filter((item) => item.id !== excludedMat.resource.id)
      .map((item) => item.key);

    const archivePath = join(src.root, "partial.dwbackup.zip");
    await exportLocalBackupAtPath({
      userDataPath: src.userDataPath,
      targetPath: archivePath,
      selectedKeys,
      appVersion: "1.9.0",
      platform: "win32"
    });

    const p1 = await previewLocalBackupArchive({
      archivePath,
      userDataPath: dst.userDataPath,
      workspaceDirectory: dst.workspaceDir
    });
    expect(p1.preview.items.every((item) => item.status === "new")).toBe(true);

    const staged = await stageLocalBackupImport({
      archivePath,
      userDataPath: dst.userDataPath,
      workspaceDirectory: dst.workspaceDir,
      selectedKeys,
      conflictPolicy: "keep_both",
      expectedLocalHashes: p1.localHashes
    });
    await commitStagedBackupImport({
      userDataPath: dst.userDataPath,
      workspaceDirectory: dst.workspaceDir,
      batchId: staged.batchId,
      stagingRoot: staged.stagingRoot,
      backupPrevRoot: staged.backupPrevRoot,
      operations: staged.operations,
      nextRegistries: staged.nextRegistries
    });
    expect(staged.summary.danglingBindingsRemoved).toBe(1);

    const dstSnap = await dst.catalog.snapshot();
    const importedBook = dstSnap.books.find((b) => b.id === book.resource.id)!;
    expect(importedBook.bookType).toBe("short");
    if (importedBook.bookType === "academic") throw new Error("unexpected");
    expect(importedBook.linkedMaterialIdsByKind.plot).toEqual([
      includedMat.resource.id
    ]);
    expect(dstSnap.libraryOrganization?.unboundLibraryIds).toHaveLength(1);
    const mergedUnbound = dstSnap.materials.find(
      (m) => m.id === dstSnap.libraryOrganization!.unboundLibraryIds[0]
    )!;
    expect(mergedUnbound.entries.map((e) => e.title)).toEqual(
      expect.arrayContaining(["目标已有游离灵感", "源端游离灵感"])
    );

    // 再次预览同一备份包：已剥离悬空引用的作品和已合并的未归类库均判为 identical
    const p2 = await previewLocalBackupArchive({
      archivePath,
      userDataPath: dst.userDataPath,
      workspaceDirectory: dst.workspaceDir
    });
    expect(p2.preview.items.every((item) => item.status === "identical")).toBe(
      true
    );
  });

  it("保留备份作品对内置基础长篇素材库和技能库的绑定而不误判为悬空引用", async () => {
    const src = await makeWorkspaceEnv("dw-builtin-backup-src-");
    const dst = await makeWorkspaceEnv("dw-builtin-backup-dst-");
    const srcCatalogWithBuiltins = new FolderCatalogStore({
      userDataPath: src.userDataPath,
      includeBuiltinLibraries: true
    });
    const book = await srcCatalogWithBuiltins.createShortBook(
      {
        title: "绑定内置库短篇",
        genre: "科幻",
        linkedMaterialIdsByKind: {
          character: [BUILTIN_MATERIAL_BASIC_LONG_NAMING_ID],
          gimmick: [],
          plot: [],
          draft: [],
          other: []
        },
        linkedSkillIdsByKind: {
          general: [BUILTIN_SKILL_BASIC_LONG_TEAM_OPS_ID],
          plot: [],
          style: [],
          other: []
        }
      },
      join(src.workspaceDir, "books")
    );

    const inv = await getLocalBackupInventory(src.userDataPath);
    const archivePath = join(src.root, "builtin-bindings.dwbackup.zip");
    await exportLocalBackupAtPath({
      userDataPath: src.userDataPath,
      targetPath: archivePath,
      selectedKeys: inv.items.map((item) => item.key),
      appVersion: "1.9.0",
      platform: "win32"
    });

    const preview = await previewLocalBackupArchive({
      archivePath,
      userDataPath: dst.userDataPath,
      workspaceDirectory: dst.workspaceDir
    });
    const staged = await stageLocalBackupImport({
      archivePath,
      userDataPath: dst.userDataPath,
      workspaceDirectory: dst.workspaceDir,
      selectedKeys: inv.items.map((item) => item.key),
      conflictPolicy: "keep_both",
      expectedLocalHashes: preview.localHashes
    });
    expect(staged.summary.danglingBindingsRemoved).toBe(0);

    await commitStagedBackupImport({
      userDataPath: dst.userDataPath,
      workspaceDirectory: dst.workspaceDir,
      batchId: staged.batchId,
      stagingRoot: staged.stagingRoot,
      backupPrevRoot: staged.backupPrevRoot,
      operations: staged.operations,
      nextRegistries: staged.nextRegistries
    });

    const dstCatalogWithBuiltins = new FolderCatalogStore({
      userDataPath: dst.userDataPath,
      includeBuiltinLibraries: true
    });
    const dstBook = (await dstCatalogWithBuiltins.snapshot()).books.find(
      (item) => item.id === book.resource.id
    )!;
    expect(dstBook.bookType).toBe("short");
    if (dstBook.bookType === "academic") throw new Error("unexpected");
    expect(dstBook.linkedMaterialIdsByKind.character).toEqual([
      BUILTIN_MATERIAL_BASIC_LONG_NAMING_ID
    ]);
    expect(dstBook.linkedSkillIdsByKind.general).toEqual([
      BUILTIN_SKILL_BASIC_LONG_TEAM_OPS_ID
    ]);
  });

  it("同 ID 冲突默认 keep_both 重映射关联并生成副本，显式 replace 覆盖并刷新缓存", async () => {
    const src = await makeWorkspaceEnv("dw-conflict-src-");
    const dst = await makeWorkspaceEnv("dw-conflict-dst-");

    const mat = await src.catalog.createLibrary({
      domain: "material",
      name: "设定库",
      materialKind: "plot",
      parentDirectory: join(src.workspaceDir, "materials")
    });
    await src.catalog.createLibraryEntry({
      domain: "material",
      libraryId: mat.resource.id,
      stageId: "intro",
      title: "旧条目",
      content: "旧设定内容"
    });
    const shortBook = await src.catalog.createShortBook(
      { title: "冲突短篇", genre: "世情" },
      join(src.workspaceDir, "books")
    );
    await src.catalog.updateBook({
      bookId: shortBook.resource.id,
      linkedMaterialIdsByKind: {
        character: [],
        gimmick: [],
        plot: [mat.resource.id],
        draft: [],
        other: []
      }
    });
    const longCreated = await src.long.create(join(src.workspaceDir, "books"), {
      title: "冲突长篇",
      genre: "悬疑"
    });
    const ch = (await src.long.open({ bookId: longCreated.book.id })).book
      .workspaceIndex.chapters[0]!;
    await src.long.writeChapter({
      bookId: longCreated.book.id,
      chapterCardId: ch.chapterCardId,
      body: { content: "第一版长篇正文。".repeat(20) },
      characterState: { content: "初始状态" },
      handoff: { content: "接续说明" }
    });
    await src.long.commitChapter({
      mode: "text_files",
      bookId: longCreated.book.id,
      chapterCardId: ch.chapterCardId,
      foreshadowingBeatDecisions: {},
      commitMessage: "第一版提交"
    });

    const inv = await getLocalBackupInventory(src.userDataPath);
    const keys = inv.items.map((item) => item.key);
    const archivePath = join(src.root, "conflict.dwbackup.zip");
    await exportLocalBackupAtPath({
      userDataPath: src.userDataPath,
      targetPath: archivePath,
      selectedKeys: keys,
      appVersion: "1.9.0",
      platform: "darwin"
    });

    const initialPreview = await previewLocalBackupArchive({
      archivePath,
      userDataPath: dst.userDataPath,
      workspaceDirectory: dst.workspaceDir
    });
    const firstStage = await stageLocalBackupImport({
      archivePath,
      userDataPath: dst.userDataPath,
      workspaceDirectory: dst.workspaceDir,
      selectedKeys: keys,
      conflictPolicy: "keep_both",
      expectedLocalHashes: initialPreview.localHashes
    });
    await commitStagedBackupImport({
      userDataPath: dst.userDataPath,
      workspaceDirectory: dst.workspaceDir,
      batchId: firstStage.batchId,
      stagingRoot: firstStage.stagingRoot,
      backupPrevRoot: firstStage.backupPrevRoot,
      operations: firstStage.operations,
      nextRegistries: firstStage.nextRegistries
    });

    await dst.catalog.createLibraryEntry({
      domain: "material",
      libraryId: mat.resource.id,
      stageId: "intro",
      title: "新电脑补充条目",
      content: "目标修改内容"
    });
    const dstShort = (await dst.catalog.snapshot()).books.find(
      (b) => b.id === shortBook.resource.id
    )!;
    await dst.catalog.saveDocument({
      bookId: shortBook.resource.id,
      documentId: dstShort.documents[0]!.id,
      content: "目标改过的短篇梗概"
    });
    await dst.long.writeChapter({
      bookId: longCreated.book.id,
      chapterCardId: ch.chapterCardId,
      body: { content: "目标机器新改的正文" },
      characterState: { content: "目标状态" },
      handoff: { content: "目标接续" }
    });

    // 目标机器预热长篇读缓存
    await dst.long.open({ bookId: longCreated.book.id });

    const conflictPreview = await previewLocalBackupArchive({
      archivePath,
      userDataPath: dst.userDataPath,
      workspaceDirectory: dst.workspaceDir
    });
    expect(
      conflictPreview.preview.items.every(
        (item) => item.status === "conflict_same_id"
      )
    ).toBe(true);

    // Keep-both 导入：原有保留不变，新副本重映射 ID 和标题
    const keepBothStage = await stageLocalBackupImport({
      archivePath,
      userDataPath: dst.userDataPath,
      workspaceDirectory: dst.workspaceDir,
      selectedKeys: keys,
      conflictPolicy: "keep_both",
      expectedLocalHashes: conflictPreview.localHashes
    });
    await commitStagedBackupImport({
      userDataPath: dst.userDataPath,
      workspaceDirectory: dst.workspaceDir,
      batchId: keepBothStage.batchId,
      stagingRoot: keepBothStage.stagingRoot,
      backupPrevRoot: keepBothStage.backupPrevRoot,
      operations: keepBothStage.operations,
      nextRegistries: keepBothStage.nextRegistries
    });
    expect(keepBothStage.summary.duplicated).toBe(3);

    const afterKeepBoth = await dst.catalog.snapshot();
    expect(afterKeepBoth.materials).toHaveLength(2);
    const copiedMat = afterKeepBoth.materials.find(
      (m) => m.id !== mat.resource.id
    )!;
    expect(copiedMat.title).toBe("设定库 (备份)");
    const copiedShort = afterKeepBoth.books.find(
      (b) => b.id !== shortBook.resource.id
    )!;
    expect(copiedShort.title).toBe("冲突短篇 (备份)");
    if (copiedShort.bookType === "academic") throw new Error("unexpected");
    expect(copiedShort.linkedMaterialIdsByKind.plot).toEqual([copiedMat.id]);

    const afterLongList = await dst.long.list();
    expect(afterLongList.books).toHaveLength(2);
    const copiedLongMeta = afterLongList.books.find(
      (b) => b.id !== longCreated.book.id
    )!;
    expect(copiedLongMeta.title).toBe("冲突长篇 (备份)");
    const openedCopiedLong = await dst.long.open({ bookId: copiedLongMeta.id });
    expect(openedCopiedLong.book.id).toBe(copiedLongMeta.id);

    // 通过 withLocalBackupCommands 执行 replace，确认缓存清空后读取到归档原内容
    const handler = withLocalBackupCommands(
      {
        userDataPath: dst.userDataPath,
        requireCatalogStore: async () => dst.catalog,
        longWorkspaceService: dst.long
      },
      async (command: CommandEnvelope): Promise<CommandResult> => ({
        status: "rejected",
        requestId: command.id,
        error: { code: "unsupported", message: "unsupported" }
      })
    );

    const replacePreview = await previewLocalBackupArchive({
      archivePath,
      userDataPath: dst.userDataPath,
      workspaceDirectory: dst.workspaceDir
    });
    const res = await handler(
      createEnvelope(
        "localBackup.coreApplyImportAtPath",
        {
          archivePath,
          workspaceDirectory: dst.workspaceDir,
          selectedKeys: [keys.find((k) => k.startsWith("long-book:"))!],
          conflictPolicy: "replace" as const,
          expectedLocalHashes: replacePreview.localHashes
        },
        { id: "cmd_test_replace", correlationId: "cmd_test_replace" }
      ),
      () => undefined
    );
    expect(res.status).toBe("accepted");
    const reloadedLong = await dst.long.readDocument({
      bookId: longCreated.book.id,
      fileId: ch.body.id,
      offset: 0,
      maxCharacters: 4000
    });
    expect(reloadedLong.content).toContain("第一版长篇正文");
  });

  it("安全解包与校验拒绝损坏包、高版本、CRC32/SHA256 不一致、路径穿越与 ZIP 炸弹", async () => {
    const dir = await makeWorkspaceEnv("dw-sec-");

    const badFile = join(dir.root, "not-zip.dwbackup.zip");
    await writeFile(badFile, "hello world");
    await expect(openVerifiedBackupZipArchive(badFile)).rejects.toMatchObject({
      code: "local_backup.invalid_archive"
    });

    const badCrc = join(dir.root, "bad-crc.dwbackup.zip");
    await writeFile(
      badCrc,
      buildMinimalZip([
        {
          name: "manifest.json",
          data: Buffer.from("{}"),
          crcOverride: 0xdeadbeef
        }
      ])
    );
    const badCrcArchive = await openVerifiedBackupZipArchive(badCrc);
    await expect(
      badCrcArchive.readEntry("manifest.json")
    ).rejects.toMatchObject({
      code: "local_backup.checksum_mismatch"
    });
    await badCrcArchive.close();

    const traversalZip = join(dir.root, "traversal.dwbackup.zip");
    await writeFile(
      traversalZip,
      buildMinimalZip([{ name: "../escape.json", data: Buffer.from("{}") }])
    );
    await expect(
      openVerifiedBackupZipArchive(traversalZip)
    ).rejects.toMatchObject({
      code: "local_backup.invalid_archive"
    });

    const caseZip = join(dir.root, "case.dwbackup.zip");
    await writeFile(
      caseZip,
      buildMinimalZip([
        { name: "items/A.txt", data: Buffer.from("a") },
        { name: "items/a.txt", data: Buffer.from("b") }
      ])
    );
    await expect(openVerifiedBackupZipArchive(caseZip)).rejects.toMatchObject({
      code: "local_backup.invalid_archive"
    });

    const futureZip = join(dir.root, "future.dwbackup.zip");
    await writeBackupZipArchive({
      targetPath: futureZip,
      entries: [],
      manifestEntryName: "manifest.json",
      buildManifest: () =>
        Buffer.from(JSON.stringify({ formatVersion: 99, items: [] }), "utf8")
    });
    await expect(readAndValidateBackupArchive(futureZip)).rejects.toMatchObject(
      {
        code: "local_backup.unsupported_format_version"
      }
    );

    const badShaZip = join(dir.root, "bad-sha.dwbackup.zip");
    await writeBackupZipArchive({
      targetPath: badShaZip,
      entries: [
        {
          archivePath: "items/book/abc/deepwrite.json",
          readBytes: async () => Buffer.from("{}")
        }
      ],
      manifestEntryName: "manifest.json",
      buildManifest: () =>
        Buffer.from(
          toJsonFileText({
            formatVersion: 1,
            minAppVersion: "1.9.0",
            appVersion: "1.9.0",
            exportedAt: new Date().toISOString(),
            platform: "darwin",
            creativePlotStages: [],
            items: [
              {
                kind: "book",
                id: "b1",
                title: "书1",
                sizeBytes: 2,
                hash: "0".repeat(64)
              }
            ],
            sha256ByPath: {
              "items/book/abc/deepwrite.json": "f".repeat(64)
            }
          })
        )
    });
    await expect(
      readAndValidateBackupArchive(badShaZip)
    ).rejects.toBeInstanceOf(LocalBackupError);

    const bombZip = join(dir.root, "bomb.dwbackup.zip");
    await writeFile(
      bombZip,
      buildMinimalZip([
        {
          name: "manifest.json",
          data: Buffer.from("small-payload"),
          rawHeaderSizeOverride: 128 * 1024 * 1024
        }
      ])
    );
    await expect(openVerifiedBackupZipArchive(bombZip)).rejects.toMatchObject({
      code: "local_backup.invalid_archive"
    });
  });

  it("支持目标变化拒绝、磁盘空间预检、导出取消、Stage 2 失败回滚及崩溃日志恢复", async () => {
    const src = await makeWorkspaceEnv("dw-tx-src-");
    const dst = await makeWorkspaceEnv("dw-tx-dst-");

    const m1 = await src.catalog.createLibrary({
      domain: "material",
      name: "库A",
      materialKind: "plot",
      parentDirectory: join(src.workspaceDir, "materials")
    });
    const m2 = await src.catalog.createLibrary({
      domain: "material",
      name: "库B",
      materialKind: "plot",
      parentDirectory: join(src.workspaceDir, "materials")
    });
    const inv = await getLocalBackupInventory(src.userDataPath);
    const keys = inv.items.map((i) => i.key);
    const archivePath = join(src.root, "tx.dwbackup.zip");

    const controller = new AbortController();
    controller.abort();
    await expect(
      exportLocalBackupAtPath({
        userDataPath: src.userDataPath,
        targetPath: archivePath,
        selectedKeys: keys,
        appVersion: "1.9.0",
        platform: "darwin",
        signal: controller.signal
      })
    ).rejects.toMatchObject({ code: "local_backup.canceled" });
    expect((await readdir(src.root)).some((f) => f.endsWith(".part"))).toBe(
      false
    );

    await expect(
      exportLocalBackupAtPath({
        userDataPath: src.userDataPath,
        targetPath: archivePath,
        selectedKeys: keys,
        appVersion: "1.9.0",
        platform: "darwin",
        statfsImpl: async () => ({ bavail: 1, bsize: 1024 })
      })
    ).rejects.toMatchObject({ code: "local_backup.insufficient_space" });

    await exportLocalBackupAtPath({
      userDataPath: src.userDataPath,
      targetPath: archivePath,
      selectedKeys: keys,
      appVersion: "1.9.0",
      platform: "darwin"
    });

    const key1 = keys.find((k) => k === `material-library:${m1.resource.id}`)!;
    const key2 = keys.find((k) => k === `material-library:${m2.resource.id}`)!;

    const pInit = await previewLocalBackupArchive({
      archivePath,
      userDataPath: dst.userDataPath,
      workspaceDirectory: dst.workspaceDir
    });
    const stage1 = await stageLocalBackupImport({
      archivePath,
      userDataPath: dst.userDataPath,
      workspaceDirectory: dst.workspaceDir,
      selectedKeys: [key1],
      conflictPolicy: "keep_both",
      expectedLocalHashes: pInit.localHashes
    });
    await commitStagedBackupImport({
      userDataPath: dst.userDataPath,
      workspaceDirectory: dst.workspaceDir,
      batchId: stage1.batchId,
      stagingRoot: stage1.stagingRoot,
      backupPrevRoot: stage1.backupPrevRoot,
      operations: stage1.operations,
      nextRegistries: stage1.nextRegistries
    });

    const pConflict = await previewLocalBackupArchive({
      archivePath,
      userDataPath: dst.userDataPath,
      workspaceDirectory: dst.workspaceDir
    });
    await dst.catalog.createLibraryEntry({
      domain: "material",
      libraryId: m1.resource.id,
      stageId: "intro",
      title: "中途插入",
      content: "干扰"
    });
    await expect(
      stageLocalBackupImport({
        archivePath,
        userDataPath: dst.userDataPath,
        workspaceDirectory: dst.workspaceDir,
        selectedKeys: [key1],
        conflictPolicy: "replace",
        expectedLocalHashes: pConflict.localHashes
      })
    ).rejects.toMatchObject({ code: "local_backup.target_changed" });

    const pFresh = await previewLocalBackupArchive({
      archivePath,
      userDataPath: dst.userDataPath,
      workspaceDirectory: dst.workspaceDir
    });
    const catalogBeforeFail = await readFile(
      join(dst.userDataPath, "catalog-registry.json"),
      "utf8"
    );
    const stageMulti = await stageLocalBackupImport({
      archivePath,
      userDataPath: dst.userDataPath,
      workspaceDirectory: dst.workspaceDir,
      selectedKeys: [key1, key2],
      conflictPolicy: "replace",
      expectedLocalHashes: pFresh.localHashes
    });
    await expect(
      commitStagedBackupImport({
        userDataPath: dst.userDataPath,
        workspaceDirectory: dst.workspaceDir,
        batchId: stageMulti.batchId,
        stagingRoot: stageMulti.stagingRoot,
        backupPrevRoot: stageMulti.backupPrevRoot,
        operations: stageMulti.operations,
        nextRegistries: stageMulti.nextRegistries,
        hooks: {
          beforeSwitchOp: (idx) => {
            if (idx === 1) throw new Error("simulated disk failure");
          }
        }
      })
    ).rejects.toMatchObject({ code: "local_backup.switch_failed" });

    expect(
      await readFile(join(dst.userDataPath, "catalog-registry.json"), "utf8")
    ).toBe(catalogBeforeFail);
    const dstM1Snap = await dst.catalog.snapshot();
    expect(
      dstM1Snap.materials.find((m) => m.id === m1.resource.id)?.entries
    ).toHaveLength(1);
    expect(
      dstM1Snap.materials.find((m) => m.id === m2.resource.id)
    ).toBeUndefined();

    // 模拟崩溃中断日志恢复
    const manualStage = await stageLocalBackupImport({
      archivePath,
      userDataPath: dst.userDataPath,
      workspaceDirectory: dst.workspaceDir,
      selectedKeys: [key2],
      conflictPolicy: "keep_both",
      expectedLocalHashes: pFresh.localHashes
    });
    const op = manualStage.operations[0]!;
    await rename(op.stagedDir, op.targetDir);
    const journalPath = join(
      dst.userDataPath,
      "local-backup-import-journal.json"
    );
    await mkdir(join(manualStage.backupPrevRoot, ".registries"), {
      recursive: true
    });
    await writeFile(
      journalPath,
      toJsonFileText({
        version: 1,
        batchId: manualStage.batchId,
        phase: "switching",
        workspaceDirectory: dst.workspaceDir,
        stagingRoot: manualStage.stagingRoot,
        backupPrevRoot: manualStage.backupPrevRoot,
        operations: manualStage.operations
      })
    );
    const recovery = await recoverInterruptedLocalBackupImport(
      dst.userDataPath
    );
    expect(recovery).toEqual({ recovered: true, action: "rolled_back" });
    await expect(lstat(op.targetDir)).rejects.toBeDefined();
    await expect(lstat(journalPath)).rejects.toBeDefined();
  });

  it("规范化 Windows 保留设备名与大小写/NFC 路径冲突", async () => {
    expect(sanitizeBackupFolderName("CON")).toBe("CON_dw");
    expect(sanitizeBackupFolderName("nul.txt")).toBe("nul_dw.txt");
    expect(sanitizeBackupFolderName("COM1")).toBe("COM1_dw");
    expect(sanitizeBackupFolderName("a<b>c:d/e\\f|g?h*i.")).toBe(
      "a-b-c-d-e-f-g-h-i"
    );

    const src = await makeWorkspaceEnv("dw-win-src-");
    const dst = await makeWorkspaceEnv("dw-win-dst-");
    const b1 = await src.catalog.createShortBook(
      { title: "CON", genre: "其他" },
      join(src.workspaceDir, "books")
    );
    const b2 = await src.catalog.createShortBook(
      { title: "Story", genre: "其他" },
      join(src.workspaceDir, "books")
    );
    const b3 = await src.catalog.createShortBook(
      { title: "story", genre: "其他" },
      join(src.workspaceDir, "books")
    );
    const inv = await getLocalBackupInventory(src.userDataPath);
    const keys = inv.items.map((i) => i.key);
    const archivePath = join(src.root, "win-compat.dwbackup.zip");
    await exportLocalBackupAtPath({
      userDataPath: src.userDataPath,
      targetPath: archivePath,
      selectedKeys: keys,
      appVersion: "1.9.0",
      platform: "win32"
    });

    const p = await previewLocalBackupArchive({
      archivePath,
      userDataPath: dst.userDataPath,
      workspaceDirectory: dst.workspaceDir
    });
    const s = await stageLocalBackupImport({
      archivePath,
      userDataPath: dst.userDataPath,
      workspaceDirectory: dst.workspaceDir,
      selectedKeys: keys,
      conflictPolicy: "keep_both",
      expectedLocalHashes: p.localHashes
    });
    await commitStagedBackupImport({
      userDataPath: dst.userDataPath,
      workspaceDirectory: dst.workspaceDir,
      batchId: s.batchId,
      stagingRoot: s.stagingRoot,
      backupPrevRoot: s.backupPrevRoot,
      operations: s.operations,
      nextRegistries: s.nextRegistries
    });

    const regs = (await readAllRegistries(dst.userDataPath)).catalog.projects;
    const dirMap = new Map(regs.map((r) => [r.id, r.projectDirectory]));
    expect(dirMap.get(b1.resource.id)).toMatch(/\/CON_dw$/u);
    expect(dirMap.get(b2.resource.id)?.toLowerCase()).not.toBe(
      dirMap.get(b3.resource.id)?.toLowerCase()
    );
  });

  it("同名不同 ID 项目导入保留两份独立资产，同 ID keep_both 后立即重导同一备份包保持幂等不重复生成副本", async () => {
    const src = await makeWorkspaceEnv("dw-dupe-idemp-src-");
    const dst = await makeWorkspaceEnv("dw-dupe-idemp-dst-");

    const srcMat = await src.catalog.createLibrary({
      domain: "material",
      name: "同名参考库",
      materialKind: "plot",
      parentDirectory: join(src.workspaceDir, "materials")
    });
    await src.catalog.createLibraryEntry({
      domain: "material",
      libraryId: srcMat.resource.id,
      stageId: "intro",
      title: "源端线索",
      content: "旧电脑线索正文"
    });
    const srcBook = await src.catalog.createShortBook(
      { title: "雾夜重逢", genre: "悬疑" },
      join(src.workspaceDir, "books")
    );
    await src.catalog.updateBook({
      bookId: srcBook.resource.id,
      linkedMaterialIdsByKind: {
        character: [],
        gimmick: [],
        plot: [srcMat.resource.id],
        draft: [],
        other: []
      }
    });
    await mkdir(join(srcBook.projectDirectory, "book-identity"), {
      recursive: true
    });
    await writeFile(
      join(srcBook.projectDirectory, "book-identity", "identity.json"),
      toJsonFileText(
        BookIdentityRecordSchema.parse({
          schemaVersion: 1,
          kind: "deepwrite.book-identity",
          bookId: srcBook.resource.id,
          revision: 1,
          updatedAt: new Date().toISOString(),
          adopted: {},
          rounds: []
        })
      )
    );
    const srcLong = await src.long.create(join(src.workspaceDir, "books"), {
      title: "长风同名",
      genre: "悬疑"
    });
    const srcMystery = await src.mystery.createAtPath(
      join(src.workspaceDir, "mystery-books"),
      {
        title: "钟楼同名",
        genre: "硬核推理",
        linkedMaterialIds: [srcMat.resource.id],
        linkedSkillIds: []
      }
    );

    // 目标端预设同名但不同 ID 的书与素材库
    const dstSameTitleMat = await dst.catalog.createLibrary({
      domain: "material",
      name: "同名参考库",
      materialKind: "plot",
      parentDirectory: join(dst.workspaceDir, "materials")
    });
    await dst.catalog.createLibraryEntry({
      domain: "material",
      libraryId: dstSameTitleMat.resource.id,
      stageId: "intro",
      title: "目标本地自有线索",
      content: "不能被同名项目混写"
    });
    const dstSameTitleBook = await dst.catalog.createShortBook(
      { title: "雾夜重逢", genre: "世情" },
      join(dst.workspaceDir, "books")
    );
    expect(dstSameTitleBook.resource.id).not.toBe(srcBook.resource.id);
    expect(dstSameTitleMat.resource.id).not.toBe(srcMat.resource.id);

    const inv = await getLocalBackupInventory(src.userDataPath);
    const keys = inv.items.map((i) => i.key);
    const archivePath = join(src.root, "same-title-and-keep-both.dwbackup.zip");
    await exportLocalBackupAtPath({
      userDataPath: src.userDataPath,
      targetPath: archivePath,
      selectedKeys: keys,
      appVersion: "1.9.0",
      platform: "darwin"
    });

    // ① 同名不同 ID 预览标记为 new + hasTitleCollision，导入保留两份独立目录与 ID
    const pSameTitle = await previewLocalBackupArchive({
      archivePath,
      userDataPath: dst.userDataPath,
      workspaceDirectory: dst.workspaceDir
    });
    const bookPreview = pSameTitle.preview.items.find(
      (i) => i.id === srcBook.resource.id
    )!;
    const matPreview = pSameTitle.preview.items.find(
      (i) => i.id === srcMat.resource.id
    )!;
    expect(bookPreview.status).toBe("new");
    expect(bookPreview.hasTitleCollision).toBe(true);
    expect(matPreview.status).toBe("new");
    expect(matPreview.hasTitleCollision).toBe(true);

    const s1 = await stageLocalBackupImport({
      archivePath,
      userDataPath: dst.userDataPath,
      workspaceDirectory: dst.workspaceDir,
      selectedKeys: keys,
      conflictPolicy: "keep_both",
      expectedLocalHashes: pSameTitle.localHashes
    });
    await commitStagedBackupImport({
      userDataPath: dst.userDataPath,
      workspaceDirectory: dst.workspaceDir,
      batchId: s1.batchId,
      stagingRoot: s1.stagingRoot,
      backupPrevRoot: s1.backupPrevRoot,
      operations: s1.operations,
      nextRegistries: s1.nextRegistries,
      expectedRegistryFingerprints: s1.expectedRegistryFingerprints
    });
    expect(s1.summary.added).toBe(4);

    const afterSameTitle = await dst.catalog.snapshot();
    const sameTitleBooks = afterSameTitle.books.filter(
      (b) => b.title === "雾夜重逢"
    );
    expect(sameTitleBooks.map((b) => b.id).sort()).toEqual(
      [dstSameTitleBook.resource.id, srcBook.resource.id].sort()
    );
    const sameTitleMats = afterSameTitle.materials.filter(
      (m) => m.title === "同名参考库"
    );
    expect(sameTitleMats.map((m) => m.id).sort()).toEqual(
      [dstSameTitleMat.resource.id, srcMat.resource.id].sort()
    );

    // 制造同 ID 冲突：修改已导入的 srcBook/srcMat/srcLong/srcMystery 后执行一次 keep_both
    await dst.catalog.createLibraryEntry({
      domain: "material",
      libraryId: srcMat.resource.id,
      stageId: "intro",
      title: "本地新增",
      content: "修改冲突"
    });
    const importedShortDocId = afterSameTitle.books.find(
      (b) => b.id === srcBook.resource.id
    )!.documents[0]!.id;
    await dst.catalog.saveDocument({
      bookId: srcBook.resource.id,
      documentId: importedShortDocId,
      content: "本地修改短篇"
    });
    const longCh = (await dst.long.open({ bookId: srcLong.book.id })).book
      .workspaceIndex.chapters[0]!;
    await dst.long.writeChapter({
      bookId: srcLong.book.id,
      chapterCardId: longCh.chapterCardId,
      body: { content: "本地修改长篇" },
      characterState: { content: "改状态" },
      handoff: { content: "改交接" }
    });
    await dst.mystery.writeDocument({
      bookId: srcMystery.book.id,
      target: { kind: "dm_manual" },
      content: "本地修改剧本杀"
    });

    const pConflict = await previewLocalBackupArchive({
      archivePath,
      userDataPath: dst.userDataPath,
      workspaceDirectory: dst.workspaceDir
    });
    expect(
      pConflict.preview.items.every((i) => i.status === "conflict_same_id")
    ).toBe(true);

    const sKeepBoth = await stageLocalBackupImport({
      archivePath,
      userDataPath: dst.userDataPath,
      workspaceDirectory: dst.workspaceDir,
      selectedKeys: keys,
      conflictPolicy: "keep_both",
      expectedLocalHashes: pConflict.localHashes
    });
    await commitStagedBackupImport({
      userDataPath: dst.userDataPath,
      workspaceDirectory: dst.workspaceDir,
      batchId: sKeepBoth.batchId,
      stagingRoot: sKeepBoth.stagingRoot,
      backupPrevRoot: sKeepBoth.backupPrevRoot,
      operations: sKeepBoth.operations,
      nextRegistries: sKeepBoth.nextRegistries,
      expectedRegistryFingerprints: sKeepBoth.expectedRegistryFingerprints
    });
    expect(sKeepBoth.summary.duplicated).toBe(4);

    // 确认副本的 identity.json 也重映射了新书号
    const copyReg = (
      await readAllRegistries(dst.userDataPath)
    ).catalog.projects.find(
      (p) =>
        p.domain === "book" &&
        p.id !== dstSameTitleBook.resource.id &&
        p.id !== srcBook.resource.id
    )!;
    const copyIdentity = BookIdentityRecordSchema.parse(
      JSON.parse(
        await readFile(
          join(copyReg.projectDirectory, "book-identity", "identity.json"),
          "utf8"
        )
      )
    );
    expect(copyIdentity.bookId).toBe(copyReg.id);

    // keep_both 完成后立即再次预览同一备份包：必须全为 identical，且再次 keep_both 导入不得生成 (备份 2)
    const pRepeat = await previewLocalBackupArchive({
      archivePath,
      userDataPath: dst.userDataPath,
      workspaceDirectory: dst.workspaceDir
    });
    expect(
      pRepeat.preview.items.every((item) => item.status === "identical")
    ).toBe(true);

    const sRepeat = await stageLocalBackupImport({
      archivePath,
      userDataPath: dst.userDataPath,
      workspaceDirectory: dst.workspaceDir,
      selectedKeys: keys,
      conflictPolicy: "keep_both",
      expectedLocalHashes: pRepeat.localHashes
    });
    expect(sRepeat.operations).toHaveLength(0);
    expect(sRepeat.summary.duplicated).toBe(0);
    expect(sRepeat.summary.skipped).toBe(4);
    await rm(sRepeat.stagingRoot, { recursive: true, force: true });

    const snapAfterRepeat = await dst.catalog.snapshot();
    expect(snapAfterRepeat.books).toHaveLength(3);
    expect(snapAfterRepeat.materials).toHaveLength(3);
    expect((await dst.long.list()).books).toHaveLength(2);
    expect((await dst.mystery.list()).books).toHaveLength(2);
  });

  it("预览后修改目标同 ID 项或任一注册表时拒绝旧确认，且绝不静默覆盖新编辑", async () => {
    const src = await makeWorkspaceEnv("dw-stale-src-");
    const dst = await makeWorkspaceEnv("dw-stale-dst-");

    const srcBook = await src.catalog.createShortBook(
      { title: "旧书版本", genre: "悬疑" },
      join(src.workspaceDir, "books")
    );
    const inv = await getLocalBackupInventory(src.userDataPath);
    const keys = inv.items.map((i) => i.key);
    const archivePath = join(src.root, "stale-check.dwbackup.zip");
    await exportLocalBackupAtPath({
      userDataPath: src.userDataPath,
      targetPath: archivePath,
      selectedKeys: keys,
      appVersion: "1.9.0",
      platform: "darwin"
    });

    // 目标预先导入一次，制造可覆写的同 ID 项目
    const p0 = await previewLocalBackupArchive({
      archivePath,
      userDataPath: dst.userDataPath,
      workspaceDirectory: dst.workspaceDir
    });
    const s0 = await stageLocalBackupImport({
      archivePath,
      userDataPath: dst.userDataPath,
      workspaceDirectory: dst.workspaceDir,
      selectedKeys: keys,
      conflictPolicy: "keep_both",
      expectedLocalHashes: p0.localHashes
    });
    await commitStagedBackupImport({
      userDataPath: dst.userDataPath,
      workspaceDirectory: dst.workspaceDir,
      batchId: s0.batchId,
      stagingRoot: s0.stagingRoot,
      backupPrevRoot: s0.backupPrevRoot,
      operations: s0.operations,
      nextRegistries: s0.nextRegistries,
      expectedRegistryFingerprints: s0.expectedRegistryFingerprints
    });

    const pBeforeCatalogChange = await previewLocalBackupArchive({
      archivePath,
      userDataPath: dst.userDataPath,
      workspaceDirectory: dst.workspaceDir
    });
    const extraBook = await dst.catalog.createShortBook(
      { title: "预览后新建无关书籍", genre: "其他" },
      join(dst.workspaceDir, "books")
    );
    await expect(
      stageLocalBackupImport({
        archivePath,
        userDataPath: dst.userDataPath,
        workspaceDirectory: dst.workspaceDir,
        selectedKeys: keys,
        conflictPolicy: "replace",
        expectedLocalHashes: pBeforeCatalogChange.localHashes
      })
    ).rejects.toMatchObject({ code: "local_backup.target_changed" });
    expect(
      (await dst.catalog.snapshot()).books.some(
        (b) => b.id === extraBook.resource.id
      )
    ).toBe(true);

    // 预览后改动 long-project-registry.json 同样阻断
    const pBeforeLongChange = await previewLocalBackupArchive({
      archivePath,
      userDataPath: dst.userDataPath,
      workspaceDirectory: dst.workspaceDir
    });
    const extraLong = await dst.long.create(join(dst.workspaceDir, "books"), {
      title: "预览后新长篇",
      genre: "其他"
    });
    await expect(
      stageLocalBackupImport({
        archivePath,
        userDataPath: dst.userDataPath,
        workspaceDirectory: dst.workspaceDir,
        selectedKeys: keys,
        conflictPolicy: "replace",
        expectedLocalHashes: pBeforeLongChange.localHashes
      })
    ).rejects.toMatchObject({ code: "local_backup.target_changed" });
    expect(
      (await dst.long.list()).books.some((b) => b.id === extraLong.book.id)
    ).toBe(true);

    // 预览后改动 mystery-projects.json 同样阻断
    const pBeforeMysteryChange = await previewLocalBackupArchive({
      archivePath,
      userDataPath: dst.userDataPath,
      workspaceDirectory: dst.workspaceDir
    });
    const extraMystery = await dst.mystery.createAtPath(
      join(dst.workspaceDir, "mystery-books"),
      { title: "预览后新剧本杀", genre: "硬核推理" }
    );
    await expect(
      stageLocalBackupImport({
        archivePath,
        userDataPath: dst.userDataPath,
        workspaceDirectory: dst.workspaceDir,
        selectedKeys: keys,
        conflictPolicy: "replace",
        expectedLocalHashes: pBeforeMysteryChange.localHashes
      })
    ).rejects.toMatchObject({ code: "local_backup.target_changed" });
    expect(
      (await dst.mystery.list()).books.some(
        (b) => b.id === extraMystery.book.id
      )
    ).toBe(true);

    // 验证同 ID 项在 preview 后被修改时，replace 不得覆盖新编辑
    const pBeforeDocEdit = await previewLocalBackupArchive({
      archivePath,
      userDataPath: dst.userDataPath,
      workspaceDirectory: dst.workspaceDir
    });
    const targetDocId = (await dst.catalog.snapshot()).books.find(
      (b) => b.id === srcBook.resource.id
    )!.documents[0]!.id;
    await dst.catalog.saveDocument({
      bookId: srcBook.resource.id,
      documentId: targetDocId,
      content: "预览后紧急补写的关键内容"
    });
    await expect(
      stageLocalBackupImport({
        archivePath,
        userDataPath: dst.userDataPath,
        workspaceDirectory: dst.workspaceDir,
        selectedKeys: keys,
        conflictPolicy: "replace",
        expectedLocalHashes: pBeforeDocEdit.localHashes
      })
    ).rejects.toMatchObject({ code: "local_backup.target_changed" });
    const latestDoc = await dst.catalog.readDocument({
      projectId: srcBook.resource.id,
      target: "document",
      documentId: targetDocId
    });
    expect(latestDoc.content).toBe("预览后紧急补写的关键内容");
  });

  it("导出期间并发 Core 写入排队隔离，外部磁盘中途改动触发快照一致性中止且零残留", async () => {
    const src = await makeWorkspaceEnv("dw-snap-consistency-");
    const book = await src.catalog.createShortBook(
      { title: "快照一致性测试", genre: "科幻" },
      join(src.workspaceDir, "books")
    );
    const docId = (await src.catalog.snapshot()).books[0]!.documents[0]!.id;
    await src.catalog.saveDocument({
      bookId: book.resource.id,
      documentId: docId,
      content: "导出基准快照正文"
    });

    const inv = await getLocalBackupInventory(src.userDataPath);
    const keys = inv.items.map((i) => i.key);

    // 1. 导出期间，其他 Core 写入命令必须排队直到导出完成后才执行，保证导出静态一致快照
    let enterSnapshot!: () => void;
    let releaseSnapshot!: () => void;
    const enteredPromise = new Promise<void>((res) => {
      enterSnapshot = res;
    });
    const releasePromise = new Promise<void>((res) => {
      releaseSnapshot = res;
    });

    const order: string[] = [];
    const barrierHandler = withLocalBackupCommands(
      {
        userDataPath: src.userDataPath,
        requireCatalogStore: async () => src.catalog,
        longWorkspaceService: src.long,
        exportHooks: {
          afterSnapshotCaptured: async () => {
            order.push("export:snapshot-captured");
            enterSnapshot();
            await releasePromise;
            order.push("export:releasing");
          }
        }
      },
      async (command: CommandEnvelope): Promise<CommandResult> => {
        if (command.type === "catalog.saveDocument") {
          order.push("regular:saveDocument");
          const saved = await src.catalog.saveDocument(
            command.payload as Parameters<typeof src.catalog.saveDocument>[0]
          );
          return {
            status: "accepted",
            requestId: command.id,
            payload: saved
          };
        }
        return {
          status: "rejected",
          requestId: command.id,
          error: { code: "unsupported", message: "unsupported" }
        };
      }
    );

    const archiveClean = join(src.root, "consistent-clean.dwbackup.zip");
    const exportPromise = barrierHandler(
      createEnvelope(
        "localBackup.coreExportAtPath",
        {
          exportId: "exp_barrier_1",
          targetPath: archiveClean,
          selectedKeys: keys,
          appVersion: "1.9.0",
          platform: "darwin" as const
        },
        { id: "cmd_exp_b", correlationId: "cmd_exp_b" }
      ),
      () => undefined
    );
    await enteredPromise;

    let concurrentFinishedDuringExport = false;
    const concurrentWrite = Promise.resolve(
      barrierHandler(
        createEnvelope(
          "catalog.saveDocument",
          {
            bookId: book.resource.id,
            documentId: docId,
            content: "并发后续写入正文"
          },
          { id: "cmd_write_b", correlationId: "cmd_write_b" }
        ),
        () => undefined
      )
    ).then((res) => {
      concurrentFinishedDuringExport = true;
      return res;
    });

    await new Promise((res) => setTimeout(res, 25));
    expect(concurrentFinishedDuringExport).toBe(false);
    releaseSnapshot();

    const [exportRes, writeRes] = await Promise.all([
      exportPromise,
      concurrentWrite
    ]);
    expect(exportRes.status).toBe("accepted");
    expect(writeRes.status).toBe("accepted");
    expect(order).toEqual([
      "export:snapshot-captured",
      "export:releasing",
      "regular:saveDocument"
    ]);

    const bundleClean = await readAndValidateBackupArchive(archiveClean);
    const archivedManifest = bundleClean.items[0]!.files.get("deepwrite.json")!;
    const parsedBook = JSON.parse(archivedManifest.toString("utf8")) as {
      documents: Array<{ id: string; path: string }>;
    };
    const docPath = parsedBook.documents.find((d) => d.id === docId)!.path;
    expect(bundleClean.items[0]!.files.get(docPath)!.toString("utf8")).toBe(
      "导出基准快照正文"
    );

    // 2. 若绕过队列直接在磁盘上中途篡改选中文件，导出必须立刻以 target_changed 中止且零残留
    const archiveTorn = join(src.root, "torn-aborted.dwbackup.zip");
    await expect(
      exportLocalBackupAtPath({
        userDataPath: src.userDataPath,
        targetPath: archiveTorn,
        selectedKeys: keys,
        appVersion: "1.9.0",
        platform: "darwin",
        exportHooks: {
          afterSnapshotCaptured: async () => {
            await writeFile(
              join(book.projectDirectory, docPath),
              "磁盘中途被外部篡改"
            );
          }
        }
      })
    ).rejects.toMatchObject({ code: "local_backup.target_changed" });
    await expect(lstat(archiveTorn)).rejects.toBeDefined();
    expect((await readdir(src.root)).some((f) => f.endsWith(".part"))).toBe(
      false
    );
  });

  it("正式写入中途（目录切换及多注册表提交）故障回滚、SIGKILL 崩溃日志先写证明、重启恢复一致性与重复恢复幂等", async () => {
    const src = await makeWorkspaceEnv("dw-crash-src-");
    const dst = await makeWorkspaceEnv("dw-crash-dst-");

    // 目标既有资产覆盖三份注册表：catalog（short）+ long（long）
    const shortDst = await dst.catalog.createShortBook(
      { title: "崩溃测试短篇", genre: "悬疑" },
      join(dst.workspaceDir, "books")
    );
    const shortDocId = (await dst.catalog.snapshot()).books[0]!.documents[0]!
      .id;
    await dst.catalog.saveDocument({
      bookId: shortDst.resource.id,
      documentId: shortDocId,
      content: "崩溃前短篇原正文"
    });
    const longDst = await dst.long.create(join(dst.workspaceDir, "books"), {
      title: "崩溃测试长篇",
      genre: "悬疑"
    });
    const longChDst = (await dst.long.open({ bookId: longDst.book.id })).book
      .workspaceIndex.chapters[0]!;
    await dst.long.writeChapter({
      bookId: longDst.book.id,
      chapterCardId: longChDst.chapterCardId,
      body: { content: "崩溃前长篇原正文" },
      characterState: { content: "原人物状态" },
      handoff: { content: "原交接说明" }
    });
    await dst.long.commitChapter({
      mode: "text_files",
      bookId: longDst.book.id,
      chapterCardId: longChDst.chapterCardId,
      foreshadowingBeatDecisions: {},
      commitMessage: "崩溃前基准提交"
    });

    // 导出目标的一份旧基线包，再让目标继续演进本地内容，确保 replace 会更新两本书且新增一本 mystery
    const mysterySrc = await dst.mystery.createAtPath(
      join(dst.workspaceDir, "mystery-books"),
      { title: "第三注册表新增剧本杀", genre: "硬核推理" }
    );
    const fullInv = await getLocalBackupInventory(dst.userDataPath);
    const fullKeys = fullInv.items.map((i) => i.key);
    const archivePath = join(src.root, "three-registries.dwbackup.zip");
    await exportLocalBackupAtPath({
      userDataPath: dst.userDataPath,
      targetPath: archivePath,
      selectedKeys: fullKeys,
      appVersion: "1.9.0",
      platform: "darwin"
    });

    // 目标删除剧本杀项目（移除 mystery-projects.json 中的它，使其导入时走 create 路径），并修改 short + long 正文
    await rm(join(dst.userDataPath, "mystery-projects.json"), { force: true });
    await rm(mysterySrc.projectDirectory, { recursive: true, force: true });
    await dst.catalog.saveDocument({
      bookId: shortDst.resource.id,
      documentId: shortDocId,
      content: "目标最新短篇正文"
    });
    await dst.long.writeChapter({
      bookId: longDst.book.id,
      chapterCardId: longChDst.chapterCardId,
      body: { content: "目标最新长篇正文" },
      characterState: { content: "最新人物" },
      handoff: { content: "最新交接" }
    });

    const catRegPath = join(dst.userDataPath, "catalog-registry.json");
    const longRegPath = join(dst.userDataPath, "long-project-registry.json");
    const mysRegPath = join(dst.userDataPath, "mystery-projects.json");
    const preCatHash = sha256Hex(await readFile(catRegPath));
    const preLongHash = sha256Hex(await readFile(longRegPath));
    const journalPath = join(
      dst.userDataPath,
      "local-backup-import-journal.json"
    );

    // 场景 A：三份注册表提交到第 3 份时抛出写入异常（catalog 与 long 注册表已覆盖、目录已切换），验证日志先落盘与完整自动回滚
    const preview1 = await previewLocalBackupArchive({
      archivePath,
      userDataPath: dst.userDataPath,
      workspaceDirectory: dst.workspaceDir
    });
    const plan1 = await stageLocalBackupImport({
      archivePath,
      userDataPath: dst.userDataPath,
      workspaceDirectory: dst.workspaceDir,
      selectedKeys: fullKeys,
      conflictPolicy: "replace",
      expectedLocalHashes: preview1.localHashes
    });

    let journalExistedBeforeFirstRename = false;
    let regBackupsExistedBeforeFirstRename = false;
    let registriesIntactBeforeFirstRename = false;
    let catAlreadyChangedBeforeThirdWrite = false;
    await expect(
      commitStagedBackupImport({
        userDataPath: dst.userDataPath,
        workspaceDirectory: dst.workspaceDir,
        batchId: plan1.batchId,
        stagingRoot: plan1.stagingRoot,
        backupPrevRoot: plan1.backupPrevRoot,
        operations: plan1.operations,
        nextRegistries: plan1.nextRegistries,
        expectedRegistryFingerprints: plan1.expectedRegistryFingerprints,
        hooks: {
          beforeSwitchOp: async (index) => {
            if (index !== 0) return;
            const rawJ = JSON.parse(
              await readFile(journalPath, "utf8")
            ) as LocalBackupImportJournal;
            journalExistedBeforeFirstRename = rawJ.phase === "switching";
            regBackupsExistedBeforeFirstRename =
              (
                await readdir(join(plan1.backupPrevRoot, ".registries"))
              ).includes("catalog-registry.json") &&
              (
                await readdir(join(plan1.backupPrevRoot, ".registries"))
              ).includes("mystery-projects.json.state.json");
            registriesIntactBeforeFirstRename =
              sha256Hex(await readFile(catRegPath)) === preCatHash &&
              sha256Hex(await readFile(longRegPath)) === preLongHash;
          },
          beforeRegistryWrite: async (index, name) => {
            if (index === 2) {
              expect(name).toBe("mystery-projects.json");
              catAlreadyChangedBeforeThirdWrite =
                sha256Hex(await readFile(catRegPath)) !== preCatHash;
              throw new Error("EIO writing third registry");
            }
          }
        }
      })
    ).rejects.toMatchObject({ code: "local_backup.switch_failed" });

    expect(journalExistedBeforeFirstRename).toBe(true);
    expect(regBackupsExistedBeforeFirstRename).toBe(true);
    expect(registriesIntactBeforeFirstRename).toBe(true);
    expect(catAlreadyChangedBeforeThirdWrite).toBe(true);

    // 验证注册表、目标正文、新增目录均完整回滚且零残留
    expect(sha256Hex(await readFile(catRegPath))).toBe(preCatHash);
    expect(sha256Hex(await readFile(longRegPath))).toBe(preLongHash);
    await expect(lstat(mysRegPath)).rejects.toBeDefined();
    await expect(lstat(mysterySrc.projectDirectory)).rejects.toBeDefined();
    await expect(lstat(journalPath)).rejects.toBeDefined();
    expect(
      (
        await dst.catalog.readDocument({
          projectId: shortDst.resource.id,
          target: "document",
          documentId: shortDocId
        })
      ).content
    ).toBe("目标最新短篇正文");
    expect(
      (
        await dst.long.readDocument({
          bookId: longDst.book.id,
          fileId: longChDst.body.id,
          offset: 0,
          maxCharacters: 2000
        })
      ).content
    ).toContain("目标最新长篇正文");

    // 场景 B：注册表写入中途模拟硬崩溃 (SIGKILL)，留下撕裂磁盘态，验证重启恢复、恢复期再次中断幂等性
    const preview2 = await previewLocalBackupArchive({
      archivePath,
      userDataPath: dst.userDataPath,
      workspaceDirectory: dst.workspaceDir
    });
    const plan2 = await stageLocalBackupImport({
      archivePath,
      userDataPath: dst.userDataPath,
      workspaceDirectory: dst.workspaceDir,
      selectedKeys: fullKeys,
      conflictPolicy: "replace",
      expectedLocalHashes: preview2.localHashes
    });

    await expect(
      commitStagedBackupImport({
        userDataPath: dst.userDataPath,
        workspaceDirectory: dst.workspaceDir,
        batchId: plan2.batchId,
        stagingRoot: plan2.stagingRoot,
        backupPrevRoot: plan2.backupPrevRoot,
        operations: plan2.operations,
        nextRegistries: plan2.nextRegistries,
        expectedRegistryFingerprints: plan2.expectedRegistryFingerprints,
        hooks: {
          beforeRegistryWrite: (index) => {
            if (index === 1) {
              // catalog-registry.json 已被覆盖，long-project-registry.json 尚未写，所有目录已完成切换
              throw new LocalBackupSimulatedCrashError("SIGKILL mid registry");
            }
          }
        }
      })
    ).rejects.toBeInstanceOf(LocalBackupSimulatedCrashError);

    // 断言崩溃瞬间磁盘撕裂状态真实存在：journal=switching、catalog 注册表已变、targetDir 为包内旧文本
    const crashedJournal = JSON.parse(
      await readFile(journalPath, "utf8")
    ) as LocalBackupImportJournal;
    expect(crashedJournal.phase).toBe("switching");
    expect(sha256Hex(await readFile(catRegPath))).not.toBe(preCatHash);
    expect(sha256Hex(await readFile(longRegPath))).toBe(preLongHash);
    expect((await lstat(mysterySrc.projectDirectory)).isDirectory()).toBe(true);

    // 模拟重启动态恢复：第一次执行回滚
    const rec1 = await recoverInterruptedLocalBackupImport(dst.userDataPath);
    expect(rec1).toEqual({ recovered: true, action: "rolled_back" });
    expect(sha256Hex(await readFile(catRegPath))).toBe(preCatHash);
    expect(sha256Hex(await readFile(longRegPath))).toBe(preLongHash);
    await expect(lstat(mysRegPath)).rejects.toBeDefined();
    await expect(lstat(mysterySrc.projectDirectory)).rejects.toBeDefined();
    await expect(lstat(journalPath)).rejects.toBeDefined();

    // 恢复中途若尚未删除 journal（仍残留在 switching/cleaning）再重启恢复，绝不得误删或破坏已恢复的用户目录！
    await writeFile(journalPath, toJsonFileText(crashedJournal));
    const rec2 = await recoverInterruptedLocalBackupImport(dst.userDataPath);
    expect(rec2).toEqual({ recovered: true, action: "rolled_back" });
    const rec3 = await recoverInterruptedLocalBackupImport(dst.userDataPath);
    expect(rec3).toEqual({ recovered: false });

    // 重新实例化全新的 Store（等效桌面重启），回读三份注册表与作品原文验证完全完好
    const restartedCatalog = new FolderCatalogStore({
      userDataPath: dst.userDataPath
    });
    const restartedLong = new LongWorkspaceService({
      userDataPath: dst.userDataPath
    });
    const restartedMystery = new MysteryWorkspaceService({
      userDataPath: dst.userDataPath
    });
    expect(
      (
        await restartedCatalog.readDocument({
          projectId: shortDst.resource.id,
          target: "document",
          documentId: shortDocId
        })
      ).content
    ).toBe("目标最新短篇正文");
    expect(
      (
        await restartedLong.readDocument({
          bookId: longDst.book.id,
          fileId: longChDst.body.id,
          offset: 0,
          maxCharacters: 2000
        })
      ).content
    ).toContain("目标最新长篇正文");
    expect((await restartedMystery.list()).books).toHaveLength(0);
    expect(sha256Hex(await readFile(catRegPath))).toBe(preCatHash);
  });
});
