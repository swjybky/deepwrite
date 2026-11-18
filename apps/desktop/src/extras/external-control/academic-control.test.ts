import {
  createDefaultGeneralSettings,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import type { ExternalWindowRequest } from "@deepwrite/contracts/external-control";
import { mkdtemp, realpath, rm } from "node:fs/promises";
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
import { AgentTeamConfigStore } from "../../main/agent-team-config-store";
import {
  FolderCatalogConflictError,
  FolderCatalogStore
} from "../../utilities/folder-catalog-store";
import { LongWorkspaceService } from "../../utilities/long-workspace-service";
import {
  callExternalControlTool,
  type ExternalControlAppState
} from "./tool-routes";
import { createTrashStore } from "./trash-store";

interface WorkSummary {
  id: string;
  type: string;
  title: string;
  genre: string;
  subtype?: string;
  citationStyle?: string;
}

interface WorkDetail extends WorkSummary {
  stages?: { id: string; title: string; enabled: boolean }[];
  chapters?: { id: string; title: string; sectionIds: string[] }[];
  documents: { id: string; title: string; group: string; bytes?: number }[];
  linkedMaterialLibraryIds: string[];
  linkedSkillLibraryIds: string[];
}

interface DocumentPage {
  workId: string;
  documentId: string;
  title: string;
  content: string;
  revision: string;
}

interface Mutation {
  id?: string;
  title?: string;
  revision?: string;
  trashId?: string;
}

describe("external control academic works integration", () => {
  let root: string;
  let store: FolderCatalogStore;
  let long: LongWorkspaceService;
  let teams: AgentTeamConfigStore;
  let trash: ReturnType<typeof createTrashStore>;
  let state: ExternalControlAppState;
  let activeRuns = 0;
  let activeIds = new Set<string>();
  const broadcast = vi.fn();
  const windowRequest = vi.fn(
    async (request: ExternalWindowRequest): Promise<unknown> => {
      if (request.action === "open_target") return null;
      if (request.action === "start_run") {
        return {
          runId: "run_acad_1",
          sessionId: "sess_acad_1",
          workId: request.target.id,
          status: "running",
          mode: request.mode ?? "normal",
          reply: "",
          changes: []
        };
      }
      return { dirty: false };
    }
  );

  const call = <T = Mutation>(
    name: string,
    args: Record<string, unknown> = {}
  ) =>
    callExternalControlTool(state, name, args, {
      trash,
      client: { name: "academic-test-client" }
    }) as Promise<T>;

  async function run(command: CommandEnvelope): Promise<unknown> {
    const parent = join(root, "projects");
    switch (command.type) {
      case "catalog.index":
        return store.indexSnapshot();
      case "catalog.readDocument":
        return store.readDocument(command.payload);
      case "catalog.saveDocument":
        return store.saveDocument(command.payload);
      case "catalog.createAcademicBook":
        return (await store.createAcademicBook(command.payload, parent))
          .resource;
      case "catalog.mutateAcademicManuscript":
        return store.mutateAcademicManuscript(command.payload);
      case "catalog.mutateAcademicFramework":
        return store.mutateAcademicFramework(command.payload);
      case "catalog.updateBook":
        return store.updateBook(command.payload);
      case "catalog.duplicateProject":
        return store.duplicateProject(command.payload);
      case "catalog.unregisterProject":
        return store.unregisterProject(command.payload);
      case "catalog.openProjectAtPath": {
        const { domain, projectDirectory } = command.payload;
        const opened = await store.openBookProject(projectDirectory);
        return {
          domain,
          id: opened.resource.id,
          title: opened.resource.title
        };
      }
      case "externalControl.locateProject":
        return {
          projectDirectory: await store.projectDirectory(
            command.payload.projectId
          )
        };
      case "long.list":
        return long.list();
      case "mystery.list":
        return { books: [], diagnostics: [] };
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
              : "core.failed",
          message: error instanceof Error ? error.message : "failed"
        }
      };
    }
  }

  beforeAll(async () => {
    root = await realpath(
      await mkdtemp(join(tmpdir(), "deepwrite-ext-academic-"))
    );
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
      activeResourceIds: () => activeIds,
      generalSettings: () => createDefaultGeneralSettings(),
      core: route,
      command: route,
      broadcastChange: broadcast,
      windowRequest: (req) => windowRequest(req),
      agentTeams: () => teams.list(),
      dataDirectory: () => root
    };
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });

  beforeEach(() => {
    activeRuns = 0;
    activeIds = new Set();
    broadcast.mockClear();
    windowRequest.mockClear();
  });

  it("creates, lists, inspects, reads, writes (with conflict detection), and searches academic works", async () => {
    const createdDefault = await call("manage_work", {
      action: "create",
      type: "academic",
      title: "检索增强生成综述"
    });
    expect(createdDefault.id).toBeTruthy();

    const thesis = await call("manage_work", {
      action: "create",
      type: "academic",
      title: "长上下文推理博士论文",
      subtype: "thesis_dissertation",
      citationStyle: "apa"
    });
    const thesisId = thesis.id!;

    const cardCreated = await store.createAcademicReferenceCard({
      bookId: thesisId,
      citeKey: "vaswani2017",
      cardType: "literature",
      title: "Attention Is All You Need",
      content: "Transformer self-attention baseline."
    });

    const listed = await call<{ works: WorkSummary[] }>("list_works", {
      type: "academic"
    });
    expect(listed.works).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: createdDefault.id,
          type: "academic",
          subtype: "empirical_paper",
          citationStyle: "gbt7714"
        }),
        expect.objectContaining({
          id: thesisId,
          type: "academic",
          subtype: "thesis_dissertation",
          citationStyle: "apa"
        })
      ])
    );

    const detail = await call<WorkDetail>("get_work", { workId: thesisId });
    expect(detail.subtype).toBe("thesis_dissertation");
    expect(detail.citationStyle).toBe("apa");
    expect(detail.stages?.length).toBeGreaterThanOrEqual(4);
    expect(detail.chapters?.length).toBeGreaterThan(0);

    const groups = detail.documents.map((d) => d.group);
    expect(groups).toContain("foundation");
    expect(groups).toContain("reference_card");
    expect(groups).toContain("framework");
    expect(groups).toContain("manuscript");
    expect(detail.documents[0]?.id).toBe("thesis_overview");
    expect(detail.documents[1]?.id).toBe("terminology");
    expect(
      detail.documents.some((d) => d.id === cardCreated.card.document.id)
    ).toBe(true);

    // Read & write foundation, framework, and 3-part section documents with baseRevision
    const termPage = await call<DocumentPage>("read_document", {
      workId: thesisId,
      documentId: "terminology"
    });
    const writtenTerm = await call("write_document", {
      workId: thesisId,
      documentId: "terminology",
      content: "符号 $\\Omega$ 表示样本空间，严禁混用。",
      baseRevision: termPage.revision
    });
    expect(writtenTerm.revision).toBeTruthy();

    // Reject stale baseRevision without force
    await expect(
      call("write_document", {
        workId: thesisId,
        documentId: "terminology",
        content: "过期的覆盖写入",
        baseRevision: termPage.revision
      })
    ).rejects.toMatchObject({ code: "external.stale_revision" });

    // Search across card and terminology
    const searchHits = await call<{
      hits: { documentId: string; snippet: string }[];
    }>("search_text", {
      workId: thesisId,
      query: "样本空间"
    });
    expect(searchHits.hits).toEqual([
      expect.objectContaining({ documentId: "terminology" })
    ]);

    const cardHits = await call<{
      hits: { documentId: string; snippet: string }[];
    }>("search_text", {
      workId: thesisId,
      query: "self-attention"
    });
    expect(cardHits.hits).toEqual([
      expect.objectContaining({ documentId: cardCreated.card.document.id })
    ]);
  });

  it("creates, moves, duplicates, deletes, and restores 3-part academic manuscript sections with brief, body, state, and chapterId intact", async () => {
    const created = await call("manage_work", {
      action: "create",
      type: "academic",
      title: "章节结构与回收站测试",
      subtype: "thesis_dissertation"
    });
    const workId = created.id!;
    const initial = await call<WorkDetail>("get_work", { workId });
    const firstChapter = initial.chapters![0]!;

    const newSection = await call("manage_document", {
      action: "create",
      workId,
      chapterId: firstChapter.id,
      title: "1.9 关键理论推导"
    });
    const bodyDocId = newSection.id!;
    const sectionId = bodyDocId.slice(
      "academic-section:".length,
      -":body".length
    );
    const briefDocId = `academic-section:${sectionId}:brief`;
    const stateDocId = `academic-section:${sectionId}:state`;

    for (const [docId, text] of [
      [briefDocId, "本节必引 [vaswani2017]，证明收敛上界。"],
      [bodyDocId, "正式推导正文：令 $x_t \\in \\mathbb{R}^d$。"],
      [stateDocId, "已定义符号 $x_t$；承诺在 4.2 节给出消融实验。"]
    ] as const) {
      const page = await call<DocumentPage>("read_document", {
        workId,
        documentId: docId
      });
      await call("write_document", {
        workId,
        documentId: docId,
        content: text,
        baseRevision: page.revision
      });
    }

    // Move & rename section
    await call("manage_document", {
      action: "move",
      workId,
      documentId: bodyDocId,
      direction: "up"
    });
    const renamed = await call("manage_document", {
      action: "rename",
      workId,
      documentId: bodyDocId,
      title: "1.9 核心收敛性推导"
    });
    expect(renamed.title).toBe("1.9 核心收敛性推导");

    // Duplicate preserves brief, body, state, and chapterId
    const duplicated = await call("manage_document", {
      action: "duplicate",
      workId,
      documentId: bodyDocId
    });
    const dupSectionId = duplicated.id!.slice(
      "academic-section:".length,
      -":body".length
    );
    const dupBrief = await call<DocumentPage>("read_document", {
      workId,
      documentId: `academic-section:${dupSectionId}:brief`
    });
    const dupState = await call<DocumentPage>("read_document", {
      workId,
      documentId: `academic-section:${dupSectionId}:state`
    });
    expect(dupBrief.content).toBe("本节必引 [vaswani2017]，证明收敛上界。");
    expect(dupState.content).toBe(
      "已定义符号 $x_t$；承诺在 4.2 节给出消融实验。"
    );

    // Delete & restore_trash_item round-trips brief, body, state, and chapterId
    const deleted = await call("manage_document", {
      action: "delete",
      workId,
      documentId: bodyDocId
    });
    expect(deleted.trashId).toBeTruthy();

    const trashList = await call<{
      items: { trashId: string; kind: string; title: string }[];
    }>("list_trash");
    expect(trashList.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          trashId: deleted.trashId,
          kind: "section",
          title: "1.9 核心收敛性推导"
        })
      ])
    );

    const restored = await call("restore_trash_item", {
      trashId: deleted.trashId!
    });
    const restoredSecId = restored.id!.slice(
      "academic-section:".length,
      -":body".length
    );
    const [rBrief, rBody, rState, afterWork] = await Promise.all([
      call<DocumentPage>("read_document", {
        workId,
        documentId: `academic-section:${restoredSecId}:brief`
      }),
      call<DocumentPage>("read_document", {
        workId,
        documentId: restored.id!
      }),
      call<DocumentPage>("read_document", {
        workId,
        documentId: `academic-section:${restoredSecId}:state`
      }),
      call<WorkDetail>("get_work", { workId })
    ]);
    expect(rBrief.content).toBe("本节必引 [vaswani2017]，证明收敛上界。");
    expect(rBody.content).toBe("正式推导正文：令 $x_t \\in \\mathbb{R}^d$。");
    expect(rState.content).toBe(
      "已定义符号 $x_t$；承诺在 4.2 节给出消融实验。"
    );
    const restoredChapter = afterWork.chapters?.find(
      (ch) => ch.id === firstChapter.id
    );
    expect(restoredChapter?.sectionIds).toContain(restoredSecId);

    // Work rename, duplicate, delete, and restore
    await call("manage_work", {
      action: "rename",
      workId,
      title: "重命名后的博士论文"
    });
    const duplicatedWork = await call("manage_work", {
      action: "duplicate",
      workId
    });
    expect(duplicatedWork.id).toBeTruthy();

    const deletedWork = await call("manage_work", {
      action: "delete",
      workId
    });
    expect(deletedWork.trashId).toBeTruthy();
    await expect(call("get_work", { workId })).rejects.toMatchObject({
      code: "external.not_found"
    });

    await call("restore_trash_item", { trashId: deletedWork.trashId! });
    const reopened = await call<WorkDetail>("get_work", { workId });
    expect(reopened.title).toBe("重命名后的博士论文");
  });

  it("opens academic works in app, dispatches normal/team agent runs, and rejects busy targets with external.busy", async () => {
    const created = await call("manage_work", {
      action: "create",
      type: "academic",
      title: "智能体运行与占用保护"
    });
    const workId = created.id!;

    await expect(call("open_in_app", { workId })).resolves.toEqual({
      id: workId
    });
    expect(windowRequest).toHaveBeenCalledWith({
      action: "open_target",
      target: { kind: "academic", id: workId }
    });

    const teamRun = await call<{ runId: string; mode: string }>("run_agent", {
      workId,
      message: "根据立意起草引言写作指引",
      mode: "team",
      newConversation: true
    });
    expect(teamRun).toMatchObject({
      runId: "run_acad_1",
      mode: "team"
    });
    expect(windowRequest).toHaveBeenLastCalledWith({
      action: "start_run",
      target: { kind: "academic", id: workId },
      message: "根据立意起草引言写作指引",
      mode: "team",
      newConversation: true
    });

    activeRuns = 1;
    activeIds = new Set([workId]);
    await expect(
      call("run_agent", { workId, message: "并发重发" })
    ).rejects.toMatchObject({ code: "external.busy" });
    await expect(
      call("manage_document", { action: "create", workId, title: "冲突小节" })
    ).rejects.toMatchObject({ code: "external.busy" });
  });
});
