import { createPinia, disposePinia } from "pinia";
import {
  createRenderer,
  h,
  nextTick,
  ref,
  ssrContextKey,
  type Component
} from "vue";
import { expect, it, vi } from "vitest";
import WorkspaceShell from "./WorkspaceShell.vue";
import { useCatalogIndexStore } from "./stores/catalogIndexStore";
import { useLongWorkspaceStore } from "./stores/longWorkspaceStore";

const { cleanup } = vi.hoisted(() => ({ cleanup: [] as Promise<void>[] }));

vi.mock("./composables/useWorkspaceLifecycleCoordinator", async (load) => {
  const actual =
    await load<
      typeof import("./composables/useWorkspaceLifecycleCoordinator")
    >();
  return {
    ...actual,
    useWorkspaceLifecycleCoordinator(
      options: Parameters<typeof actual.useWorkspaceLifecycleCoordinator>[0]
    ) {
      const lifecycle = actual.useWorkspaceLifecycleCoordinator(options);
      return {
        ...lifecycle,
        dispose() {
          const disposing = lifecycle.dispose();
          cleanup.push(disposing);
          return disposing;
        }
      };
    }
  };
});

vi.mock("./composables/useAppearance", () => ({
  useAppearance: () => ({})
}));

const renderer = createRenderer({
  patchProp() {},
  insert() {},
  remove() {},
  createElement: () => ({}),
  createText: () => ({}),
  createComment: () => ({}),
  setText() {},
  setElementText() {},
  parentNode: () => null,
  nextSibling: () => null
});

it("keeps both Pinia stores usable after the previous workbench unmounts", async () => {
  vi.stubGlobal(
    "window",
    Object.assign(new EventTarget(), {
      localStorage: { getItem: () => null },
      innerWidth: 1440
    })
  );
  vi.stubGlobal("document", { documentElement: {} });
  const pinia = createPinia();
  const catalog = useCatalogIndexStore(pinia);
  const longWorkspace = useLongWorkspaceStore(pinia);
  const key = ref(0);
  const shell = { ...WorkspaceShell, render: () => null } as Component;
  const app = renderer.createApp({
    render: () => h(shell, { key: key.value })
  });
  app.provide(ssrContextKey, { modules: new Set() });
  app.use(pinia).mount({});

  try {
    catalog.cacheDocument("fixture", { content: "测试正文" });
    key.value += 1;
    await nextTick();
    expect(cleanup).toHaveLength(1);
    await cleanup[0];

    expect(catalog.getCachedDocument("fixture")).toEqual({
      content: "测试正文"
    });
    await expect(
      longWorkspace.ensureBookList(async () => ({
        updatedAt: "2026-11-20T00:00:00.000Z",
        books: []
      }))
    ).resolves.toMatchObject({ books: [] });
  } finally {
    app.unmount();
    await Promise.all(cleanup);
    disposePinia(pinia);
    vi.unstubAllGlobals();
  }
});
