import type { DeepWriteApi } from "@deepwrite/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  createdDraftSectionsAreVisible,
  saveCreatedCharacterContent,
  saveCreatedDraftSectionContents
} from "./creation-content";

const NOW = "2026-08-30T00:00:00.000Z";

function createCatalogWriter(initialProjectRevision = 10) {
  let projectRevision = initialProjectRevision;
  const saveDocument = vi.fn(
    async (input: Parameters<DeepWriteApi["catalog"]["saveDocument"]>[0]) => ({
      id: input.documentId,
      title: input.title ?? input.documentId,
      content: input.content,
      createdAt: NOW,
      updatedAt: NOW,
      projectRevision: (projectRevision += 1)
    })
  );
  return {
    catalog: { saveDocument } as Pick<DeepWriteApi["catalog"], "saveDocument">,
    saveDocument
  };
}

describe("proposal creation content persistence", () => {
  it("uses the stable section id when projected document ids are namespaced", () => {
    const created = [
      {
        clientSectionId: "pending:section:1",
        section: {
          id: "section-1",
          body: { id: "draft-section:section-1:body", content: "" },
          characterState: {
            id: "draft-section:section-1:character-state",
            content: ""
          }
        }
      }
    ];

    expect(
      createdDraftSectionsAreVisible(
        {
          sections: [
            {
              id: "section-1",
              bodyDocumentId:
                "catalog:book-document:book-1:draft-section%3Asection-1%3Abody",
              characterStateDocumentId:
                "catalog:book-document:book-1:draft-section%3Asection-1%3Acharacter-state"
            }
          ]
        },
        created
      )
    ).toBe(true);
    expect(createdDraftSectionsAreVisible(undefined, created)).toBe(false);
    expect(
      createdDraftSectionsAreVisible(
        {
          sections: [
            {
              id: "missing-section",
              bodyDocumentId:
                "catalog:book-document:book-1:draft-section%3Asection-1%3Abody",
              characterStateDocumentId:
                "catalog:book-document:book-1:draft-section%3Asection-1%3Acharacter-state"
            }
          ]
        },
        created
      )
    ).toBe(false);
  });

  it("writes created character content directly without revision guards", async () => {
    const { catalog, saveDocument } = createCatalogWriter();

    await saveCreatedCharacterContent(catalog, {
      bookId: "book-direct-character",
      itemId: "character-direct",
      currentContent: "",
      content: "人物初始设定"
    });

    expect(saveDocument).toHaveBeenCalledOnce();
    expect(saveDocument).toHaveBeenCalledWith({
      bookId: "book-direct-character",
      documentId: "character-direct",
      content: "人物初始设定",
      force: true
    });
  });

  it("does not overwrite newer character content when creation is retried", async () => {
    const { catalog, saveDocument } = createCatalogWriter();

    await expect(
      saveCreatedCharacterContent(catalog, {
        bookId: "book-retried-character",
        itemId: "character-retried",
        currentContent: "用户后续修改",
        content: "智能体最初设定"
      })
    ).rejects.toThrow("已有不同内容");

    expect(saveDocument).not.toHaveBeenCalled();
  });

  it("treats an already persisted character initial body as idempotent", async () => {
    const { catalog, saveDocument } = createCatalogWriter();

    await saveCreatedCharacterContent(catalog, {
      bookId: "book-retried-character",
      itemId: "character-retried",
      currentContent: "相同初始设定",
      content: "相同初始设定"
    });

    expect(saveDocument).not.toHaveBeenCalled();
  });

  it("serially writes created section body and state with direct saves", async () => {
    const { catalog, saveDocument } = createCatalogWriter(20);

    await saveCreatedDraftSectionContents(catalog, {
      bookId: "book-direct-section",
      requested: [
        {
          provisionalSectionId: "pending:section:1",
          bodyContent: "第一节正文",
          characterStateContent: "第一节人物状态"
        }
      ],
      created: [
        {
          clientSectionId: "pending:section:1",
          section: {
            body: { id: "section-1-body", content: "" },
            characterState: { id: "section-1-state", content: "" }
          }
        }
      ]
    });

    expect(saveDocument.mock.calls.map(([input]) => input)).toEqual([
      {
        bookId: "book-direct-section",
        documentId: "section-1-body",
        content: "第一节正文",
        force: true
      },
      {
        bookId: "book-direct-section",
        documentId: "section-1-state",
        content: "第一节人物状态",
        force: true
      }
    ]);
  });

  it("keeps the semantic safeguard for a newly created file with other content", async () => {
    const { catalog, saveDocument } = createCatalogWriter();

    await expect(
      saveCreatedDraftSectionContents(catalog, {
        bookId: "book-direct-section",
        requested: [
          {
            provisionalSectionId: "pending:section:1",
            bodyContent: "智能体初始正文"
          }
        ],
        created: [
          {
            clientSectionId: "pending:section:1",
            section: {
              body: { id: "section-1-body", content: "已有其他正文" },
              characterState: { id: "section-1-state", content: "" }
            }
          }
        ]
      })
    ).rejects.toThrow("新建章节正文已有不同内容");
    expect(saveDocument).not.toHaveBeenCalled();
  });
});
