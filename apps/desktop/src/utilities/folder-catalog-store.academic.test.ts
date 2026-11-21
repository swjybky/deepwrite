import {
  FolderCatalogStore,
  describe,
  expect,
  it,
  join,
  makeTemporaryRoot,
  readFile
} from "./folder-catalog-store.test-support";
import {
  CurrentAcademicBookProjectManifestSchema,
  createAcademicSectionDocumentId,
  type MutateAcademicFrameworkInput
} from "@deepwrite/contracts";
import { FolderCatalogConflictError } from "./folder-catalog-store";
import { FolderCatalogAcademicCiteKeyConflictError } from "./folder-catalog-store/academic-mutations";

describe("FolderCatalogStore academic book storage & mutations", () => {
  it("moves a framework stage across multiple rows in one revision", async () => {
    const root = await makeTemporaryRoot("deepwrite-academic-reorder-");
    const store = new FolderCatalogStore({ userDataPath: root });
    const { resource: book } = await store.createAcademicBook({
      title: "排序测试",
      subtype: "empirical_paper"
    });
    const [first, second, third, last] = book.frameworkStages;
    const input = {
      bookId: book.id,
      baseProjectRevision: book.projectRevision,
      mutation: {
        type: "reorder",
        stageId: first!.id,
        anchorId: last!.id,
        position: "after"
      }
    } satisfies MutateAcademicFrameworkInput;

    const reordered = await store.mutateAcademicFramework(input);
    expect(reordered.frameworkStages).toEqual([second, third, last, first]);
    expect(reordered.documents).toEqual(book.documents);
    expect(reordered.projectRevision).toBe(book.projectRevision! + 1);
    await expect(store.mutateAcademicFramework(input)).rejects.toBeInstanceOf(
      FolderCatalogConflictError
    );

    const current = {
      ...input,
      baseProjectRevision: reordered.projectRevision
    };
    const sameOrder = await store.mutateAcademicFramework(current);
    expect(sameOrder.projectRevision).toBe(reordered.projectRevision);
    await expect(
      store.mutateAcademicFramework({
        ...current,
        mutation: { ...input.mutation, anchorId: "missing" }
      })
    ).rejects.toThrow();

    const restored = await store.mutateAcademicFramework({
      ...current,
      mutation: { ...input.mutation, anchorId: second!.id, position: "before" }
    });
    expect(restored.frameworkStages).toEqual(book.frameworkStages);
  });

  it("creates flat and chaptered academic books on disk and isolates them from global creative plot stages", async () => {
    const root = await makeTemporaryRoot("deepwrite-academic-books-");
    const store = new FolderCatalogStore({ userDataPath: root });

    const shortBook = (
      await store.createShortBook({
        title: "对照短篇",
        genre: "科幻"
      })
    ).resource;
    const paper = (
      await store.createAcademicBook({
        title: "长上下文注意力机制实证研究",
        subtype: "empirical_paper"
      })
    ).resource;
    const thesis = (
      await store.createAcademicBook({
        title: "大规模推理系统博士学位论文",
        subtype: "thesis_dissertation"
      })
    ).resource;

    expect(paper.bookType).toBe("academic");
    expect(paper.citationStyle).toBe("ieee");
    expect(paper.manuscript.chapters).toEqual([]);
    expect(paper.manuscript.sections.at(-1)?.title).toBe("参考文献");

    expect(thesis.bookType).toBe("academic");
    expect(thesis.citationStyle).toBe("gbt7714");
    expect(thesis.manuscript.chapters.length).toBeGreaterThanOrEqual(4);
    expect(
      thesis.manuscript.sections.some((section) => Boolean(section.chapterId))
    ).toBe(true);

    const paperDir = await store.projectDirectory(paper.id);
    const rawManifest = JSON.parse(
      await readFile(join(paperDir, "deepwrite.json"), "utf8")
    );
    const parsedManifest =
      CurrentAcademicBookProjectManifestSchema.parse(rawManifest);
    expect(parsedManifest.schemaVersion).toBe(4);
    expect(parsedManifest.foundation.thesisOverview.path).toBe(
      "foundation/thesis-overview.md"
    );

    // Mutate global creative plot stages via shortBook and verify academic books remain untouched
    await store.mutatePlotStructure({
      bookId: shortBook.id,
      baseProjectRevision: shortBook.projectRevision ?? 1,
      mutation: {
        type: "create",
        title: "全局新增悬念阶段",
        description: "仅影响短篇与剧本"
      }
    });

    const snapshot = await store.snapshot();
    const indexSnapshot = await store.indexSnapshot();
    expect(snapshot.books).toHaveLength(3);
    expect(indexSnapshot.books).toHaveLength(3);

    const refreshedPaper = snapshot.books.find((b) => b.id === paper.id)!;
    if (refreshedPaper.bookType !== "academic") {
      throw new Error("Expected academic book");
    }
    expect(
      refreshedPaper.frameworkStages.some(
        (stage) => stage.title === "全局新增悬念阶段"
      )
    ).toBe(false);
  });

  it("manages reference cards, rejects duplicate citeKeys, and scrubs deleted library bindings", async () => {
    const root = await makeTemporaryRoot("deepwrite-academic-cards-");
    const store = new FolderCatalogStore({ userDataPath: root });

    const matLib = (
      await store.createLibrary({
        domain: "material",
        name: "AI 论文文献库",
        libraryType: "long",
        materialKind: "other",
        customTag: "文献"
      })
    ).resource;
    const skillLib = (
      await store.createLibrary({
        domain: "skill",
        name: "学术论证方法",
        libraryType: "short",
        skillKind: "general",
        customTag: "方法论"
      })
    ).resource;

    const book = (
      await store.createAcademicBook({
        title: "文献卡测试论文",
        subtype: "literature_review",
        linkedMaterialIds: [matLib.id],
        linkedSkillIds: [skillLib.id]
      })
    ).resource;

    const card1 = await store.createAcademicReferenceCard({
      bookId: book.id,
      citeKey: "vaswani2017",
      cardType: "literature",
      title: "Attention Is All You Need",
      content: "Transformer self-attention architecture."
    });
    expect(card1.card.citeKey).toBe("vaswani2017");
    expect(card1.book.foundation.cards).toHaveLength(1);

    await expect(
      store.createAcademicReferenceCard({
        bookId: book.id,
        citeKey: "VASWANI2017",
        cardType: "evidence",
        title: "Case-insensitive collision"
      })
    ).rejects.toBeInstanceOf(FolderCatalogAcademicCiteKeyConflictError);

    const updatedCard = await store.updateAcademicReferenceCard({
      bookId: book.id,
      cardId: card1.card.id,
      citeKey: "vaswani2017_nips",
      cardType: "evidence",
      title: "Vaswani 2017 NIPS"
    });
    expect(updatedCard.card.citeKey).toBe("vaswani2017_nips");
    expect(updatedCard.card.cardType).toBe("evidence");

    // Deleting/unregistering bound libraries scrubs linkedMaterialIds & linkedSkillIds on academic books
    await store.deleteProject({ domain: "material", projectId: matLib.id });
    await store.unregisterProject({ domain: "skill", projectId: skillLib.id });

    const afterScrub = (await store.snapshot()).books[0]!;
    if (afterScrub.bookType !== "academic") {
      throw new Error("Expected academic book");
    }
    expect(afterScrub.linkedMaterialIds).toEqual([]);
    expect(afterScrub.linkedSkillIds).toEqual([]);

    const deleted = await store.deleteAcademicReferenceCard({
      bookId: book.id,
      cardId: card1.card.id
    });
    expect(deleted.deleted).toBe(true);
    expect(deleted.book.foundation.cards).toHaveLength(0);
  });

  it("supports per-book framework mutations, chapter/section manuscript upgrades, document saves, and workspace search", async () => {
    const root = await makeTemporaryRoot("deepwrite-academic-manuscript-");
    const store = new FolderCatalogStore({ userDataPath: root });

    const book = (
      await store.createAcademicBook({
        title: "从单层升级到章节的论文",
        subtype: "tech_report_article"
      })
    ).resource;
    expect(book.manuscript.chapters).toHaveLength(0);

    const withStage = await store.mutateAcademicFramework({
      bookId: book.id,
      mutation: {
        type: "create",
        title: "形式化证明规划",
        description: "列出核心引理与定理依赖关系"
      }
    });
    const customStage = withStage.frameworkStages.find(
      (stage) => stage.title === "形式化证明规划"
    )!;
    expect(customStage).toBeDefined();

    await store.mutateAcademicFramework({
      bookId: book.id,
      mutation: {
        type: "setEnabled",
        stageId: customStage.id,
        enabled: false
      }
    });
    const afterStageDelete = await store.mutateAcademicFramework({
      bookId: book.id,
      mutation: {
        type: "delete",
        stageId: customStage.id
      }
    });
    expect(
      afterStageDelete.frameworkStages.some(
        (stage) => stage.id === customStage.id
      )
    ).toBe(false);

    const createdChapter = await store.mutateAcademicManuscript({
      bookId: book.id,
      mutation: {
        type: "create-chapter",
        title: "第一章 核心机制"
      }
    });
    const chapterId = createdChapter.chapterId!;
    const createdSection = await store.mutateAcademicManuscript({
      bookId: book.id,
      mutation: {
        type: "create-section",
        chapterId,
        title: "1.1 关键定理推导",
        wordCountRequirement: "2000 字",
        briefContent: "本节证明收敛性上界",
        bodyContent: "设目标函数满足 Lipschitz 连续条件。",
        stateContent: "已定义常数 L_0"
      }
    });
    const sectionId = createdSection.sectionId!;
    expect(
      createdSection.book.manuscript.sections.find(
        (section) => section.id === sectionId
      )?.chapterId
    ).toBe(chapterId);

    const bodyDocId = createAcademicSectionDocumentId(sectionId, "body");
    const savedDoc = await store.saveDocument({
      bookId: book.id,
      documentId: bodyDocId,
      title: "1.1 关键定理与收敛性证明",
      content: "设目标函数满足强凸与 Lipschitz 梯度连续条件，见 [lemma_lip]。",
      force: true
    });
    expect(savedDoc.title).toBe("1.1 关键定理与收敛性证明");
    expect(createdSection.book.projectRevision).toBeDefined();
    await expect(
      store.mutateAcademicManuscript({
        bookId: book.id,
        baseProjectRevision: createdSection.book.projectRevision,
        mutation: { type: "delete-section", sectionId }
      })
    ).rejects.toThrow(FolderCatalogConflictError);

    const initialCtx = await store.readWritingContext({ bookId: book.id });
    expect(initialCtx.workspaceType).toBe("academic");
    await store.writeWritingContext({
      bookId: book.id,
      content: "# 符号规范\n统一使用粗体表示向量。"
    });

    const wsIndex = await store.readWritingWorkspace(
      {
        bookId: book.id,
        bookType: "academic",
        query: { mode: "index" }
      },
      "run-academic-test"
    );
    expect(wsIndex.mode).toBe("index");
    if (wsIndex.mode === "index" && "bookType" in wsIndex) {
      expect(wsIndex.bookType).toBe("academic");
      expect(wsIndex.projectRevision).toBeGreaterThanOrEqual(
        savedDoc.projectRevision ?? 0
      );
    }

    const wsSearch = await store.readWritingWorkspace(
      {
        bookId: book.id,
        bookType: "academic",
        query: { mode: "search", query: "Lipschitz" }
      },
      "run-academic-test"
    );
    expect(wsSearch.mode).toBe("search");
    if (wsSearch.mode === "search") {
      expect(wsSearch.matches.length).toBeGreaterThanOrEqual(1);
      expect(wsSearch.matches[0]?.snippet).toContain("Lipschitz");
    }

    const afterDeleteChapter = await store.mutateAcademicManuscript({
      bookId: book.id,
      mutation: {
        type: "delete-chapter",
        chapterId,
        sectionAction: "unassign"
      }
    });
    expect(afterDeleteChapter.book.manuscript.chapters).toHaveLength(0);
    const preservedSection = afterDeleteChapter.book.manuscript.sections.find(
      (section) => section.id === sectionId
    );
    expect(preservedSection?.chapterId).toBeUndefined();
    expect(preservedSection?.body.content).toContain("Lipschitz");
  });

  it("reorders academic chapters and sections by anchor and rejects cross-chapter drops", async () => {
    const root = await makeTemporaryRoot(
      "deepwrite-academic-manuscript-reorder-"
    );
    const store = new FolderCatalogStore({ userDataPath: root });
    const { resource: book } = await store.createAcademicBook({
      title: "章节与小节重排",
      subtype: "empirical_paper"
    });

    const ch1 = await store.mutateAcademicManuscript({
      bookId: book.id,
      mutation: { type: "create-chapter", chapterId: "ch_one", title: "第一章" }
    });
    const ch2 = await store.mutateAcademicManuscript({
      bookId: book.id,
      baseProjectRevision: ch1.book.projectRevision,
      mutation: { type: "create-chapter", chapterId: "ch_two", title: "第二章" }
    });
    const s1 = await store.mutateAcademicManuscript({
      bookId: book.id,
      baseProjectRevision: ch2.book.projectRevision,
      mutation: {
        type: "create-section",
        sectionId: "sec_a",
        chapterId: "ch_one",
        title: "1.1 甲"
      }
    });
    const s2 = await store.mutateAcademicManuscript({
      bookId: book.id,
      baseProjectRevision: s1.book.projectRevision,
      mutation: {
        type: "create-section",
        sectionId: "sec_b",
        chapterId: "ch_one",
        title: "1.2 乙"
      }
    });
    const s3 = await store.mutateAcademicManuscript({
      bookId: book.id,
      baseProjectRevision: s2.book.projectRevision,
      mutation: {
        type: "create-section",
        sectionId: "sec_c",
        chapterId: "ch_two",
        title: "2.1 丙"
      }
    });

    const chapterReordered = await store.mutateAcademicManuscript({
      bookId: book.id,
      baseProjectRevision: s3.book.projectRevision,
      mutation: {
        type: "reorder-chapter",
        chapterId: "ch_one",
        anchorChapterId: "ch_two",
        position: "after"
      }
    });
    expect(chapterReordered.book.manuscript.chapters.map((c) => c.id)).toEqual([
      "ch_two",
      "ch_one"
    ]);

    const sectionReordered = await store.mutateAcademicManuscript({
      bookId: book.id,
      baseProjectRevision: chapterReordered.book.projectRevision,
      mutation: {
        type: "reorder-section",
        sectionId: "sec_b",
        anchorSectionId: "sec_a",
        position: "before"
      }
    });
    expect(
      sectionReordered.book.manuscript.sections
        .filter((s) => s.chapterId === "ch_one")
        .map((s) => s.id)
    ).toEqual(["sec_b", "sec_a"]);

    await expect(
      store.mutateAcademicManuscript({
        bookId: book.id,
        baseProjectRevision: sectionReordered.book.projectRevision,
        mutation: {
          type: "reorder-section",
          sectionId: "sec_a",
          anchorSectionId: "sec_c",
          position: "after"
        }
      })
    ).rejects.toThrow(/同级目录/u);
  });
});
