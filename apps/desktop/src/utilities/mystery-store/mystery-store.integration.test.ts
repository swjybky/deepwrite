import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DocumentVersionCommandEnvelopeSchema,
  MATERIAL_KINDS,
  createEnvelope,
  mysteryDocumentTargetKey
} from "@deepwrite/contracts";
import { BookImageStore } from "../book-images/store";
import { createBookProjectResolver } from "../book-project-resolver";
import { executeDocumentVersionCommand } from "../document-versions/version-commands";
import { FolderCatalogStore } from "../folder-catalog-store";
import { LibraryManagementService } from "../library-management-service";
import { LongWorkspaceService } from "../long-workspace-service";
import { MaterialQueryService } from "../material-query-service";
import { MysteryDocumentConflictError, MysteryWorkspaceService } from "./index";

const tempDirs: string[] = [];

async function makeTempDir(prefix = "deepwrite-mystery-"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function nowFactory(): () => string {
  let step = 0;
  return () => new Date(Date.UTC(2026, 10, 17, 0, 0, ++step)).toISOString();
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    await rm(dir, { recursive: true, force: true });
  }
});

describe("MysteryWorkspaceService", () => {
  it("gives new mysteries the same context and saves edits separately by revision", async () => {
    const userDataPath = await makeTempDir();
    const booksParent = await makeTempDir();
    const service = new MysteryWorkspaceService({ userDataPath });
    const boardSpec = {
      playerCount: 4,
      actCountTarget: 2,
      narrativePerson: "second"
    };
    const first = await service.createAtPath(booksParent, {
      title: "第一部推理本",
      genre: "硬核推理",
      boardSpec
    });
    const second = await service.createAtPath(booksParent, {
      title: "第二部推理本",
      genre: "硬核推理",
      boardSpec: { ...boardSpec, playerCount: 6 }
    });
    const bookId = first.book.id;
    const initial = await service.readAgentsMd({ bookId });
    expect(initial.content).toMatch(/^# 剧本杀上下文\n\n/);
    expect(
      (await service.readAgentsMd({ bookId: second.book.id })).content
    ).toBe(initial.content);

    const content = "# 作者自定义约定\n\n保留开场线索。";
    const result = await service.writeAgentsMd({
      bookId,
      content,
      expectedRevision: initial.revision
    });
    await expect(
      service.writeAgentsMd({
        bookId,
        content: "旧草稿",
        expectedRevision: initial.revision
      })
    ).rejects.toBeInstanceOf(MysteryDocumentConflictError);
    expect(await service.readAgentsMd({ bookId })).toMatchObject({
      content,
      revision: result.revision
    });
    expect(
      (await service.readAgentsMd({ bookId: second.book.id })).content
    ).toBe(initial.content);
  });

  it("requires the registered identity before deletion and restores the folder if unregistering fails", async () => {
    const userDataPath = await makeTempDir();
    const booksParent = await makeTempDir();
    const service = new MysteryWorkspaceService({ userDataPath });
    const opened = await service.createAtPath(booksParent, {
      title: "删除验证作品",
      genre: "硬核推理",
      boardSpec: {
        playerCount: 3,
        actCountTarget: 1,
        narrativePerson: "second"
      }
    });
    const { book, projectDirectory } = opened;
    const unregister = async () => {
      throw new Error("registry write failed");
    };

    await expect(
      service.store.deleteBook(projectDirectory, "mystery_other", unregister)
    ).rejects.toThrow("标识与注册信息不一致");
    await expect(
      service.store.deleteBook(projectDirectory, book.id, unregister)
    ).rejects.toThrow("registry write failed");
    expect((await service.open({ bookId: book.id })).book.id).toBe(book.id);

    await service.deleteBook({ bookId: book.id });
    expect((await service.list()).books).toEqual([]);
    await expect(
      service.store.inspectBook(projectDirectory)
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("manages 2D roles x acts matrix, restorePoints, optimistic locks, search filters, versions, and duplication", async () => {
    const userDataPath = await makeTempDir("deepwrite-mystery-user-");
    const booksParent = await makeTempDir("deepwrite-mystery-books-");
    const service = new MysteryWorkspaceService({
      userDataPath,
      now: nowFactory()
    });

    const created = await service.createAtPath(
      join(booksParent, "mystery-books"),
      {
        title: "雾钟山庄",
        genre: "硬核推理",
        boardSpec: {
          playerCount: 4,
          actCountTarget: 3,
          narrativePerson: "second",
          summary: "暴风雪山庄的时钟诡计"
        }
      }
    );

    expect(created.book.roles).toHaveLength(4);
    expect(created.book.acts).toHaveLength(3);
    expect(created.workspaceIndex.actMatrix).toHaveLength(12);
    expect(created.book.truthDocuments.map((d) => d.id)).toEqual([
      "overview",
      "core_truth",
      "timeline_dispatch"
    ]);

    const listed = await service.list();
    expect(listed.books.map((b) => b.id)).toEqual([created.book.id]);

    const renamed = await service.rename(created.book.id, "雾钟山庄·修订版");
    expect(renamed.summary.title).toBe("雾钟山庄·修订版");

    // 2D matrix: add role & act, reorder, delete, and restore
    const roleId = created.book.roles[0]!.id;
    const actId = created.book.acts[0]!.id;
    const roleProfileBefore = await service.readDocument({
      bookId: created.book.id,
      target: { kind: "role", roleId, document: "profile" }
    });
    const actBodyTarget = {
      kind: "player_act" as const,
      roleId,
      actId,
      document: "body" as const
    };
    const actBriefTarget = {
      kind: "player_act" as const,
      roleId,
      actId,
      document: "brief" as const
    };
    const actBodyBefore = await service.readDocument({
      bookId: created.book.id,
      target: actBodyTarget
    });

    await service.writeDocument({
      bookId: created.book.id,
      target: roleProfileBefore.target,
      content: "# 上帝底牌\n核心凶手密室手法 SECRET_TOKEN_ALPHA",
      expectedRevision: roleProfileBefore.revision
    });
    await expect(
      service.writeDocument({
        bookId: created.book.id,
        target: roleProfileBefore.target,
        content: "陈旧写入",
        expectedRevision: roleProfileBefore.revision
      })
    ).rejects.toThrow(MysteryDocumentConflictError);

    await service.writeDocument({
      bookId: created.book.id,
      target: actBriefTarget,
      content: "第一幕视角任务卡 SECRET_TOKEN_ALPHA"
    });
    const writtenBody = await service.writeDocument({
      bookId: created.book.id,
      target: actBodyTarget,
      content: "你推开阁楼木门，壁炉里的余烬还散发着松木味。PLAYER_TOKEN_BETA",
      expectedRevision: actBodyBefore.revision,
      versionOrigin: {
        sessionId: "sess_test_1",
        runId: "run_test_1",
        summary: "写入第一幕人物本正文"
      }
    });

    // Search filter: playerVisibleOnly hides .profile, .brief, truth, dm, endings
    const allHits = await service.search({
      bookId: created.book.id,
      query: "SECRET_TOKEN_ALPHA",
      playerVisibleOnly: false
    });
    expect(allHits.hits.length).toBeGreaterThanOrEqual(2);
    expect(allHits.hits.every((h) => !h.playerVisible)).toBe(true);

    const playerOnlySecretHits = await service.search({
      bookId: created.book.id,
      query: "SECRET_TOKEN_ALPHA",
      playerVisibleOnly: true
    });
    expect(playerOnlySecretHits.hits).toHaveLength(0);

    const playerOnlyPublicHits = await service.search({
      bookId: created.book.id,
      query: "PLAYER_TOKEN_BETA",
      playerVisibleOnly: true
    });
    expect(playerOnlyPublicHits.hits).toHaveLength(1);
    expect(playerOnlyPublicHits.hits[0]?.target).toEqual(actBodyTarget);

    // Add 5th role and 4th act, reorder, then delete the original first role and restore it
    const added = await service.applyOperations({
      bookId: created.book.id,
      batch: {
        operations: [
          {
            type: "role.create",
            role: { id: "npc_helper", name: "林医生", tag: "法医" }
          },
          {
            type: "act.create",
            act: { id: "act_extra", title: "终幕揭晓" }
          },
          {
            type: "role.updateMeta",
            roleId,
            move: "down"
          }
        ],
        documentWrites: []
      }
    });
    expect(added.book.roles).toHaveLength(5);
    expect(added.book.acts).toHaveLength(4);
    expect(added.workspaceIndex.actMatrix).toHaveLength(20);
    expect(added.book.roles[1]?.id).toBe(roleId);

    const deleted = await service.applyOperations({
      bookId: created.book.id,
      batch: {
        operations: [{ type: "role.delete", roleId }],
        documentWrites: []
      }
    });
    expect(deleted.book.roles.some((r) => r.id === roleId)).toBe(false);
    expect(deleted.restorePoint).toBeDefined();

    const restoredOp = await service.restoreOperations({
      bookId: created.book.id,
      restoreId: deleted.restorePoint!.restoreId
    });
    expect(restoredOp.book.roles.some((r) => r.id === roleId)).toBe(true);
    const restoredBody = await service.readDocument({
      bookId: created.book.id,
      target: actBodyTarget
    });
    expect(restoredBody.content).toContain("PLAYER_TOKEN_BETA");

    // Minimum 1 role / 1 act invariant
    await expect(
      service.applyOperations({
        bookId: created.book.id,
        batch: {
          operations: restoredOp.book.roles.map((r) => ({
            type: "role.delete" as const,
            roleId: r.id
          })),
          documentWrites: []
        }
      })
    ).rejects.toMatchObject({ code: "minimum_required" });

    // Document versions list, read, restore for workspace: "mystery"
    const catalog = new FolderCatalogStore({ userDataPath });
    const longs = new LongWorkspaceService({ userDataPath });
    const targetKey = mysteryDocumentTargetKey(actBodyTarget);
    const versionTarget = {
      workspace: "mystery" as const,
      bookId: created.book.id,
      targetKey,
      target: actBodyTarget
    };
    await service.writeDocument({
      bookId: created.book.id,
      target: actBodyTarget,
      content: "这是修改后的第二版正文。",
      expectedRevision: restoredBody.revision
    });
    const listRes = (await executeDocumentVersionCommand(
      DocumentVersionCommandEnvelopeSchema.parse(
        createEnvelope(
          "versions.list",
          { target: versionTarget },
          { id: "cmd_ver_list" }
        )
      ),
      async () => catalog,
      longs,
      service
    )) as {
      versions: { id: string; kind: string }[];
      current: { sha256: string };
    };
    expect(listRes.versions.length).toBeGreaterThanOrEqual(1);
    const savedConversationVersion = listRes.versions.find(
      (v) => v.kind === "conversation"
    );
    expect(savedConversationVersion).toBeDefined();

    await executeDocumentVersionCommand(
      DocumentVersionCommandEnvelopeSchema.parse(
        createEnvelope(
          "versions.restore",
          {
            target: versionTarget,
            versionId: savedConversationVersion!.id,
            expectedCurrentSha256: listRes.current.sha256
          },
          { id: "cmd_ver_restore" }
        )
      ),
      async () => catalog,
      longs,
      service
    );
    const afterRestore = await service.readDocument({
      bookId: created.book.id,
      target: actBodyTarget
    });
    expect(afterRestore.content).toContain("PLAYER_TOKEN_BETA");
    expect(afterRestore.revision).toBe(writtenBody.revision);

    // Duplicate book
    const duplicated = await service.duplicateBook(created.book.id);
    expect(duplicated.book.id).not.toBe(created.book.id);
    expect(duplicated.book.title).not.toBe(renamed.summary.title);
    const dupBody = await service.readDocument({
      bookId: duplicated.book.id,
      target: actBodyTarget
    });
    expect(dupBody.content).toContain("PLAYER_TOKEN_BETA");
  });

  it("supports flat cross-type material and skill bindings and book-image resolution", async () => {
    const userDataPath = await makeTempDir("deepwrite-mystery-lib-user-");
    const booksParent = await makeTempDir("deepwrite-mystery-lib-books-");
    const catalog = new FolderCatalogStore({ userDataPath });
    await catalog.snapshot();
    const longs = new LongWorkspaceService({ userDataPath });
    const service = new MysteryWorkspaceService({ userDataPath });

    const charMat = (
      await catalog.createLibrary({
        parentDirectory: booksParent,
        domain: "material",
        name: "人物卡设定素材",
        materialKind: "character"
      })
    ).resource;
    const plotMat = (
      await catalog.createLibrary({
        parentDirectory: booksParent,
        domain: "material",
        name: "诡计结构参考",
        materialKind: "plot"
      })
    ).resource;
    const charEntry = await catalog.createLibraryEntry({
      domain: "material",
      libraryId: charMat.id,
      stageId: "character",
      title: "孤岛管家",
      content: "雪夜孤灯下的钟摆停在零点十三分。"
    });
    const plotEntry = await catalog.createLibraryEntry({
      domain: "material",
      libraryId: plotMat.id,
      stageId: "plot_refine",
      title: "钟楼密室",
      content: "二楼东侧书房有一道旋转书架密门。"
    });
    const customSkill = (
      await catalog.createLibrary({
        parentDirectory: booksParent,
        domain: "skill",
        name: "诡计校对技法",
        skillKind: "plot"
      })
    ).resource;

    const book = await service.createAtPath(booksParent, {
      title: "钟楼谜影",
      genre: "情感沉浸",
      linkedMaterialIds: [charMat.id, plotMat.id],
      linkedSkillIds: [customSkill.id]
    });

    const queryService = new MaterialQueryService(catalog, longs, service);
    const catalogResult = await queryService.query({
      scope: {
        bookId: book.book.id,
        bookType: "mystery",
        stageId: "scripts",
        kinds: [...MATERIAL_KINDS]
      },
      mode: "list",
      limit: 32
    });
    expect(catalogResult.entries.map((e) => e.entryId)).toEqual(
      expect.arrayContaining([charEntry.id, plotEntry.id])
    );

    const mgmtService = new LibraryManagementService(catalog, longs, service);
    const mgmtResult = await mgmtService.query({
      scope: {
        bookId: book.book.id,
        bookType: "mystery"
      }
    });
    expect(mgmtResult.libraries.map((l) => l.libraryId)).toEqual(
      expect.arrayContaining([charMat.id, plotMat.id, customSkill.id])
    );

    // Book images write & resolve for mystery book
    const resolver = createBookProjectResolver(
      async () => catalog,
      longs,
      service
    );
    const imageStore = new BookImageStore(resolver);
    const png1x1Base64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";
    const written = await imageStore.write({
      book: { projectType: "mystery", projectId: book.book.id },
      images: [
        {
          baseName: "floorplan",
          ext: "png",
          bytes: png1x1Base64
        }
      ]
    });
    expect(written.images).toHaveLength(1);
    const resolved = await imageStore.resolve(
      { projectType: "mystery", projectId: book.book.id },
      written.images[0]!.path
    );
    expect(resolved.mimeType).toBe("image/png");
    expect(resolved.path.startsWith(book.projectDirectory)).toBe(true);
  });
});
