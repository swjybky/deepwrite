import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEmptyLongMarkdownFileReference,
  createEnvelope,
  DocumentVersionCommandEnvelopeSchema,
  longWorldbuildingItemContentPath,
  longWorldbuildingItemFileId,
  RestoreDocumentVersionResultSchema
} from "@deepwrite/contracts";
import { LongWorkspaceService } from "../long-workspace-service";
import { LongProjectStore } from "../long-project-store";
import * as longIo from "../long-project-store/io";
import { DocumentVersionStore, documentVersionCurrent } from "./version-store";
import { executeDocumentVersionCommand } from "./version-commands";

const roots: string[] = [];
const now = "2026-11-11T10:00:00.000Z";
const origin = {
  sessionId: "session_versions",
  runId: "run_one",
  summary: "修改"
};
async function fixture() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "deepwrite-long-versions-"))
  );
  roots.push(root);
  const longs = new LongWorkspaceService({
    userDataPath: join(root, "user-data"),
    now: () => now
  });
  const created = await longs.create(root, {
    title: "长篇版本",
    genre: "其他"
  });
  const directory = await longs.catalog.resolveProjectDirectory(
    created.book.id
  );
  return { root, longs, created, directory };
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

describe("long document version capture", () => {
  it("captures the actual text overwritten at commit when another store writes after preparation", async () => {
    const { longs, created, directory } = await fixture();
    const body = created.book.workspaceIndex.chapters[0]!.body;
    await longs.writeDocument({
      bookId: created.book.id,
      fileId: body.id,
      content: "准备时的旧稿"
    });
    const other = new LongProjectStore();
    const commit = longIo.commitLongProjectTransaction;
    vi.spyOn(longIo, "commitLongProjectTransaction").mockImplementationOnce(
      async (input, afterCommit, preserve) => {
        await other.writeDocument(directory, {
          fileId: body.id,
          content: "实际被覆盖的手写"
        });
        return commit(input, afterCommit, preserve);
      }
    );
    await longs.applyOperations({
      bookId: created.book.id,
      versionOrigin: origin,
      batch: {
        updatedAt: now,
        operations: [],
        documentWrites: [
          {
            proposalId: "proposal_interleave",
            fileId: body.id,
            mode: "replace",
            content: "智能体修改",
            updatedAt: now,
            reason: "修改"
          }
        ]
      }
    });
    const versions = new DocumentVersionStore(
      directory,
      { workspace: "long", bookId: created.book.id, fileId: body.id },
      16 * 1024 * 1024
    );
    expect((await versions.list()).at(-1)).toMatchObject({
      kind: "pre_conversation",
      ...documentVersionCurrent("实际被覆盖的手写")
    });
    expect(
      (await versions.read((await versions.list()).at(-1)!.id)).content
    ).toBe("实际被覆盖的手写");
  });

  it("records content written in a create proposal as the first version", async () => {
    const { longs, created, directory } = await fixture();
    const category = created.book.workspaceIndex.worldbuilding.find(
      ({ format }) => format === "list"
    )!;
    const itemId = "worlditem_versions";
    const file = createEmptyLongMarkdownFileReference(
      longWorldbuildingItemFileId(itemId),
      longWorldbuildingItemContentPath(category.id, itemId),
      now
    );
    await longs.applyOperations({
      bookId: created.book.id,
      versionOrigin: origin,
      batch: {
        updatedAt: now,
        operations: [
          {
            type: "worldbuildingItem.create",
            categoryId: category.id,
            item: { id: itemId, title: "设定", order: 1, file }
          }
        ],
        documentWrites: [
          {
            proposalId: "proposal_create_versions",
            fileId: file.id,
            mode: "create",
            content: "第一份设定",
            reason: "新建设定",
            updatedAt: now
          }
        ]
      }
    });
    const versions = new DocumentVersionStore(
      directory,
      { workspace: "long", bookId: created.book.id, fileId: file.id },
      16 * 1024 * 1024
    );
    expect(await versions.list()).toMatchObject([
      { seq: 1, kind: "conversation" }
    ]);
    await longs.writeDocument({
      bookId: created.book.id,
      fileId: file.id,
      content: "手动编辑"
    });
    expect(await versions.list()).toHaveLength(1);
  });

  it("keeps long saves successful when version capture fails", async () => {
    const { longs, created, directory } = await fixture();
    const body = created.book.workspaceIndex.chapters[0]!.body;
    const capture = vi
      .spyOn(DocumentVersionStore.prototype, "capture")
      .mockRejectedValueOnce(new Error("injected capture failure"));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const write = (content: string, runId: string) =>
      longs.applyOperations({
        bookId: created.book.id,
        versionOrigin: { ...origin, runId },
        batch: {
          updatedAt: now,
          operations: [],
          documentWrites: [
            {
              proposalId: `proposal_${runId}`,
              fileId: body.id,
              mode: "replace",
              content,
              updatedAt: now,
              reason: "修改"
            }
          ]
        }
      });
    await write("未存入历史", "run_one");
    expect(
      (
        await longs.readDocument({
          bookId: created.book.id,
          fileId: body.id,
          offset: 0,
          maxCharacters: 1000
        })
      ).content
    ).toBe("未存入历史");
    capture.mockRestore();
    await write("下一稿", "run_two");
    const versions = new DocumentVersionStore(
      directory,
      { workspace: "long", bookId: created.book.id, fileId: body.id },
      16 * 1024 * 1024
    );
    expect((await versions.list()).at(-1)).toMatchObject({
      kind: "pre_conversation",
      ...documentVersionCurrent("未存入历史")
    });
  });

  it("refuses stale long restore hashes without writing the document or index", async () => {
    const { longs, created, directory } = await fixture();
    const body = created.book.workspaceIndex.chapters[0]!.body;
    await longs.applyOperations({
      bookId: created.book.id,
      versionOrigin: origin,
      batch: {
        updatedAt: now,
        operations: [],
        documentWrites: [
          {
            proposalId: "proposal_version",
            fileId: body.id,
            mode: "replace",
            content: "甲",
            updatedAt: now,
            reason: "修改"
          }
        ]
      }
    });
    const target = {
      workspace: "long" as const,
      bookId: created.book.id,
      fileId: body.id
    };
    const versions = new DocumentVersionStore(
      directory,
      target,
      16 * 1024 * 1024
    );
    const first = (await versions.list())[0]!;
    await longs.writeDocument({
      bookId: created.book.id,
      fileId: body.id,
      content: "乙"
    });
    const before = await readFile(join(versions.directory, "index.json"));
    const invoke = (hash: string) =>
      executeDocumentVersionCommand(
        DocumentVersionCommandEnvelopeSchema.parse(
          createEnvelope(
            "versions.restore",
            {
              target,
              versionId: first.id,
              expectedCurrentSha256: hash
            },
            { id: "command_restore" }
          )
        ),
        async () => {
          throw new Error("Unexpected catalog access.");
        },
        longs
      );
    await expect(
      invoke(documentVersionCurrent("甲").sha256)
    ).rejects.toMatchObject({ code: "version.conflict" });
    expect(await readFile(join(versions.directory, "index.json"))).toEqual(
      before
    );
    expect(
      (
        await longs.readDocument({
          bookId: created.book.id,
          fileId: body.id,
          offset: 0,
          maxCharacters: 1000
        })
      ).content
    ).toBe("乙");
    expect(
      RestoreDocumentVersionResultSchema.parse(
        await invoke(documentVersionCurrent("乙").sha256)
      )
    ).toMatchObject({ workspace: "long", version: { kind: "restore" } });
  });
});
