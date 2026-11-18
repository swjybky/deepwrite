import type {
  LongBookSummary,
  LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import { describe, expect, it } from "vitest";
import type { DraftDirectoryProjection } from "../data/catalogWorkspace";
import type { LongWorkspaceSelection } from "../types/longWorkspace";
import type { ResourceTreeNode, WorkspaceDocument } from "../types/workspace";
import type {
  ApprovalNavigationTarget,
  ResolvedLongApprovalNavigation
} from "../utils/approvalNavigation";
import {
  useApprovalNavigationCoordinator,
  type ApprovalNavigationCoordinatorContext
} from "./useApprovalNavigationCoordinator";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function workspaceDocument(
  id: string,
  overrides: Partial<WorkspaceDocument> = {}
): WorkspaceDocument {
  return {
    id,
    domain: "creation",
    title: id,
    eyebrow: "测试",
    path: [id],
    content: "",
    ...overrides
  };
}

function resourceNode(
  id: string,
  overrides: Partial<ResourceTreeNode> = {}
): ResourceTreeNode {
  return { id, label: id, ...overrides };
}

function longSummary(bookId = "long-book"): LongBookSummary {
  return { id: bookId, title: bookId } as unknown as LongBookSummary;
}

function longIndex(revision = 1): LongWorkspaceIndexSnapshot {
  return { revision } as unknown as LongWorkspaceIndexSnapshot;
}

function longSelection(key = "worldbuilding"): LongWorkspaceSelection {
  return { key } as unknown as LongWorkspaceSelection;
}

interface HarnessOptions {
  refresh?: () => Promise<unknown>;
  afterUpdate?: () => Promise<void>;
  resolveLong?: (
    target: Extract<ApprovalNavigationTarget, { kind: "long" }>,
    summary: LongBookSummary,
    index: LongWorkspaceIndexSnapshot
  ) =>
    | ResolvedLongApprovalNavigation
    | undefined
    | Promise<ResolvedLongApprovalNavigation | undefined>;
}

function createHarness(options: HarnessOptions = {}) {
  const documents: WorkspaceDocument[] = [];
  const directories: DraftDirectoryProjection[] = [];
  const nodes = new Map<string, ResourceTreeNode>();
  const resourceIds = new Map<string, string>();
  const resourceDocuments = new Map<string, WorkspaceDocument>();
  const selectedNodes: string[] = [];
  const selectedExpertSections: Array<[string, string]> = [];
  const selectedDraftFiles: Array<
    [string, import("../types/workspace").DraftFileKind]
  > = [];
  const infoMessages: string[] = [];
  const longSelections: LongWorkspaceSelection[] = [];
  let selectedResourceId = "";
  let activeLongBookId: string | null = "long-book";
  let activeLongSummary: LongBookSummary | null = longSummary();
  let activeLongIndex: LongWorkspaceIndexSnapshot | null = longIndex();
  let longRefreshes = 0;
  let longFocuses = 0;
  let conversationsShown = 0;
  let rightPaneExpansions = 0;
  let saveBeforeLeavingResult = true;
  let saveActiveResult = true;
  let selectLongResult = true;
  let focusLongResult = true;

  const context: ApprovalNavigationCoordinatorContext = {
    catalog: {
      documents: () => documents,
      documentById: (documentId) =>
        documents.find(({ id }) => id === documentId),
      draftDirectoryForWorkspace: (workspaceId) =>
        directories.find((directory) => directory.workspaceId === workspaceId),
      draftFileDocument(directory, sectionId, fileKind) {
        const section = directory.sections.find(({ id }) => id === sectionId);
        const documentId =
          fileKind === "body"
            ? section?.bodyDocumentId
            : section?.characterStateDocumentId;
        return documents.find(({ id }) => id === documentId);
      },
      refresh: options.refresh ?? (async () => undefined)
    },
    resources: {
      resourceIdForDocumentId: (documentId) => resourceIds.get(documentId),
      node: (resourceId) => nodes.get(resourceId),
      libraryNode: (libraryId) => nodes.get(`library:${libraryId}`),
      draftSectionResourceId: (directoryNode, sectionId) =>
        directoryNode && nodes.has(`${directoryNode.id}:${sectionId}`)
          ? `${directoryNode.id}:${sectionId}`
          : undefined,
      async select(node) {
        selectedNodes.push(node.id);
        selectedResourceId = node.id;
      },
      selectedResourceId: () => selectedResourceId,
      documentForResourceId: (resourceId) => resourceDocuments.get(resourceId),
      preferredLongResourceId: (bookId, _index, selection) =>
        `long:${bookId}:${selection.key}`,
      longNavigationResourceId: (bookId, selectionKey) =>
        `long:${bookId}:${selectionKey}`,
      longBookResourceId: (bookId) => `long:${bookId}`,
      setSelectedResourceId(resourceId) {
        selectedResourceId = resourceId;
      }
    },
    longWorkspace: {
      activeBookId: () => activeLongBookId,
      activeBookSummary: () => activeLongSummary,
      workspaceIndex: () => activeLongIndex,
      editor: () => ({
        async focusTarget() {
          longFocuses += 1;
          return focusLongResult;
        }
      }),
      async saveEditorBeforeLeaving() {
        return saveBeforeLeavingResult;
      },
      async saveActiveEditorChanges() {
        return saveActiveResult;
      },
      async openBook(bookId) {
        activeLongBookId = bookId;
        activeLongSummary = longSummary(bookId);
        activeLongIndex = longIndex();
      },
      async refresh() {
        longRefreshes += 1;
      },
      async selectFile(selection) {
        longSelections.push(selection);
        return selectLongResult;
      },
      resolveNavigation:
        options.resolveLong ??
        ((_target, _summary, _index) => ({
          selection: longSelection(),
          candidateIndex: 0
        }))
    },
    view: {
      selectExpertSection(directoryId, sectionId) {
        selectedExpertSections.push([directoryId, sectionId]);
      },
      selectDraftFile(directoryId, fileKind) {
        selectedDraftFiles.push([directoryId, fileKind]);
      },
      showConversation() {
        conversationsShown += 1;
      },
      expandRightPane() {
        rightPaneExpansions += 1;
      },
      afterUpdate: options.afterUpdate ?? (async () => undefined),
      info(message) {
        infoMessages.push(message);
      }
    }
  };

  return {
    context,
    directories,
    documents,
    infoMessages,
    longSelections,
    nodes,
    resourceDocuments,
    resourceIds,
    selectedDraftFiles,
    selectedExpertSections,
    selectedNodes,
    get conversationsShown() {
      return conversationsShown;
    },
    get longFocuses() {
      return longFocuses;
    },
    get longRefreshes() {
      return longRefreshes;
    },
    get rightPaneExpansions() {
      return rightPaneExpansions;
    },
    get selectedResourceId() {
      return selectedResourceId;
    },
    set focusLongResult(value: boolean) {
      focusLongResult = value;
    },
    set saveActiveResult(value: boolean) {
      saveActiveResult = value;
    },
    set saveBeforeLeavingResult(value: boolean) {
      saveBeforeLeavingResult = value;
    },
    set selectLongResult(value: boolean) {
      selectLongResult = value;
    }
  };
}

describe("useApprovalNavigationCoordinator", () => {
  it("refreshes a missing document once and selects its exact resource", async () => {
    const targetDocument = workspaceDocument("document-1", {
      workspaceId: "workspace-1"
    });
    const harness = createHarness({
      async refresh() {
        harness.documents.push(targetDocument);
      }
    });
    const node = resourceNode("resource-1");
    harness.nodes.set(node.id, node);
    harness.resourceIds.set(targetDocument.id, node.id);
    harness.resourceDocuments.set(node.id, targetDocument);
    const coordinator = useApprovalNavigationCoordinator(harness.context);

    await expect(
      coordinator.navigateToDocument({
        kind: "document",
        workspaceId: "workspace-1",
        documentId: targetDocument.id
      })
    ).resolves.toBe(true);
    expect(harness.selectedNodes).toEqual([node.id]);
    expect(harness.selectedResourceId).toBe(node.id);
  });

  it("routes library, draft-section, and character-item targets", async () => {
    const harness = createHarness();
    const libraryDocument = workspaceDocument("library-entry", {
      domain: "skill",
      libraryId: "library-1",
      catalogEntryId: "entry-1"
    });
    const bodyDocument = workspaceDocument("draft-body", {
      workspaceId: "workspace-1",
      draftDirectoryId: "draft-directory",
      expertSectionId: "section-1",
      draftFileKind: "body"
    });
    const characterDocument = workspaceDocument("character-item", {
      workspaceId: "workspace-1",
      stageId: "character_design",
      characterItemId: "character-1",
      characterFileKind: "item"
    });
    harness.documents.push(libraryDocument, bodyDocument, characterDocument);
    harness.directories.push({
      id: "draft-directory",
      workspaceId: "workspace-1",
      workspaceType: "short",
      title: "正文",
      sections: [
        {
          id: "section-1",
          title: "第一节",
          wordCountRequirement: "",
          bodyDocumentId: bodyDocument.id,
          characterStateDocumentId: "draft-state"
        }
      ]
    });
    for (const [document, nodeId] of [
      [libraryDocument, "library-resource"],
      [bodyDocument, "draft-directory:section-1"],
      [characterDocument, "character-resource"]
    ] as const) {
      const node = resourceNode(nodeId, { catalogNodeType: "document" });
      harness.nodes.set(node.id, node);
      harness.resourceIds.set(document.id, node.id);
      harness.resourceDocuments.set(node.id, document);
    }
    harness.nodes.set("draft-directory", resourceNode("draft-directory"));
    const coordinator = useApprovalNavigationCoordinator(harness.context);

    await expect(
      coordinator.navigateToTarget({
        kind: "library",
        domain: "skill",
        libraryId: "library-1",
        entryId: "entry-1",
        documentId: libraryDocument.id
      })
    ).resolves.toBe(true);
    await expect(
      coordinator.navigateToTarget({
        kind: "draft-section",
        workspaceId: "workspace-1",
        sectionId: "section-1",
        fileKind: "body"
      })
    ).resolves.toBe(true);
    await expect(
      coordinator.navigateToTarget({
        kind: "character-item",
        workspaceId: "workspace-1",
        itemId: "character-1"
      })
    ).resolves.toBe(true);

    expect(harness.selectedNodes).toEqual([
      "library-resource",
      "draft-directory:section-1",
      "character-resource"
    ]);
    expect(harness.selectedExpertSections).toEqual([
      ["draft-directory", "section-1"]
    ]);
    expect(harness.selectedDraftFiles).toEqual([["draft-directory", "body"]]);
  });

  it("lets the newest request win after an older refresh settles", async () => {
    const refreshStarted = deferred<void>();
    const refreshGate = deferred<void>();
    const staleDocument = workspaceDocument("missing-document", {
      workspaceId: "stale-workspace"
    });
    const harness = createHarness({
      async refresh() {
        refreshStarted.resolve();
        await refreshGate.promise;
        harness.documents.push(staleDocument);
      }
    });
    const staleNode = resourceNode("stale-resource");
    const latestDocument = workspaceDocument("latest-document", {
      workspaceId: "latest-workspace"
    });
    const latestNode = resourceNode("latest-resource");
    harness.documents.push(latestDocument);
    harness.nodes.set(staleNode.id, staleNode);
    harness.nodes.set(latestNode.id, latestNode);
    harness.resourceIds.set(staleDocument.id, staleNode.id);
    harness.resourceIds.set(latestDocument.id, latestNode.id);
    harness.resourceDocuments.set(staleNode.id, staleDocument);
    harness.resourceDocuments.set(latestNode.id, latestDocument);
    const coordinator = useApprovalNavigationCoordinator(harness.context);

    const staleNavigation = coordinator.navigateToDocument({
      kind: "document",
      workspaceId: "stale-workspace",
      documentId: "missing-document"
    });
    await refreshStarted.promise;
    const latestNavigation = coordinator.navigateToDocument({
      kind: "document",
      workspaceId: "latest-workspace",
      documentId: latestDocument.id
    });
    refreshGate.resolve();

    await expect(staleNavigation).resolves.toBe(false);
    await expect(latestNavigation).resolves.toBe(true);
    expect(harness.selectedNodes).toEqual([latestNode.id]);
  });

  it("dispose invalidates delayed catalog work and drain waits for settlement", async () => {
    const refreshStarted = deferred<void>();
    const refreshGate = deferred<void>();
    const lateDocument = workspaceDocument("missing-document", {
      workspaceId: "workspace-1"
    });
    const harness = createHarness({
      async refresh() {
        refreshStarted.resolve();
        await refreshGate.promise;
        harness.documents.push(lateDocument);
      }
    });
    const lateNode = resourceNode("late-resource");
    harness.nodes.set(lateNode.id, lateNode);
    harness.resourceIds.set(lateDocument.id, lateNode.id);
    harness.resourceDocuments.set(lateNode.id, lateDocument);
    const coordinator = useApprovalNavigationCoordinator(harness.context);
    const navigation = coordinator.navigateToDocument({
      kind: "document",
      workspaceId: "workspace-1",
      documentId: "missing-document"
    });
    await refreshStarted.promise;
    let disposed = false;
    const disposal = coordinator.dispose().then(() => {
      disposed = true;
    });
    await Promise.resolve();
    expect(disposed).toBe(false);
    refreshGate.resolve();

    await disposal;
    await expect(navigation).resolves.toBe(false);
    expect(harness.selectedNodes).toEqual([]);
    await expect(coordinator.drain()).resolves.toBeUndefined();
  });

  it("refreshes fallback long targets and focuses only while current", async () => {
    let resolutionCount = 0;
    const selection = longSelection("draft:chapter-1");
    const harness = createHarness({
      resolveLong() {
        resolutionCount += 1;
        return {
          selection,
          focus: { fileId: "chapter-body" },
          candidateIndex: resolutionCount === 1 ? 1 : 0
        };
      }
    });
    harness.focusLongResult = false;
    const navigationNode = resourceNode("long:long-book:draft:chapter-1");
    harness.nodes.set(navigationNode.id, navigationNode);
    const coordinator = useApprovalNavigationCoordinator(harness.context);

    await expect(
      coordinator.navigateToLong({
        kind: "long",
        bookId: "long-book",
        candidates: [{ kind: "file", fileId: "chapter-body" }]
      })
    ).resolves.toBe(true);

    expect(resolutionCount).toBe(2);
    expect(harness.longRefreshes).toBe(1);
    expect(harness.longSelections).toEqual([selection]);
    expect(harness.conversationsShown).toBe(1);
    expect(harness.rightPaneExpansions).toBe(1);
    expect(harness.selectedResourceId).toBe(navigationNode.id);
    expect(harness.longFocuses).toBe(1);
    expect(harness.infoMessages).toEqual([
      "已跳转到所属条目，目标文件暂未就绪。"
    ]);
  });

  it("dispose suppresses focus and notifications after a delayed view update", async () => {
    const updateStarted = deferred<void>();
    const updateGate = deferred<void>();
    const harness = createHarness({
      async afterUpdate() {
        updateStarted.resolve();
        await updateGate.promise;
      },
      resolveLong() {
        return {
          selection: longSelection("draft:chapter-1"),
          focus: { fileId: "chapter-body" },
          candidateIndex: 0
        };
      }
    });
    harness.focusLongResult = false;
    const coordinator = useApprovalNavigationCoordinator(harness.context);
    const navigation = coordinator.navigateToTarget({
      kind: "long",
      bookId: "long-book",
      candidates: [{ kind: "file", fileId: "chapter-body" }]
    });
    await updateStarted.promise;
    const disposal = coordinator.dispose();
    updateGate.resolve();

    await expect(navigation).resolves.toBe(false);
    await disposal;
    expect(harness.longFocuses).toBe(0);
    expect(harness.infoMessages).toEqual([]);
  });
});
