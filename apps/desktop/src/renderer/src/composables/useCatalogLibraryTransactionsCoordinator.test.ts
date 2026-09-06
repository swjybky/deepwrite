import {
  type CatalogIndexSnapshot,
  type CatalogLibrary,
  type DeepWriteApi,
  type MaterialLibrary,
  type SkillLibrary
} from "@deepwrite/contracts";
import { ref, shallowRef } from "vue";
import { describe, expect, it, vi } from "vitest";
import type {
  CatalogResourceNodeActionPayload,
  EditorDraftState,
  ResourceTreeNode,
  WorkspaceDocument
} from "../types/workspace";
import { useCatalogLibraryTransactionsCoordinator } from "./useCatalogLibraryTransactionsCoordinator";

const NOW = "2026-08-14T00:00:00.000Z";

function materialLibrary(
  id: string,
  materialKind: MaterialLibrary["materialKind"],
  entries: MaterialLibrary["entries"] = [],
  projectRevision = 1
): MaterialLibrary {
  return {
    id,
    title: `素材库 ${id}`,
    materialType: "short",
    materialKind,
    parentGenre: "",
    subGenre: "",
    overview: "",
    entries,
    projectRevision,
    createdAt: NOW,
    updatedAt: NOW
  };
}

function skillLibrary(
  id: string,
  entries: SkillLibrary["entries"] = [],
  projectRevision = 1
): SkillLibrary {
  return {
    id,
    title: `技能库 ${id}`,
    skillType: "short",
    skillKind: "plot",
    overview: "",
    isBuiltin: false,
    entries,
    projectRevision,
    createdAt: NOW,
    updatedAt: NOW
  };
}

function workspaceDocument(
  id: string,
  domain: "material" | "skill",
  libraryId: string,
  entryId: string,
  content = "persisted"
): WorkspaceDocument {
  return {
    id,
    domain,
    title: `文档 ${id}`,
    eyebrow: "资料库",
    path: ["资料库", id],
    content,
    libraryId,
    catalogEntryId: entryId,
    catalogContentLoaded: true
  };
}

function libraryNode(
  libraryId: string,
  domain: "material" | "skill",
  patch: Partial<ResourceTreeNode> = {}
): ResourceTreeNode {
  return {
    id: `node:${libraryId}`,
    label: `资料库 ${libraryId}`,
    catalogNodeType: "library",
    libraryId,
    workspaceType: "short",
    ...(domain === "material"
      ? { materialKind: "other" as const }
      : { skillKind: "plot" as const }),
    ...patch
  };
}

interface HarnessOptions {
  materials?: MaterialLibrary[];
  skills?: SkillLibrary[];
  documents?: WorkspaceDocument[];
  drafts?: Record<string, EditorDraftState>;
}

