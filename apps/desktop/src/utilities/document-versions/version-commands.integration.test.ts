import {
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  unlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEnvelope,
  DocumentVersionCommandEnvelopeSchema,
  ListDocumentVersionsResultSchema,
  ReadDocumentVersionResultSchema,
  RestoreDocumentVersionResultSchema,
  type DocumentVersionOrigin,
  type DocumentVersionTarget
} from "@deepwrite/contracts";
import { FolderCatalogStore } from "../folder-catalog-store";
import { LongWorkspaceService } from "../long-workspace-service";
import { withProjectTransactionLock } from "../project-transaction/lock";
import { documentVersionCurrent, DocumentVersionStore } from "./version-store";
import { executeDocumentVersionCommand } from "./version-commands";

const roots: string[] = [];
const origin = {
  sessionId: "session_versions",
  runId: "run_one",
  summary: "修改正文"
};
async function fixture() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "deepwrite-version-commands-"))
  );
  roots.push(root);
  let tick = 0;
  const now = () =>
    new Date(Date.UTC(2026, 10, 11, 10, 0, tick++)).toISOString();
  const catalog = new FolderCatalogStore({
    userDataPath: join(root, "user-data"),
    now
  });
  const longs = new LongWorkspaceService({
    userDataPath: join(root, "user-data"),
    now
  });
  const created = await catalog.createShortBook(
    { title: "版本记录", genre: "其他" },
    root
  );
  const target = {
    workspace: "catalog" as const,
    bookId: created.resource.id,
    documentId: "worldbuilding"
  };
  const versions = new DocumentVersionStore(
    created.projectDirectory,
    target,
    32 * 1024 * 1024,
    now
  );
  const invoke = (
    type: "versions.list" | "versions.read" | "versions.restore",
    payload: unknown
  ) =>
    executeDocumentVersionCommand(
      DocumentVersionCommandEnvelopeSchema.parse(
        createEnvelope(type, payload, { id: "command_versions" })
      ),
      async () => catalog,
      longs
    );
  const list = async (requested: DocumentVersionTarget = target) =>
    ListDocumentVersionsResultSchema.parse(
      await invoke("versions.list", { target: requested })
    );
  const save = async (
    content: string,
    versionOrigin?: DocumentVersionOrigin
  ) => {
    const current = await catalog.readDocument({
      projectId: target.bookId,
      documentId: target.documentId,
      target: "document"
    });
    return catalog.saveDocument({
      bookId: target.bookId,
      documentId: target.documentId,
      content,
      baseProjectRevision: current.projectRevision,
      ...(versionOrigin ? { versionOrigin } : {})
    });
  };
  return {
    root,
    catalog,
    longs,
    created,
    target,
    versions,
    invoke,
    list,
    save
  };
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100
      })
    )
  );
});

