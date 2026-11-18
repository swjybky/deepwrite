import {
  AcademicBookSchema,
  CatalogDraftSectionSchema,
  CatalogReadDocumentResultSchema,
  DeleteDraftSectionResultSchema,
  MutateAcademicManuscriptResultSchema,
  SaveDocumentResultSchema,
  createAcademicSectionDocumentId,
  createShortWorkspaceContentRevision,
  parseAcademicSectionDocumentId,
  parseCatalogDraftDocumentId,
  type CatalogDraftSection,
  type CatalogIndexBook
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
import {
  isLongWorkId,
  isMysteryWorkId,
  readCatalogIndex
} from "./work-read-tools";

const NOT_FOUND = "找不到这个文档。请用 get_work 重新确认文档 ID。";
const WORK_NOT_FOUND = "找不到这部作品。请用 list_works 重新确认作品 ID。";

type AcademicIndexBook = Extract<CatalogIndexBook, { bookType: "academic" }>;

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

function academicSectionIdOf(
  book: AcademicIndexBook,
  documentId: string | undefined,
  action: string
): string {
  const id = requireField(documentId, action, "documentId");
  const parsed = parseAcademicSectionDocumentId(id);
  if (parsed) return parsed.sectionId;
  if (book.manuscript.sections.some((section) => section.id === id)) {
    return id;
  }
  throw new ExternalControlError(
    "external.invalid_input",
    `${action} 只支持正文小节，这个文档不是正文小节。`
  );
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

async function findCatalogBook(
  context: MutationContext,
  bookId: string
): Promise<CatalogIndexBook> {
  const index = await readCatalogIndex(context.core);
  const foundBook = index.books.find(({ id }) => id === bookId);
  if (!foundBook) {
    throw new ExternalControlError("external.not_found", WORK_NOT_FOUND);
  }
  return foundBook;
}

function findShortOrScriptSection(
  book: Exclude<CatalogIndexBook, { bookType: "academic" }>,
  sectionId: string
) {
  const section = book.draft.sections.find(({ id }) => id === sectionId);
  if (!section) {
    throw new ExternalControlError("external.not_found", NOT_FOUND);
  }
  return section;
}

function findAcademicSection(book: AcademicIndexBook, sectionId: string) {
  const section = book.manuscript.sections.find(({ id }) => id === sectionId);
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
  book: Exclude<CatalogIndexBook, { bookType: "academic" }>,
  sectionId: string
): Promise<ExternalMutationResult> {
  const section = findShortOrScriptSection(book, sectionId);
  const [body, characterState] = await Promise.all([
    readText(context, book.id, section.body.id),
    readText(context, book.id, section.characterState.id)
  ]);
  const created = await createSection(
    context,
    book.id,
    `${section.title} 副本`,
    sectionId,
    section.wordCountRequirement
  );
  const revision = await saveText(context, book.id, created.body.id, body);
  await saveText(context, book.id, created.characterState.id, characterState);
  return { id: created.body.id, title: created.title, revision };
}

/** The copy is written first: a failed delete only leaves a spare copy. */
async function deleteSection(
  context: MutationContext,
  book: Exclude<CatalogIndexBook, { bookType: "academic" }>,
  sectionId: string
): Promise<ExternalMutationResult> {
  const section = findShortOrScriptSection(book, sectionId);
  const [body, characterState] = await Promise.all([
    readText(context, book.id, section.body.id),
    readText(context, book.id, section.characterState.id)
  ]);
  const record = await context.trash.save({
    kind: "section",
    title: section.title,
    client: context.client.name,
    bookId: book.id,
    bookType: book.bookType,
    body,
    characterState,
    wordCountRequirement: section.wordCountRequirement
  });
  try {
    const { deleted } = await runCommand(
      context,
      "catalog.deleteDraftSection",
      { bookId: book.id, sectionId },
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

async function manageAcademicDocument(
  context: MutationContext,
  book: AcademicIndexBook,
  input: ExternalManageDocumentInput
): Promise<ExternalMutationResult> {
  const { action, workId, documentId, title } = input;
  switch (action) {
    case "create": {
      const afterSectionId = documentId
        ? academicSectionIdOf(book, documentId, "create")
        : undefined;
      const afterSection = afterSectionId
        ? findAcademicSection(book, afterSectionId)
        : undefined;
      const chapterId = input.chapterId ?? afterSection?.chapterId;
      const created = await runCommand(
        context,
        "catalog.mutateAcademicManuscript",
        {
          bookId: workId,
          baseProjectRevision: book.projectRevision,
          mutation: {
            type: "create-section",
            ...(title ? { title } : {}),
            ...(chapterId ? { chapterId } : {}),
            ...(afterSectionId ? { afterSectionId } : {})
          }
        },
        MutateAcademicManuscriptResultSchema
      );
      const section = created.book.manuscript.sections.find(
        ({ id }) => id === created.sectionId
      );
      const createdBodyId =
        section?.body.id ??
        createAcademicSectionDocumentId(created.sectionId ?? "", "body");
      return {
        id: createdBodyId,
        title: section?.title ?? title ?? "新小节"
      };
    }
    case "rename": {
      const targetDocId = requireField(documentId, "rename", "documentId");
      const nextTitle = requireField(title, "rename", "title");
      const parsedSection = parseAcademicSectionDocumentId(targetDocId);
      const directSection = book.manuscript.sections.find(
        (s) => s.id === targetDocId
      );
      if (parsedSection || directSection) {
        const sectionId = parsedSection?.sectionId ?? directSection!.id;
        findAcademicSection(book, sectionId);
        const updated = await runCommand(
          context,
          "catalog.mutateAcademicManuscript",
          {
            bookId: workId,
            baseProjectRevision: book.projectRevision,
            mutation: {
              type: "update-section-meta",
              sectionId,
              title: nextTitle
            }
          },
          MutateAcademicManuscriptResultSchema
        );
        const section = updated.book.manuscript.sections.find(
          (s) => s.id === sectionId
        );
        const responseId = parsedSection
          ? targetDocId
          : (section?.body.id ??
            createAcademicSectionDocumentId(sectionId, "body"));
        const responseTitle =
          parsedSection?.fileKind === "brief"
            ? section?.brief.title
            : parsedSection?.fileKind === "state"
              ? section?.state.title
              : section?.title;
        return {
          id: responseId,
          title: responseTitle ?? nextTitle
        };
      }
      const stage = book.frameworkStages.find((s) => s.id === targetDocId);
      if (stage) {
        const updatedBook = await runCommand(
          context,
          "catalog.mutateAcademicFramework",
          {
            bookId: workId,
            baseProjectRevision: book.projectRevision,
            mutation: {
              type: "update",
              stageId: stage.id,
              title: nextTitle,
              description: stage.description
            }
          },
          AcademicBookSchema
        );
        const updatedStage = updatedBook.frameworkStages.find(
          (s) => s.id === stage.id
        );
        return { id: stage.id, title: updatedStage?.title ?? nextTitle };
      }
      const saved = await runCommand(
        context,
        "catalog.saveDocument",
        {
          bookId: workId,
          documentId: targetDocId,
          title: nextTitle,
          content: "",
          preserveCurrentContent: true,
          baseProjectRevision: book.projectRevision
        },
        SaveDocumentResultSchema
      );
      return { id: saved.id, title: saved.title };
    }
    case "move": {
      const sectionId = academicSectionIdOf(book, documentId, "move");
      findAcademicSection(book, sectionId);
      await runCommand(
        context,
        "catalog.mutateAcademicManuscript",
        {
          bookId: workId,
          baseProjectRevision: book.projectRevision,
          mutation: {
            type: "move-section",
            sectionId,
            direction: requireField(input.direction, "move", "direction")
          }
        },
        MutateAcademicManuscriptResultSchema
      );
      return { ...(documentId ? { id: documentId } : {}) };
    }
    case "duplicate": {
      const sectionId = academicSectionIdOf(book, documentId, "duplicate");
      const section = findAcademicSection(book, sectionId);
      const [brief, body, state] = await Promise.all([
        readText(context, workId, section.brief.id),
        readText(context, workId, section.body.id),
        readText(context, workId, section.state.id)
      ]);
      const created = await runCommand(
        context,
        "catalog.mutateAcademicManuscript",
        {
          bookId: workId,
          baseProjectRevision: book.projectRevision,
          mutation: {
            type: "create-section",
            title: `${section.title} 副本`,
            ...(section.chapterId ? { chapterId: section.chapterId } : {}),
            afterSectionId: sectionId,
            ...(section.wordCountRequirement
              ? { wordCountRequirement: section.wordCountRequirement }
              : {}),
            briefContent: brief,
            bodyContent: body,
            stateContent: state
          }
        },
        MutateAcademicManuscriptResultSchema
      );
      const copySection = created.book.manuscript.sections.find(
        ({ id }) => id === created.sectionId
      );
      const copyBodyId =
        copySection?.body.id ??
        createAcademicSectionDocumentId(created.sectionId ?? "", "body");
      return {
        id: copyBodyId,
        title: copySection?.title ?? `${section.title} 副本`,
        revision: createShortWorkspaceContentRevision(body)
      };
    }
    case "delete": {
      const sectionId = academicSectionIdOf(book, documentId, "delete");
      const section = findAcademicSection(book, sectionId);
      const [brief, body, state] = await Promise.all([
        readText(context, workId, section.brief.id),
        readText(context, workId, section.body.id),
        readText(context, workId, section.state.id)
      ]);
      const record = await context.trash.save({
        kind: "section",
        title: section.title,
        client: context.client.name,
        bookId: workId,
        bookType: "academic",
        brief,
        body,
        state,
        characterState: state,
        ...(section.chapterId ? { chapterId: section.chapterId } : {}),
        ...(section.wordCountRequirement
          ? { wordCountRequirement: section.wordCountRequirement }
          : {})
      });
      try {
        await runCommand(
          context,
          "catalog.mutateAcademicManuscript",
          {
            bookId: workId,
            baseProjectRevision: book.projectRevision,
            mutation: {
              type: "delete-section",
              sectionId
            }
          },
          MutateAcademicManuscriptResultSchema
        );
      } catch (error: unknown) {
        await context.trash.remove(record.id);
        throw error;
      }
      return { id: sectionId, title: section.title, trashId: record.id };
    }
  }
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
  if (isMysteryWorkId(workId)) {
    throw new ExternalControlError(
      "external.invalid_input",
      "manage_document 暂不支持剧本杀。剧本杀结构改动需要内置智能体或在工作台完成。"
    );
  }
  const book = await findCatalogBook(context, workId);
  if (book.bookType === "academic") {
    const result = await manageAcademicDocument(context, book, input);
    context.broadcastChange({ domain: "work", resourceId: workId });
    return ExternalMutationResultSchema.parse(result);
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
          book,
          sectionIdOf(documentId, "duplicate")
        );
      case "delete":
        return deleteSection(context, book, sectionIdOf(documentId, "delete"));
    }
  })();
  context.broadcastChange({ domain: "work", resourceId: workId });
  return ExternalMutationResultSchema.parse(result);
}
