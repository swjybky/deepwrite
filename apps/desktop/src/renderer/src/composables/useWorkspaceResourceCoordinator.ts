import { formatError } from "../i18n/errors";
import { createScopedTranslator } from "../i18n";
import type {
  Book,
  CatalogIndexSnapshot,
  CatalogSnapshot,
  LongBookSummary,
  LongWorkspaceIndexSnapshot,
  LongWorkspaceRuntimeContext
} from "@deepwrite/contracts";
import { PROMPT_ATTACHMENT_MAX_ITEMS } from "@deepwrite/contracts";
import { computed, watch, type Ref } from "vue";
import {
  resolveDraftSectionProjection,
  resolveDraftSectionResourceId,
  resolvePreferredBookResourceId,
  type CatalogWorkspaceProjection,
  type DraftDirectoryProjection
} from "../data/catalogWorkspace";
import type { useCatalogDocumentLoader } from "./useCatalogDocumentLoader";
import type {
  EditorTextReference,
  EditorTextReferenceNavigation
} from "../types/conversation";
import type { LongWorkspaceSelection } from "../types/longWorkspace";
import { reconcileLongWorkspaceSelection } from "../types/longWorkspace";
import type {
  DraftFileKind,
  EditorDraftState,
  ResourceTreeNode,
  ResourceTreeSection,
  WorkspaceDocument
} from "../types/workspace";
import { buildLibraryAgentWorkspaceContext } from "../utils/libraryAgentContext";
import { activeAgentDocumentForSelection } from "../utils/agentRunPreferences";
import { useBookPanePreferenceKey } from "./useBookPanePreferenceKey";
import type { ResourceTreeLookup } from "../utils/resourceTreeLookup";

const t = createScopedTranslator("workspace");

export interface WorkspaceResourceNotifications {
  error(message: string): void;
  info(message: string): void;
  warning(message: string): void;
}

export interface WorkspaceResourceCoordinatorState {
  selectedResourceId: Ref<string>;
  activeCreationResourceId: Ref<string>;
  selectedExpertSectionIds: Ref<Record<string, string>>;
  selectedDraftFileKinds: Ref<Record<string, DraftFileKind>>;
  pendingEditorReferences: Ref<EditorTextReference[]>;
  editorReferenceNavigation: Ref<EditorTextReferenceNavigation | undefined>;
  documents: Ref<WorkspaceDocument[]>;
  editorDrafts: Ref<Record<string, EditorDraftState>>;
}

export interface WorkspaceResourceCatalogPort {
  snapshot: Readonly<Ref<CatalogIndexSnapshot | null>>;
  projection: Readonly<Ref<CatalogWorkspaceProjection | null>>;
  /**
   * When provided, Catalog tree changes are not reconciled until the matching
   * document overlay transaction has committed.
   */
  reconciledProjection?: Readonly<Ref<CatalogWorkspaceProjection | null>>;
  loader: Pick<
    ReturnType<typeof useCatalogDocumentLoader>,
    "documentsById" | "ensureLoaded" | "ensureOne" | "contextSnapshot"
  >;
  findBook(bookId: string): Book | undefined;
}

export interface WorkspaceResourceTreePort {
  sections: Readonly<Ref<readonly ResourceTreeSection[]>>;
  lookup: Readonly<Ref<ResourceTreeLookup>>;
}

export interface WorkspaceResourceLongNavigationPort {
  books: Readonly<Ref<readonly LongBookSummary[]>>;
  activeBookId: Readonly<Ref<string | null>>;
  activeBookSummary: Readonly<Ref<LongBookSummary | null>>;
  workspaceIndex: Readonly<Ref<LongWorkspaceIndexSnapshot | null>>;
  activeRoot: Readonly<Ref<LongWorkspaceRuntimeContext["activeRoot"]>>;
  workspaceActive: Readonly<Ref<boolean>>;
  saveActiveEditorBeforeLeaving(nextBookId?: string): Promise<boolean>;
  openBook(
    bookId: string,
    requestedSelection?: LongWorkspaceSelection | null
  ): Promise<void>;
  selectWorkspaceFile(selection: LongWorkspaceSelection): Promise<unknown>;
  deactivateActiveBook(): void;
}

export interface WorkspaceResourceMysteryNavigationPort {
  activeBookId: Readonly<Ref<string | null>>;
  openBook(bookId: string, current: () => boolean): Promise<void>;
  selectTarget(
    target: import("@deepwrite/contracts").MysteryDocumentTarget
  ): Promise<boolean>;
  saveActiveEditorBeforeLeaving(): Promise<boolean>;
  deactivateActiveBook(): void;
}

