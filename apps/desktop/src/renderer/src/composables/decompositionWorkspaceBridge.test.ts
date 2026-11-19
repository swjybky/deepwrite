import { ref } from "vue";
import { afterEach, expect, it, vi } from "vitest";
import {
  CatalogSnapshotSchema,
  createEnvelope
} from "@deepwrite/contracts/renderer";
import type {
  DecompositionContentRef,
  DecompositionTarget,
  DecompositionTargetUpdatedEvent
} from "@deepwrite/contracts";
import type { ResourceTreeNode } from "../types/workspace";
import { createDecompositionWorkspaceBridge } from "./decompositionWorkspaceBridge";
import {
  projectCatalogWorkspace,
  findProjectedWorkspaceDocument,
  resolveProjectedResourceTargetDocumentId
} from "../data/catalogWorkspace";

afterEach(() => vi.useRealTimers());
function fixture() {
  const now = "2026-10-04T00:00:00.000Z";
  const projection = projectCatalogWorkspace(
    CatalogSnapshotSchema.parse({
      schemaVersion: 1,
      revision: 1,
      updatedAt: now,
      books: [],
      materials: [
        {
          id: "library_fixture",
          title: "合成素材库",
          materialType: "long",
          materialKind: "plot",
          parentGenre: "",
          subGenre: "",
          overview: "合成素材概览",
          entries: [
            {
              id: "entry_fixture",
              title: "合成素材条目",
              stageId: "pacing",
              body: "合成内容",
              createdAt: now,
              updatedAt: now
            }
          ],
          createdAt: now,
          updatedAt: now
        }
      ],
      materialGroups: [
        {
          id: "group_fixture",
          title: "合成素材分组",
          members: {
            character: "missing_library",
            plot: "library_fixture"
          },
          createdAt: now,
          updatedAt: now
        }
      ],
      skills: [],
      skillGroups: []
    })
  );
  const group = projection.resourceSections.find(
    (section) => section.id === "material"
  )!.nodes[0]!;
  // The library node itself opens its overview; entries are its only children.
  const overview = group.children![1]!;
  const nodes = [
    group,
    overview.children![0]!,
    {
      id: "long-book:book_fixture",
      label: "合成长篇作品",
      catalogNodeType: "long-book",
      longBookId: "book_fixture"
    }
  ] as ResourceTreeNode[];
  const ports = {
    loadCatalog: vi.fn(async () => undefined),
    loadBooks: vi.fn(async () => undefined),
    refreshBook: vi.fn(async () => true),
    activeBookId: ref<string | null>("book_fixture"),
    navigate: vi.fn(async () => true),
    find: (predicate: (node: ResourceTreeNode) => boolean) =>
      nodes.find(predicate),
    select: vi.fn(async () => undefined),
    documentForResourceId: (id: string) =>
      findProjectedWorkspaceDocument(
        projection,
        resolveProjectedResourceTargetDocumentId(projection, id)
      ),
    unavailable: vi.fn()
  };
  return {
    ports,
    nodes,
    overview,
    bridge: createDecompositionWorkspaceBridge(ports)
  };
}

it("成果引用打开实际长篇文档或素材条目，目标入口打开所属作品", async () => {
  const { ports, nodes, overview, bridge } = fixture();
  await bridge.openRef({
    projectId: "book_fixture",
    fileId: "note_fixture"
  } as DecompositionContentRef);
  expect(ports.navigate).toHaveBeenCalledWith({
    kind: "long",
    bookId: "book_fixture",
    candidates: [{ kind: "file", fileId: "note_fixture" }]
  });
  await bridge.openRef({
    projectId: "library_fixture",
    resourceId: "entry_fixture"
  } as DecompositionContentRef);
  expect(ports.select).toHaveBeenLastCalledWith(nodes[1]);
  await bridge.openTarget({
    kind: "long",
    bookId: "book_fixture"
  } as DecompositionTarget);
  expect(ports.select).toHaveBeenLastCalledWith(nodes[2]);
  await bridge.openTarget({
    kind: "material-group",
    groupId: "group_fixture"
  } as DecompositionTarget);
  expect(ports.select).toHaveBeenLastCalledWith(overview);
  expect(ports.documentForResourceId(overview.id)).toMatchObject({
    domain: "material",
    catalogLibraryField: "overview",
    libraryId: "library_fixture"
  });
  expect(ports.unavailable).not.toHaveBeenCalled();
  bridge.dispose();
});

