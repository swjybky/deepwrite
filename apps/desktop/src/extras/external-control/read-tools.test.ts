import { createDefaultGeneralSettings } from "@deepwrite/contracts";
import type {
  AgentTeamCatalogSnapshot,
  CommandEnvelope,
  CommandResult
} from "@deepwrite/contracts";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FolderCatalogStore } from "../../utilities/folder-catalog-store";
import { LongWorkspaceService } from "../../utilities/long-workspace-service";
import { MysteryWorkspaceService } from "../../utilities/mystery-store";
import type { CoreRequest } from "./core-client";
import { searchText } from "./search-text";
import {
  callExternalControlTool,
  type ExternalControlAppState
} from "./tool-routes";
import { createTrashStore } from "./trash-store";

interface Listing {
  works: { id: string; type: string; title: string }[];
  unavailableWorkIds: string[];
}
interface WorkDetail {
  documents: { id: string; title: string; group: string; bytes?: number }[];
  stages?: { id: string }[];
}
interface Page {
  content: string;
  nextOffset: number | null;
  totalCharacters: number;
  revision?: string;
  title: string;
}
interface Hits {
  hits: { documentId: string; offset: number; snippet: string }[];
  nextCursor: string | null;
}

const teams = {
  enabledTeamIds: { short: "team-a" },
  builtinSubagents: {},
  teams: [
    {
      id: "team-a",
      name: "短篇团队",
      workspaceType: "short",
      settings: { workspaceType: "short", marker: "team-a-settings" }
    },
    {
      id: "team-b",
      name: "长篇团队",
      workspaceType: "long",
      marketplaceSource: {
        teamId: "plaza-1",
        version: 1,
        installedAt: "2026-10-31T00:00:00.000Z"
      },
      settings: { workspaceType: "long" }
    }
  ]
} as unknown as AgentTeamCatalogSnapshot;

