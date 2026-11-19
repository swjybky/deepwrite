import { isWorkspaceBookNode } from "../utils/resourceTreeLookup";
import { formatError } from "../i18n/errors";
import { t } from "../i18n";
import { computed, ref, type Ref } from "vue";
import type { ResourceTreeNode, ResourceTreeSection } from "../types/workspace";

import type {
  useWorkspaceResourceCoordinator,
  WorkspaceResourceCoordinatorOptions
} from "./useWorkspaceResourceCoordinator";
import type {
  ComposerContextNavigation,
  ComposerContextOption
} from "./composerContextNavigationContext";

export function createComposerContextNavigation(options: {
  sections: Readonly<Ref<readonly ResourceTreeSection[]>>;
  selectedResourceId: Readonly<Ref<string>>;
  selectResource(node: ResourceTreeNode): Promise<void>;
  canSelect(node: ResourceTreeNode): boolean;
  error(message: string): void;
}): ComposerContextNavigation {
  const busy = ref(false);
  function contains(node: ResourceTreeNode, id: string): boolean {
    return (
      node.id === id ||
      Boolean(node.children?.some((child) => contains(child, id)))
    );
  }
  const roots = computed(() => {
    const result: { node: ResourceTreeNode; domain: string }[] = [];
    const seen = new Set<string>();
    function visit(nodes: ResourceTreeNode[], domain: string): void {
      for (const node of nodes) {
        if (isWorkspaceBookNode(node) || node.catalogNodeType === "library") {
          if (!seen.has(node.id)) result.push({ node, domain });
          seen.add(node.id);
        } else visit(node.children ?? [], domain);
      }
    }
    for (const section of options.sections.value)
      visit(section.nodes, section.label);
    return result;
  });
  const currentBook = computed(
    () =>
      roots.value.find(({ node }) =>
        contains(node, options.selectedResourceId.value)
      )?.node
  );
  function target(node: ResourceTreeNode): ResourceTreeNode | undefined {
    if (node.unavailable || node.missing) return undefined;
    if (options.canSelect(node)) return node;
    for (const child of node.children ?? []) {
      const found = target(child);
      if (found) return found;
    }
    return undefined;
  }
  function choice(
    node: ResourceTreeNode,
    detail: string
  ): ComposerContextOption {
    return {
      id: node.id,
      label: node.label,
      detail,
      icon: node.icon ?? "file",
      current: contains(node, options.selectedResourceId.value),
      disabled: !target(node)
    };
  }
  const books = computed(() =>
    roots.value.map(({ node, domain }) =>
      choice(node, node.badge ? `${domain} · ${node.badge}` : domain)
    )
  );
  const stageNodes = computed(() => {
    const result: { node: ResourceTreeNode; detail: string }[] = [];
    function visit(nodes: ResourceTreeNode[], path: string[]): void {
      for (const node of nodes) {
        if (options.canSelect(node) || !node.children?.length) {
          result.push({ node, detail: path.join(" / ") });
        } else visit(node.children, [...path, node.label]);
      }
    }
    const root = currentBook.value;
    if (root) visit(root.children ?? [], []);
    return result;
  });
  const stages = computed(() =>
    stageNodes.value.map(({ node, detail }) => choice(node, detail))
  );
  async function select(kind: "book" | "stage", id: string): Promise<boolean> {
    if (busy.value) return false;
    const node =
      kind === "book"
        ? roots.value.find((item) => item.node.id === id)?.node
        : stageNodes.value.find((item) => item.node.id === id)?.node;
    if (!node || !target(node)) return false;
    if (contains(node, options.selectedResourceId.value)) return true;
    busy.value = true;
    try {
      await options.selectResource(target(node)!);
      return contains(node, options.selectedResourceId.value);
    } catch (error) {
      options.error(
        formatError(
          error,
          t("workspace.composerContextNavigation.couldNotSwitchPleaseTryAgain")
        )
      );
      return false;
    } finally {
      busy.value = false;
    }
  }
  return { books, stages, currentBook, busy, select };
}

/** Resolve real selectable documents through the existing workspace coordinator. */
export function createWorkspaceComposerContextNavigation(
  options: WorkspaceResourceCoordinatorOptions,
  resources: ReturnType<typeof useWorkspaceResourceCoordinator>
): ComposerContextNavigation {
  return createComposerContextNavigation({
    sections: options.tree.sections,
    selectedResourceId: options.state.selectedResourceId,
    selectResource: resources.selectResource,
    canSelect: (node) =>
      Boolean(node.mysteryTarget || node.catalogNodeType === "mystery-book") ||
      Boolean(
        node.longBookId &&
        (node.longWorkspaceSelection || node.catalogNodeType === "long-book")
      ) ||
      Boolean(resources.documentForResourceId(node.id)),
    error: options.notifications.error
  });
}
