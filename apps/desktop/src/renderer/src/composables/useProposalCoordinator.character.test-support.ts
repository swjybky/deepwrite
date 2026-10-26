import {
  createShortWorkspaceContentRevision as revision,
  type CatalogReadDocumentInput,
  type CatalogReadDocumentResult,
  type DeepWriteApi,
  type WorkspaceEditorMutationEventEnvelope
} from "@deepwrite/contracts";
import { vi } from "vitest";
import type { CatalogWorkspaceProjection } from "../data/catalogWorkspace";
import { useCatalogIndexStore } from "../stores/catalogIndexStore";
import type { WorkspaceDocument } from "../types/workspace";
import { useCatalogDocumentLoader } from "./useCatalogDocumentLoader";
import {
  BOOK_ID,
  NOW,
  createFixture,
  mutationEvent
} from "./useProposalCoordinator.short-script.test-support";

export const CHARACTER_ID = "character-one";
export const CHARACTER_DOCUMENT_ID = `catalog:book-document:${BOOK_ID}:${CHARACTER_ID}`;
export const CHARACTER_TITLE = "测试人物";
export const INITIAL_CHARACTER = "人物原设定。\n动机尚待展开。";
export const REVISED_CHARACTER = "人物原设定。\n补充明确的人物动机。";

function characterEvent(
  text: string,
  second: number
): WorkspaceEditorMutationEventEnvelope {
  const event = mutationEvent(
    `tool-character-${second}`,
    text,
    revision(INITIAL_CHARACTER),
    second
  );
  return {
    ...event,
    payload: { ...event.payload, stageId: "character_design" }
  };
}

export function createCharacterEvent(): WorkspaceEditorMutationEventEnvelope {
  const event = characterEvent(CHARACTER_TITLE, 1);
  return {
    ...event,
    payload: {
      ...event.payload,
      baseRevision: revision(""),
      mutationTarget: {
        kind: "character-structure",
        mutation: {
          type: "createItem",
          title: CHARACTER_TITLE,
          provisionalItemId: CHARACTER_ID
        },
        initialContent: INITIAL_CHARACTER
      }
    }
  };
}

export function editCharacterEvent(
  text = REVISED_CHARACTER,
  base = INITIAL_CHARACTER,
  second = 2
): WorkspaceEditorMutationEventEnvelope {
  const event = characterEvent(text, second);
  return {
    ...event,
    payload: {
      ...event.payload,
      baseRevision: revision(base),
      mutationTarget: {
        kind: "character-file",
        documentId: CHARACTER_ID,
        itemId: CHARACTER_ID
      }
    }
  };
}

function projection(
  documents: WorkspaceDocument[]
): CatalogWorkspaceProjection {
  return {
    resourceSections: [],
    workspaceDocuments: documents,
    draftDirectories: [],
    index: {
      resourceNodeById: new Map(),
      workspaceDocumentById: new Map(
        documents.map((document) => [document.id, document])
      ),
      resourceIdByDocumentId: new Map(),
      resourceTargetDocumentIdById: new Map(),
      draftDirectoryById: new Map(),
      draftDirectoryByWorkspaceId: new Map(),
      preferredResourceIdByWorkspaceId: new Map(),
      workspaceIdByResourceId: new Map()
    }
  };
}

/** Real metadata/body loader and coordinator, with a version-checked Core port. */
export function createCharacterFixture(bookType: "short" | "script" = "short") {
  let diskContent = "";
  let created = false;
  let projectRevision = 7;
  let loader!: ReturnType<typeof useCatalogDocumentLoader>;
  let refresh!: () => void;
  const readDocument = vi.fn(
    async (
      input: CatalogReadDocumentInput
    ): Promise<CatalogReadDocumentResult> => {
      if (input.target !== "document")
        throw new Error("Expected a character document");
      return {
        ...input,
        title: CHARACTER_TITLE,
        content: diskContent,
        contentBytes: new TextEncoder().encode(diskContent).length,
        revision: revision(diskContent),
        projectRevision,
        updatedAt: NOW
      };
    }
  );
  const fixture = createFixture(bookType, {
    holdFirstSave: false,
    configure(context) {
      const book = context.catalog.catalogBook(BOOK_ID)!;
      book.characterStructure = { format: "list", items: [] };
      context.editor.documents.value = [];
      loader = useCatalogDocumentLoader({
        documents: context.editor.documents,
        catalogIndex: useCatalogIndexStore(),
        reader: () => ({ readDocument })
      });
      refresh = () => {
        const documents: WorkspaceDocument[] = created
          ? [
              {
                id: CHARACTER_DOCUMENT_ID,
                domain: "creation",
                title: CHARACTER_TITLE,
                eyebrow: "人物",
                path: ["测试作品", "人物", CHARACTER_TITLE],
                workspaceId: BOOK_ID,
                workspaceType: bookType,
                workspaceTitle: "测试作品",
                stageId: "character_design",
                characterFileKind: "item",
                characterItemId: CHARACTER_ID,
                catalogDocumentId: CHARACTER_ID,
                catalogProjectRevision: projectRevision,
                content: "",
                catalogContentLoaded: false,
                catalogContentBytes: new TextEncoder().encode(diskContent)
                  .length,
                catalogContentStamp: revision(diskContent)
              }
            ]
          : [];
        const next = projection(documents);
        context.catalog.projection.value = next;
        loader.reconcileProjection(next);
      };
      context.catalog.loadSnapshot = vi.fn(async () => refresh());
      context.catalog.ensureDocumentLoaded = async (document) =>
        (await loader.ensureOne(document)).document ?? document;
      context.catalog.refreshBookAfterSave = vi.fn(async () => {
        refresh();
        return true;
      });
      const apply = context.catalog.applyAcceptedDocumentLocally;
      context.catalog.applyAcceptedDocumentLocally = (
        payload,
        savedRevision,
        draft
      ) => {
        loader.preserveAuthoritativeBodyForNextProjection(
          payload.id,
          payload.content,
          savedRevision
        );
        apply(payload, savedRevision, draft);
        context.editor.documents.value = context.editor.documents.value.map(
          (document) =>
            document.id === payload.id
              ? { ...document, catalogContentLoaded: true }
              : document
        );
      };
      const saveDocument = vi.mocked(context.api()!.catalog.saveDocument);
      saveDocument.mockImplementation(async (input) => {
        if (
          input.baseRevision !== undefined &&
          input.baseRevision !== revision(diskContent)
        ) {
          throw {
            code: "catalog.conflict",
            message: "Document changed",
            details: { actualRevision: revision(diskContent) }
          };
        }
        diskContent = input.content;
        projectRevision += 1;
        return {
          id: CHARACTER_ID,
          title: CHARACTER_TITLE,
          content: diskContent,
          projectRevision,
          createdAt: NOW,
          updatedAt: NOW
        };
      });
      context.api = () =>
        ({
          catalog: {
            readDocument,
            saveDocument,
            mutateCharacterStructure: vi.fn(async () => {
              created = true;
              projectRevision += 1;
              return {
                ...book,
                projectRevision,
                documents: [
                  {
                    id: CHARACTER_ID,
                    title: CHARACTER_TITLE,
                    content: diskContent,
                    createdAt: NOW,
                    updatedAt: NOW
                  }
                ]
              };
            })
          }
        }) as unknown as DeepWriteApi;
    }
  });
  return {
    ...fixture,
    loader,
    readDocument,
    diskContent: () => diskContent,
    refresh: () => refresh(),
    saveExternalText(content: string, refreshIndex = true) {
      diskContent = content;
      projectRevision += 1;
      if (refreshIndex) refresh();
    }
  };
}