export interface WorkspaceResourceCoordinatorOptions {
  state: WorkspaceResourceCoordinatorState;
  catalog: WorkspaceResourceCatalogPort;
  tree: WorkspaceResourceTreePort;
  longNavigation: WorkspaceResourceLongNavigationPort;
  mysteryNavigation?: WorkspaceResourceMysteryNavigationPort;
  emptyDocument: Readonly<WorkspaceDocument>;
  showConversation(): void;
  revealEditor(): void;
  notifications: WorkspaceResourceNotifications;
}

/**
 * Owns visible-tree lookup, metadata-to-document resolution, and short/script
 * editor navigation. Catalog mutation and conversation execution deliberately
 * stay outside this boundary.
 */
export function useWorkspaceResourceCoordinator(
  options: WorkspaceResourceCoordinatorOptions
) {
  const { catalog, longNavigation, notifications, state, tree } = options;
  let navigationRequestId = 0;
  let editorReferenceNavigationClock = 0;
  let disposed = false;

  function beginNavigationRequest(): number {
    navigationRequestId += 1;
    return navigationRequestId;
  }

  function navigationRequestIsCurrent(requestId: number): boolean {
    return !disposed && requestId === navigationRequestId;
  }

  function findResourceNodeIn(
    sections: readonly ResourceTreeSection[],
    resourceId: string
  ): ResourceTreeNode | undefined {
    if (sections === tree.sections.value) {
      return tree.lookup.value.nodeById.get(resourceId);
    }
    const visit = (
      nodes: readonly ResourceTreeNode[]
    ): ResourceTreeNode | undefined => {
      for (const node of nodes) {
        if (node.id === resourceId) return node;
        const nested = visit(node.children ?? []);
        if (nested) return nested;
      }
      return undefined;
    };
    return visit(sections.flatMap((section) => section.nodes));
  }

  function findResourceNodeWhere(
    predicate: (node: ResourceTreeNode) => boolean
  ): ResourceTreeNode | undefined {
    const visit = (
      nodes: readonly ResourceTreeNode[]
    ): ResourceTreeNode | undefined => {
      for (const node of nodes) {
        if (predicate(node)) return node;
        const nested = visit(node.children ?? []);
        if (nested) return nested;
      }
      return undefined;
    };
    return visit(tree.sections.value.flatMap(({ nodes }) => nodes));
  }

  function resourceIdForDocumentId(documentId: string): string | undefined {
    return tree.lookup.value.resourceIdByDocumentId.get(documentId);
  }

  function resourceTargetDocumentId(
    sections: readonly ResourceTreeSection[],
    resourceId: string
  ): string {
    if (sections === tree.sections.value) {
      return (
        tree.lookup.value.targetDocumentIdByResourceId.get(resourceId) ??
        resourceId
      );
    }
    const node = findResourceNodeIn(sections, resourceId);
    return (
      node?.targetDocumentId ??
      (node?.stageCategoryId === "draft"
        ? node.children?.find((child) => child.targetDocumentId)
            ?.targetDocumentId
        : undefined) ??
      resourceId
    );
  }

  function resourceNode(resourceId: string): ResourceTreeNode | undefined {
    return findResourceNodeIn(tree.sections.value, resourceId);
  }

  function draftDirectoryForResourceId(
    resourceId: string
  ): DraftDirectoryProjection | undefined {
    const exact =
      catalog.projection.value?.index.draftDirectoryById.get(resourceId);
    if (exact) return exact;
    const node = resourceNode(resourceId);
    const targetId = node?.targetDocumentId ?? resourceId;
    const target = catalog.loader.documentsById.value.get(targetId);
    if (!node?.expertSectionId && target?.draftDirectoryId === undefined) {
      return undefined;
    }
    return target?.workspaceId
      ? catalog.projection.value?.index.draftDirectoryByWorkspaceId.get(
          target.workspaceId
        )
      : undefined;
  }

  function selectedDraftSection(
    directory: DraftDirectoryProjection,
    node?: ResourceTreeNode
  ): DraftDirectoryProjection["sections"][number] | undefined {
    return resolveDraftSectionProjection(
      directory,
      state.selectedExpertSectionIds.value[directory.id],
      node?.expertSectionId
    );
  }

  function draftFileDocument(
    directory: DraftDirectoryProjection,
    sectionId: string,
    fileKind: DraftFileKind
  ): WorkspaceDocument | undefined {
    const section = directory.sections.find(
      (candidate) => candidate.id === sectionId
    );
    if (!section) return undefined;
    const documentId =
      directory.workspaceType === "academic"
        ? fileKind === "brief"
          ? (section.briefDocumentId ?? section.bodyDocumentId)
          : fileKind === "state"
            ? (section.stateDocumentId ?? section.characterStateDocumentId)
            : section.bodyDocumentId
        : fileKind === "body"
          ? section.bodyDocumentId
          : section.characterStateDocumentId;
    return catalog.loader.documentsById.value.get(documentId);
  }

  function documentForResourceId(
    resourceId: string
  ): WorkspaceDocument | undefined {
    const node = resourceNode(resourceId);
    const directory = draftDirectoryForResourceId(resourceId);
    if (directory) {
      const section = selectedDraftSection(directory, node);
      if (!section) return undefined;
      return draftFileDocument(
        directory,
        section.id,
        state.selectedDraftFileKinds.value[directory.id] ?? "body"
      );
    }
    const targetId = node?.targetDocumentId ?? resourceId;
    return catalog.loader.documentsById.value.get(targetId);
  }

  async function ensureCatalogDocumentsLoaded(
    sources: readonly WorkspaceDocument[],
    loadOptions: { notify?: boolean } = {}
  ): Promise<boolean> {
    if (disposed) return false;
    const result = await catalog.loader.ensureLoaded(sources);
    if (disposed) return false;
    const actionableFailure = result.failures.find(
      (failure) =>
        failure.code === "reader-unavailable" ||
        failure.code === "read-failed" ||
        failure.code === "invalid-result"
    );
    if (actionableFailure && loadOptions.notify !== false) {
      notifications.error(
        actionableFailure.error instanceof Error
          ? actionableFailure.error.message
          : t(
              "workspaceResourceCoordinator.failedToReadTheManuscriptSelectItAgainAnd"
            )
      );
    }
    return result.ok;
  }

  async function ensureCatalogDocumentLoaded(
    source: WorkspaceDocument,
    loadOptions: { notify?: boolean } = {}
  ): Promise<WorkspaceDocument> {
    if (disposed) return source;
    const result = await catalog.loader.ensureOne(source);
    if (disposed) return source;
    const actionableFailure = result.failures.find(
      (failure) =>
        failure.code === "reader-unavailable" ||
        failure.code === "read-failed" ||
        failure.code === "invalid-result"
    );
    if (actionableFailure && loadOptions.notify !== false) {
      notifications.error(
        actionableFailure.error instanceof Error
          ? actionableFailure.error.message
          : t(
              "workspaceResourceCoordinator.failedToReadTheManuscriptSelectItAgainAnd"
            )
      );
    }
    return result.document ?? source;
  }

  function liveDocument(document: WorkspaceDocument): WorkspaceDocument {
    const live = state.editorDrafts.value[document.id];
    return live
      ? { ...document, title: live.title, content: live.content }
      : document;
  }

  function promptDocumentForResourceId(
    resourceId: string
  ): WorkspaceDocument | undefined {
    const node = resourceNode(resourceId);
    const directory = draftDirectoryForResourceId(resourceId);
    const promptSection = directory
      ? selectedDraftSection(directory, node)
      : undefined;
    const document =
      directory && promptSection
        ? draftFileDocument(directory, promptSection.id, "body")
        : documentForResourceId(resourceId);
    if (!document) return undefined;
    const resolved = liveDocument(document);
    const workspaceLabel =
      resolved.workspaceType === "script"
        ? t("catalogWorkspace.screenplay")
        : t("catalogWorkspace.shortStory");
    const unitLabel =
      resolved.workspaceType === "script"
        ? t("workspaceResourceCoordinator.episode")
        : t("workspaceResourceCoordinator.section");
    if (!node?.shortAgentId) return resolved;
    if (
      node.stageCategoryId === "draft" &&
      directory &&
      !node.expertSectionId
    ) {
      const {
        catalogDocumentId: _catalogDocumentId,
        draftFileKind: _draftFileKind,
        expertSectionId: _expertSectionId,
        ...contextDocument
      } = resolved;
      return {
        ...contextDocument,
        id: "draft",
        title: directory.title,
        eyebrow: t("workspaceResourceCoordinator.manuscript", {
          workspaceLabel: workspaceLabel
        }),
        path: [
          resolved.workspaceTitle ?? resolved.path[0] ?? workspaceLabel,
          directory.title
        ],
        content: "",
        shortAgentId: node.shortAgentId
      };
    }
    return {
      ...resolved,
      shortAgentId: node.shortAgentId,
      ...(promptSection && node.expertSectionId
        ? {
            expertSectionId: promptSection.id,
            title: promptSection.title,
            eyebrow: t("workspaceResourceCoordinator.writing", {
              workspaceLabel: workspaceLabel,
              unitLabel: unitLabel
            }),
            path: [
              resolved.workspaceTitle ?? resolved.path[0] ?? workspaceLabel,
              t("catalogWorkspace.manuscript"),
              promptSection.title
            ]
          }
        : {})
    };
  }

  const activeDocument = computed<WorkspaceDocument>(() => {
    const source =
      documentForResourceId(state.selectedResourceId.value) ??
      options.emptyDocument;
    return liveDocument(source);
  });

  const stopActiveDocumentLoad = watch(
    () => {
      const document = documentForResourceId(state.selectedResourceId.value);
      return document
        ? `${document.id}\u0000${document.catalogContentStamp ?? ""}\u0000${
            document.catalogContentLoaded === false ? "unloaded" : "loaded"
          }`
        : "";
    },
    () => {
      const document = documentForResourceId(state.selectedResourceId.value);
      if (document?.catalogContentLoaded === false) {
        void ensureCatalogDocumentLoaded(document);
      }
    },
    { immediate: true }
  );

  const activeEditorDraft = computed<EditorDraftState | undefined>(
    () => state.editorDrafts.value[activeDocument.value.id]
  );
  const activeExpertSectionTabs = computed(() => {
    const directory = draftDirectoryForResourceId(
      state.selectedResourceId.value
    );
    return (directory?.sections ?? []).map((section) => ({
      id: section.id,
      title: section.title
    }));
  });
  const activeExpertSectionId = computed(
    () => activeDocument.value.expertSectionId
  );
  const activeCharacterItemTabs = computed(() => {
    const document = activeDocument.value;
    if (
      document.domain !== "creation" ||
      document.stageId !== "character_design" ||
      (document.workspaceType !== "short" &&
        document.workspaceType !== "script") ||
      !document.workspaceId
    ) {
      return [] as { id: string; title: string }[];
    }
    const book = catalog.findBook(document.workspaceId);
    if (
      !book ||
      book.bookType === "academic" ||
      book.characterStructure.format !== "list"
    ) {
      return [] as { id: string; title: string }[];
    }
    const overview = state.documents.value.find(
      (candidate) =>
        candidate.workspaceId === book.id &&
        candidate.stageId === "character_design" &&
        candidate.characterFileKind === "overview"
    );
    const items = state.documents.value
      .filter(
        (candidate) =>
          candidate.workspaceId === book.id &&
          candidate.stageId === "character_design" &&
          candidate.characterFileKind === "item"
      )
      .sort(
        (left, right) =>
          (left.characterItemOrder ?? 0) - (right.characterItemOrder ?? 0)
      );
    return [
      ...(overview
        ? [{ id: overview.id, title: t("catalogWorkspace.overview") }]
        : []),
      ...items.map((item) => ({ id: item.id, title: item.title }))
    ];
  });
  const activeEditorSectionTabs = computed(() =>
    activeCharacterItemTabs.value.length
      ? activeCharacterItemTabs.value
      : activeExpertSectionTabs.value
  );
  const activeEditorSectionId = computed(() =>
    activeCharacterItemTabs.value.length
      ? activeDocument.value.id
      : activeExpertSectionId.value
  );
  const editorShowsCharacterItemTabs = computed(
    () => activeCharacterItemTabs.value.length > 0
  );
  const editorShowsExpertSectionTabs = computed(
    () =>
      !editorShowsCharacterItemTabs.value &&
      activeExpertSectionTabs.value.length > 0 &&
      (activeDocument.value.workspaceType === "short" ||
        activeDocument.value.workspaceType === "academic") &&
      activeDocument.value.stageId === "draft"
  );
  const showEditorDeleteSection = computed(
    () =>
      editorShowsCharacterItemTabs.value || editorShowsExpertSectionTabs.value
  );
  const canCreateEditorSection = computed(() => {
    if (editorShowsCharacterItemTabs.value) {
      return (
        activeDocument.value.workspaceType === "short" ||
        activeDocument.value.workspaceType === "script"
      );
    }
    return editorShowsExpertSectionTabs.value;
  });
  const canDeleteEditorSection = computed(() => {
    if (editorShowsCharacterItemTabs.value) {
      return (
        activeDocument.value.characterFileKind === "item" &&
        Boolean(activeDocument.value.characterItemId)
      );
    }
    if (editorShowsExpertSectionTabs.value) {
      const directory = draftDirectoryForResourceId(
        state.selectedResourceId.value
      );
      return (directory?.sections.length ?? 0) > 1;
    }
    return false;
  });
  const editorSectionTabsLabel = computed(() =>
    editorShowsCharacterItemTabs.value
      ? t("workspaceResourceCoordinator.characterEntry")
      : undefined
  );
  const editorCreateSectionLabel = computed(() =>
    editorShowsCharacterItemTabs.value
      ? t("workspaceResourceCoordinator.newCharacterEntry")
      : undefined
  );
  const editorDeleteSectionLabel = computed(() => {
    if (editorShowsCharacterItemTabs.value)
      return t("workspaceResourceCoordinator.deleteCurrentCharacterEntry");
    if (editorShowsExpertSectionTabs.value)
      return t("workspaceResourceCoordinator.deleteCurrentSection");
    return undefined;
  });
  const activePromptDocument = computed<WorkspaceDocument>(() => {
    return (
      promptDocumentForResourceId(state.activeCreationResourceId.value) ??
      options.emptyDocument
    );
  });
  const activeAgentDocument = computed<WorkspaceDocument>(() =>
    activeAgentDocumentForSelection(
      activeDocument.value,
      activePromptDocument.value
    )
  );
  const activeRightPanePreferenceKey = useBookPanePreferenceKey({
    document: activeDocument,
    longWorkspaceActive: longNavigation.workspaceActive,
    longBookId: longNavigation.activeBookId,
    mysteryBookId: options.mysteryNavigation?.activeBookId
  });
  const liveWorkspaceDocuments = computed<WorkspaceDocument[]>(() =>
    state.documents.value.map((document) => {
      const live = state.editorDrafts.value[document.id];
      return live
        ? { ...document, title: live.title, content: live.content }
        : document;
    })
  );

  function shortCatalogContextDocuments(): WorkspaceDocument[] {
    const workspaceId = activePromptDocument.value.workspaceId;
    const activeLibraryId = activeAgentDocument.value.libraryId;
    const libraryIds = new Set<string>(
      activeLibraryId ? [activeLibraryId] : []
    );
    const book = workspaceId ? catalog.findBook(workspaceId) : undefined;
    if (book) {
      if (book.bookType === "academic") {
        book.linkedMaterialIds.forEach((id) => libraryIds.add(id));
        book.linkedSkillIds.forEach((id) => libraryIds.add(id));
      } else {
        for (const ids of Object.values(book.linkedMaterialIdsByKind)) {
          ids.forEach((id) => libraryIds.add(id));
        }
        for (const ids of Object.values(book.linkedSkillIdsByKind)) {
          ids.forEach((id) => libraryIds.add(id));
        }
      }
    }
    return state.documents.value.filter(
      (document) =>
        (workspaceId !== undefined && document.workspaceId === workspaceId) ||
        (document.libraryId !== undefined && libraryIds.has(document.libraryId))
    );
  }

  function hydratedCatalogSnapshot(): CatalogSnapshot | null {
    return catalog.loader.contextSnapshot(
      catalog.snapshot.value,
      liveWorkspaceDocuments.value
    );
  }
  const activeLibraryAgentContext = computed(() =>
    buildLibraryAgentWorkspaceContext(
      catalog.snapshot.value,
      activeAgentDocument.value,
      liveWorkspaceDocuments.value
    )
  );
  const activeLibraryBoundToBook = computed(() => {
    const document = activeDocument.value;
    const workspaceId = activePromptDocument.value.workspaceId;
    if (!document.libraryId || !workspaceId || document.domain === "creation") {
      return false;
    }
    const book = tree.sections.value
      .find((section) => section.id === "creation")
      ?.nodes.find((node) => node.id === workspaceId);
    return document.domain === "skill"
      ? (book?.boundSkillLibraryIds?.includes(document.libraryId) ?? false)
      : (book?.boundMaterialLibraryIds?.includes(document.libraryId) ?? false);
  });

  function resourceSelectionExists(
    sections: readonly ResourceTreeSection[],
    resourceId: string
  ): boolean {
    const node = findResourceNodeIn(sections, resourceId);
    if (node?.longBookId) {
      return longNavigation.books.value.some(
        (book) => book.id === node.longBookId
      );
    }
    if (node?.mysteryBookId) return !node.unavailable;
    const targetId = resourceTargetDocumentId(sections, resourceId);
    return catalog.loader.documentsById.value.has(targetId);
  }

  function fallbackCreationResourceId(
    previousSections: readonly ResourceTreeSection[],
    previousResourceId: string
  ): string {
    const mysteryBookId = findResourceNodeIn(
      previousSections,
      previousResourceId
    )?.mysteryBookId;
    if (mysteryBookId) {
      const rootId = `mystery-book:${mysteryBookId}`;
      if (findResourceNodeIn(tree.sections.value, rootId)) return rootId;
    }
    const previousTargetId = resourceTargetDocumentId(
      previousSections,
      previousResourceId
    );
    const previousWorkspaceId =
      catalog.loader.documentsById.value.get(previousTargetId)?.workspaceId;
    return (
      (previousWorkspaceId
        ? resolvePreferredBookResourceId(
            catalog.projection.value ?? undefined,
            previousWorkspaceId
          )
        : undefined) ??
      catalog.projection.value?.draftDirectories[0]?.id ??
      state.documents.value.find((document) => document.domain === "creation")
        ?.id ??
      state.documents.value[0]?.id ??
      ""
    );
  }

  const selectionReconciliationSource = computed(() => ({
    sections: tree.sections.value,
    reconciledProjection: catalog.reconciledProjection?.value
  }));
  let lastReconciledTreeSections = tree.sections.value;
  const stopSelectionReconciliation = watch(
    selectionReconciliationSource,
    (next) => {
      if (
        catalog.reconciledProjection &&
        catalog.projection.value !== next.reconciledProjection
      ) {
        return;
      }
      const nextSections = next.sections;
      const previousSections = lastReconciledTreeSections;
      lastReconciledTreeSections = nextSections;
      const selectedMissing = Boolean(
        state.selectedResourceId.value &&
        !resourceSelectionExists(nextSections, state.selectedResourceId.value)
      );
      const activeCreationMissing = Boolean(
        state.activeCreationResourceId.value &&
        !resourceSelectionExists(
          nextSections,
          state.activeCreationResourceId.value
        )
      );
      if (selectedMissing) {
        beginNavigationRequest();
        state.selectedResourceId.value = fallbackCreationResourceId(
          previousSections ?? [],
          state.selectedResourceId.value
        );
      }
      if (activeCreationMissing) {
        state.activeCreationResourceId.value = fallbackCreationResourceId(
          previousSections ?? [],
          state.activeCreationResourceId.value
        );
      }
    },
    { flush: "sync" }
  );

  async function selectResource(node: ResourceTreeNode): Promise<void> {
    let requestId = beginNavigationRequest();
    if (disposed) return;
    if (
      options.mysteryNavigation?.activeBookId.value &&
      (!(await options.mysteryNavigation.saveActiveEditorBeforeLeaving()) ||
        !navigationRequestIsCurrent(requestId))
    )
      return;
    if (node.mysteryBookId) {
      if (node.unavailable) return;
      if (
        !(await longNavigation.saveActiveEditorBeforeLeaving()) ||
        !navigationRequestIsCurrent(requestId)
      ) {
        return;
      }
      const mystery = options.mysteryNavigation;
      if (!mystery) return;
      if (mystery.activeBookId.value !== node.mysteryBookId) {
        const previous = state.selectedResourceId.value;
        state.selectedResourceId.value = `mystery-book:${node.mysteryBookId}`;
        try {
          await mystery.openBook(node.mysteryBookId, () =>
            navigationRequestIsCurrent(requestId)
          );
        } catch (error) {
          if (navigationRequestIsCurrent(requestId)) {
            state.selectedResourceId.value = previous;
            options.notifications.error(
              formatError(
                error,
                t("composerContextNavigation.couldNotSwitchPleaseTryAgain")
              )
            );
          }
          return;
        }
        if (!navigationRequestIsCurrent(requestId)) return;
      }
      if (longNavigation.activeBookId.value) {
        longNavigation.deactivateActiveBook();
        requestId = beginNavigationRequest();
      }
      options.showConversation();
      options.revealEditor();
      if (node.mysteryTarget) {
        if (
          (await mystery.selectTarget(node.mysteryTarget)) &&
          navigationRequestIsCurrent(requestId)
        )
          state.selectedResourceId.value = node.id;
      }
      return;
    }
    if (node.longBookId) {
      if (
        !(await longNavigation.saveActiveEditorBeforeLeaving(
          node.longBookId
        )) ||
        !navigationRequestIsCurrent(requestId)
      ) {
        return;
      }
      state.selectedResourceId.value = node.id;
      options.mysteryNavigation?.deactivateActiveBook();
      options.showConversation();
      options.revealEditor();
      if (
        longNavigation.activeBookId.value !== node.longBookId ||
        !longNavigation.workspaceIndex.value
      ) {
        await longNavigation.openBook(
          node.longBookId,
          node.longWorkspaceSelection ?? null
        );
      }
      if (!navigationRequestIsCurrent(requestId)) return;
      if (
        node.longWorkspaceSelection &&
        longNavigation.activeBookSummary.value?.id === node.longBookId &&
        longNavigation.workspaceIndex.value
      ) {
        const selection = reconcileLongWorkspaceSelection(
          longNavigation.activeBookSummary.value,
          longNavigation.workspaceIndex.value,
          node.longWorkspaceSelection
        );
        if (selection) {
          await longNavigation.selectWorkspaceFile(selection);
        }
      }
      return;
    }
    if (
      !(await longNavigation.saveActiveEditorBeforeLeaving()) ||
      !navigationRequestIsCurrent(requestId)
    ) {
      return;
    }
    if (options.mysteryNavigation?.activeBookId.value) {
      options.mysteryNavigation.deactivateActiveBook();
      requestId = beginNavigationRequest();
    }
    if (longNavigation.activeBookId.value) {
      longNavigation.deactivateActiveBook();
      // Deactivating a long workspace synchronously contracts its resource
      // tree. Selection reconciliation may advance the navigation generation
      // when the previously selected long node disappears. Reassert this
      // explicit short-form selection after that contraction so the user's
      // cross-workspace navigation is not mistaken for a stale request.
      requestId = beginNavigationRequest();
    }
    const directory = draftDirectoryForResourceId(node.id);
    const document =
      directory && node.expertSectionId
        ? draftFileDocument(directory, node.expertSectionId, "body")
        : documentForResourceId(node.id);
    if (!document) return;
    const loadedDocument = await ensureCatalogDocumentLoaded(document);
    if (
      !navigationRequestIsCurrent(requestId) ||
      loadedDocument.catalogContentLoaded === false
    ) {
      return;
    }
    if (directory && node.expertSectionId) {
      state.selectedExpertSectionIds.value = {
        ...state.selectedExpertSectionIds.value,
        [directory.id]: node.expertSectionId
      };
      state.selectedDraftFileKinds.value = {
        ...state.selectedDraftFileKinds.value,
        [directory.id]: "body"
      };
    }
    options.showConversation();
    state.selectedResourceId.value = node.id;
    if (document.domain === "creation") {
      state.activeCreationResourceId.value = node.id;
    }
    options.revealEditor();
  }

  async function selectExpertSection(sectionId: string): Promise<void> {
    const requestId = beginNavigationRequest();
    const resourceId = state.selectedResourceId.value;
    const directory = draftDirectoryForResourceId(resourceId);
    if (!directory) return;
    if (!directory.sections.some((section) => section.id === sectionId)) {
      notifications.warning(
        t(
          "workspaceResourceCoordinator.thisNoLongerExistsTheListHasBeenRefreshed",
          {
            value:
              directory.workspaceType === "script"
                ? t("workspaceResourceCoordinator.episode")
                : t("workspaceResourceCoordinator.section")
          }
        )
      );
      return;
    }
    const document = draftFileDocument(
      directory,
      sectionId,
      state.selectedDraftFileKinds.value[directory.id] ?? "body"
    );
    if (document) {
      const loaded = await ensureCatalogDocumentLoaded(document);
      if (
        !navigationRequestIsCurrent(requestId) ||
        loaded.catalogContentLoaded === false
      ) {
        return;
      }
    }
    if (!navigationRequestIsCurrent(requestId)) return;
    state.selectedExpertSectionIds.value = {
      ...state.selectedExpertSectionIds.value,
      [directory.id]: sectionId
    };
    const sectionResourceId = resolveDraftSectionResourceId(
      resourceNode(directory.id),
      sectionId
    );
    if (sectionResourceId) {
      state.selectedResourceId.value = sectionResourceId;
      state.activeCreationResourceId.value = sectionResourceId;
    }
  }

  async function selectDraftFile(fileKind: DraftFileKind): Promise<void> {
    const requestId = beginNavigationRequest();
    const resourceId = state.selectedResourceId.value;
    const directory = draftDirectoryForResourceId(resourceId);
    if (!directory) return;
    const section = selectedDraftSection(directory, resourceNode(resourceId));
    const document = section
      ? draftFileDocument(directory, section.id, fileKind)
      : undefined;
    if (document) {
      const loaded = await ensureCatalogDocumentLoaded(document);
      if (
        !navigationRequestIsCurrent(requestId) ||
        loaded.catalogContentLoaded === false
      ) {
        return;
      }
    }
    if (!navigationRequestIsCurrent(requestId)) return;
    state.selectedDraftFileKinds.value = {
      ...state.selectedDraftFileKinds.value,
      [directory.id]: fileKind
    };
  }

  function insertEditorSelectionReference(
    reference: EditorTextReference
  ): void {
    const duplicate = state.pendingEditorReferences.value.some(
      (item) =>
        item.documentId === reference.documentId &&
        item.start === reference.start &&
        item.end === reference.end &&
        item.text === reference.text
    );
    if (duplicate) {
      notifications.info(
        t("pendingEditorReferences.thisPassageIsAlreadyInTheInput")
      );
      return;
    }
    if (
      state.pendingEditorReferences.value.length >= PROMPT_ATTACHMENT_MAX_ITEMS
    ) {
      notifications.warning(
        t(
          "pendingEditorReferences.eachMessageCanIncludeUpToManuscriptReferences",
          { PROMPT_ATTACHMENT_MAX_ITEMS: PROMPT_ATTACHMENT_MAX_ITEMS }
        )
      );
      return;
    }
    state.pendingEditorReferences.value = [
      ...state.pendingEditorReferences.value,
      reference
    ];
  }

  function removeEditorSelectionReference(referenceId: string): void {
    state.pendingEditorReferences.value =
      state.pendingEditorReferences.value.filter(
        (reference) => reference.id !== referenceId
      );
  }

  function clearEditorSelectionReferences(): void {
    state.pendingEditorReferences.value = [];
  }

  function locateEditorSelectionReference(
    reference: EditorTextReference
  ): void {
    if (disposed) return;
    const document = state.documents.value.find(
      (candidate) => candidate.id === reference.documentId
    );
    if (!document) {
      removeEditorSelectionReference(reference.id);
      notifications.warning(
        t(
          "workspaceResourceCoordinator.theReferencedManuscriptFileNoLongerExistsTheReference"
        )
      );
      return;
    }
    beginNavigationRequest();
    let targetResourceId = resourceNode(reference.resourceId)
      ? reference.resourceId
      : (resourceIdForDocumentId(reference.documentId) ?? reference.documentId);
    if (document.draftFileKind && document.expertSectionId) {
      const directory = catalog.projection.value?.draftDirectories.find(
        (candidate) =>
          candidate.sections.some(
            (section) =>
              section.bodyDocumentId === document.id ||
              section.briefDocumentId === document.id ||
              section.stateDocumentId === document.id ||
              section.characterStateDocumentId === document.id
          )
      );
      if (directory) {
        state.selectedExpertSectionIds.value = {
          ...state.selectedExpertSectionIds.value,
          [directory.id]: document.expertSectionId
        };
        state.selectedDraftFileKinds.value = {
          ...state.selectedDraftFileKinds.value,
          [directory.id]: document.draftFileKind
        };
        const referenceNode = resourceNode(targetResourceId);
        const referenceDirectory = referenceNode
          ? draftDirectoryForResourceId(referenceNode.id)
          : undefined;
        if (referenceDirectory?.id !== directory.id) {
          targetResourceId =
            resolveDraftSectionResourceId(
              resourceNode(directory.id),
              document.expertSectionId
            ) ?? directory.id;
        }
      }
    }
    state.selectedResourceId.value = targetResourceId;
    if (document.domain === "creation") {
      state.activeCreationResourceId.value = targetResourceId;
    }
    options.revealEditor();
    state.editorReferenceNavigation.value = {
      requestId: ++editorReferenceNavigationClock,
      reference
    };
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    navigationRequestId += 1;
    stopActiveDocumentLoad();
    stopSelectionReconciliation();
  }

  return {
    activeAgentDocument,
    activeCharacterItemTabs,
    activeDocument,
    activeEditorDraft,
    activeEditorSectionId,
    activeEditorSectionTabs,
    activeExpertSectionId,
    activeExpertSectionTabs,
    activeLibraryAgentContext,
    activeLibraryBoundToBook,
    activePromptDocument,
    activeRightPanePreferenceKey,
    canCreateEditorSection,
    canDeleteEditorSection,
    clearEditorSelectionReferences,
    dispose,
    documentForResourceId,
    draftDirectoryForResourceId,
    draftFileDocument,
    editorCreateSectionLabel,
    editorDeleteSectionLabel,
    editorSectionTabsLabel,
    editorShowsCharacterItemTabs,
    editorShowsExpertSectionTabs,
    ensureCatalogDocumentLoaded,
    ensureCatalogDocumentsLoaded,
    fallbackCreationResourceId,
    findResourceNodeIn,
    findResourceNodeWhere,
    hydratedCatalogSnapshot,
    insertEditorSelectionReference,
    liveDocument,
    liveWorkspaceDocuments,
    locateEditorSelectionReference,
    promptDocumentForResourceId,
    removeEditorSelectionReference,
    resourceIdForDocumentId,
    resourceNode,
    resourceSelectionExists,
    resourceTargetDocumentId,
    selectDraftFile,
    selectedDraftSection,
    selectExpertSection,
    selectResource,
    shortCatalogContextDocuments,
    showEditorDeleteSection
  };
}
