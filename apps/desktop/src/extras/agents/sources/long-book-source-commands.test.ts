import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CommandEnvelopeSchema,
  LongBookAnalysisSavedSourceCatalogSchema,
  LongBookAnalysisSourceSchema,
  LongBookDecompositionJobSchema,
  createEnvelope as envelope,
  type CommandEnvelope
} from "@deepwrite/contracts";
import {
  runLongBookAnalysisSourceOperation,
  withLongBookAnalysisSources
} from "../../../utilities/long-book-analysis-sources";
import { decompositionFixture } from "../../../utilities/long-book-decomposition/test-support";
import { withDecompositionCommands } from "../../../utilities/long-book-decomposition/commands";
import {
  handleLongBookSourceCommands,
  type LongBookAnalysisCommandContext
} from "./long-book-source-commands";
import {
  LONG_BOOK_ANALYSIS_SOURCE_DIRECTORY,
  LongBookAnalysisSourceStore
} from "../../../utilities/long-book-sources/long-book-source-store";

const roots: string[] = [];
vi.setConfig({ testTimeout: 30_000 });
function createEnvelope<const T, K extends string>(type: K, payload: T) {
  return envelope(type, payload, {
    id: "test-command",
    correlationId: "test-command"
  });
}

async function setup() {
  const workspace = await mkdtemp(join(tmpdir(), "long-analysis-delete-"));
  roots.push(workspace);
  const core = withLongBookAnalysisSources(async (command) => ({
    status: "rejected",
    requestId: command.id,
    error: { code: "unused", message: "unused" }
  }));
  const dialog = { showOpenDialog: vi.fn() };
  const context = {
    dialog,
    getMainWindow: () => undefined,
    getWorkspaceDirectory: async () => workspace,
    core
  } as unknown as LongBookAnalysisCommandContext;
  return { workspace, core, dialog, context };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("long analysis source deletion", () => {
  it("removes the selected snapshot, revisions and confirmations while preserving originals and outputs", async () => {
    const { workspace, dialog, context } = await setup();
    const original = join(workspace, "novel.txt");
    const text =
      "第一章 来信\n主角收到完整来信。\n第二章 告别\n主角继续寻找铜铃。";
    await writeFile(original, text);
    dialog.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [original]
    });
    const imported = await handleLongBookSourceCommands(
      context,
      createEnvelope("longBookAnalysis.chooseSource", { kind: "txt" })
    );
    if (imported?.status !== "accepted") throw new Error("Import failed");
    const source = LongBookAnalysisSourceSchema.parse(imported.payload);
    const store = new LongBookAnalysisSourceStore(workspace);
    const edited = await store.saveChapters({
      sourceId: source.id,
      baseRevision: source.revision!,
      chapters: source.chapters.map((chapter) => ({
        ...chapter,
        title: `${chapter.title}（校对）`
      }))
    });
    const confirmation = await store.confirm({
      sourceId: edited.id,
      sourceRevision: edited.revision!,
      fingerprint: edited.fingerprint!,
      range: { start: 1, end: edited.chapters.length }
    });
    await store.save({ ...source, id: "retained_source" });
    const output = join(workspace, "books", "analysis.md");
    await mkdir(join(workspace, "books"));
    await writeFile(output, "已经保存的拆书结果");
    const entry = join(store.directory, source.id);
    await expect(
      stat(join(entry, "revisions", "1.json"))
    ).resolves.toBeDefined();
    await expect(
      stat(join(entry, "revisions", "2.json"))
    ).resolves.toBeDefined();
    await expect(
      stat(join(entry, "confirmations", `${confirmation.id}.json`))
    ).resolves.toBeDefined();

    const command = createEnvelope("longBookAnalysis.deleteSource", {
      sourceId: source.id
    });
    const deleted = await handleLongBookSourceCommands(context, command);
    expect(deleted?.status === "accepted" && deleted.payload).toBe(source.id);
    expect((await handleLongBookSourceCommands(context, command))?.status).toBe(
      "accepted"
    );
    await expect(stat(entry)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(original, "utf8")).toBe(text);
    expect(await readFile(output, "utf8")).toBe("已经保存的拆书结果");
    const catalog = await handleLongBookSourceCommands(
      context,
      createEnvelope("longBookAnalysis.listSources", {})
    );
    if (catalog?.status !== "accepted") throw new Error("List failed");
    expect(
      LongBookAnalysisSavedSourceCatalogSchema.parse(
        catalog.payload
      ).sources.map(({ id }) => id)
    ).toEqual(["retained_source"]);
    expect(
      (
        await handleLongBookSourceCommands(
          context,
          createEnvelope("longBookAnalysis.loadSource", { sourceId: source.id })
        )
      )?.status
    ).toBe("rejected");
  });

  it("protects sources referenced by any existing decomposition job until its task record is deleted", async () => {
    const fixture = await decompositionFixture("continuation");
    roots.push(fixture.root);
    const core = withLongBookAnalysisSources(async (command) => ({
      status: "rejected",
      requestId: command.id,
      error: { code: "unused", message: "unused" }
    }));
    const command = createEnvelope("longBookAnalysis.coreSource", {
      workspaceDirectory: fixture.root,
      operation: "delete",
      sourceId: fixture.source.id
    });
    for (const status of ["idle", "stopped", "failed", "completed"] as const) {
      await fixture.service.state.save({ ...fixture.job, status });
      const blocked = await core(command);
      expect(blocked.status).toBe("rejected");
      if (blocked.status !== "rejected")
        throw new Error("Deletion was allowed");
      expect(blocked.error.message).toContain("请先删除对应任务记录");
      await expect(
        fixture.sources.load(fixture.source.id)
      ).resolves.toBeDefined();
    }
    const target = fixture.job.target;
    if (target?.kind !== "long") throw new Error("Long target missing");
    await fixture.service.control({ jobId: fixture.job.id, action: "delete" });
    const deleted = await core(command);
    expect(deleted.status === "accepted" && deleted.payload).toBe(
      fixture.source.id
    );
    await expect(
      fixture.longs.open({ bookId: target.bookId })
    ).resolves.toBeDefined();
  });

  it("rejects unsafe identifiers and symlinked source directories without touching their targets", async () => {
    const { workspace, core } = await setup();
    for (const sourceId of ["../outside", "/outside", "", "book/1"]) {
      expect(
        CommandEnvelopeSchema.safeParse(
          createEnvelope("longBookAnalysis.deleteSource", { sourceId })
        ).success
      ).toBe(false);
      expect(
        (
          await core(
            createEnvelope("longBookAnalysis.coreSource", {
              workspaceDirectory: workspace,
              operation: "delete",
              sourceId
            }) as CommandEnvelope
          )
        ).status
      ).toBe("rejected");
    }
    const external = await mkdtemp(join(tmpdir(), "long-analysis-external-"));
    roots.push(external);
    const retained = join(external, "retained.txt");
    await writeFile(retained, "外部正文");
    const directory = join(workspace, LONG_BOOK_ANALYSIS_SOURCE_DIRECTORY);
    await symlink(external, directory);
    const command = createEnvelope("longBookAnalysis.coreSource", {
      workspaceDirectory: workspace,
      operation: "delete",
      sourceId: "retained_source"
    });
    expect((await core(command)).status).toBe("rejected");
    await rm(directory);
    await mkdir(directory);
    await symlink(external, join(directory, "retained_source"));
    expect((await core(command)).status).toBe("rejected");
    expect(await readFile(retained, "utf8")).toBe("外部正文");
  });

  it("waits for actual Core decomposition creation before checking whether a source can be deleted", async () => {
    const fixture = await decompositionFixture("continuation");
    roots.push(fixture.root);
    await fixture.service.state.remove(fixture.job.id);
    const core = withDecompositionCommands(
      fixture.userDataPath,
      async () => fixture.catalog,
      fixture.longs,
      withLongBookAnalysisSources(async (command) => ({
        status: "rejected",
        requestId: command.id,
        error: { code: "unused", message: "unused" }
      }))
    );
    let release!: () => void;
    let started!: () => void;
    const reading = new Promise<void>((resolve) => {
      started = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const load = LongBookAnalysisSourceStore.prototype.load;
    let held = false;
    vi.spyOn(LongBookAnalysisSourceStore.prototype, "load").mockImplementation(
      async function (this: LongBookAnalysisSourceStore, sourceId, revision) {
        if (sourceId === fixture.source.id && !held) {
          held = true;
          started();
          await waiting;
        }
        return load.call(this, sourceId, revision);
      }
    );
    const job = LongBookDecompositionJobSchema.parse({
      ...fixture.job,
      id: "ldjob_creation_queue",
      target: undefined,
      phase: "prepare_target",
      status: "idle",
      units: {}
    });
    const creation = core(
      createEnvelope("longBookDecomposition.coreCreate", {
        workspaceDirectory: fixture.root,
        job,
        paths: {
          book: join(fixture.root, "books"),
          materials: join(fixture.root, "materials"),
          groups: join(fixture.root, "groups")
        }
      })
    );
    await reading;
    let deleted = false;
    const deletion = core(
      createEnvelope("longBookAnalysis.coreSource", {
        workspaceDirectory: fixture.root,
        operation: "delete",
        sourceId: fixture.source.id
      })
    ).then((result) => {
      deleted = true;
      return result;
    });
    await Promise.resolve();
    expect(deleted).toBe(false);
    await expect(
      load.call(fixture.sources, fixture.source.id)
    ).resolves.toBeDefined();
    release();
    expect((await creation).status).toBe("accepted");
    const result = await deletion;
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") throw new Error("Deletion was allowed");
    expect(result.error.message).toContain("请先删除对应任务记录");
    await expect(
      fixture.sources.load(fixture.source.id)
    ).resolves.toBeDefined();
  });

  it("serializes deletion with source access and continues after a failed operation", async () => {
    const { workspace, core } = await setup();
    const store = new LongBookAnalysisSourceStore(workspace);
    await store.save({
      id: "locked_source",
      kind: "txt",
      name: "合成长篇.txt",
      chapters: [
        {
          id: "chapter_1",
          order: 1,
          title: "第一章",
          sourceName: "合成长篇.txt",
          text: "合成正文",
          charCount: 4
        }
      ],
      diagnostics: []
    });
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const held = runLongBookAnalysisSourceOperation(workspace, () => waiting);
    let completed = false;
    const deletion = core(
      createEnvelope("longBookAnalysis.coreSource", {
        workspaceDirectory: workspace,
        operation: "delete",
        sourceId: "locked_source"
      })
    ).then((result) => {
      completed = true;
      return result;
    });
    await Promise.resolve();
    expect(completed).toBe(false);
    await expect(store.load("locked_source")).resolves.toBeDefined();
    release();
    await held;
    expect((await deletion).status).toBe("accepted");
    await expect(
      runLongBookAnalysisSourceOperation(workspace, async () => {
        throw new Error("operation failed");
      })
    ).rejects.toThrow("operation failed");
    expect(
      (
        await core(
          createEnvelope("longBookAnalysis.coreSource", {
            workspaceDirectory: workspace,
            operation: "list"
          })
        )
      ).status
    ).toBe("accepted");
  });
});