function createHarness(options: HarnessOptions = {}) {
  const materials = options.materials ?? [];
  const skills = options.skills ?? [];
  const snapshot = ref({
    materials,
    materialGroups: [],
    skills,
    skillGroups: []
  } as unknown as CatalogIndexSnapshot);
  const documents = shallowRef(options.documents ?? []);
  const drafts = shallowRef(options.drafts ?? {});
  const mutationPending = ref(false);
  const conflictError = new Error("catalog conflict");
  const apiMocks = {
    createLibrary: vi.fn(),
    createLibraryGroup: vi.fn(),
    updateLibraryGroup: vi.fn(),
    createLibraryEntry: vi.fn(),
    updateLibrary: vi.fn(),
    saveLibraryEntry: vi.fn(),
    moveLibraryEntry: vi.fn(),
    removeLibraryEntry: vi.fn(),
    chooseExternalLibraryEntries: vi.fn(),
    importLibraryEntries: vi.fn(),
    unregisterProject: vi.fn(),
    deleteProject: vi.fn(),
    duplicateProject: vi.fn()
  };
  const refreshCatalog = vi.fn(async () => true);
  const refreshWorkspaceDirectory = vi.fn(async () => undefined);
  const advanceDraftProjectRevision = vi.fn();
  const prepareProjectsForDuplicate = vi.fn(async () => true);
  const selectDocument = vi.fn();
  const navigateToDocumentResource = vi.fn(async () => undefined);
  const collectResourceNodeIds = vi.fn((node: ResourceTreeNode) => [
    node.id,
    ...(node.children ?? []).flatMap((child) => [child.id])
  ]);
  const disposeLibraryConversation = vi.fn();
  const notifications = {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn()
  };
  const findLibrary = vi.fn(
    (
      domain: "material" | "skill",
      libraryId: string
    ): CatalogLibrary | undefined =>
      domain === "material"
        ? snapshot.value.materials.find(({ id }) => id === libraryId)
        : snapshot.value.skills.find(({ id }) => id === libraryId)
  );

  const coordinator = useCatalogLibraryTransactionsCoordinator({
    api: () => apiMocks as unknown as DeepWriteApi["catalog"],
    snapshot,
    documents,
    drafts,
    mutationPending,
    findLibrary,
    ensureDocumentLoaded: vi.fn(async (document) => document),
    refreshCatalog,
    refreshWorkspaceDirectory,
    advanceDraftProjectRevision,
    isConflict: (error) => error === conflictError,
    prepareProjectsForDuplicate,
    selectDocument,
    navigateToDocumentResource,
    collectResourceNodeIds,
    disposeLibraryConversation,
    notifications
  });

  return {
    coordinator,
    snapshot,
    documents,
    drafts,
    mutationPending,
    conflictError,
    apiMocks,
    refreshCatalog,
    refreshWorkspaceDirectory,
    advanceDraftProjectRevision,
    prepareProjectsForDuplicate,
    selectDocument,
    navigateToDocumentResource,
    disposeLibraryConversation,
    notifications
  };
}

function action(
  domain: "material" | "skill",
  actionName: CatalogResourceNodeActionPayload["action"],
  node: ResourceTreeNode
): CatalogResourceNodeActionPayload {
  return { domain, action: actionName, node };
}

