import {
  resolveScriptWorkspaceAgentIdForStage,
  resolveShortWorkspaceAgentIdForStage,
  type LibraryAgentSettings,
  type LongAgentSettings,
  type LongBookSummary,
  type LongWorkspaceRoot,
  type WorkspaceAgentSettings
} from "@deepwrite/contracts";
import type {
  AgentActivityDescriptor,
  AgentActivityItem
} from "../types/agentActivity";
import type { ResourceTreeNode, WorkspaceDocument } from "../types/workspace";
import { longBookResourceId } from "../types/longWorkspace";
import type { ResourceTreeLookup } from "./resourceTreeLookup";
import { agentConversationKeyForDocument } from "./agentRunPreferences";
import {
  LONG_WORKSPACE_ROOT_LABELS,
  longNavigationNodeId
} from "./longWorkspaceResourceTree";

export interface AgentActivityDescriptorSources {
  documents: readonly WorkspaceDocument[];
  resourceTree: ResourceTreeLookup;
  workspaceAgents: readonly WorkspaceAgentSettings[];
  longAgents: LongAgentSettings;
  libraryAgents: LibraryAgentSettings;
  longBooks: readonly LongBookSummary[];
}

function resourceIdForDocument(
  document: WorkspaceDocument,
  lookup: ResourceTreeLookup
): string {
  return lookup.resourceIdByDocumentId.get(document.id) ?? document.id;
}

function shortAgentLabel(
  document: WorkspaceDocument,
  settings: readonly WorkspaceAgentSettings[]
): string | undefined {
  if (
    !document.stageId ||
    (document.workspaceType !== "short" && document.workspaceType !== "script")
  ) {
    return undefined;
  }
  const agentId =
    document.shortAgentId ??
    (document.workspaceType === "script"
      ? resolveScriptWorkspaceAgentIdForStage(document.stageId)
      : resolveShortWorkspaceAgentIdForStage(document.stageId));
  return settings
    .find(({ workspaceType }) => workspaceType === document.workspaceType)
    ?.agents.find(({ id }) => id === agentId)?.label;
}

function resolveDocumentDescriptor(
  conversationKey: string,
  sources: AgentActivityDescriptorSources
): AgentActivityDescriptor | undefined {
  const document = sources.documents.find(
    (candidate) =>
      agentConversationKeyForDocument(candidate) === conversationKey
  );
  if (!document) return undefined;
  const libraryDomain =
    document.domain === "skill" || document.domain === "material"
      ? document.domain
      : undefined;
  const agentLabel = libraryDomain
    ? sources.libraryAgents.agents.find(
        ({ domain }) => domain === libraryDomain
      )?.label
    : shortAgentLabel(document, sources.workspaceAgents);
  const owner = document.workspaceTitle ?? document.path[0] ?? document.title;
  return {
    conversationKey,
    agentLabel: agentLabel ?? "智能体对话",
    contextLabel:
      document.workspaceId || owner === document.title
        ? owner
        : `${owner} · ${document.title}`,
    targetResourceId: resourceIdForDocument(document, sources.resourceTree)
  };
}

