import type {
  CreateLongBookInput,
  LongBook,
  LongBookSummary
} from "@deepwrite/contracts";
import {
  lstat,
  link,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  utimes,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LONG_PROJECT_CATALOG_MAX_SUMMARY_BYTES,
  LongProjectCatalog,
  type LongProjectCatalogOptions,
  type LongProjectAccess,
  type OpenLongProject
} from "./long-project-catalog";

const now = "2026-07-26T10:00:00.000Z";

function fakeOpened(
  projectDirectory: string,
  id = "longbook_catalog"
): OpenLongProject {
  const index = {
    schemaVersion: 1 as const,
    bookId: id,
    updatedAt: now,
    bookLine: {
      id: "file_long-book-line",
      path: "long/plot/book-line.md",
      updatedAt: now
    },
    featureSettings: {
      worldbuildingItemLayout: "top-tabs" as const,
      characterAndContinuityItemLayout: "top-tabs" as const,
      plotItemLayout: "top-tabs" as const
    },
    worldbuilding: [],
    characterTypes: [{ id: "protagonist" as const, title: "主角", order: 1 }],
    characters: [],
    characterFiles: [],
    plot: {
      volumes: [
        { id: "volume_default", title: "第一卷", order: 1, summary: "" }
      ],
      arcs: [],
      chapterCards: [],
      storyEvents: [],
      storyPlots: [],
      eventConnections: [],
      narrativePlacements: [],
      foreshadowing: []
    },
    chapters: [],
    ledger: {
      committedThroughChapterId: null,
      commits: [],
      projection: {
        throughCommitId: null,
        facts: [],
        knowledge: [],
        openLoops: [],
        latestHandoff: null
      }
    }
  };
  const common = {
    schemaVersion: 1 as const,
    id,
    title: "长篇测试",
    bookType: "long" as const,
    genre: "悬疑",
    status: "editing" as const,
    linkedMaterialIdsByKind: {
      character: [],
      gimmick: [],
      plot: [],
      draft: [],
      other: []
    },
    linkedSkillIdsByKind: {
      general: [],
      plot: [],
      style: [],
      other: []
    },
    createdAt: now,
    updatedAt: now
  };
  const book: LongBook = {
    ...common,
    workspaceIndex: index
  };
  const summary: LongBookSummary = {
    ...common,
    kind: "deepwrite.long-book",
    navigation: {
      schemaVersion: 1,
      bookId: id,
      updatedAt: now,
      counts: {
        worldbuildingCategories: 0,
        characters: 0,
        volumes: 1,
        arcs: 0,
        chapterCards: 0,
        storyEvents: 0,
        storyPlots: 0,
        foreshadowingThreads: 0,
        committedChapters: 0
      },
      worldbuilding: [],
      characterTypes: [{ id: "protagonist", title: "主角", order: 1 }],
      characters: [],
      volumes: [{ id: "volume_default", title: "第一卷", order: 1 }],
      arcs: [],
      chapterCards: [],
      committedThroughChapterId: null
    }
  };
  return { projectDirectory, book, summary };
}

async function createFixture(
  options: {
    removeDirectory?: (path: string) => Promise<void>;
    lockHooks?: LongProjectCatalogOptions["lockHooks"];
  } = {}
) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "deepwrite-long-catalog-"))
  );
  const projectDirectory = join(root, "project");
  await mkdir(projectDirectory);
  let opened = fakeOpened(projectDirectory);
  const projects: LongProjectAccess = {
    async createBook(
      _parent: string,
      _input: CreateLongBookInput
    ): Promise<OpenLongProject> {
      return opened;
    },
    async openBook(directory: string): Promise<OpenLongProject> {
      if (directory !== opened.projectDirectory) {
        const error = new Error("missing") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      }
      return opened;
    },
    async inspectBook(directory: string) {
      const inspected = await this.openBook(directory);
      return {
        bookId: inspected.summary.id,
        updatedAt: inspected.summary.updatedAt
      };
    }
  };
  const catalog = new LongProjectCatalog({
    userDataPath: join(root, "user-data"),
    projects,
    now: () => now,
    ...(options.removeDirectory
      ? { removeDirectory: options.removeDirectory }
      : {}),
    ...(options.lockHooks ? { lockHooks: options.lockHooks } : {})
  });
  return {
    root,
    projectDirectory,
    catalog,
    setOpened(value: OpenLongProject) {
      opened = value;
    }
  };
}