describe("external read tools against real stores", () => {
  let root: string;
  let shortId: string;
  let bodyId: string;
  let longId: string;
  let mysteryId: string;
  let materialId: string;
  let materialEntryId: string;
  let skillId: string;
  let state: ExternalControlAppState;
  const core = vi.fn<CoreRequest>();

  const call = <T>(name: string, args: Record<string, unknown> = {}) =>
    callExternalControlTool(state, name, args, {
      trash: createTrashStore({ directory: () => join(root, "trash") }),
      client: { name: "test-client" }
    }) as Promise<T>;

  beforeAll(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "deepwrite-external-")));
    const userDataPath = join(root, "user-data");
    const store = new FolderCatalogStore({ userDataPath });
    const long = new LongWorkspaceService({ userDataPath });
    const mystery = new MysteryWorkspaceService({ userDataPath });
    const books = join(root, "books");

    const short = await store.createShortBook(
      { title: "雾港来信", genre: "悬疑" },
      books
    );
    shortId = short.resource.id;
    const section = await store.createDraftSection({
      bookId: shortId,
      title: "第一节"
    });
    bodyId = section.body.id;
    await store.saveDocument({
      bookId: shortId,
      documentId: bodyId,
      content: `雾港的灯塔熄灭了。\n她在码头等信。${"海".repeat(200)}灯塔再次亮起。`
    });

    const created = await long.create(books, {
      title: "长夜行",
      genre: "科幻"
    });
    longId = created.book.id;

    const mysteryBook = await mystery.createAtPath(books, {
      title: "雾钟山庄",
      genre: "硬核推理",
      boardSpec: {
        playerCount: 4,
        actCountTarget: 2,
        narrativePerson: "second"
      }
    });
    mysteryId = mysteryBook.book.id;
    await mystery.writeDocument({
      bookId: mysteryId,
      target: { kind: "truth_doc", docId: "core_truth" },
      content: `暴风雪山庄的钟声在零点敲响。${"雾".repeat(40)}凶手利用密室钟摆停表制造了不在场证明。`
    });

    const material = await store.createLibrary({
      domain: "material",
      name: "人物素材",
      materialKind: "character",
      parentDirectory: join(root, "libraries")
    });
    materialId = material.resource.id;
    const entry = await store.createLibraryEntry({
      domain: "material",
      libraryId: materialId,
      title: "守夜人",
      content: "守夜人总在灯塔下抽烟。"
    });
    materialEntryId = entry.id;
    const skill = await store.createLibrary({
      domain: "skill",
      name: "写作技能",
      skillKind: "general",
      parentDirectory: join(root, "libraries")
    });
    skillId = skill.resource.id;

    core.mockImplementation(
      async (command: CommandEnvelope): Promise<CommandResult> => {
        try {
          const payload = await run(command);
          return { status: "accepted", requestId: command.id, payload };
        } catch (error: unknown) {
          return {
            status: "rejected",
            requestId: command.id,
            error: {
              code: "core.failed",
              message: error instanceof Error ? error.message : "failed"
            }
          };
        }
      }
    );
    function run(command: CommandEnvelope): Promise<unknown> {
      switch (command.type) {
        case "catalog.index":
          return store.indexSnapshot();
        case "catalog.readDocument":
          return store.readDocument(command.payload);
        case "long.list":
          return long.list();
        case "long.getWorkspaceIndex":
          return long.getWorkspaceIndex(command.payload);
        case "long.readDocument":
          return long.readDocument(command.payload);
        case "long.search":
          return long.search(command.payload);
        case "mystery.list":
          return mystery.list();
        case "mystery.getWorkspaceIndex":
          return mystery.getWorkspaceIndex(command.payload.bookId);
        case "mystery.readDocument":
          return mystery.readDocument(command.payload);
        case "mystery.readAgentsMd":
          return mystery.readAgentsMd(command.payload);
        default:
          throw new Error(`unexpected command ${command.type}`);
      }
    }

    state = {
      appVersion: "1.0.0",
      platform: "darwin",
      rendererReady: () => true,
      activeRunCount: () => 0,
      generalSettings: () => createDefaultGeneralSettings(),
      core,
      command: (command) => core(command, 0),
      broadcastChange: () => undefined,
      windowRequest: () => Promise.resolve({ dirty: false }),
      agentTeams: () => Promise.resolve(teams),
      dataDirectory: () => root
    };
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });

  it("lists every kind of work and filters by type", async () => {
    const all = await call<Listing>("list_works");
    expect(all.works.map(({ title }) => title).sort()).toEqual(
      ["长夜行", "雾港来信", "雾钟山庄"].sort()
    );
    expect(all.unavailableWorkIds).toEqual([]);
    const long = await call<Listing>("list_works", { type: "long" });
    expect(long.works.map(({ id }) => id)).toEqual([longId]);
    const mysteryOnly = await call<Listing>("list_works", { type: "mystery" });
    expect(mysteryOnly.works.map(({ id }) => id)).toEqual([mysteryId]);
  });

  it("describes a short work without its text", async () => {
    const work = await call<WorkDetail>("get_work", { workId: shortId });
    const draft = work.documents
      .filter(({ group }) => group === "draft")
      .map(({ title }) => title);
    expect(draft).toEqual(
      expect.arrayContaining(["第一节 · 正文", "第一节 · 状态"])
    );
    expect(work.stages?.length).toBeGreaterThan(0);
    expect(JSON.stringify(work)).not.toContain("灯塔");
  });

  it("describes a long work through its file list", async () => {
    const work = await call<WorkDetail>("get_work", { workId: longId });
    expect(work.documents.length).toBeGreaterThan(0);
    expect(work.documents[0]).toMatchObject({ title: "全书主线" });
    expect(work.stages).toBeUndefined();
  });

  it("reads a document page by page with its revision", async () => {
    const first = await call<Page>("read_document", {
      workId: shortId,
      documentId: bodyId,
      maxCharacters: 5
    });
    expect(first.content).toBe("雾港的灯塔");
    expect(first.nextOffset).toBe(5);
    expect(first.revision).toMatch(/^v1:/u);
    const rest = await call<Page>("read_document", {
      workId: shortId,
      documentId: bodyId,
      offset: first.nextOffset
    });
    expect(rest.content.endsWith("灯塔再次亮起。")).toBe(true);
    expect(rest.nextOffset).toBeNull();
  });

  it("reads a long document", async () => {
    const work = await call<WorkDetail>("get_work", { workId: longId });
    const chapter = work.documents.find(({ title }) =>
      title.endsWith(" · 正文")
    );
    expect(chapter).toBeDefined();
    const page = await call<Page>("read_document", {
      workId: longId,
      documentId: chapter?.id
    });
    expect(page.title).toBe(chapter?.title);
    expect(page.revision).toBeDefined();
  });

  it("reports unknown ids as not found", async () => {
    await expect(call("get_work", { workId: "missing" })).rejects.toMatchObject(
      { code: "external.not_found" }
    );
    await expect(
      call("read_document", { workId: shortId, documentId: "missing" })
    ).rejects.toMatchObject({ code: "external.not_found" });
    await expect(
      call("read_document", { workId: longId, documentId: "missing" })
    ).rejects.toMatchObject({ code: "external.not_found" });
    await expect(
      call("get_library", { libraryId: "missing" })
    ).rejects.toMatchObject({ code: "external.not_found" });
    await expect(
      call("read_entry", { libraryId: materialId, entryId: "missing" })
    ).rejects.toMatchObject({ code: "external.not_found" });
    await expect(
      call("list_agent_teams", { teamId: "missing" })
    ).rejects.toMatchObject({ code: "external.not_found" });
  });

  it("finds text in a short work with offsets usable by read_document", async () => {
    const result = await call<Hits>("search_text", {
      workId: shortId,
      query: "灯塔"
    });
    expect(result.hits).toHaveLength(2);
    expect(result.nextCursor).toBeNull();
    const hit = result.hits[1];
    const page = await call<Page>("read_document", {
      workId: shortId,
      documentId: hit?.documentId,
      offset: hit?.offset,
      maxCharacters: 2
    });
    expect(page.content).toBe("灯塔");
  });

  it("continues a search from its cursor without repeating hits", async () => {
    const first = await call<Hits>("search_text", {
      workId: shortId,
      query: "灯塔",
      limit: 1
    });
    expect(first.hits).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const second = await call<Hits>("search_text", {
      workId: shortId,
      query: "灯塔",
      limit: 1,
      cursor: first.nextCursor
    });
    expect(second.hits).toHaveLength(1);
    expect(second.hits[0]?.offset).not.toBe(first.hits[0]?.offset);
  });

  it("treats the query as plain text, not a pattern", async () => {
    const result = await call<Hits>("search_text", {
      workId: shortId,
      query: "灯.*塔"
    });
    expect(result.hits).toEqual([]);
  });

  it("searches a library", async () => {
    const result = await call<Hits>("search_text", {
      libraryId: materialId,
      query: "灯塔"
    });
    expect(result.hits).toMatchObject([{ documentId: materialEntryId }]);
  });

  it("searches a long work through its own index", async () => {
    const result = await call<Hits>("search_text", {
      workId: longId,
      query: "绝不会出现的词语"
    });
    expect(result).toMatchObject({ hits: [], nextCursor: null });
  });

  it("needs exactly one search target", async () => {
    await expect(call("search_text", { query: "灯塔" })).rejects.toMatchObject({
      code: "external.invalid_input"
    });
    await expect(
      call("search_text", {
        query: "灯塔",
        workId: shortId,
        libraryId: materialId
      })
    ).rejects.toMatchObject({ code: "external.invalid_input" });
  });

  it("rejects a forged cursor", async () => {
    await expect(
      call("search_text", {
        query: "灯塔",
        workId: shortId,
        cursor: "../../etc"
      })
    ).rejects.toMatchObject({ code: "external.invalid_input" });
  });

  it("stops a long scan and hands back a cursor", async () => {
    let time = 0;
    const result = await searchText(
      core,
      { workId: shortId, query: "灯塔" },
      () => (time += 60_000)
    );
    expect(result.nextCursor).toMatch(/^\d+:0$/u);
  });

  it("lists libraries and groups by domain", async () => {
    const all = await call<{ libraries: { id: string; domain: string }[] }>(
      "list_libraries"
    );
    expect(all.libraries.map(({ id }) => id).sort()).toEqual(
      [materialId, skillId].sort()
    );
    const skills = await call<{ libraries: { id: string }[] }>(
      "list_libraries",
      { domain: "skill" }
    );
    expect(skills.libraries.map(({ id }) => id)).toEqual([skillId]);
  });

  it("describes a library and reads its entry and overview", async () => {
    const library = await call<{
      entries: { id: string; title: string }[];
      domain: string;
    }>("get_library", { libraryId: materialId });
    expect(library.domain).toBe("material");
    expect(library.entries).toMatchObject([
      { id: materialEntryId, title: "守夜人" }
    ]);
    expect(JSON.stringify(library)).not.toContain("抽烟");

    const entry = await call<Page>("read_entry", {
      libraryId: materialId,
      entryId: materialEntryId
    });
    expect(entry.content).toBe("守夜人总在灯塔下抽烟。");

    const overview = await call<Page>("read_entry", { libraryId: materialId });
    expect(overview.title).toBe("人物素材");
  });

  it("lists teams and returns settings only for the requested one", async () => {
    const list = await call<{
      teams: { id: string; enabled: boolean; fromMarketplace: boolean }[];
      team?: unknown;
    }>("list_agent_teams");
    expect(list.teams).toMatchObject([
      { id: "team-a", enabled: true, fromMarketplace: false },
      { id: "team-b", enabled: false, fromMarketplace: true }
    ]);
    expect(list.team).toBeUndefined();

    const long = await call<{ teams: unknown[] }>("list_agent_teams", {
      type: "long"
    });
    expect(long.teams).toHaveLength(1);

    const detail = await call<{ team: { settings: unknown } }>(
      "list_agent_teams",
      { teamId: "team-a" }
    );
    expect(detail.team.settings).toMatchObject({ marker: "team-a-settings" });
  });

  it("describes a mystery work and reads/searches documents without leaking full text", async () => {
    const work = await call<WorkDetail>("get_work", { workId: mysteryId });
    expect(work.stages?.map(({ id }) => id)).toEqual([
      "truth",
      "characters",
      "scripts",
      "clues",
      "dm"
    ]);
    expect(work.documents.some(({ id }) => id === "truth_doc:core_truth")).toBe(
      true
    );
    expect(work.documents.some(({ id }) => id === "dm_manual")).toBe(true);
    expect(JSON.stringify(work)).not.toContain("密室钟摆停表");

    const page = await call<Page>("read_document", {
      workId: mysteryId,
      documentId: "truth_doc:core_truth",
      maxCharacters: 7
    });
    expect(page.content).toBe("暴风雪山庄的钟");
    expect(page.nextOffset).toBe(7);
    expect(page.revision).toMatch(/^v1:/u);

    const hits = await call<Hits>("search_text", {
      workId: mysteryId,
      query: "密室钟摆停表"
    });
    expect(hits.hits).toHaveLength(1);
    expect(hits.hits[0]?.documentId).toBe("truth_doc:core_truth");
    const matched = await call<Page>("read_document", {
      workId: mysteryId,
      documentId: hits.hits[0]?.documentId,
      offset: hits.hits[0]?.offset,
      maxCharacters: 6
    });
    expect(matched.content).toBe("密室钟摆停表");

    await expect(
      call("read_document", { workId: mysteryId, documentId: "missing" })
    ).rejects.toMatchObject({ code: "external.invalid_input" });
  });

  it("exposes no local paths in what it returns", async () => {
    const outputs = await Promise.all([
      call("list_works"),
      call("get_work", { workId: shortId }),
      call("get_work", { workId: longId }),
      call("get_work", { workId: mysteryId }),
      call("list_libraries"),
      call("get_library", { libraryId: materialId })
    ]);
    expect(JSON.stringify(outputs)).not.toContain(root);
  });
});
