import { ref, shallowRef } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AcademicBook } from "@deepwrite/contracts/renderer";
import { createAcademicBookProjection } from "../../data/academicBookProjection";
import { executeExportAcademicManuscript } from "../../composables/useAcademicBookLifecycleCoordinator";
import { registerAcademicLifecyclePort } from "../../stores/academicWorkspaceDialog";
import dialogSource from "./ExportAcademicManuscriptDialog.vue?raw";
import dialogsHostSource from "./AcademicWorkspaceDialogs.vue?raw";
import menuSource from "./AcademicTreeNodeMenuItems.vue?raw";

const NOW = "2026-11-17T12:00:00.000Z";

function makeFixtureBook(): AcademicBook {
  return {
    id: "acad-export-book",
    bookType: "academic",
    title: "可信智能体论文",
    subtype: "empirical_paper",
    citationStyle: "ieee",
    status: "editing",
    linkedMaterialIds: [],
    linkedSkillIds: [],
    foundation: {
      thesisOverview: {
        id: "thesis_overview",
        title: "研究立意与核心贡献",
        content: "",
        createdAt: NOW,
        updatedAt: NOW
      },
      terminology: {
        id: "terminology",
        title: "术语与符号表",
        content: "",
        createdAt: NOW,
        updatedAt: NOW
      },
      cards: []
    },
    frameworkStages: [
      {
        id: "problem_and_gap",
        title: "立题与文献脉络",
        description: "desc",
        enabled: true
      }
    ],
    documents: [
      {
        id: "problem_and_gap",
        title: "立题与文献脉络",
        content: "",
        createdAt: NOW,
        updatedAt: NOW
      }
    ],
    manuscript: {
      chapters: [],
      sections: [
        {
          id: "sec-1",
          title: "1 引言",
          wordCountRequirement: "",
          brief: {
            id: "academic-section:sec-1:brief",
            title: "1 引言 · 写作指引",
            content: "内部指引",
            createdAt: NOW,
            updatedAt: NOW
          },
          body: {
            id: "academic-section:sec-1:body",
            title: "1 引言",
            content: "引言正式正文。",
            createdAt: NOW,
            updatedAt: NOW
          },
          state: {
            id: "academic-section:sec-1:state",
            title: "1 引言 · 节末状态",
            content: "内部状态",
            createdAt: NOW,
            updatedAt: NOW
          },
          createdAt: NOW,
          updatedAt: NOW
        }
      ]
    },
    createdAt: NOW,
    updatedAt: NOW
  };
}

describe("ExportAcademicManuscriptDialog & coordinator", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("keeps lazy loading, scoped acad-export-* classes, chapter hierarchy toggle, and md image mode options", () => {
    expect(dialogsHostSource).toContain(
      'defineAsyncComponent(\n  () => import("./ExportAcademicManuscriptDialog.vue")\n)'
    );
    expect(menuSource).toContain("openExportAcademicManuscriptDialog");
    expect(dialogSource).toContain('value="docx"');
    expect(dialogSource).toContain('value="md"');
    expect(dialogSource).toContain('value="assets_folder"');
    expect(dialogSource).toContain('value="single_file"');
    expect(dialogSource).toContain("includeChapterHeadings");
    expect(dialogSource).toContain("toggleChapter");
    expect(dialogSource).not.toContain(".tree-row");
    expect(dialogSource).not.toContain(".section-tab");
  });

  it("loads unloaded section body documents via ensureDocumentsLoaded and calls exportAcademic", async () => {
    const book = makeFixtureBook();
    const projection = createAcademicBookProjection(book);
    const unloadedDocs = projection.documents.map((doc) =>
      doc.catalogDocumentId === "academic-section:sec-1:body"
        ? {
            ...doc,
            content: "",
            catalogContentBytes: 24,
            catalogContentLoaded: false
          }
        : doc
    );
    const docsRef = shallowRef(unloadedDocs);
    const draftsRef = shallowRef({});
    const ensureDocumentsLoaded = vi.fn(async (targets) => {
      const targetIds = new Set(targets.map((d: { id: string }) => d.id));
      docsRef.value = docsRef.value.map((doc) =>
        targetIds.has(doc.id)
          ? {
              ...doc,
              content: "按需加载的引言正文。",
              catalogContentLoaded: true
            }
          : doc
      );
      return true;
    });
    const exportAcademic = vi.fn(async () => ({
      status: "saved" as const,
      filePath: "/tmp/out.docx",
      missingImages: 0
    }));

    const unregister = registerAcademicLifecyclePort({
      api: () => undefined,
      manuscriptApi: () => ({
        exportAcademic,
        exportLong: vi.fn(),
        exportShort: vi.fn()
      }),
      book: (id) => (id === book.id ? book : undefined),
      refresh: async () => true,
      prepareBookMutation: async () => true,
      ensureDocumentsLoaded,
      documents: docsRef,
      drafts: draftsRef,
      selectedResourceId: ref(""),
      activeCreationResourceId: ref(""),
      selectedExpertSectionIds: ref({}),
      selectedDraftFileKinds: ref({}),
      catalogMutationPending: ref(false),
      manuscriptExportPending: ref(false),
      notifications: {
        error: vi.fn(),
        info: vi.fn(),
        success: vi.fn(),
        warning: vi.fn()
      }
    });

    try {
      const ok = await executeExportAcademicManuscript(book.id, {
        sectionIds: ["sec-1"],
        includeChapterHeadings: false,
        format: "docx",
        imageMode: "assets_folder"
      });
      expect(ok).toBe(true);
      expect(ensureDocumentsLoaded).toHaveBeenCalledOnce();
      expect(exportAcademic).toHaveBeenCalledWith({
        book: { projectType: "academic", projectId: book.id },
        title: "可信智能体论文",
        format: "docx",
        includeChapterHeadings: false,
        items: [
          {
            sectionTitle: "1 引言",
            content: "按需加载的引言正文。"
          }
        ]
      });
    } finally {
      unregister();
    }
  });
});
