import type { DeepWriteApi } from "@deepwrite/contracts";

type CatalogDocumentWriter = Pick<DeepWriteApi["catalog"], "saveDocument">;

interface RequestedDraftSectionContent {
  provisionalSectionId: string;
  bodyContent?: string;
  characterStateContent?: string;
}

interface CreatedDraftSectionContentTarget {
  clientSectionId: string;
  section: {
    body: { id: string; content: string };
    characterState: { id: string; content: string };
  };
}

interface CreatedDraftSectionVisibilityTarget {
  section: {
    id: string;
  };
}

interface RefreshedDraftDirectory {
  sections: readonly {
    id: string;
    bodyDocumentId: string;
    characterStateDocumentId: string;
  }[];
}

export function createdDraftSectionsAreVisible(
  directory: RefreshedDraftDirectory | undefined,
  created: readonly CreatedDraftSectionVisibilityTarget[]
): boolean {
  return Boolean(
    directory &&
    created.every((result) =>
      directory.sections.some((section) => section.id === result.section.id)
    )
  );
}

export async function saveCreatedCharacterContent(
  catalog: CatalogDocumentWriter,
  input: {
    bookId: string;
    itemId: string;
    currentContent: string;
    content: string;
  }
): Promise<void> {
  if (!input.content.trim() || input.currentContent === input.content) return;
  if (input.currentContent.trim()) {
    throw new Error("新建人物条目已有不同内容，未覆盖现有文件。");
  }
  await catalog.saveDocument({
    bookId: input.bookId,
    documentId: input.itemId,
    content: input.content,
    force: true
  });
}

async function saveCreatedDraftDocument(
  catalog: CatalogDocumentWriter,
  input: {
    bookId: string;
    documentId: string;
    currentContent: string;
    content: string | undefined;
    label: string;
  }
): Promise<void> {
  if (!input.content?.trim() || input.currentContent === input.content) {
    return;
  }
  if (input.currentContent.trim()) {
    throw new Error(`新建章节${input.label}已有不同内容，未覆盖现有文件。`);
  }
  await catalog.saveDocument({
    bookId: input.bookId,
    documentId: input.documentId,
    content: input.content,
    force: true
  });
}

export async function saveCreatedDraftSectionContents(
  catalog: CatalogDocumentWriter,
  input: {
    bookId: string;
    requested: readonly RequestedDraftSectionContent[];
    created: readonly CreatedDraftSectionContentTarget[];
  }
): Promise<void> {
  for (const result of input.created) {
    const requested = input.requested.find(
      (section) => section.provisionalSectionId === result.clientSectionId
    );
    await saveCreatedDraftDocument(catalog, {
      bookId: input.bookId,
      documentId: result.section.body.id,
      currentContent: result.section.body.content,
      content: requested?.bodyContent,
      label: "正文"
    });
    await saveCreatedDraftDocument(catalog, {
      bookId: input.bookId,
      documentId: result.section.characterState.id,
      currentContent: result.section.characterState.content,
      content: requested?.characterStateContent,
      label: "人物状态"
    });
  }
}
