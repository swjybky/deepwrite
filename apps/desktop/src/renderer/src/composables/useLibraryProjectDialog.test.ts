import { createPinia, setActivePinia } from "pinia";
import { createRenderer, nextTick, reactive, type App } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CatalogIndexSnapshot } from "@deepwrite/contracts";
import { useCatalogIndexStore } from "../stores/catalogIndexStore";
import {
  useLibraryProjectDialog,
  type LibraryProjectDialogProps
} from "./useLibraryProjectDialog";

const apps: App[] = [];
const renderer = createRenderer({
  patchProp: () => {},
  insert: () => {},
  remove: () => {},
  createElement: () => ({}),
  createText: () => ({}),
  createComment: () => ({}),
  setText: () => {},
  setElementText: () => {},
  parentNode: () => null,
  nextSibling: () => null
});
afterEach(() => {
  apps.splice(0).forEach((app) => app.unmount());
  vi.unstubAllGlobals();
});

async function setup(domain: "material" | "skill") {
  const pinia = createPinia();
  setActivePinia(pinia);
  const libraries = ["short", "script", "long"].map((type) => ({
    id: type,
    title: type,
    materialType: type,
    skillType: type,
    materialKind: "plot",
    skillKind: "general"
  }));
  useCatalogIndexStore().snapshot = {
    materials: [
      ...libraries,
      { ...libraries[0], id: "loose", isUnbound: true }
    ],
    skills: [...libraries, { ...libraries[0], id: "official", isBuiltin: true }]
  } as unknown as CatalogIndexSnapshot;
  const props = reactive<LibraryProjectDialogProps>({
    open: true,
    operation: "create-entry",
    domain
  });
  const emit = vi.fn();
  let form!: ReturnType<typeof useLibraryProjectDialog>;
  vi.stubGlobal("document", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  });
  const app = renderer
    .createApp({
      setup() {
        form = useLibraryProjectDialog(props, emit);
        return () => null;
      }
    })
    .use(pinia);
  app.mount({});
  apps.push(app);
  return { form, props, emit };
}

describe("shared library entry creation", () => {
  it.each(["material", "skill"] as const)(
    "offers all writable %s libraries regardless of legacy type",
    async (domain) => {
      const { form, emit } = await setup(domain);
      expect(form.entryDestinations.value.map(({ value }) => value)).toEqual([
        "",
        "short",
        "script",
        "long"
      ]);
      form.title.value = " 新条目 ";
      form.submit();
      expect(emit).toHaveBeenLastCalledWith(
        "createEntry",
        expect.objectContaining({
          unbound: true,
          domain,
          title: "新条目"
        })
      );
      expect(emit.mock.calls.at(-1)?.[1]).not.toHaveProperty("libraryType");
      for (const destination of ["short", "script", "long"]) {
        form.destination.value = destination;
        await nextTick();
        form.submit();
        expect(emit).toHaveBeenLastCalledWith(
          "createEntry",
          expect.objectContaining({
            domain,
            libraryId: destination,
            title: "新条目"
          })
        );
      }
    }
  );
  it("allows all content stages regardless of the target library's tag or kind", async () => {
    const { form } = await setup("material");
    form.stageId.value = "character";
    form.destination.value = "long";
    await nextTick();
    expect(form.stageOptions.value.map(({ value }) => value)).toEqual([
      "gimmick",
      "character",
      "pacing",
      "intro",
      "plot_refine",
      "draft_excerpt",
      "other"
    ]);
    expect(form.stageId.value).toBe("character");
  });

  it("supports preset and custom tags on library creation and clearing customTag on rename", async () => {
    const { form, props, emit } = await setup("material");
    props.operation = "create-library";
    await nextTick();
    form.title.value = "深度学习文献库";
    form.libraryTagChoice.value = "preset:文献";
    form.submit();
    expect(emit).toHaveBeenLastCalledWith("createLibrary", {
      domain: "material",
      name: "深度学习文献库",
      materialKind: "other",
      customTag: "文献"
    });

    form.libraryTagChoice.value = "__custom__";
    form.customTagDraft.value = " 实验记录 ";
    form.submit();
    expect(emit).toHaveBeenLastCalledWith("createLibrary", {
      domain: "material",
      name: "深度学习文献库",
      materialKind: "other",
      customTag: "实验记录"
    });

    props.operation = "rename-library";
    props.libraryId = "long";
    props.libraryTitle = "旧名称";
    props.materialKind = "other";
    props.customTag = "实验记录";
    await nextTick();
    expect(form.libraryTagChoice.value).toBe("__custom__");
    expect(form.customTagDraft.value).toBe("实验记录");
    form.libraryTagChoice.value = "other";
    form.submit();
    expect(emit).toHaveBeenLastCalledWith("renameLibrary", {
      domain: "material",
      libraryId: "long",
      title: "旧名称",
      customTag: null
    });
  });
});
