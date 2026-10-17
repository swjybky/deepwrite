import { afterEach, expect, it } from "vitest";
import { createLongWorkspaceNavigationSnapshot } from "@deepwrite/contracts";
import { setAppLanguage } from "../i18n";
import {
  createLongChapterSelection,
  nextWritableLongChapterId
} from "../types/longWorkspace";
import { createLongChapterLookup } from "../types/longIndexedChapter";
import type { ResourceTreeNode } from "../types/workspace";
import { projectLongWorkspaceNavigation } from "./longWorkspaceResourceTree";
import { createLongWorkspaceNavigationCache } from "./longWorkspaceNavigationCache";
import { longWorkspaceScaleFixture } from "./longWorkspaceScale.test-support";

afterEach(() => setAppLanguage("zh-CN", "zh-CN"));
const flatten = (nodes: ResourceTreeNode[]): ResourceTreeNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);

it.each([800, 1200, 3000])(
  "%i imported chapters project with a bounded number of status reads",
  (count) => {
    const { book, index } = longWorkspaceScaleFixture(count);
    index.featureSettings.plotItemLayout = "left-tree";
    let reads = 0;
    for (const chapter of index.chapters)
      Object.defineProperty(chapter, "bodyStatus", {
        enumerable: true,
        get() {
          reads++;
          return "written";
        }
      });
    const nodes = flatten(projectLongWorkspaceNavigation(book, index));
    const chapters = nodes.filter((node) =>
      node.longWorkspaceSelection?.key.startsWith("chapter:")
    );
    expect(chapters).toHaveLength(count);
    expect(reads).toBeLessThan(count * 8);
    for (const node of [chapters[0]!, chapters.at(-1)!]) {
      expect(JSON.stringify(node.longWorkspaceSelection)).toBe(
        JSON.stringify(
          createLongChapterSelection(
            book,
            index,
            node.longWorkspaceSelection!.chapterCardId!
          )
        )
      );
      expect(node.badge).toBe("待提交");
    }
    const cards = nodes.filter(
      (node) => node.longTreeItem?.kind === "chapter-card"
    );
    expect(cards[0]!.longWorkspaceSelection!.chapterCardTabs).toBe(
      cards.at(-1)!.longWorkspaceSelection!.chapterCardTabs
    );
  }
);

it("keeps volume/order/id precedence and computes the next empty chapter once per projection", () => {
  const { book, index } = longWorkspaceScaleFixture(300);
  index.plot.volumes.push({
    id: "volume_two",
    title: "第二卷",
    order: 0,
    summary: ""
  });
  const first = index.plot.chapterCards[0]!;
  first.volumeId = "volume_two";
  for (const chapter of index.chapters) chapter.bodyStatus = "empty";
  expect(nextWritableLongChapterId(index)).toBe(first.id);
  const lookup = createLongChapterLookup(book, index);
  let reads = 0;
  for (const chapter of index.chapters)
    Object.defineProperty(chapter, "bodyStatus", {
      configurable: true,
      get() {
        reads++;
        return "empty";
      }
    });
  for (const chapter of index.chapters)
    createLongChapterSelection(book, index, chapter.chapterCardId, lookup);
  expect(reads).toBeLessThanOrEqual(600);
  index.chapters.forEach((chapter) =>
    Object.defineProperty(chapter, "bodyStatus", { value: "written" })
  );
  expect(nextWritableLongChapterId(index)).toBeNull();
});

it("reuses content-only directory nodes while selections resolve the latest file versions", () => {
  const { book, index } = longWorkspaceScaleFixture(20);
  const cache = createLongWorkspaceNavigationCache();
  const before = cache.project(book, index, "zh-CN");
  const next = structuredClone(index);
  next.updatedAt = "2026-10-06T00:00:01.000Z";
  next.chapters[0]!.body.updatedAt = next.updatedAt;
  next.plot.volumes[0]!.summary = "后台更新的分卷概要";
  const nextBook = {
    ...book,
    updatedAt: next.updatedAt,
    navigation: createLongWorkspaceNavigationSnapshot(next)
  };
  const after = cache.project(nextBook, next, "zh-CN");
  expect(after).toBe(before);
  const chapter = flatten(after).find(
    (node) => node.longWorkspaceSelection?.key === "chapter:chapter_1"
  )!;
  expect(chapter.longWorkspaceSelection!.files[0]!.file.updatedAt).toBe(
    next.updatedAt
  );
  expect(chapter.longWorkspaceSelection!.files[0]!.file).toBe(
    next.chapters[0]!.body
  );
  const expected = JSON.stringify(
    projectLongWorkspaceNavigation(nextBook, next)
  );
  expect(JSON.parse(JSON.stringify(after))).toEqual(JSON.parse(expected));
});

it("does not rescan an unchanged index on repeated projections", () => {
  const { book, index } = longWorkspaceScaleFixture(600);
  const chapters = index.chapters;
  let reads = 0;
  Object.defineProperty(index, "chapters", {
    configurable: true,
    get() {
      reads += 1;
      return chapters;
    }
  });
  const cache = createLongWorkspaceNavigationCache();

  cache.project(book, index, "zh-CN");
  const firstProjectionReads = reads;
  cache.project(book, index, "zh-CN");

  expect(firstProjectionReads).toBeGreaterThan(0);
  expect(reads).toBe(firstProjectionReads);
});

it("rebuilds for order/status/commit/layout/language changes and releases removed books", () => {
  const { book, index } = longWorkspaceScaleFixture(3);
  const cache = createLongWorkspaceNavigationCache();
  let previous = cache.project(book, index, "zh-CN");
  for (const edit of [
    () => {
      index.plot.chapterCards[0]!.narrativeOrder = 3;
      index.plot.chapterCards[2]!.narrativeOrder = 1;
    },
    () => {
      index.chapters[1]!.bodyStatus = "empty";
    },
    () => {
      index.chapters[0]!.commitId = "commit_one";
    },
    () => {
      index.featureSettings.plotItemLayout = "left-tree";
    }
  ]) {
    edit();
    const nextBook = {
      ...book,
      navigation: createLongWorkspaceNavigationSnapshot(index)
    };
    const current = cache.project(nextBook, index, "zh-CN");
    expect(current).not.toBe(previous);
    expect(JSON.stringify(current)).toBe(
      JSON.stringify(projectLongWorkspaceNavigation(nextBook, index))
    );
    previous = current;
  }
  setAppLanguage("en-US", "en-US");
  expect(cache.project(book, index, "en-US")).not.toBe(previous);
  const english = cache.project(book, index, "en-US");
  expect(cache.project(book, index, "en-US", {})).not.toBe(english);
  const retained = cache.project(book, index, "en-US");
  cache.retain(new Set());
  expect(cache.project(book, index, "en-US")).not.toBe(retained);
});
