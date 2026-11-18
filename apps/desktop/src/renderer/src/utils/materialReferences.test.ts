import { describe, expect, it } from "vitest";
import { effectScope, ref } from "vue";
import {
  ATTACHED_CONTEXT_MAX_ITEMS,
  MATERIAL_KINDS,
  CatalogIndexSnapshotSchema,
  CatalogSnapshotSchema,
  createDefaultCreativePlotStages,
  getDefaultLongAgentProfile,
  type CatalogIndexSnapshot,
  type CreativeBook,
  type LongBookSummary,
  type MaterialKind,
  type MaterialStageId
} from "@deepwrite/contracts/renderer";
import { creationMaterialReferences } from "./shortLibraryReferences";
import { longMaterialReferences } from "./longLibraryReferences";
import { useConversationComposer } from "../composables/useConversationComposer";

const NOW = "2026-10-12T00:00:00.000Z";

function materialEntry(
  id: string,
  stageId: MaterialStageId,
  contentBytes = 24
): CatalogIndexSnapshot["materials"][number]["entries"][number] {
  return {
    id,
    stageId,
    title: id,
    body: "",
    contentBytes,
    contentStamp: `fs-v1:${contentBytes}:100:200`,
    createdAt: NOW,
    updatedAt: NOW
  };
}

function fixture() {
  const library = {
    id: "material-mixed",
    title: "综合素材",
    materialType: "short",
    materialKind: "mixed",
    parentGenre: "",
    subGenre: "",
    overview: "",
    overviewContentBytes: 0,
    overviewContentStamp: "fs-v1:0:100:200",
    entries: [
      ...Array.from({ length: ATTACHED_CONTEXT_MAX_ITEMS + 6 }, (_, index) =>
        materialEntry(`character-${index}`, "character")
      ),
      materialEntry("plot-entry", "pacing"),
      materialEntry("draft-entry", "draft_excerpt"),
      materialEntry("unbound-kind", "other"),
      materialEntry("empty-entry", "character", 0)
    ],
    createdAt: NOW,
    updatedAt: NOW
  };
  const snapshot = CatalogIndexSnapshotSchema.parse({
    schemaVersion: 1,
    revision: 1,
    creativePlotStages: createDefaultCreativePlotStages(),
    books: [],
    materials: [
      library,
      { ...library, id: "unbound-library", title: "未绑定素材库" }
    ],
    materialGroups: [],
    skills: [],
    skillGroups: [],
    updatedAt: NOW
  });
  const book = CatalogSnapshotSchema.parse({
    ...snapshot,
    books: [
      {
        id: "book-references",
        title: "引用测试",
        bookType: "short",
        genre: "悬疑",
        status: "editing",
        linkedMaterialIdsByKind: {
          character: [library.id],
          gimmick: [],
          plot: [library.id],
          draft: [library.id],
          other: []
        },
        linkedSkillIdsByKind: { general: [], plot: [], style: [], other: [] },
        documents: [],
        createdAt: NOW,
        updatedAt: NOW
      }
    ]
  }).books[0] as CreativeBook;
  return { snapshot, book };
}

function longSummary(book: CreativeBook): LongBookSummary {
  return {
    schemaVersion: 1,
    kind: "deepwrite.long-book",
    id: "longbook_references",
    title: book.title,
    bookType: "long",
    genre: book.genre,
    status: book.status,
    linkedMaterialIdsByKind: book.linkedMaterialIdsByKind,
    linkedSkillIdsByKind: book.linkedSkillIdsByKind,
    // Old manifests retain this field; it must not hide references in other stages.
    linkedResourceStageScopes: {
      materials: { "material-mixed": ["character_design"] },
      skills: {}
    },
    createdAt: NOW,
    updatedAt: NOW,
    navigation: {
      schemaVersion: 1,
      bookId: "longbook_references",
      updatedAt: NOW,
      counts: {
        worldbuildingCategories: 0,
        characters: 0,
        volumes: 0,
        arcs: 0,
        chapterCards: 0,
        storyEvents: 0,
        storyPlots: 0,
        foreshadowingThreads: 0,
        committedChapters: 0
      },
      worldbuilding: [],
      characterTypes: [],
      characters: [],
      volumes: [],
      arcs: [],
      chapterCards: [],
      committedThroughChapterId: null
    }
  };
}