function decodeSegment(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

export interface ParsedLongAgentActivityKey {
  bookId: string;
  root?: LongWorkspaceRoot;
  chapterCardId?: string;
}

export function parseLongAgentActivityKey(
  conversationKey: string
): ParsedLongAgentActivityKey | undefined {
  const bookMatch = conversationKey.match(/^long:([^:]+):chat$/u);
  if (bookMatch) {
    const bookId = decodeSegment(bookMatch[1]!);
    return bookId ? { bookId } : undefined;
  }
  const match = conversationKey.match(/^long:([^:]+):([^:]+):(.+)$/u);
  if (!match) return undefined;
  const bookId = decodeSegment(match[1]!);
  const root = match[2]!;
  const chapterCardId = decodeSegment(match[3]!);
  if (!bookId || !(root in LONG_WORKSPACE_ROOT_LABELS)) return undefined;
  return {
    bookId,
    root: root as LongWorkspaceRoot,
    ...(chapterCardId && chapterCardId !== "__book__" ? { chapterCardId } : {})
  };
}

function nodeMatchesChapterCard(
  node: ResourceTreeNode,
  bookId: string,
  root: LongWorkspaceRoot,
  chapterCardId: string
): boolean {
  const selection = node.longWorkspaceSelection;
  return Boolean(
    node.longBookId === bookId &&
    selection?.root === root &&
    (selection.chapterCardId === chapterCardId ||
      selection.chapterCardTabs?.some(({ id }) => id === chapterCardId))
  );
}

function findChapterCardNode(
  lookup: ResourceTreeLookup,
  bookId: string,
  root: LongWorkspaceRoot,
  chapterCardId: string
): ResourceTreeNode | undefined {
  const matches = [...lookup.nodeById.values()].filter((node) =>
    nodeMatchesChapterCard(node, bookId, root, chapterCardId)
  );
  return (
    matches.find((node) => node.longTreeItem?.kind === "chapter-card") ??
    matches.find((node) =>
      node.longWorkspaceSelection?.key.startsWith("plot-design:chapter-cards:")
    ) ??
    matches.find((node) =>
      node.longWorkspaceSelection?.key.startsWith("chapter:")
    ) ??
    matches[0]
  );
}

function longStageResourceId(
  lookup: ResourceTreeLookup,
  bookId: string,
  root: LongWorkspaceRoot
): string {
  const rootResourceId = longNavigationNodeId(bookId, `root:${root}`);
  if (lookup.nodeById.has(rootResourceId)) return rootResourceId;
  if (root === "plot_design") {
    const chapterCardsId = longNavigationNodeId(
      bookId,
      "root:plot-chapter-cards"
    );
    if (lookup.nodeById.has(chapterCardsId)) return chapterCardsId;
  }
  const bookResourceId = longBookResourceId(bookId);
  return lookup.nodeById.has(bookResourceId) ? bookResourceId : rootResourceId;
}

function isCompatibleLongActivityNode(
  parsed: ParsedLongAgentActivityKey,
  node: ResourceTreeNode
): boolean {
  return (
    node.longBookId === parsed.bookId &&
    (!parsed.root || node.longWorkspaceSelection?.root === parsed.root)
  );
}

function resolveLongDescriptor(
  conversationKey: string,
  sources: AgentActivityDescriptorSources
): AgentActivityDescriptor | undefined {
  const parsed = parseLongAgentActivityKey(conversationKey);
  if (!parsed) return undefined;
  const book = sources.longBooks.find(({ id }) => id === parsed.bookId);
  const agent = sources.longAgents.agents[0];
  const matchingNode =
    parsed.root && parsed.chapterCardId
      ? findChapterCardNode(
          sources.resourceTree,
          parsed.bookId,
          parsed.root,
          parsed.chapterCardId
        )
      : undefined;
  return {
    conversationKey,
    agentLabel: agent?.label ?? "长篇智能体",
    contextLabel: parsed.root
      ? `${book?.title ?? "长篇作品"} · ${LONG_WORKSPACE_ROOT_LABELS[parsed.root]}`
      : (book?.title ?? "长篇作品"),
    targetResourceId:
      matchingNode?.id ??
      (parsed.root
        ? longStageResourceId(sources.resourceTree, parsed.bookId, parsed.root)
        : longBookResourceId(parsed.bookId)),
    ...(parsed.chapterCardId ? { chapterCardId: parsed.chapterCardId } : {})
  };
}

export function resolveAgentActivityNavigationNode(
  item: Pick<
    AgentActivityItem,
    "conversationKey" | "targetResourceId" | "chapterCardId"
  >,
  sources: AgentActivityDescriptorSources
): ResourceTreeNode | undefined {
  const lookup = sources.resourceTree;
  const stored = lookup.nodeById.get(item.targetResourceId);
  const parsed = parseLongAgentActivityKey(item.conversationKey);
  const chapterCardId = item.chapterCardId ?? parsed?.chapterCardId;
  if (parsed?.root && chapterCardId) {
    const chapterNode = findChapterCardNode(
      lookup,
      parsed.bookId,
      parsed.root,
      chapterCardId
    );
    if (chapterNode) return chapterNode;
  }
  if (stored && (!parsed || isCompatibleLongActivityNode(parsed, stored))) {
    return stored;
  }
  const resolved = resolveAgentActivityDescriptor(
    item.conversationKey,
    sources
  );
  return resolved ? lookup.nodeById.get(resolved.targetResourceId) : stored;
}

export function resolveAgentActivityDescriptor(
  conversationKey: string,
  sources: AgentActivityDescriptorSources
): AgentActivityDescriptor | undefined {
  return conversationKey.startsWith("long:")
    ? resolveLongDescriptor(conversationKey, sources)
    : resolveDocumentDescriptor(conversationKey, sources);
}
