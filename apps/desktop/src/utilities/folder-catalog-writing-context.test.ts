import { mkdtemp, readFile, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  WritingIndexSchema,
  WritingFileSchema,
  createShortWorkspaceContentRevision,
  DEFAULT_SCRIPT_WRITING_CONTEXT,
  DEFAULT_SHORT_WRITING_CONTEXT,
  WRITING_CONTEXT_MAX_CHARACTERS
} from "@deepwrite/contracts";
import { FolderCatalogStore } from "./folder-catalog-store";

const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "deepwrite-writing-context-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("FolderCatalogStore writing context", () => {
  it.each(["short", "script"] as const)(
    "reads only the registered %s work and its latest saved State file",
    async (bookType) => {
      const root = await temporaryRoot();
      const store = new FolderCatalogStore({
        userDataPath: join(root, "user-data")
      });
      const book = await (bookType === "short"
        ? store.createShortBook(
            { title: "测试", genre: "其他" },
            join(root, "books")
          )
        : store.createScriptBook(
            { title: "测试", genre: "其他" },
            join(root, "books")
          ));
      const scope = { bookType, bookId: book.resource.id };
      const read = (query: import("@deepwrite/contracts").WritingReadQuery) =>
        store.readWritingWorkspace({ ...scope, query }, "run-test");
      const index = WritingIndexSchema.parse(await read({ mode: "index" }));
      const documentId = index.sections[0]!.characterState.id;
      const disabledStage = book.resource.plotStages.find(
        (stage) => !stage.enabled
      )!;
      await expect(
        read({ mode: "file", documentId: disabledStage.id })
      ).rejects.toThrow();
      expect(
        index.plotStages.some((stage) => stage.id === disabledStage.id)
      ).toBe(false);
      await expect(
        read({ mode: "file", documentId: "../other.md" })
      ).rejects.toThrow();
      await expect(
        store.readWritingWorkspace(
          {
            ...scope,
            bookType: bookType === "short" ? "script" : "short",
            query: { mode: "index" }
          },
          "run-test"
        )
      ).rejects.toThrow();
      const before = WritingFileSchema.parse(
        await read({ mode: "file", documentId })
      );
      await store.saveDocument({
        bookId: scope.bookId,
        documentId,
        content: "情感 转变",
        baseRevision: before.revision,
        baseProjectRevision: 0
      });
      const slice = WritingFileSchema.parse(
        await read({ mode: "file", documentId, offset: 3, limit: 2 })
      );
      expect(slice).toMatchObject({
        content: "转变",
        length: 5,
        characters: 4,
        revision: createShortWorkspaceContentRevision("情感 转变")
      });
      const directory = WritingIndexSchema.parse(
        await read({ mode: "index", counts: "draft" })
      );
      expect(directory.counts).toContainEqual({
        id: documentId,
        length: 5,
        characters: 4,
        revision: slice.revision
      });
      expect(JSON.stringify(directory)).not.toContain("情感 转变");
    }
  );

  it("initializes distinct AGENTS.md defaults for new short and script books", async () => {
    const root = await temporaryRoot();
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data")
    });
    const short = await store.createShortBook(
      { title: "短篇测试", genre: "悬疑" },
      join(root, "books")
    );
    const script = await store.createScriptBook(
      { title: "剧本测试", genre: "其他" },
      join(root, "books")
    );

    await expect(
      readFile(join(short.projectDirectory, "AGENTS.md"), "utf8")
    ).resolves.toBe(DEFAULT_SHORT_WRITING_CONTEXT);
    await expect(
      readFile(join(script.projectDirectory, "AGENTS.md"), "utf8")
    ).resolves.toBe(DEFAULT_SCRIPT_WRITING_CONTEXT);
    await expect(
      store.readWritingContext({ bookId: short.resource.id })
    ).resolves.toMatchObject({
      workspaceType: "short",
      content: DEFAULT_SHORT_WRITING_CONTEXT,
      truncated: false
    });
    await expect(
      store.readWritingContext({ bookId: script.resource.id })
    ).resolves.toMatchObject({
      workspaceType: "script",
      content: DEFAULT_SCRIPT_WRITING_CONTEXT,
      truncated: false
    });
  });

  it("saves custom context and lazily repairs a missing legacy file", async () => {
    const root = await temporaryRoot();
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data")
    });
    const book = await store.createShortBook(
      { title: "旧短篇", genre: "其他" },
      join(root, "books")
    );
    const custom = "# 我的短篇上下文\n\n结尾必须回收开场意象。\n";

    await expect(
      store.writeWritingContext({ bookId: book.resource.id, content: custom })
    ).resolves.toMatchObject({ workspaceType: "short" });
    await expect(
      store.readWritingContext({ bookId: book.resource.id })
    ).resolves.toMatchObject({ content: custom });

    await unlink(join(book.projectDirectory, "AGENTS.md"));
    await expect(
      store.readWritingContext({ bookId: book.resource.id })
    ).resolves.toMatchObject({ content: DEFAULT_SHORT_WRITING_CONTEXT });
    await expect(
      readFile(join(book.projectDirectory, "AGENTS.md"), "utf8")
    ).resolves.toBe(DEFAULT_SHORT_WRITING_CONTEXT);
  });

  it("rejects writes above the code-point limit", async () => {
    const root = await temporaryRoot();
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data")
    });
    const book = await store.createScriptBook(
      { title: "超限剧本", genre: "其他" },
      join(root, "books")
    );
    await expect(
      store.writeWritingContext({
        bookId: book.resource.id,
        content: "界".repeat(WRITING_CONTEXT_MAX_CHARACTERS + 1)
      })
    ).rejects.toThrow();
  });

  it("copies customized context with a duplicated book", async () => {
    const root = await temporaryRoot();
    const store = new FolderCatalogStore({
      userDataPath: join(root, "user-data")
    });
    const source = await store.createScriptBook(
      { title: "原剧本", genre: "其他" },
      join(root, "books")
    );
    const custom = "# 剧本上下文\n\n每集结尾留下一个可见行动悬念。\n";
    await store.writeWritingContext({
      bookId: source.resource.id,
      content: custom
    });
    const copy = await store.duplicateProject({
      domain: "book",
      projectId: source.resource.id
    });
    await expect(
      store.readWritingContext({ bookId: copy.projectId })
    ).resolves.toMatchObject({ workspaceType: "script", content: custom });
  });
});