function groupedFixture() {
  const { snapshot, book } = fixture();
  const library = snapshot.materials[0]!;
  const entries: Record<
    MaterialKind,
    { stageId: MaterialStageId; titles: string[] }
  > = {
    character: {
      stageId: "character",
      titles: Array.from({ length: 60 }, (_, i) => `人物 ${i}`)
    },
    gimmick: { stageId: "gimmick", titles: ["故事构思"] },
    plot: {
      stageId: "pacing",
      titles: [
        "分卷剧情 1",
        "分卷剧情 3",
        "分卷剧情 4",
        "分卷剧情 2",
        "开篇分析",
        "伏笔与回收",
        "全书主线"
      ]
    },
    draft: { stageId: "draft_excerpt", titles: ["正文示例"] },
    other: {
      stageId: "other",
      titles: ["势力", "规则", "历史", "物品", "地理", "术语"]
    }
  };
  snapshot.materials = MATERIAL_KINDS.map((kind) => ({
    ...library,
    id: `library-${kind}`,
    title: `示例${kind}`,
    materialKind: kind,
    entries: entries[kind].titles.map((title, i) => ({
      ...materialEntry(`entry-${i}`, entries[kind].stageId),
      title
    }))
  }));
  book.linkedMaterialIdsByKind = {
    character: ["library-character"],
    gimmick: ["library-gimmick"],
    plot: ["library-plot"],
    draft: ["library-draft"],
    other: ["library-other"]
  };
  return { snapshot, book, entries };
}

const referenceBuilders = [
  {
    name: "short",
    build: (
      snapshot: CatalogIndexSnapshot,
      book: CreativeBook,
      kinds: MaterialKind[]
    ) => creationMaterialReferences(snapshot, book, kinds)
  },
  {
    name: "script",
    build: (
      snapshot: CatalogIndexSnapshot,
      book: CreativeBook,
      kinds: MaterialKind[]
    ) =>
      creationMaterialReferences(
        snapshot,
        { ...book, bookType: "script" },
        kinds
      )
  },
  {
    name: "long",
    build: (
      snapshot: CatalogIndexSnapshot,
      book: CreativeBook,
      kinds: MaterialKind[]
    ) => {
      const profile = getDefaultLongAgentProfile("long");
      return longMaterialReferences(snapshot, longSummary(book), {
        ...profile,
        readAccess: { ...profile.readAccess, materialKinds: kinds }
      });
    }
  }
];

describe.each(referenceBuilders)("$name material references", ({ build }) => {
  it("searches every plot and other entry after preceding libraries fill the old capacity", () => {
    const { snapshot, book, entries } = groupedFixture();
    const references = build(snapshot, book, [...MATERIAL_KINDS]);
    const scope = effectScope();
    const composer = scope.run(() =>
      useConversationComposer({
        draft: () => "",
        canSend: () => false,
        canSendAttachments: () => false,
        runtimeAvailable: () => true,
        libraryDomain: () => undefined,
        availableSkills: () => [],
        availableMaterials: () => references,
        availableTeamMembers: () => null,
        editorReferences: () => [],
        textAttachmentMaxCharacters: () => 50_000,
        textAttachmentsTotalMaxCharacters: () => 57_600,
        pendingAttachments: ref([]),
        readingAttachments: ref(false),
        emitDraft: () => {},
        emitSend: () => {},
        emitClearEditorReferences: () => {}
      })
    );
    if (!composer) throw new Error("Composer scope did not run");
    try {
      for (const [query, kind] of [
        ["", null],
        ["剧情", "plot"],
        ["其他", "other"]
      ] as const) {
        const value = `@${query}`;
        composer.updateActiveReference({
          value,
          selectionStart: value.length
        } as HTMLTextAreaElement);
        const options = composer.filteredReferenceOptions.value;
        expect(options).toHaveLength(kind ? entries[kind].titles.length : 75);
        if (kind) {
          expect(options.map(({ label }) => label)).toEqual(
            entries[kind].titles.map((title) => `示例${kind} · ${title}`)
          );
        }
      }
    } finally {
      scope.stop();
    }
  });

  it("includes every non-empty entry from a bound library beyond attachment capacity", () => {
    const { snapshot, book } = fixture();
    const references = build(snapshot, book, [
      "character",
      "plot",
      "draft",
      "other"
    ]);
    expect(references).toHaveLength(ATTACHED_CONTEXT_MAX_ITEMS + 9);
    expect(references.map(({ label }) => label)).toContain(
      "综合素材 · character-69"
    );
    expect(references.map(({ label }) => label)).toContain(
      "综合素材 · plot-entry"
    );
    expect(references.map(({ label }) => label)).toContain(
      "综合素材 · draft-entry"
    );
    expect(new Set(references.map(({ id }) => id)).size).toBe(
      references.length
    );
  });

  it("includes all non-empty bound entries across buckets while skipping empty entries", () => {
    const { snapshot, book } = fixture();
    const labels = build(snapshot, book, ["plot", "draft", "other"]).map(
      ({ label }) => label
    );
    expect(labels).toContain("综合素材 · plot-entry");
    expect(labels).toContain("综合素材 · draft-entry");
    expect(labels).toContain("综合素材 · character-0");
    expect(labels).not.toContain("综合素材 · empty-entry");
    expect(
      build(
        snapshot,
        {
          ...book,
          linkedMaterialIdsByKind: {
            character: [],
            gimmick: [],
            plot: [],
            draft: [],
            other: []
          }
        },
        []
      )
    ).toEqual([]);
  });
});
