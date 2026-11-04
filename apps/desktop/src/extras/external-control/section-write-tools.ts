import {
  CatalogDraftSectionSchema,
  CatalogReadDocumentResultSchema,
  DeleteDraftSectionResultSchema,
  SaveDocumentResultSchema,
  createShortWorkspaceContentRevision,
  parseCatalogDraftDocumentId,
  type CatalogDraftSection
} from "@deepwrite/contracts";
import {
  ExternalMutationResultSchema,
  type ExternalManageDocumentInput,
  type ExternalMutationResult
} from "@deepwrite/contracts/external-control";
import { readCore } from "./core-client";
import { ExternalControlError } from "./errors";
import {
  ANY_PAYLOAD,
  assertNoActiveRun,
  requireField,
  runCommand,
  type MutationContext
} from "./mutation-client";
import { isLongWorkId, readCatalogIndex } from "./work-read-tools";

const NOT_FOUND = "找不到这个文档。请用 get_work 重新确认文档 ID。";

async function saveText(
  context: MutationContext,
  bookId: string,
  documentId: string,
  content: string
): Promise<string> {
  const saved = await runCommand(
    context,
    "catalog.saveDocument",
    { bookId, documentId, content },
    SaveDocumentResultSchema
  );
  return createShortWorkspaceContentRevision(saved.content);
}

function sectionIdOf(documentId: string | undefined, action: string): string {
  const id = requireField(documentId, action, "documentId");
  const parsed = parseCatalogDraftDocumentId(id);
  if (!parsed) {
    throw new ExternalControlError(
      "external.invalid_input",
      `${action} 只支持正文小节，这个文档不是正文小节。`
    );
  }
  return parsed.sectionId;
}

async function readText(
  context: MutationContext,
  bookId: string,
  documentId: string
): Promise<string> {
  const document = await readCore(
    context.core,
    "catalog.readDocument",
    { projectId: bookId, target: "document", documentId },
    CatalogReadDocumentResultSchema,
    NOT_FOUND
  );
  return document.content;
}

async function findSection(
  context: MutationContext,
  bookId: string,
  sectionId: string
) {
  const index = await readCatalogIndex(context.core);
  const section = index.books
    .find(({ id }) => id === bookId)
    ?.draft.sections.find(({ id }) => id === sectionId);
  if (!section) {
    throw new ExternalControlError("external.not_found", NOT_FOUND);
  }
  return section;
}

function createSection(
  context: MutationContext,
  bookId: string,
  title: string | undefined,
  afterSectionId: string | undefined,
  wordCountRequirement?: string
): Promise<CatalogDraftSection> {
  return runCommand(
    context,
    "catalog.createDraftSection",
    {
      bookId,
      ...(title ? { title } : {}),
      ...(afterSectionId ? { afterSectionId } : {}),
      ...(wordCountRequirement ? { wordCountRequirement } : {})
    },
    CatalogDraftSectionSchema
  );
}

async function duplicateSection(
  context: MutationContext,
  bookId: string,
  sectionId: string
): Promise<ExternalMutationResult> {
  const section = await findSection(context, bookId, sectionId);
  const [body, characterState] = await Promise.all([
    readText(context, bookId, section.body.id),
    readText(context, bookId, section.characterState.id)
  ]);
  const created = await createSection(
    context,
    bookId,
    `${section.title} 副本`,
    sectionId,
    section.wordCountRequirement
  );
  const revision = await saveText(context, bookId, created.body.id, body);
  await saveText(context, bookId, created.characterState.id, characterState);
  return { id: created.body.id, title: created.title, revision };
}

/** The copy is written first: a failed delete only leaves a spare copy. */
async function deleteSection(
  context: MutationContext,
  bookId: string,
  sectionId: string
): Promise<ExternalMutationResult> {
  const section = await findSection(context, bookId, sectionId);
  const [body, characterState] = await Promise.all([
    readText(context, bookId, section.body.id),
    readText(context, bookId, section.characterState.id)
  ]);
  const record = await context.trash.save({
    kind: "section",
    title: section.title,
    client: context.client.name,
    bookId,
    body,
    characterState,
    wordCountRequirement: section.wordCountRequirement
  });
  try {
    const { deleted } = await runCommand(
      context,
      "catalog.deleteDraftSection",
      { bookId, sectionId },
      DeleteDraftSectionResultSchema
    );
    if (!deleted)
      throw new ExternalControlError("external.not_found", NOT_FOUND);
  } catch (error: unknown) {
    await context.trash.remove(record.id);
    throw error;
  }
  return { id: sectionId, title: section.title, trashId: record.id };
}

export async function manageDocument(
  context: MutationContext,
  input: ExternalManageDocumentInput
): Promise<ExternalMutationResult> {
  assertNoActiveRun(context, [input.workId]);
  const { action, workId, documentId, title } = input;
  if (isLongWorkId(workId)) {
    throw new ExternalControlError(
      "external.invalid_input",
      "manage_document 暂不支持长篇。长篇章节结构的改动需要内置智能体完成。"
    );
  }
  const result = await (async (): Promise<ExternalMutationResult> => {
    switch (action) {
      case "create": {
        const afterSectionId = documentId
          ? sectionIdOf(documentId, "create")
          : undefined;
        const created = await createSection(
          context,
          workId,
          title,
          afterSectionId
        );
        return { id: created.body.id, title: created.title };
      }
      case "rename": {
        const saved = await runCommand(
          context,
          "catalog.saveDocument",
          {
            bookId: workId,
            documentId: requireField(documentId, "rename", "documentId"),
            title: requireField(title, "rename", "title"),
            content: "",
            preserveCurrentContent: true
          },
          SaveDocumentResultSchema
        );
        return { id: saved.id, title: saved.title };
      }
      case "move": {
        await runCommand(
          context,
          "catalog.moveDraftSection",
          {
            bookId: workId,
            sectionId: sectionIdOf(documentId, "move"),
            direction: requireField(input.direction, "move", "direction")
          },
          ANY_PAYLOAD
        );
        return { ...(documentId ? { id: documentId } : {}) };
      }
      case "duplicate":
        return duplicateSection(
          context,
          workId,
          sectionIdOf(documentId, "duplicate")
        );
      case "delete":
        return deleteSection(
          context,
          workId,
          sectionIdOf(documentId, "delete")
        );
    }
  })();
  context.broadcastChange({ domain: "work", resourceId: workId });
  return ExternalMutationResultSchema.parse(result);
}
