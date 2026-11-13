import { createScopedTranslator } from "../../i18n";
import type { DeepWriteApi, DocumentVersionOrigin } from "@deepwrite/contracts";

const t = createScopedTranslator("workspace");

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
    versionOrigin?: DocumentVersionOrigin;
    bookId: string;
    itemId: string;
    currentContent: string;
    content: string;
  }
): Promise<void> {
  if (!input.content.trim() || input.currentContent === input.content) return;
  if (input.currentContent.trim()) {
    throw new Error(
      t("creationContent.theNewCharacterEntryAlreadyHasDifferentContentThe")
    );
  }
  await catalog.saveDocument({
    bookId: input.bookId,
    documentId: input.itemId,
    content: input.content,
    ...(input.versionOrigin ? { versionOrigin: input.versionOrigin } : {}),
    force: true
  });
}

async function saveCreatedDraftDocument(
  catalog: CatalogDocumentWriter,
  input: {
    versionOrigin?: DocumentVersionOrigin;
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
    throw new Error(
      t("creationContent.theNewChapterAlreadyHasDifferentContentTheExisting", {
        label: input.label
      })
    );
  }
  await catalog.saveDocument({
    bookId: input.bookId,
    documentId: input.documentId,
    content: input.content,
    ...(input.versionOrigin ? { versionOrigin: input.versionOrigin } : {}),
    force: true
  });
}

export async function saveCreatedDraftSectionContents(
  catalog: CatalogDocumentWriter,
  input: {
    versionOrigin?: DocumentVersionOrigin;
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
      ...(input.versionOrigin ? { versionOrigin: input.versionOrigin } : {}),
      bookId: input.bookId,
      documentId: result.section.body.id,
      currentContent: result.section.body.content,
      content: requested?.bodyContent,
      label: t("catalogWorkspace.manuscript")
    });
    await saveCreatedDraftDocument(catalog, {
      ...(input.versionOrigin ? { versionOrigin: input.versionOrigin } : {}),
      bookId: input.bookId,
      documentId: result.section.characterState.id,
      currentContent: result.section.characterState.content,
      content: requested?.characterStateContent,
      label: t("catalogWorkspace.characterState")
    });
  }
}
