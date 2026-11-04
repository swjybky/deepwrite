import {
  createDefaultGeneralSettings,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import { mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";
import {
  FolderCatalogConflictError,
  FolderCatalogStore
} from "../../utilities/folder-catalog-store";
import { LongDocumentConflictError } from "../../utilities/long-project-store/types";
import { LongWorkspaceService } from "../../utilities/long-workspace-service";
import { AgentTeamConfigStore } from "../../main/agent-team-config-store";
import type { ExternalWindowRequest } from "@deepwrite/contracts/external-control";
import { createExternalControl } from "./index";
import {
  callExternalControlTool,
  type ExternalControlAppState
} from "./tool-routes";
import { createTrashStore } from "./trash-store";

interface Mutation {
  id: string;
  title?: string;
  revision?: string;
  trashId?: string;
}
interface Page {
  content: string;
  revision: string;
  title: string;
}
interface Detail {
  id: string;
  title: string;
  documents: { id: string; title: string; group: string }[];
}

describe("external write tools against real stores", () => {
  let root: string;
  let store: FolderCatalogStore;
  let long: LongWorkspaceService;
  let teams: AgentTeamConfigStore;
  let state: ExternalControlAppState;
  let bookId: string;
  let bodyId: string;
  let longId: string;
  let libraryId: string;
  let otherLibraryId: string;
  let activeRuns = 0;
  const broadcast = vi.fn();
  const windowRequest = vi.fn(
    async (_request: ExternalWindowRequest): Promise<unknown> => ({
      dirty: false
    })
  );
  let trash: ReturnType<typeof createTrashStore>;

  const call = <T = Mutation>(name: string, args: Record<string, unknown>) =>
    callExternalControlTool(state, name, args, {
      trash,
      client: { name: "test-client" }
    }) as Promise<T>;

  const firstText = (work: Detail) => {
    const document = work.documents.find(({ group }) => group !== "draft");
    if (!document) throw new Error("no document");
    return document;
  };

  async function run(command: CommandEnvelope): Promise<unknown> {
    const parent = join(root, "projects");
    switch (command.type) {
      case "catalog.index":
        return store.indexSnapshot();
      case "catalog.readDocument":
        return store.readDocument(command.payload);
      case "catalog.saveDocument":
        return store.saveDocument(command.payload);
      case "catalog.createDraftSection":
        return store.createDraftSection(command.payload);
      case "catalog.deleteDraftSection":
        return store.deleteDraftSection(command.payload);
      case "catalog.moveDraftSection":
        return store.moveDraftSection(command.payload);
      case "catalog.saveLibraryEntry":
        return store.saveLibraryEntry(command.payload);
      case "catalog.createLibraryEntry":
        return store.createLibraryEntry(command.payload);
      case "catalog.removeLibraryEntry":
        return store.removeLibraryEntry(command.payload);
      case "catalog.moveLibraryEntry":
        return store.moveLibraryEntry(command.payload);
      case "catalog.createShortBook":
        return store.createShortBook(command.payload, parent);
      case "catalog.updateBook":
        return store.updateBook(command.payload);
      case "catalog.updateLibrary":
        return store.updateLibrary(command.payload);
      case "catalog.createLibrary":
        return store.createLibrary({
          ...command.payload,
          parentDirectory: parent
        });
      case "catalog.duplicateProject":
        return store.duplicateProject(command.payload);
      case "catalog.unregisterProject":
        return store.unregisterProject(command.payload);
      case "catalog.openProjectAtPath": {
        const { domain, projectDirectory } = command.payload;
        const opened = await (domain === "book"
          ? store.openBookProject(projectDirectory)
          : domain === "material"
            ? store.openMaterialProject(projectDirectory)
            : store.openSkillProject(projectDirectory));
        return {
          domain,
          id: opened.resource.id,
          title: opened.resource.title
        };
      }
      case "externalControl.locateProject":
        return {
          projectDirectory:
            command.payload.source === "long"
              ? await long.resolveProjectDirectory(command.payload.projectId)
              : await store.projectDirectory(command.payload.projectId)
        };
      case "long.list":
        return long.list();
      case "long.getWorkspaceIndex":
        return long.getWorkspaceIndex(command.payload);
      case "long.readDocument":
        return long.readDocument(command.payload);
      case "long.writeDocument":
        return long.writeDocument(command.payload);
      case "long.createBook":
        return long.create(parent, command.payload);
      case "long.rename":
        return long.renameBook(command.payload);
      case "long.unregister":
        return long.unregister(command.payload);
      case "long.openAtPath":
        return long.openAtPath(command.payload.projectDirectory);
      case "agentTeams.create":
        return teams.create(command.payload);
      case "agentTeams.rename":
        return teams.rename(command.payload);
      case "agentTeams.setEnabled":
        return teams.setEnabled(command.payload);
      case "agentTeams.delete":
        return teams.delete(command.payload);
      case "agentTeams.save":
        return teams.save(command.payload);
      default:
        throw new Error(`unexpected command ${command.type}`);
    }
  }

  async function route(command: CommandEnvelope): Promise<CommandResult> {
    try {
      return {
        status: "accepted",
        requestId: command.id,
        payload: await run(command)
      };
    } catch (error: unknown) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code:
            error instanceof FolderCatalogConflictError
              ? "catalog.conflict"
              : error instanceof LongDocumentConflictError
                ? "long.document_conflict"
                : "core.failed",
          message: error instanceof Error ? error.message : "failed"
        }
      };
    }
  }

  beforeAll(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "deepwrite-write-")));
    const userDataPath = join(root, "user-data");
    store = new FolderCatalogStore({ userDataPath });
    long = new LongWorkspaceService({ userDataPath });
    teams = new AgentTeamConfigStore(userDataPath);
    trash = createTrashStore({ directory: () => join(root, "trash") });
    state = {
      appVersion: "1.0.0",
      platform: "darwin",
      rendererReady: () => true,
      activeRunCount: () => activeRuns,
      generalSettings: () => createDefaultGeneralSettings(),
      core: route,
      command: route,
      broadcastChange: broadcast,
      windowRequest: (request) => windowRequest(request),
      agentTeams: () => teams.list(),
      dataDirectory: () => root
    };
    const projects = join(root, "projects");
    const book = await store.createShortBook(
      { title: "雾港来信", genre: "悬疑" },
      projects
    );
    bookId = book.resource.id;
    const section = await store.createDraftSection({ bookId, title: "目标节" });
    bodyId = section.body.id;
    await store.saveDocument({
      bookId,
      documentId: bodyId,
      content: "原始正文"
    });
    longId = (await long.create(projects, { title: "长夜行", genre: "科幻" }))
      .book.id;
    const material = await store.createLibrary({
      domain: "material",
      name: "人物素材",
      materialKind: "character",
      parentDirectory: projects
    });
    libraryId = material.resource.id;
    const other = await store.createLibrary({
      domain: "material",
      name: "备用素材",
      materialKind: "character",
      parentDirectory: projects
    });
    otherLibraryId = other.resource.id;
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });

  beforeEach(() => {
    activeRuns = 0;
    broadcast.mockClear();
  });

  it("writes a document and hands back the next revision", async () => {
    const before = await call<Page>("read_document", {
      workId: bookId,
      documentId: bodyId
    });
    const written = await call("write_document", {
      workId: bookId,
      documentId: bodyId,
      content: "新的正文",
      baseRevision: before.revision
    });
    const after = await call<Page>("read_document", {
      workId: bookId,
      documentId: bodyId
    });
    expect(after.content).toBe("新的正文");
    expect(written.revision).toBe(after.revision);
    expect(broadcast).toHaveBeenCalledWith({
      domain: "work",
      resourceId: bookId
    });
  });

  it("refuses a stale write and leaves the text alone", async () => {
    const stale = await call<Page>("read_document", {
      workId: bookId,
      documentId: bodyId
    });
    await store.saveDocument({
      bookId,
      documentId: bodyId,
      content: "用户刚写的字"
    });
    await expect(
      call("write_document", {
        workId: bookId,
        documentId: bodyId,
        content: "外部覆盖",
        baseRevision: stale.revision
      })
    ).rejects.toMatchObject({ code: "external.stale_revision" });
    const current = await call<Page>("read_document", {
      workId: bookId,
      documentId: bodyId
    });
    expect(current.content).toBe("用户刚写的字");
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("writes long documents only from the revision it read", async () => {
    const work = await call<Detail>("get_work", { workId: longId });
    const documentId = work.documents[0]?.id;
    const before = await call<Page>("read_document", {
      workId: longId,
      documentId
    });
    const written = await call("write_document", {
      workId: longId,
      documentId,
      content: "全书主线",
      baseRevision: before.revision
    });
    await expect(
      call("write_document", {
        workId: longId,
        documentId,
        content: "旧版本的覆盖",
        baseRevision: before.revision
      })
    ).rejects.toMatchObject({ code: "external.stale_revision" });
    const after = await call<Page>("read_document", {
      workId: longId,
      documentId
    });
    expect(after.content).toBe("全书主线");
    expect(after.revision).toBe(written.revision);
  });

  it("changes nothing while an agent is running, but still reads", async () => {
    activeRuns = 1;
    const attempts: [string, Record<string, unknown>][] = [
      [
        "write_document",
        {
          workId: bookId,
          documentId: bodyId,
          content: "x",
          baseRevision: "v1:1:00000000"
        }
      ],
      ["manage_document", { action: "create", workId: bookId }],
      ["manage_work", { action: "rename", workId: bookId, title: "x" }],
      [
        "write_entry",
        { libraryId, entryId: "e", content: "x", baseRevision: "v1:1:0" }
      ],
      ["manage_entry", { action: "create", libraryId, title: "x" }],
      ["manage_library", { action: "rename", libraryId, title: "x" }],
      ["restore_trash_item", { trashId: "x" }]
    ];
    for (const [tool, args] of attempts) {
      await expect(call(tool, args)).rejects.toMatchObject({
        code: "external.busy"
      });
    }
    await expect(
      call("read_document", { workId: bookId, documentId: bodyId })
    ).resolves.toBeDefined();
  });

  it("sets up other books while a run holds only its own resources", async () => {
    activeRuns = 1;
    state.activeResourceIds = () => new Set([bookId]);
    try {
      const created = await call("manage_work", {
        action: "create",
        type: "short",
        genre: "追妻",
        title: "并行新书"
      });
      const copy = await call("manage_work", {
        action: "duplicate",
        workId: created.id
      });
      expect(copy.id).toBeTruthy();
      const detail = await call<Detail>("get_work", { workId: created.id });
      const document = firstText(detail);
      const page = await call<Page>("read_document", {
        workId: created.id,
        documentId: document.id
      });
      await call("write_document", {
        workId: created.id,
        documentId: document.id,
        content: "独立输入",
        baseRevision: page.revision
      });
      await expect(
        call("manage_work", {
          action: "rename",
          workId: bookId,
          title: "禁止覆盖"
        })
      ).rejects.toMatchObject({ code: "external.busy" });
      windowRequest.mockImplementation(async (request) =>
        request.action === "start_run"
          ? {
              runId: `run-${request.target.id}`,
              status: "running",
              reply: "",
              changes: []
            }
          : { dirty: false }
      );
      await expect(
        call("run_agent", { workId: created.id, message: "开始" })
      ).resolves.toMatchObject({ status: "running" });
    } finally {
      delete state.activeResourceIds;
      windowRequest.mockImplementation(async () => ({ dirty: false }));
      activeRuns = 0;
    }
  });

  it("creates, renames and reorders draft sections", async () => {
    const created = await call("manage_document", {
      action: "create",
      workId: bookId,
      title: "新建节"
    });
    await call("manage_document", {
      action: "rename",
      workId: bookId,
      documentId: created.id,
      title: "改名节"
    });
    await call("manage_document", {
      action: "move",
      workId: bookId,
      documentId: created.id,
      direction: "up"
    });
    const work = await call<Detail>("get_work", { workId: bookId });
    const titles = work.documents
      .filter(({ group }) => group === "draft")
      .map(({ title }) => title);
    expect(titles.indexOf("改名节 · 正文")).toBeGreaterThanOrEqual(0);
    expect(titles.indexOf("改名节 · 正文")).toBeLessThan(
      titles.indexOf("目标节 · 正文")
    );
  });

  it("renames a stage document without touching its text", async () => {
    const work = await call<Detail>("get_work", { workId: bookId });
    const documentId = firstText(work).id;
    const before = await call<Page>("read_document", {
      workId: bookId,
      documentId
    });
    await call("manage_document", {
      action: "rename",
      workId: bookId,
      documentId,
      title: "改过的标题"
    });
    const after = await call<Page>("read_document", {
      workId: bookId,
      documentId
    });
    expect(after.title).toBe("改过的标题");
    expect(after.content).toBe(before.content);
  });

  it("only moves, copies and deletes draft sections", async () => {
    const work = await call<Detail>("get_work", { workId: bookId });
    await expect(
      call("manage_document", {
        action: "delete",
        workId: bookId,
        documentId: firstText(work).id
      })
    ).rejects.toMatchObject({ code: "external.invalid_input" });
  });

  it("copies a section with its text", async () => {
    const copy = await call("manage_document", {
      action: "duplicate",
      workId: bookId,
      documentId: bodyId
    });
    const page = await call<Page>("read_document", {
      workId: bookId,
      documentId: copy.id
    });
    expect(page.content).toBe("用户刚写的字");
    expect(copy.title).toBe("目标节 副本");
  });

  it("deletes a section into the trash and restores it", async () => {
    const created = await call("manage_document", {
      action: "create",
      workId: bookId,
      title: "待删节"
    });
    await store.saveDocument({
      bookId,
      documentId: created.id,
      content: "不能丢的正文"
    });
    const deleted = await call("manage_document", {
      action: "delete",
      workId: bookId,
      documentId: created.id
    });
    expect(deleted.trashId).toBeDefined();
    await expect(
      call("read_document", { workId: bookId, documentId: created.id })
    ).rejects.toMatchObject({ code: "external.not_found" });

    const listed = await call<{ items: { trashId: string; title: string }[] }>(
      "list_trash",
      {}
    );
    expect(listed.items[0]).toMatchObject({
      trashId: deleted.trashId,
      title: "待删节"
    });

    const restored = await call("restore_trash_item", {
      trashId: deleted.trashId
    });
    const page = await call<Page>("read_document", {
      workId: bookId,
      documentId: restored.id
    });
    expect(page.content).toBe("不能丢的正文");
    await expect(
      call("restore_trash_item", { trashId: deleted.trashId })
    ).rejects.toMatchObject({ code: "external.not_found" });
  });

  it("keeps no trash record when the delete is refused", async () => {
    const book = await store.createShortBook(
      { title: "单节作品", genre: "悬疑" },
      join(root, "projects")
    );
    const detail = await call<Detail>("get_work", { workId: book.resource.id });
    const draft = detail.documents.filter(({ group }) => group === "draft");
    const bodies = draft.filter(({ id }) => id.endsWith(":body"));
    for (const document of bodies.slice(1)) {
      await call("manage_document", {
        action: "delete",
        workId: book.resource.id,
        documentId: document.id
      });
    }
    const before = (await trash.list()).length;
    await expect(
      call("manage_document", {
        action: "delete",
        workId: book.resource.id,
        documentId: bodies[0]?.id
      })
    ).rejects.toMatchObject({
      code: "external.invalid_input",
      message: expect.stringContaining("至少需要保留") as string
    });
    expect(await trash.list()).toHaveLength(before);
  });

  it("does not support long-form chapter structure", async () => {
    await expect(
      call("manage_document", { action: "create", workId: longId })
    ).rejects.toMatchObject({ code: "external.invalid_input" });
  });

  it("manages a library entry through its whole life", async () => {
    const created = await call("manage_entry", {
      action: "create",
      libraryId,
      title: "守夜人",
      content: "总在灯塔下抽烟。"
    });
    const page = await call<Page>("read_entry", {
      libraryId,
      entryId: created.id
    });
    const written = await call("write_entry", {
      libraryId,
      entryId: created.id,
      content: "改抽旱烟了。",
      baseRevision: page.revision
    });
    await expect(
      call("write_entry", {
        libraryId,
        entryId: created.id,
        content: "过期写入",
        baseRevision: page.revision
      })
    ).rejects.toMatchObject({ code: "external.stale_revision" });
    expect(
      (await call<Page>("read_entry", { libraryId, entryId: created.id }))
        .revision
    ).toBe(written.revision);

    await call("manage_entry", {
      action: "rename",
      libraryId,
      entryId: created.id,
      title: "老守夜人"
    });
    const renamed = await call<Page>("read_entry", {
      libraryId,
      entryId: created.id
    });
    expect(renamed).toMatchObject({
      title: "老守夜人",
      content: "改抽旱烟了。"
    });

    const copy = await call("manage_entry", {
      action: "duplicate",
      libraryId,
      entryId: created.id
    });
    expect(copy.title).toBe("老守夜人 副本");

    await call("manage_entry", {
      action: "move",
      libraryId,
      entryId: created.id,
      targetLibraryId: otherLibraryId,
      stageId: "character"
    });
    expect(
      (
        await call<Page>("read_entry", {
          libraryId: otherLibraryId,
          entryId: created.id
        })
      ).content
    ).toBe("改抽旱烟了。");

    const deleted = await call("manage_entry", {
      action: "delete",
      libraryId,
      entryId: copy.id
    });
    await expect(
      call("read_entry", { libraryId, entryId: copy.id })
    ).rejects.toMatchObject({ code: "external.not_found" });
    const restored = await call("restore_trash_item", {
      trashId: deleted.trashId
    });
    expect(
      (await call<Page>("read_entry", { libraryId, entryId: restored.id }))
        .content
    ).toBe("改抽旱烟了。");
  });

  it("names the allowed genres when a short work's genre is unknown", async () => {
    await expect(
      call("manage_work", {
        action: "create",
        type: "short",
        title: "题材不对",
        genre: "测试"
      })
    ).rejects.toThrow(/世情、追妻、科幻、悬疑、其他/u);
  });

  it("keeps a deleted work's folder and restores it", async () => {
    const created = await call("manage_work", {
      action: "create",
      type: "short",
      title: "待删作品",
      genre: "悬疑"
    });
    const directory = await store.projectDirectory(created.id);
    await call("manage_work", {
      action: "rename",
      workId: created.id,
      title: "改名作品"
    });
    const deleted = await call("manage_work", {
      action: "delete",
      workId: created.id
    });
    expect(deleted.title).toBe("改名作品");
    expect((await stat(directory)).isDirectory()).toBe(true);
    await expect(
      call("get_work", { workId: created.id })
    ).rejects.toMatchObject({ code: "external.not_found" });

    await call("restore_trash_item", { trashId: deleted.trashId });
    await expect(
      call<Detail>("get_work", { workId: created.id })
    ).resolves.toMatchObject({ title: "改名作品" });
  });

  it("restores a long work the same way", async () => {
    const created = await call("manage_work", {
      action: "create",
      type: "long",
      title: "待删长篇",
      genre: "科幻"
    });
    const deleted = await call("manage_work", {
      action: "delete",
      workId: created.id
    });
    await expect(
      call("get_work", { workId: created.id })
    ).rejects.toMatchObject({ code: "external.not_found" });
    await call("restore_trash_item", { trashId: deleted.trashId });
    await expect(
      call<Detail>("get_work", { workId: created.id })
    ).resolves.toMatchObject({ title: "待删长篇" });
  });

  it("explains when a work's folder can no longer be restored", async () => {
    const created = await call("manage_work", {
      action: "create",
      type: "short",
      title: "文件夹被移走",
      genre: "悬疑"
    });
    const directory = await store.projectDirectory(created.id);
    const deleted = await call("manage_work", {
      action: "delete",
      workId: created.id
    });
    await rm(directory, { recursive: true });
    await expect(
      call("restore_trash_item", { trashId: deleted.trashId })
    ).rejects.toMatchObject({ code: "external.not_found" });
    expect(await trash.get(deleted.trashId ?? "")).toBeDefined();
  });

  it("creates, copies, renames and restores a library", async () => {
    const created = await call("manage_library", {
      action: "create",
      domain: "skill",
      title: "写作技能",
      kind: "general"
    });
    await call("manage_library", {
      action: "rename",
      libraryId: created.id,
      title: "新技能"
    });
    const copy = await call("manage_library", {
      action: "duplicate",
      libraryId: created.id
    });
    expect(copy.id).not.toBe(created.id);
    const deleted = await call("manage_library", {
      action: "delete",
      libraryId: created.id
    });
    expect(deleted.title).toBe("新技能");
    await call("restore_trash_item", { trashId: deleted.trashId });
    await expect(
      call("get_library", { libraryId: created.id })
    ).resolves.toMatchObject({ title: "新技能" });
  });

  describe("agent teams", () => {
    interface TeamDetail {
      team: { settings: Record<string, unknown>; revision: string };
    }
    const detail = (teamId: string | undefined) =>
      call<TeamDetail>("list_agent_teams", { teamId });
    const newTeam = (name: string) =>
      call("manage_agent_team", { action: "create", type: "short", name });

    it("creates a team and saves settings from its revision", async () => {
      const created = await newTeam("外部团队");
      const { team } = await detail(created.id);
      const saved = await call("save_agent_team", {
        teamId: created.id,
        settings: { ...team.settings, parallelSubagents: true },
        baseRevision: team.revision
      });
      const after = await detail(created.id);
      expect(after.team.settings).toMatchObject({ parallelSubagents: true });
      expect(saved.revision).toBe(after.team.revision);
      expect(broadcast).toHaveBeenCalledWith({
        domain: "agent_team",
        resourceId: created.id
      });
    });

    it("refuses a save from an old revision", async () => {
      const created = await newTeam("过期团队");
      const { team } = await detail(created.id);
      await teams.save({
        teamId: created.id ?? "",
        settings: { ...team.settings, parallelSubagents: true }
      } as never);
      await expect(
        call("save_agent_team", {
          teamId: created.id,
          settings: team.settings,
          baseRevision: team.revision
        })
      ).rejects.toMatchObject({ code: "external.stale_revision" });
      expect((await detail(created.id)).team.settings).toMatchObject({
        parallelSubagents: true
      });
    });

    it("names the field that makes settings invalid", async () => {
      const created = await newTeam("错误配置");
      const { team } = await detail(created.id);
      await expect(
        call("save_agent_team", {
          teamId: created.id,
          settings: { ...team.settings, parallelSubagents: "yes" },
          baseRevision: team.revision
        })
      ).rejects.toMatchObject({
        code: "external.invalid_input",
        message: expect.stringContaining("parallelSubagents") as string
      });
    });

    it("renames and keeps one team enabled per type", async () => {
      const first = await newTeam("启用甲");
      const second = await newTeam("启用乙");
      await call("manage_agent_team", {
        action: "rename",
        teamId: first.id,
        name: "启用丙"
      });
      await call("manage_agent_team", { action: "enable", teamId: first.id });
      await call("manage_agent_team", { action: "enable", teamId: second.id });
      const { teams: listed } = await call<{
        teams: { id: string; name: string; enabled: boolean }[];
      }>("list_agent_teams", {});
      expect(listed.find(({ id }) => id === first.id)).toMatchObject({
        name: "启用丙",
        enabled: false
      });
      expect(listed.find(({ id }) => id === second.id)?.enabled).toBe(true);
      await call("manage_agent_team", { action: "disable", teamId: second.id });
    });

    it("refuses to delete an enabled team and keeps no copy", async () => {
      const created = await newTeam("启用中");
      await call("manage_agent_team", { action: "enable", teamId: created.id });
      const before = (await trash.list()).length;
      await expect(
        call("manage_agent_team", { action: "delete", teamId: created.id })
      ).rejects.toMatchObject({
        code: "external.invalid_input",
        message: expect.stringContaining("不能删除") as string
      });
      expect(await trash.list()).toHaveLength(before);
      await call("manage_agent_team", {
        action: "disable",
        teamId: created.id
      });
    });

    it("deletes into the trash and restores the settings", async () => {
      const created = await newTeam("待删团队");
      const { team } = await detail(created.id);
      await call("save_agent_team", {
        teamId: created.id,
        settings: { ...team.settings, parallelSubagents: true },
        baseRevision: team.revision
      });
      const deleted = await call("manage_agent_team", {
        action: "delete",
        teamId: created.id
      });
      await expect(detail(created.id)).rejects.toMatchObject({
        code: "external.not_found"
      });
      await newTeam("待删团队");
      const restored = await call("restore_trash_item", {
        trashId: deleted.trashId
      });
      expect(restored.title).toBe("待删团队 恢复");
      expect((await detail(restored.id)).team.settings).toMatchObject({
        parallelSubagents: true
      });
    });

    it("waits for a running agent", async () => {
      const created = await newTeam("运行中");
      activeRuns = 1;
      await expect(
        call("manage_agent_team", {
          action: "rename",
          teamId: created.id,
          name: "不会改名"
        })
      ).rejects.toMatchObject({ code: "external.busy" });
    });
  });

  it("never turns a trash id into a path", async () => {
    await expect(
      call("restore_trash_item", { trashId: "../../config/general-settings" })
    ).rejects.toMatchObject({ code: "external.not_found" });
  });

  it("names the field an action needs", async () => {
    await expect(
      call("manage_work", { action: "rename", workId: bookId })
    ).rejects.toMatchObject({
      code: "external.invalid_input",
      message: expect.stringContaining("title") as string
    });
  });

  it("purges only expired text and never project records", async () => {
    let now = new Date("2026-01-01T00:00:00.000Z");
    const aging = createTrashStore({
      directory: () => join(root, "aging"),
      now: () => now
    });
    const text = await aging.save({
      kind: "entry",
      title: "旧条目",
      client: "test",
      domain: "material",
      libraryId: "library",
      stageId: "other",
      content: "旧"
    });
    const project = await aging.save({
      kind: "project",
      title: "旧作品",
      client: "test",
      domain: "book",
      projectId: "book",
      projectDirectory: "/example.test/book"
    });
    now = new Date("2026-01-30T00:00:00.000Z");
    await aging.purgeExpired();
    expect(await aging.get(text.id)).toBeDefined();
    now = new Date("2026-02-01T00:00:00.000Z");
    await aging.purgeExpired();
    expect(await aging.get(text.id)).toBeUndefined();
    expect(await aging.get(project.id)).toBeDefined();
  });

  it("audits writes by id and never copies their text", async () => {
    const dataDirectory = join(root, "audited");
    const control = createExternalControl({
      paths: {
        directory: join(dataDirectory, "control"),
        stateFile: join(dataDirectory, "control", "control.json"),
        endpoint: join(dataDirectory, "c.sock")
      },
      app: { ...state, dataDirectory: () => dataDirectory },
      homeDirectory: dataDirectory,
      connection: () => ({ command: "/example.test/DeepWrite", args: [] }),
      sendWindowRequest: vi.fn(),
      confirmClient: () => Promise.resolve(true),
      warn: vi.fn()
    });
    await control
      .call("list_works", {}, { name: "audited-client" })
      .catch(() => undefined);
    const page = await call<Page>("read_document", {
      workId: bookId,
      documentId: bodyId
    });
    await control.call(
      "write_document",
      {
        workId: bookId,
        documentId: bodyId,
        content: "绝不能进日志的正文",
        baseRevision: page.revision
      },
      { name: "audited-client" }
    );
    await control
      .call(
        "write_document",
        {
          workId: bookId,
          documentId: bodyId,
          content: "绝不能进日志的正文",
          baseRevision: "v1:1:00000000"
        },
        { name: "audited-client" }
      )
      .catch(() => undefined);
    const log = await readFile(
      join(dataDirectory, "logs", "external-control.jsonl"),
      "utf8"
    );
    const entries = log
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      client: "audited-client",
      tool: "write_document",
      target: { workId: bookId, documentId: bodyId },
      result: "ok"
    });
    expect(entries[1]).toMatchObject({ result: "external.stale_revision" });
    expect(log).not.toContain("绝不能进日志");
  });
});
