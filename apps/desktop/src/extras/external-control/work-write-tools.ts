import {
  DuplicateCatalogProjectResultSchema,
  ExternalControlLocateProjectResultSchema,
  LongWriteDocumentResultSchema,
  SCRIPT_BOOK_GENRES,
  SaveDocumentResultSchema,
  ScriptBookGenreSchema,
  createShortWorkspaceContentRevision
} from "@deepwrite/contracts";
import {
  ExternalMutationResultSchema,
  type ExternalManageWorkInput,
  type ExternalMutationResult,
  type ExternalWriteDocumentInput
} from "@deepwrite/contracts/external-control";
import { readCore } from "./core-client";
import { ExternalControlError } from "./errors";
import {
  ANY_PAYLOAD,
  assertNoActiveRun,
  createdId,
  requireField,
  runCommand,
  type MutationContext
} from "./mutation-client";
import { getWork, isLongWorkId } from "./work-read-tools";

function changed(context: MutationContext, workId: string): void {
  context.broadcastChange({ domain: "work", resourceId: workId });
}

/** The long editor saves without a revision, so it would undo this write. */
async function assertLongEditorSaved(
  context: MutationContext,
  bookId: string
): Promise<void> {
  const { dirty } = (await context.windowRequest({
    action: "long_editor_state",
    bookId
  })) as { dirty?: boolean };
  if (dirty) {
    throw new ExternalControlError(
      "external.busy",
      "用户正在编辑这部长篇，还有未保存的内容。请等保存后重新读取再写入。"
    );
  }
}

export async function writeDocument(
  context: MutationContext,
  input: ExternalWriteDocumentInput
): Promise<ExternalMutationResult> {
  assertNoActiveRun(context, [input.workId]);
  const { workId, documentId, content, baseRevision } = input;
  if (isLongWorkId(workId)) {
    await assertLongEditorSaved(context, workId);
    const written = await runCommand(
      context,
      "long.writeDocument",
      {
        bookId: workId,
        fileId: documentId,
        content,
        expectedUpdatedAt: baseRevision
      },
      LongWriteDocumentResultSchema
    );
    changed(context, workId);
    return ExternalMutationResultSchema.parse({
      id: documentId,
      revision: written.file.updatedAt
    });
  }
  const saved = await runCommand(
    context,
    "catalog.saveDocument",
    { bookId: workId, documentId, content, baseRevision },
    SaveDocumentResultSchema
  );
  changed(context, workId);
  return ExternalMutationResultSchema.parse({
    id: documentId,
    title: saved.title,
    revision: createShortWorkspaceContentRevision(saved.content)
  });
}

async function createWork(
  context: MutationContext,
  input: ExternalManageWorkInput
): Promise<ExternalMutationResult> {
  const type = requireField(input.type, "create", "type");
  const title = requireField(input.title, "create", "title");
  const genre = requireField(input.genre, "create", "genre");
  if (type !== "long" && !ScriptBookGenreSchema.safeParse(genre).success) {
    throw new ExternalControlError(
      "external.invalid_input",
      `短篇和剧本的 genre 只能是：${SCRIPT_BOOK_GENRES.join("、")}。`
    );
  }
  const created = await runCommand(
    context,
    type === "long"
      ? "long.createBook"
      : type === "script"
        ? "catalog.createScriptBook"
        : "catalog.createShortBook",
    { title, genre },
    ANY_PAYLOAD
  );
  const id = createdId(created);
  if (!id) {
    throw new ExternalControlError(
      "external.not_ready",
      "DeepWrite 还没有选择工作目录，无法新建作品。请让用户先在设置里选择。"
    );
  }
  return { id, title };
}

async function deleteWork(
  context: MutationContext,
  workId: string
): Promise<ExternalMutationResult> {
  const long = isLongWorkId(workId);
  const { title } = await getWork(context.core, { workId });
  const { projectDirectory } = await readCore(
    context.core,
    "externalControl.locateProject",
    { source: long ? "long" : "catalog", projectId: workId },
    ExternalControlLocateProjectResultSchema,
    "找不到这部作品。请用 list_works 重新确认作品 ID。"
  );
  const record = await context.trash.save({
    kind: "project",
    title,
    client: context.client.name,
    domain: long ? "long" : "book",
    projectId: workId,
    projectDirectory
  });
  try {
    if (long) {
      await runCommand(
        context,
        "long.unregister",
        { bookId: workId },
        ANY_PAYLOAD
      );
    } else {
      await runCommand(
        context,
        "catalog.unregisterProject",
        { domain: "book", projectId: workId },
        ANY_PAYLOAD
      );
    }
  } catch (error: unknown) {
    await context.trash.remove(record.id);
    throw error;
  }
  return { id: workId, title, trashId: record.id };
}

export async function manageWork(
  context: MutationContext,
  input: ExternalManageWorkInput
): Promise<ExternalMutationResult> {
  assertNoActiveRun(
    context,
    input.action === "create" ? [] : [input.workId ?? ""]
  );
  const { action } = input;
  if (action === "create") {
    const created = await createWork(context, input);
    changed(context, created.id ?? "");
    return ExternalMutationResultSchema.parse(created);
  }
  const workId = requireField(input.workId, action, "workId");
  const long = isLongWorkId(workId);
  const result = await (async (): Promise<ExternalMutationResult> => {
    switch (action) {
      case "rename": {
        const title = requireField(input.title, "rename", "title");
        await runCommand(
          context,
          long ? "long.rename" : "catalog.updateBook",
          { bookId: workId, title },
          ANY_PAYLOAD
        );
        return { id: workId, title };
      }
      case "duplicate": {
        if (long) {
          const copy = await runCommand(
            context,
            "long.duplicateBook",
            { bookId: workId },
            ANY_PAYLOAD
          );
          return { ...spreadId(createdId(copy)) };
        }
        const copy = await runCommand(
          context,
          "catalog.duplicateProject",
          { domain: "book", projectId: workId },
          DuplicateCatalogProjectResultSchema
        );
        return { id: copy.projectId, title: copy.title };
      }
      case "delete":
        return deleteWork(context, workId);
    }
  })();
  changed(context, workId);
  return ExternalMutationResultSchema.parse(result);
}

function spreadId(id: string | undefined): { id?: string } {
  return id ? { id } : {};
}