describe("LongProjectCatalog", () => {
  it("registers a created book and lists summaries without chapter bodies", async () => {
    const fixture = await createFixture();
    const created = await fixture.catalog.create(fixture.root, {
      title: "长篇测试",
      genre: "悬疑"
    });
    expect(created.summary.id).toBe("longbook_catalog");
    const listed = await fixture.catalog.list();
    expect(listed.books.map((book) => book.id)).toEqual(["longbook_catalog"]);
    expect(JSON.stringify(listed)).not.toContain("workspaceIndex");
  });

  it("serializes concurrent registrations from separate catalog instances without losing either project", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "deepwrite-long-catalog-concurrent-"))
    );
    const userDataPath = join(root, "user-data");
    const firstDirectory = join(root, "first");
    const secondDirectory = join(root, "second");
    await mkdir(firstDirectory);
    await mkdir(secondDirectory);
    const openedByDirectory = new Map([
      [firstDirectory, fakeOpened(firstDirectory, "longbook_catalog-first")],
      [secondDirectory, fakeOpened(secondDirectory, "longbook_catalog-second")]
    ]);
    const projects: LongProjectAccess = {
      async createBook(parent) {
        return fakeOpened(parent, "longbook_catalog-created");
      },
      async openBook(directory) {
        const opened = openedByDirectory.get(directory);
        if (!opened) throw new Error("missing");
        return opened;
      },
      async inspectBook(directory) {
        const opened = await this.openBook(directory);
        return {
          bookId: opened.summary.id,
          updatedAt: opened.summary.updatedAt
        };
      }
    };
    const firstCatalog = new LongProjectCatalog({
      userDataPath,
      projects,
      now: () => now
    });
    const secondCatalog = new LongProjectCatalog({
      userDataPath,
      projects,
      now: () => now
    });

    await Promise.all([
      firstCatalog.openAtPath(firstDirectory),
      secondCatalog.openAtPath(secondDirectory)
    ]);

    expect(
      (await firstCatalog.list()).books.map(({ id }) => id).sort()
    ).toEqual(["longbook_catalog-first", "longbook_catalog-second"]);
  });

  it("does not steal an old lock while its owner pid is still alive", async () => {
    const fixture = await createFixture();
    const userData = join(fixture.root, "user-data");
    const lockPath = join(userData, "long-project-registry.lock");
    await mkdir(userData, { recursive: true });
    await writeFile(
      lockPath,
      `${JSON.stringify({
        pid: process.pid,
        acquiredAt: "2020-01-01T00:00:00.000Z",
        nonce: "1234abcd"
      })}\n`,
      "utf8"
    );
    const old = new Date(Date.now() - 120_000);
    await utimes(lockPath, old, old);
    let settled = false;
    const listed = fixture.catalog.list().finally(() => {
      settled = true;
    });

    await new Promise<void>((resolveDelay) => {
      setTimeout(resolveDelay, 100);
    });
    expect(settled).toBe(false);
    await rm(lockPath);
    await expect(listed).resolves.toMatchObject({ books: [] });
  });

  it("does not unlink a replacement lock during stale-lock ABA recovery", async () => {
    let lockPath = "";
    let replacementWritten!: () => void;
    const replacementReady = new Promise<void>((resolveReady) => {
      replacementWritten = resolveReady;
    });
    const fixture = await createFixture({
      lockHooks: {
        async beforeStaleUnlink() {
          await rm(lockPath);
          await writeFile(
            lockPath,
            `${JSON.stringify({
              pid: process.pid,
              acquiredAt: new Date().toISOString(),
              nonce: "feedbeef"
            })}\n`,
            "utf8"
          );
          replacementWritten();
        }
      }
    });
    const userData = join(fixture.root, "user-data");
    lockPath = join(userData, "long-project-registry.lock");
    await mkdir(userData, { recursive: true });
    await writeFile(
      lockPath,
      `${JSON.stringify({
        pid: 2_147_483_647,
        acquiredAt: "2020-01-01T00:00:00.000Z",
        nonce: "deadbeef"
      })}\n`,
      "utf8"
    );
    const old = new Date(Date.now() - 120_000);
    await utimes(lockPath, old, old);

    const listed = fixture.catalog.list();
    await replacementReady;
    await new Promise<void>((resolveDelay) => {
      setTimeout(resolveDelay, 60);
    });
    expect(await readFile(lockPath, "utf8")).toContain("feedbeef");
    await rm(lockPath);
    await expect(listed).resolves.toMatchObject({ books: [] });
  });

  it("rejects symlinked and hard-linked registry files", async () => {
    for (const linkKind of ["symbolic", "hard"] as const) {
      const fixture = await createFixture();
      const userData = join(fixture.root, "user-data");
      await mkdir(userData, { recursive: true });
      const target = join(fixture.root, `${linkKind}-registry.json`);
      await writeFile(target, "{}\n", "utf8");
      if (linkKind === "symbolic") {
        await symlink(target, fixture.catalog.registryPath);
      } else {
        await link(target, fixture.catalog.registryPath);
      }

      await expect(fixture.catalog.list()).rejects.toThrow(
        /符号链接|硬链接|安全/u
      );
    }
  });

  it("bounds each cached navigation summary independently", async () => {
    expect(LONG_PROJECT_CATALOG_MAX_SUMMARY_BYTES).toBe(3 * 1024 * 1024);
    const fixture = await createFixture();
    await fixture.catalog.openAtPath(fixture.projectDirectory);
    const oversized = structuredClone(
      fakeOpened(fixture.projectDirectory).summary
    );
    const chapterCount = 5_000;
    oversized.navigation.arcs = [
      {
        id: "arc_catalog-large",
        volumeId: "volume_default",
        title: "主线",
        order: 1
      }
    ];
    oversized.navigation.chapterCards = Array.from(
      { length: chapterCount },
      (_, index) => ({
        id: `chapter_catalog-large-${index + 1}`,
        volumeId: "volume_default",
        primaryArcId: "arc_catalog-large",
        title: `第 ${index + 1} 章 ${"长".repeat(180)}`,
        narrativeOrder: index + 1,
        bodyStatus: "empty" as const
      })
    );
    oversized.navigation.counts = {
      ...oversized.navigation.counts,
      arcs: 1,
      chapterCards: chapterCount
    };

    await expect(
      fixture.catalog.updateSummary(oversized.id, oversized)
    ).resolves.toBeUndefined();
  });

  it("recovers the primary registry from its backup", async () => {
    const fixture = await createFixture();
    await fixture.catalog.openAtPath(fixture.projectDirectory);
    await rename(
      fixture.catalog.registryPath,
      `${fixture.catalog.registryPath}.broken`
    );
    const listed = await fixture.catalog.list();
    expect(listed.books).toHaveLength(1);
    expect(await readFile(fixture.catalog.registryPath, "utf8")).toContain(
      "longbook_catalog"
    );
  });

  it("lists a cached 240-chapter navigation summary without opening the large workspace index", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "deepwrite-long-catalog-scale-"))
    );
    const projectDirectory = join(root, "large-project");
    const userDataPath = join(root, "user-data");
    await mkdir(projectDirectory);
    await mkdir(userDataPath);
    const opened = fakeOpened(projectDirectory, "longbook_catalog-scale");
    const chapterCards = Array.from({ length: 240 }, (_, index) => ({
      id: `chapter_catalog-scale-${index + 1}`,
      volumeId: "volume_default",
      primaryArcId: "arc_catalog-scale",
      title: `第 ${index + 1} 章`,
      narrativeOrder: index + 1,
      bodyStatus: "empty" as const
    }));
    opened.summary.navigation = {
      ...opened.summary.navigation,
      counts: {
        ...opened.summary.navigation.counts,
        arcs: 1,
        chapterCards: chapterCards.length
      },
      arcs: [
        {
          id: "arc_catalog-scale",
          volumeId: "volume_default",
          title: "主线",
          order: 1
        }
      ],
      chapterCards
    };
    let openCalls = 0;
    let inspectCalls = 0;
    const catalog = new LongProjectCatalog({
      userDataPath,
      projects: {
        async createBook() {
          return opened;
        },
        async openBook() {
          openCalls += 1;
          return opened;
        },
        async inspectBook() {
          inspectCalls += 1;
          return {
            bookId: opened.summary.id,
            updatedAt: opened.summary.updatedAt
          };
        }
      },
      now: () => now
    });
    await writeFile(
      catalog.registryPath,
      `${JSON.stringify({
        schemaVersion: 2,
        updatedAt: now,
        projects: [
          {
            bookId: opened.summary.id,
            projectDirectory,
            registeredAt: now,
            summary: opened.summary
          }
        ]
      })}\n`,
      "utf8"
    );

    const listed = await catalog.list();
    expect(listed.books[0]?.navigation.chapterCards).toHaveLength(240);
    expect(inspectCalls).toBe(1);
    expect(openCalls).toBe(0);
  });

  it("hydrates a version-1 path-only registry once and persists its summary", async () => {
    const fixture = await createFixture();
    await mkdir(join(fixture.root, "user-data"), { recursive: true });
    await writeFile(
      fixture.catalog.registryPath,
      `${JSON.stringify({
        schemaVersion: 1,
        revision: 3,
        updatedAt: now,
        projects: [
          {
            bookId: "longbook_catalog",
            projectDirectory: fixture.projectDirectory,
            registeredAt: now
          }
        ]
      })}\n`,
      "utf8"
    );

    await expect(fixture.catalog.list()).resolves.toMatchObject({
      books: [expect.objectContaining({ id: "longbook_catalog" })]
    });
    const migrated = JSON.parse(
      await readFile(fixture.catalog.registryPath, "utf8")
    ) as {
      schemaVersion: number;
      projects: Array<{ summary?: unknown }>;
    };
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.projects[0]?.summary).toBeDefined();
    expect(migrated).not.toHaveProperty("revision");
  });

  it("unregisters without deleting the project folder", async () => {
    const fixture = await createFixture();
    await fixture.catalog.openAtPath(fixture.projectDirectory);
    expect(await fixture.catalog.unregister("longbook_catalog")).toEqual({
      bookId: "longbook_catalog",
      removed: true
    });
    expect((await fixture.catalog.list()).books).toHaveLength(0);
    await expect(
      readFile(join(fixture.projectDirectory, "missing"))
    ).rejects.toBeTruthy();
  });

  it("reports an unavailable registered project without dropping it", async () => {
    const fixture = await createFixture();
    await fixture.catalog.openAtPath(fixture.projectDirectory);
    fixture.setOpened({
      ...fakeOpened(join(fixture.root, "moved")),
      summary: fakeOpened(join(fixture.root, "moved")).summary
    });
    const listed = await fixture.catalog.list();
    expect(listed.books).toHaveLength(0);
    expect(listed.diagnostics?.[0]).toMatchObject({
      bookId: "longbook_catalog",
      code: "unavailable"
    });
  });

  it("reports recursive cleanup failure and completes the persisted deletion during list recovery", async () => {
    let cleanupAttempts = 0;
    const fixture = await createFixture({
      removeDirectory: async (path) => {
        cleanupAttempts += 1;
        if (cleanupAttempts === 1) {
          const error = new Error(
            "simulated cleanup failure"
          ) as NodeJS.ErrnoException;
          error.code = "EACCES";
          throw error;
        }
        await rm(path, { recursive: true, force: false });
      }
    });
    await fixture.catalog.openAtPath(fixture.projectDirectory);

    await expect(fixture.catalog.delete("longbook_catalog")).rejects.toThrow(
      "simulated cleanup failure"
    );
    expect(cleanupAttempts).toBe(1);
    await expect(lstat(fixture.projectDirectory)).rejects.toMatchObject({
      code: "ENOENT"
    });
    const stagedName = (await readdir(fixture.root)).find((name) =>
      name.startsWith(".deepwrite-deleting-long-longbook_catalog-")
    );
    expect(stagedName).toBeDefined();
    const recoveredList = await fixture.catalog.list();
    expect(recoveredList.books).toEqual([]);
    expect(recoveredList.diagnostics).toBeUndefined();
    expect(cleanupAttempts).toBe(2);
    await expect(lstat(join(fixture.root, stagedName!))).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(fixture.catalog.delete("longbook_catalog")).resolves.toEqual({
      bookId: "longbook_catalog",
      removed: false
    });
  });
});