describe("useCatalogLibraryTransactionsCoordinator", () => {
  it("creates an entry against the current project revision and focuses its refreshed document", async () => {
    const library = materialLibrary("material-a", "other", [], 4);
    const harness = createHarness({ materials: [library] });
    harness.apiMocks.createLibraryEntry.mockResolvedValue({
      id: "entry-new",
      title: "新条目"
    });
    harness.refreshCatalog.mockImplementation(async () => {
      harness.snapshot.value = {
        ...harness.snapshot.value,
        materials: [{ ...library, projectRevision: 5 }]
      } as unknown as CatalogIndexSnapshot;
      harness.documents.value = [
        workspaceDocument("document-new", "material", library.id, "entry-new")
      ];
      return true;
    });

    await harness.coordinator.createCatalogLibraryEntry({
      domain: "material",
      libraryId: library.id,
      title: "新条目",
      stageId: "other"
    });

    expect(harness.apiMocks.createLibraryEntry).toHaveBeenCalledWith({
      domain: "material",
      libraryId: library.id,
      title: "新条目",
      stageId: "other",
      content: "",
      baseProjectRevision: 4
    });
    expect(harness.advanceDraftProjectRevision).toHaveBeenCalledWith(
      "material",
      library.id,
      5
    );
    expect(harness.selectDocument).toHaveBeenCalledWith("document-new", true);
    expect(harness.mutationPending.value).toBe(false);
  });

  it("renames an entry with the dirty draft content and captured revisions", async () => {
    const library = materialLibrary("material-a", "other", [], 8);
    const document = workspaceDocument(
      "document-a",
      "material",
      library.id,
      "entry-a"
    );
    const harness = createHarness({
      materials: [library],
      documents: [document],
      drafts: {
        [document.id]: {
          title: "草稿标题",
          content: "dirty body",
          dirty: true,
          baseRevision: "revision-a",
          baseProjectRevision: 7
        }
      }
    });
    harness.apiMocks.saveLibraryEntry.mockResolvedValue({ saved: true });

    await harness.coordinator.renameCatalogLibraryEntry({
      domain: "material",
      libraryId: library.id,
      entryId: "entry-a",
      title: "重命名"
    });

    expect(harness.apiMocks.saveLibraryEntry).toHaveBeenCalledWith({
      domain: "material",
      libraryId: library.id,
      entryId: "entry-a",
      title: "重命名",
      content: "dirty body",
      baseRevision: "revision-a",
      baseProjectRevision: 7
    });
    expect(harness.refreshCatalog).toHaveBeenCalledOnce();
  });

  it("asks for a compatible stage before moving material entries across kinds", async () => {
    const source = materialLibrary("source", "character", [
      {
        id: "entry-a",
        title: "人物",
        body: "",
        stageId: "character",
        createdAt: NOW,
        updatedAt: NOW
      }
    ]);
    const target = materialLibrary("target", "plot");
    const harness = createHarness({ materials: [source, target] });
    harness.apiMocks.moveLibraryEntry.mockResolvedValue({ moved: true });

    harness.coordinator.requestCatalogLibraryEntryMove({
      domain: "material",
      sourceLibraryId: source.id,
      targetLibraryId: target.id,
      entryId: "entry-a"
    });

    expect(harness.coordinator.pendingLibraryEntryMove.value).toMatchObject({
      entryTitle: "人物",
      targetLibraryTitle: target.title,
      targetMaterialKind: "plot",
      initialStageId: "character"
    });
    expect(harness.apiMocks.moveLibraryEntry).not.toHaveBeenCalled();

    harness.coordinator.confirmCatalogLibraryEntryMove("intro");
    await vi.waitFor(() => {
      expect(harness.apiMocks.moveLibraryEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceLibraryId: source.id,
          targetLibraryId: target.id,
          entryId: "entry-a",
          targetStageId: "intro",
          sourceBaseProjectRevision: 1,
          targetBaseProjectRevision: 1
        })
      );
    });
    expect(harness.coordinator.pendingLibraryEntryMove.value).toBeNull();
  });

  it("copies dirty content and coerces an incompatible material stage when pasting", async () => {
    const source = materialLibrary("source", "character", [
      {
        id: "entry-a",
        title: "人物",
        body: "persisted body",
        stageId: "character",
        createdAt: NOW,
        updatedAt: NOW
      }
    ]);
    const target = materialLibrary("target", "plot", [], 3);
    const document = workspaceDocument(
      "document-a",
      "material",
      source.id,
      "entry-a"
    );
    const harness = createHarness({
      materials: [source, target],
      documents: [document],
      drafts: {
        [document.id]: {
          title: "草稿人物",
          content: "dirty body",
          dirty: true
        }
      }
    });
    harness.apiMocks.createLibraryEntry.mockResolvedValue({
      id: "entry-copy",
      title: "草稿人物"
    });
    const sourceNode = libraryNode(source.id, "material", {
      id: document.id,
      catalogNodeType: "document",
      catalogEntryId: "entry-a",
      label: "人物"
    });
    const targetNode = libraryNode(target.id, "material", {
      materialKind: "plot"
    });

    harness.coordinator.handleResourceNodeAction(
      action("material", "copy-entry", sourceNode)
    );
    harness.coordinator.handleResourceNodeAction(
      action("material", "paste-entry", targetNode)
    );

    await vi.waitFor(() => {
      expect(harness.apiMocks.createLibraryEntry).toHaveBeenCalledWith({
        domain: "material",
        libraryId: target.id,
        title: "草稿人物",
        content: "dirty body",
        stageId: "pacing",
        baseProjectRevision: 3
      });
    });
  });

  it("scans external skills and imports the selected batch", async () => {
    const library = skillLibrary(
      "skill-a",
      [
        {
          id: "existing",
          title: "Existing",
          body: "",
          stageId: "draft",
          createdAt: NOW,
          updatedAt: NOW
        }
      ],
      10
    );
    const harness = createHarness({ skills: [library] });
    harness.apiMocks.chooseExternalLibraryEntries.mockResolvedValue({
      scanned: 3,
      candidates: [
        {
          id: "candidate-1",
          title: "Existing",
          sourceName: "Existing.md",
          content: "old"
        },
        {
          id: "candidate-2",
          title: "Fresh",
          sourceName: "Fresh.md",
          content: "new"
        }
      ],
      skipped: {
        unsupported: 0,
        unreadable: 0,
        empty: 0,
        tooLarge: 0,
        limitExceeded: 0
      }
    });
    harness.apiMocks.importLibraryEntries.mockResolvedValue({
      entries: [
        {
          id: "fresh-id",
          title: "Fresh",
          body: "new",
          stageId: "plot_design",
          createdAt: NOW,
          updatedAt: NOW
        }
      ]
    });
    harness.coordinator.handleResourceNodeAction(
      action(
        "skill",
        "import-external-skills",
        libraryNode(library.id, "skill")
      )
    );

    await harness.coordinator.externalLibraryImport.chooseSource("directory");
    await harness.coordinator.externalLibraryImport.submit({
      libraryId: library.id,
      candidateIds: ["candidate-2"]
    });

    expect(harness.apiMocks.importLibraryEntries).toHaveBeenCalledWith({
      domain: "skill",
      libraryId: library.id,
      entries: [{ title: "Fresh", content: "new" }],
      baseProjectRevision: 10
    });
    expect(harness.notifications.success).toHaveBeenCalledWith(
      `已导入 1 条到“${library.title}”`
    );
    expect(harness.refreshWorkspaceDirectory).toHaveBeenCalledOnce();
    expect(harness.coordinator.externalLibraryImport.dialog.value).toBeNull();
  });

  it("keeps the import dialog open and refreshes after a revision conflict", async () => {
    const library = skillLibrary("skill-a", [], 10);
    const harness = createHarness({ skills: [library] });
    harness.apiMocks.chooseExternalLibraryEntries.mockResolvedValue({
      scanned: 1,
      candidates: [
        {
          id: "candidate-1",
          title: "Fresh",
          sourceName: "Fresh.md",
          content: "new"
        }
      ],
      skipped: {
        unsupported: 0,
        unreadable: 0,
        empty: 0,
        tooLarge: 0,
        limitExceeded: 0
      }
    });
    harness.apiMocks.importLibraryEntries.mockRejectedValue(
      harness.conflictError
    );
    harness.coordinator.externalLibraryImport.open("skill", library.id);
    await harness.coordinator.externalLibraryImport.chooseSource("file");

    await harness.coordinator.externalLibraryImport.submit({
      libraryId: library.id,
      candidateIds: ["candidate-1"]
    });

    expect(harness.refreshWorkspaceDirectory).toHaveBeenCalledOnce();
    expect(harness.refreshCatalog).toHaveBeenCalledOnce();
    expect(
      harness.coordinator.externalLibraryImport.dialog.value
    ).not.toBeNull();
    expect(harness.notifications.warning).toHaveBeenCalledWith(
      "目标资料库已在外部更新，已刷新重名结果；请确认后重试"
    );
  });

  it("refreshes and closes a group dialog after a revision conflict", async () => {
    const harness = createHarness();
    harness.apiMocks.updateLibraryGroup.mockRejectedValue(
      harness.conflictError
    );
    harness.coordinator.libraryGroupDialog.value = {
      domain: "material",
      groupId: "group-a"
    };

    harness.coordinator.saveCatalogLibraryGroup({
      domain: "material",
      groupId: "group-a",
      title: "分组",
      members: {},
      baseProjectRevision: 1
    });

    await vi.waitFor(() => {
      expect(harness.refreshCatalog).toHaveBeenCalledOnce();
    });
    expect(harness.coordinator.libraryGroupDialog.value).toBeNull();
    expect(harness.notifications.warning).toHaveBeenCalledWith(
      "分组配置已在外部更新，已重新加载；请确认后再次编辑"
    );
    expect(harness.mutationPending.value).toBe(false);
  });

  it("deletes a library only after confirmation and clears its drafts and conversation", async () => {
    const library = materialLibrary("material-a", "other");
    const child: ResourceTreeNode = {
      id: "document-a",
      label: "条目"
    };
    const node = libraryNode(library.id, "material", { children: [child] });
    const harness = createHarness({
      materials: [library],
      drafts: {
        "document-a": { title: "删除", content: "", dirty: true },
        "document-keep": { title: "保留", content: "", dirty: true }
      }
    });
    harness.apiMocks.deleteProject.mockResolvedValue({ deleted: true });

    harness.coordinator.handleResourceNodeAction(
      action("material", "delete-library", node)
    );
    expect(harness.apiMocks.deleteProject).not.toHaveBeenCalled();
    harness.coordinator.confirmLibraryRemoval();

    await vi.waitFor(() => {
      expect(harness.apiMocks.deleteProject).toHaveBeenCalledWith({
        domain: "material",
        projectId: library.id
      });
      expect(harness.coordinator.libraryRemovalDialog.value).toBeNull();
    });
    expect(harness.drafts.value["document-a"]).toBeUndefined();
    expect(harness.drafts.value["document-keep"]).toBeDefined();
    expect(harness.disposeLibraryConversation).toHaveBeenCalledWith(
      "material",
      library.id
    );
  });

  it("runs the save barrier before duplicating and navigates only after refresh", async () => {
    const library = materialLibrary("material-a", "other");
    const harness = createHarness({ materials: [library] });
    const order: string[] = [];
    harness.prepareProjectsForDuplicate.mockImplementation(async () => {
      order.push("prepare");
      return true;
    });
    harness.apiMocks.duplicateProject.mockImplementation(async () => {
      order.push("duplicate");
      return {
        projectId: "material-copy",
        title: "副本",
        copiedMemberLibraryIds: []
      };
    });
    harness.refreshWorkspaceDirectory.mockImplementation(async () => {
      order.push("directory");
    });
    harness.refreshCatalog.mockImplementation(async () => {
      order.push("catalog");
      harness.documents.value = [
        workspaceDocument(
          "document-copy",
          "material",
          "material-copy",
          "entry-copy"
        )
      ];
      return true;
    });
    harness.navigateToDocumentResource.mockImplementation(async () => {
      order.push("navigate");
    });

    harness.coordinator.handleResourceNodeAction(
      action(
        "material",
        "duplicate-library",
        libraryNode(library.id, "material")
      )
    );

    await vi.waitFor(() => {
      expect(harness.navigateToDocumentResource).toHaveBeenCalledWith(
        "document-copy"
      );
    });
    expect(order).toEqual([
      "prepare",
      "duplicate",
      "directory",
      "catalog",
      "navigate"
    ]);
  });

  it("keeps read-only library mutation actions out of the transaction dialogs", () => {
    const library = skillLibrary("builtin");
    const harness = createHarness({ skills: [library] });
    harness.coordinator.handleResourceNodeAction(
      action(
        "skill",
        "create-entry",
        libraryNode(library.id, "skill", { readOnly: true })
      )
    );

    expect(harness.coordinator.libraryProjectDialog.value).toBeNull();
    expect(harness.notifications.warning).toHaveBeenCalledWith(
      "内置技能库为只读内容，不能修改条目"
    );
  });
});
