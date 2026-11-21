import { builtinAgentLabel } from "../i18n/builtinLabels";
import { createScopedTranslator } from "../i18n";
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

const t = createScopedTranslator("workspace");

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
  if (document.workspaceType === "academic") {
    return builtinAgentLabel("academic");
  }
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
  const profile = settings
    .find(({ workspaceType }) => workspaceType === document.workspaceType)
    ?.agents.find(({ id }) => id === agentId);
  return profile
    ? builtinAgentLabel(document.workspaceType, profile.label)
    : undefined;
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
    ? builtinAgentLabel(
        libraryDomain,
        sources.libraryAgents.agents.find(
          ({ domain }) => domain === libraryDomain
        )?.label
      )
    : shortAgentLabel(document, sources.workspaceAgents);
  const owner = document.workspaceTitle ?? document.path[0] ?? document.title;
  return {
    conversationKey,
    agentLabel: agentLabel ?? t("agentActivityDescriptors.agentConversation"),
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

function findChapterCardNode(
  lookup: ResourceTreeLookup,
  bookId: string,
  root: LongWorkspaceRoot | undefined,
  chapterCardId: string
): ResourceTreeNode | undefined {
  if (!root || root === "plot_design" || root === "draft") {
    return lookup.nodeById.get(
      longNavigationNodeId(bookId, `chapter:${chapterCardId}`)
    );
  }
  return [...lookup.nodeById.values()].find(
    (node) =>
      node.longBookId === bookId &&
      node.longWorkspaceSelection?.root === root &&
      node.longWorkspaceSelection.chapterCardId === chapterCardId
  );
}

function longStageResourceId(
  lookup: ResourceTreeLookup,
  bookId: string,
  root: LongWorkspaceRoot
): string {
  const rootResourceId = longNavigationNodeId(bookId, `root:${root}`);
  if (lookup.nodeById.has(rootResourceId)) return rootResourceId;
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
    agentLabel: builtinAgentLabel("long", agent?.label),
    contextLabel: parsed.root
      ? t("catalogWorkspace.message", {
          value: book?.title ?? t("agentActivityDescriptors.novelProject"),
          value2: LONG_WORKSPACE_ROOT_LABELS[parsed.root]
        })
      : (book?.title ?? t("agentActivityDescriptors.novelProject")),
    targetResourceId:
      matchingNode?.id ??
      (parsed.root
        ? longStageResourceId(sources.resourceTree, parsed.bookId, parsed.root)
        : longBookResourceId(parsed.bookId)),
    ...(parsed.chapterCardId ? { chapterCardId: parsed.chapterCardId } : {}),
    ...(parsed.root === "plot_design" && parsed.chapterCardId
      ? { chapterCardView: "card" as const }
      : {})
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
  if (parsed && chapterCardId) {
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