describe("Core document version commands and capture", () => {
  it("records catalog proposal writes per run and excludes manual/title-only saves", async () => {
    const { catalog, target, versions, created, save, list } = await fixture();
    await save("手写");
    expect(await list()).toMatchObject({ versions: [] });
    expect(await readdir(created.projectDirectory)).not.toContain("versions");
    await save("第一稿", origin);
    await save("第一稿修订", origin);
    await save("第二稿", { ...origin, runId: "run_two" });
    const listed = await list();
    expect(listed.versions.map(({ seq, kind }) => [seq, kind])).toEqual([
      [3, "conversation"],
      [2, "conversation"],
      [1, "pre_conversation"]
    ]);
    expect((await versions.read(listed.versions[1]!.id)).content).toBe(
      "第一稿修订"
    );
    const current = await catalog.readDocument({
      projectId: target.bookId,
      documentId: target.documentId,
      target: "document"
    });
    await catalog.saveDocument({
      bookId: target.bookId,
      documentId: target.documentId,
      content: "忽略",
      title: current.title,
      preserveCurrentContent: true,
      baseProjectRevision: current.projectRevision,
      versionOrigin: origin
    });
    expect((await list()).versions).toEqual(listed.versions);
  });

  it("restores and restores back, preserving unsaved-to-history manual text", async () => {
    const { target, save, list, invoke } = await fixture();
    await save("手写", undefined);
    await save("智能体", origin);
    await save("后来手写");
    const listed = await list();
    const first = listed.versions.at(-1)!;
    const restored = RestoreDocumentVersionResultSchema.parse(
      await invoke("versions.restore", {
        target,
        versionId: first.id,
        expectedCurrentSha256: listed.current!.sha256
      })
    );
    expect(restored).toMatchObject({
      workspace: "catalog",
      document: { content: "手写" },
      version: { kind: "restore", restoredFromSeq: 1 }
    });
    const refreshed = await list();
    const beforeRestore = refreshed.versions.find(
      ({ reason }) => reason === "restore"
    )!;
    const back = RestoreDocumentVersionResultSchema.parse(
      await invoke("versions.restore", {
        target,
        versionId: beforeRestore.id,
        expectedCurrentSha256: refreshed.current!.sha256
      })
    );
    expect(back).toMatchObject({
      document: { content: "后来手写" },
      version: { seq: 5 }
    });
  });

  it("rejects stale hashes and damaged versions without changing document or index bytes", async () => {
    const { target, versions, save, list, invoke, created } = await fixture();
    await save("甲", origin);
    await save("乙", { ...origin, runId: "run_two" });
    const first = (await list()).versions.at(-1)!;
    const manifest = await readFile(
      join(created.projectDirectory, "deepwrite.json")
    );
    const index = await readFile(join(versions.directory, "index.json"));
    await expect(
      invoke("versions.restore", {
        target,
        versionId: first.id,
        expectedCurrentSha256: "0".repeat(64)
      })
    ).rejects.toMatchObject({ code: "version.conflict" });
    expect(
      await readFile(join(created.projectDirectory, "deepwrite.json"))
    ).toEqual(manifest);
    expect(await readFile(join(versions.directory, "index.json"))).toEqual(
      index
    );
    await unlink(join(versions.directory, `${first.id}.md.gz`));
    await expect(
      invoke("versions.read", { target, versionId: first.id })
    ).rejects.toMatchObject({ code: "version.unavailable" });
    await expect(
      invoke("versions.restore", {
        target,
        versionId: first.id,
        expectedCurrentSha256: documentVersionCurrent("乙").sha256
      })
    ).rejects.toMatchObject({ code: "version.unavailable" });
    expect((await list()).current).toEqual(documentVersionCurrent("乙"));
  });

  it("keeps the saved document on capture failure and repairs missing pre-conversation text on the next write", async () => {
    const { target, versions, save, list } = await fixture();
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    await save("甲", origin);
    await rename(versions.directory, `${versions.directory}-backup`);
    await writeFile(versions.directory, "blocked");
    await expect(
      save("乙", { ...origin, runId: "run_two" })
    ).resolves.toMatchObject({ content: "乙" });
    expect(warning).toHaveBeenCalled();
    await unlink(versions.directory);
    await rename(`${versions.directory}-backup`, versions.directory);
    await save("丙", { ...origin, runId: "run_three" });
    expect(
      (await list()).versions.map(({ kind, sha256 }) => [kind, sha256])
    ).toEqual([
      ["conversation", documentVersionCurrent("丙").sha256],
      ["pre_conversation", documentVersionCurrent("乙").sha256],
      ["conversation", documentVersionCurrent("甲").sha256]
    ]);
    expect(target.workspace).toBe("catalog");
  });

  it("serializes concurrent writes from distinct catalog stores behind the project lock", async () => {
    const { root, target, created, catalog, list } = await fixture();
    const second = new FolderCatalogStore({
      userDataPath: join(root, "user-data")
    });
    let entered!: () => void;
    let release!: () => void;
    const holding = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const lock = withProjectTransactionLock(
      created.projectDirectory,
      async () => {
        entered();
        await gate;
      }
    );
    await holding;
    const firstWrite = catalog.saveDocument({
      bookId: target.bookId,
      documentId: target.documentId,
      content: "甲",
      baseProjectRevision: 0,
      versionOrigin: origin
    });
    const secondWrite = second.saveDocument({
      bookId: target.bookId,
      documentId: target.documentId,
      content: "乙",
      baseProjectRevision: 0,
      versionOrigin: { ...origin, runId: "run_two" }
    });
    release();
    await lock;
    const results = await Promise.allSettled([firstWrite, secondWrite]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1
    );
    expect((await list()).versions.map(({ seq }) => seq)).toEqual([1]);
  });

  it("returns the committed document when recording a restore fails", async () => {
    const { target, save, list, invoke } = await fixture();
    await save("甲", origin);
    await save("乙", { ...origin, runId: "run_two" });
    const first = (await list()).versions.at(-1)!;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(DocumentVersionStore.prototype, "restore").mockRejectedValue(
      new Error("injected history failure")
    );
    const restored = RestoreDocumentVersionResultSchema.parse(
      await invoke("versions.restore", {
        target,
        versionId: first.id,
        expectedCurrentSha256: documentVersionCurrent("乙").sha256
      })
    );
    expect(restored).toMatchObject({
      version: null,
      document: { content: "甲" },
      current: documentVersionCurrent("甲")
    });
  });

  it("recovers corrupt history during a catalog save and preserves history after a book title change", async () => {
    const { catalog, target, versions, save, list } = await fixture();
    await save("甲", origin);
    await writeFile(join(versions.directory, "index.json"), "{");
    await save("乙", { ...origin, runId: "run_two" });
    expect((await list()).versions.map(({ kind }) => kind)).toEqual([
      "conversation",
      "pre_conversation"
    ]);
    expect(
      (await readdir(versions.directory)).some((name) =>
        name.startsWith("index.corrupt-")
      )
    ).toBe(true);
    const current = await catalog.readDocument({
      projectId: target.bookId,
      documentId: target.documentId,
      target: "document"
    });
    const before = (await list()).versions;
    await catalog.updateBook({
      bookId: target.bookId,
      title: "新作品名",
      baseProjectRevision: current.projectRevision
    });
    expect((await list()).versions).toEqual(before);
  });

  it("captures multi-file long writes, full append text, and restores without losing history after rename", async () => {
    const { root, longs, list, invoke } = await fixture();
    const created = await longs.create(root, {
      title: "长篇版本",
      genre: "其他"
    });
    const [body, card] = [
      created.book.workspaceIndex.chapters[0]!.body,
      created.book.workspaceIndex.chapters[0]!.card
    ];
    const updatedAt = "2026-11-11T15:00:00.000Z";
    await longs.applyOperations({
      bookId: created.book.id,
      versionOrigin: origin,
      batch: {
        updatedAt,
        operations: [],
        documentWrites: [body, card].map((file, i) => ({
          proposalId: `proposal_versions_${i}`,
          fileId: file.id,
          mode: "replace",
          content: i ? "章纲" : "正文",
          updatedAt,
          reason: "修改"
        }))
      }
    });
    const target = {
      workspace: "long" as const,
      bookId: created.book.id,
      fileId: body.id
    };
    expect((await list(target)).versions).toHaveLength(1);
    expect((await list({ ...target, fileId: card.id })).versions).toHaveLength(
      1
    );
    await longs.applyOperations({
      bookId: created.book.id,
      versionOrigin: origin,
      batch: {
        updatedAt,
        operations: [],
        documentWrites: [
          {
            proposalId: "proposal_append",
            fileId: body.id,
            mode: "append",
            content: "追加",
            updatedAt,
            reason: "追加"
          }
        ]
      }
    });
    const only = (await list(target)).versions[0]!;
    expect(
      ReadDocumentVersionResultSchema.parse(
        await invoke("versions.read", { target, versionId: only.id })
      ).content
    ).toBe("正文追加");
    await longs.writeDocument({
      bookId: target.bookId,
      fileId: body.id,
      content: "手写"
    });
    await longs.renameBook({ bookId: target.bookId, title: "重命名长篇" });
    const restored = RestoreDocumentVersionResultSchema.parse(
      await invoke("versions.restore", {
        target,
        versionId: only.id,
        expectedCurrentSha256: documentVersionCurrent("手写").sha256
      })
    );
    expect(restored).toMatchObject({
      workspace: "long",
      version: { seq: 3, kind: "restore" }
    });
    expect(
      (
        await longs.readDocument({
          bookId: target.bookId,
          fileId: body.id,
          offset: 0,
          maxCharacters: 1000
        })
      ).content
    ).toBe("正文追加");
    expect((await list(target)).versions).toHaveLength(3);
  });
});
