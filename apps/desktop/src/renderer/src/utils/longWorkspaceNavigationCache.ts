import type {
  LongBookSummary,
  LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import type { ResourceTreeNode } from "../types/workspace";
import { createLongChapterLookup } from "../types/longIndexedChapter";
import {
  reconcileLongWorkspaceSelection,
  type LongWorkspaceSelection
} from "../types/longWorkspace";
import { projectLongWorkspaceNavigation } from "./longWorkspaceResourceTree";

/** File revisions and prose/plot summaries do not change the visible directory. */
const navigationKeys = new WeakMap<
  LongBookSummary,
  WeakMap<LongWorkspaceIndexSnapshot, string>
>();
const emptyIndexKeys = new WeakMap<LongBookSummary, string>();

function navigationKey(
  book: LongBookSummary,
  index?: LongWorkspaceIndexSnapshot | null
) {
  if (!index) {
    const cached = emptyIndexKeys.get(book);
    if (cached) return cached;
    const key = JSON.stringify([
      book.title,
      { ...book.navigation, updatedAt: undefined },
      null
    ]);
    emptyIndexKeys.set(book, key);
    return key;
  }
  let keysForBook = navigationKeys.get(book);
  if (!keysForBook) {
    keysForBook = new WeakMap<LongWorkspaceIndexSnapshot, string>();
    navigationKeys.set(book, keysForBook);
  }
  const cached = keysForBook.get(index);
  if (cached) return cached;
  const navigation = { ...book.navigation, updatedAt: undefined };
  const key = JSON.stringify([
    book.title,
    navigation,
    index
      ? {
          settings: index.featureSettings,
          world: index.worldbuilding.map((category) => [
            category.id,
            category.format,
            category.format === "list"
              ? category.items.map(({ id, title, order }) => [id, title, order])
              : [],
            category.format === "list"
              ? category.overview?.id
              : category.file.id
          ]),
          characters: index.characterFiles.map(
            ({ characterId }) => characterId
          ),
          chapters: index.chapters.map((chapter) => [
            chapter.chapterCardId,
            chapter.bodyStatus,
            chapter.commitId,
            chapter.body.id,
            chapter.characterState.id,
            chapter.handoff.id,
            chapter.foreshadowingChanges.id,
            chapter.worldReveals?.id,
            chapter.characterContinuity.map(
              ({ characterId, currentState, history }) => [
                characterId,
                currentState.id,
                history.id
              ]
            )
          ]),
          commits: index.ledger.commits
        }
      : null
  ]);
  keysForBook.set(index, key);
  return key;
}

/** Owned by one workspace tree; deleted books release their nodes and snapshots. */
export function createLongWorkspaceNavigationCache() {
  const entries = new Map<
    string,
    {
      key: string;
      language: string;
      catalog: unknown;
      nodes: ResourceTreeNode[];
      book: LongBookSummary;
      index: LongWorkspaceIndexSnapshot | null;
      lookup: ReturnType<typeof createLongChapterLookup> | undefined;
      resolved: Map<string, LongWorkspaceSelection>;
    }
  >();

  return {
    retain(ids: ReadonlySet<string>) {
      for (const id of entries.keys()) if (!ids.has(id)) entries.delete(id);
    },
    project(
      book: LongBookSummary,
      index: LongWorkspaceIndexSnapshot | null,
      language: string,
      catalog?: unknown
    ) {
      const previous = entries.get(book.id);
      if (
        previous?.book === book &&
        previous?.index === index &&
        previous.language === language &&
        previous.catalog === catalog
      ) {
        return previous.nodes;
      }
      const key = navigationKey(book, index);
      if (
        previous?.key === key &&
        previous.language === language &&
        previous.catalog === catalog
      ) {
        previous.book = book;
        previous.index = index;
        previous.lookup = undefined;
        previous.resolved.clear();
        return previous.nodes;
      }
      const entry = {
        key,
        language,
        catalog,
        nodes: projectLongWorkspaceNavigation(book, index),
        book,
        index,
        lookup: undefined as
          ReturnType<typeof createLongChapterLookup> | undefined,
        resolved: new Map<string, LongWorkspaceSelection>()
      };
      function bind(nodes: ResourceTreeNode[]) {
        for (const node of nodes) {
          const requested = node.longWorkspaceSelection;
          if (requested) {
            // Navigation keeps its identity; opening it resolves current files,
            // permissions and tabs against the most recent authoritative index.
            entry.resolved.set(node.id, requested);
            Object.defineProperty(node, "longWorkspaceSelection", {
              enumerable: true,
              get() {
                let resolved = entry.resolved.get(node.id);
                if (!resolved) {
                  resolved = requested;
                  if (entry.index) {
                    entry.lookup ??= createLongChapterLookup(
                      entry.book,
                      entry.index
                    );
                    resolved = requested.key.startsWith("root:")
                      ? {
                          ...requested,
                          breadcrumbs: [
                            entry.book.title,
                            ...requested.breadcrumbs.slice(1)
                          ],
                          files: []
                        }
                      : (reconcileLongWorkspaceSelection(
                          entry.book,
                          entry.index,
                          requested,
                          entry.lookup
                        ) ?? requested);
                  }
                  entry.resolved.set(node.id, resolved);
                }
                return resolved;
              }
            });
          }
          if (node.children) bind(node.children);
        }
      }
      bind(entry.nodes);
      entries.set(book.id, entry);
      return entry.nodes;
    }
  };
}