it("素材分组不存在或没有可打开的成员时提示，不选择目录或缺失素材库", async () => {
  const { ports, nodes, bridge } = fixture();
  const target = {
    kind: "material-group",
    groupId: "group_fixture"
  } as Extract<DecompositionTarget, { kind: "material-group" }>;
  // Keep only the missing member from the real catalog projection.
  nodes[0]!.children!.splice(1);
  await bridge.openTarget(target);
  expect(ports.select).not.toHaveBeenCalled();
  expect(ports.unavailable).toHaveBeenCalledTimes(1);
  await bridge.openTarget({ ...target, groupId: "deleted_group" });
  expect(ports.select).not.toHaveBeenCalled();
  expect(ports.unavailable).toHaveBeenCalledTimes(2);
  bridge.dispose();
});

it("合并章节回执刷新，只刷新当前长篇正文，并在销毁时取消待刷新", async () => {
  vi.useFakeTimers();
  const { ports, bridge } = fixture();
  const event = (targetKind: "long" | "material-group", projectIds: string[]) =>
    createEnvelope(
      "decomposition.target_updated",
      {
        jobId: "ldjob_fixture",
        targetKind,
        projectIds
      },
      { id: "event_fixture" }
    ) as DecompositionTargetUpdatedEvent;
  const first = bridge.handle(event("long", ["book_fixture"]));
  const second = bridge.handle(event("long", ["book_fixture", "other_book"]));
  const third = bridge.handle(event("material-group", ["library_fixture"]));
  await vi.advanceTimersByTimeAsync(150);
  await Promise.all([first, second, third]);
  expect(ports.refreshBook).toHaveBeenCalledExactlyOnceWith("book_fixture");
  expect(ports.loadBooks).toHaveBeenCalledTimes(1);
  expect(ports.loadCatalog).toHaveBeenCalledTimes(1);
  const pending = bridge.handle(event("long", ["book_fixture"]));
  bridge.dispose();
  await pending;
  await vi.advanceTimersByTimeAsync(150);
  expect(ports.refreshBook).toHaveBeenCalledTimes(1);
});

it("当前作品刷新未发布或刷新时切换作品，仍同步目录列表", async () => {
  vi.useFakeTimers();
  const { ports, bridge } = fixture();
  const event = createEnvelope(
    "decomposition.target_updated",
    {
      jobId: "ldjob_fixture",
      targetKind: "long",
      projectIds: ["book_fixture"]
    },
    { id: "event_fixture" }
  ) as DecompositionTargetUpdatedEvent;
  ports.refreshBook.mockResolvedValueOnce(false);
  const failed = bridge.handle(event);
  await vi.advanceTimersByTimeAsync(150);
  await failed;
  expect(ports.loadBooks).toHaveBeenCalledTimes(1);
  ports.refreshBook.mockImplementationOnce(async () => {
    ports.activeBookId.value = "other_book";
    return true;
  });
  const changed = bridge.handle(event);
  await vi.advanceTimersByTimeAsync(150);
  await changed;
  expect(ports.loadBooks).toHaveBeenCalledTimes(2);
  bridge.dispose();
});

it("刷新期间到达的回执保留最后一次同步，包括停止前的最后写入", async () => {
  vi.useFakeTimers();
  const { ports, bridge } = fixture();
  let resolve!: (value: boolean) => void;
  ports.refreshBook.mockImplementationOnce(
    () =>
      new Promise<boolean>((done) => {
        resolve = done;
      })
  );
  const event = createEnvelope(
    "decomposition.target_updated",
    {
      jobId: "ldjob_fixture",
      targetKind: "long",
      projectIds: ["book_fixture"]
    },
    { id: "event_fixture" }
  ) as DecompositionTargetUpdatedEvent;
  const initial = bridge.handle(event);
  await vi.advanceTimersByTimeAsync(150);
  const last = bridge.handle(event);
  resolve(true);
  await initial;
  await vi.advanceTimersByTimeAsync(150);
  await last;
  expect(ports.refreshBook).toHaveBeenCalledTimes(2);
  expect(ports.loadBooks).not.toHaveBeenCalled();
  bridge.dispose();
});
