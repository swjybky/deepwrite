import { t } from "../i18n";
import { computed, provide } from "vue";
import type {
  ChatAssistantProjectRef,
  ExternalWindowTarget
} from "@deepwrite/contracts";
import type { ResourceTreeNode } from "../types/workspace";
import type { ApprovalNavigationTarget } from "../utils/approvalNavigation";
import {
  useWorkspaceResourceCoordinator,
  type WorkspaceResourceCoordinatorOptions
} from "./useWorkspaceResourceCoordinator";
import {
  COMPOSER_CONTEXT_NAVIGATION,
  type ComposerContextNavigation
} from "./composerContextNavigationContext";

/** Share existing workspace navigation; build picker choices only on demand. */
export function useWorkspaceResourceNavigation(
  options: WorkspaceResourceCoordinatorOptions
) {
  const resources = useWorkspaceResourceCoordinator(options);
  let navigation: Promise<ComposerContextNavigation | null> | undefined;
  provide(COMPOSER_CONTEXT_NAVIGATION, {
    available: computed(() =>
      options.tree.lookup.value.nodeById.has(
        options.state.selectedResourceId.value
      )
    ),
    load() {
      navigation ??= import("./composerContextNavigation")
        .then(({ createWorkspaceComposerContextNavigation }) =>
          createWorkspaceComposerContextNavigation(options, resources)
        )
        .catch(() => {
          navigation = undefined;
          options.notifications.error(
            t(
              "workspace.workspaceResourceNavigation.couldNotLoadTheSelectionListTryAgain"
            )
          );
          return null;
        });
      return navigation;
    }
  });
  async function openIdentityBook(
    book: ChatAssistantProjectRef
  ): Promise<void> {
    const bookNode = resources.findResourceNodeWhere((node) =>
      book.projectType === "long"
        ? node.longBookId === book.projectId &&
          node.catalogNodeType === "long-book"
        : node.id === book.projectId && node.catalogNodeType === "book"
    );
    function openingNode(
      node: ResourceTreeNode | undefined
    ): ResourceTreeNode | undefined {
      if (!node || node.unavailable || node.missing) return undefined;
      if (
        book.projectType === "long"
          ? node.longWorkspaceSelection?.key === "root:worldbuilding"
          : resources.documentForResourceId(node.id)
      ) {
        return node;
      }
      for (const child of node.children ?? []) {
        const target = openingNode(child);
        if (target) return target;
      }
      return undefined;
    }
    const node = openingNode(bookNode);
    if (!node) {
      options.notifications.warning(
        t("components.workspaceShell.theTargetEntryNoLongerExists")
      );
      return;
    }
    await resources.selectResource(node);
  }

  /** Opens the first readable document; returns false when there is none. */
  async function openExternalTarget(
    target: ExternalWindowTarget
  ): Promise<boolean> {
    const root = resources.findResourceNodeWhere((node) =>
      target.kind === "long"
        ? node.longBookId === target.id && node.catalogNodeType === "long-book"
        : target.kind === "library"
          ? node.libraryId === target.id && node.catalogNodeType === "library"
          : node.id === target.id && node.catalogNodeType === "book"
    );
    function opening(
      node: ResourceTreeNode | undefined
    ): ResourceTreeNode | undefined {
      if (!node || node.unavailable || node.missing) return undefined;
      if (
        target.kind === "long"
          ? node.longWorkspaceSelection?.key === "root:worldbuilding"
          : resources.documentForResourceId(node.id)
      ) {
        return node;
      }
      for (const child of node.children ?? []) {
        const found = opening(child);
        if (found) return found;
      }
      return undefined;
    }
    const node = opening(root);
    if (!node) return false;
    await resources.selectResource(node);
    return true;
  }

  async function selectEditorEntrySearchResult(
    documentId: string,
    navigate: (target: ApprovalNavigationTarget) => Promise<boolean>
  ): Promise<void> {
    const target = resources.liveWorkspaceDocuments.value.find(
      (document) => document.id === documentId
    );
    if (!target) {
      options.notifications.warning(
        t("components.workspaceShell.theTargetEntryNoLongerExists")
      );
      return;
    }
    const navigated = await navigate({
      kind: "document",
      workspaceId: target.workspaceId ?? target.libraryId ?? target.id,
      documentId: target.id
    });
    if (!navigated)
      options.notifications.warning(
        t("components.workspaceShell.theTargetEntryCannotBeOpenedRightNow")
      );
  }

  async function selectLongEntrySearchResult(
    fileId: string,
    navigate: (target: ApprovalNavigationTarget) => Promise<boolean>
  ): Promise<void> {
    const bookId = options.longNavigation.activeBookId.value;
    if (!bookId) return;
    const navigated = await navigate({
      kind: "long",
      bookId,
      candidates: [{ kind: "file", fileId }]
    });
    if (!navigated)
      options.notifications.warning(
        t("components.workspaceShell.theTargetNovelEntryCannotBeOpenedRightNow")
      );
  }

  return {
    ...resources,
    openIdentityBook,
    openExternalTarget,
    selectEditorEntrySearchResult,
    selectLongEntrySearchResult
  };
}
