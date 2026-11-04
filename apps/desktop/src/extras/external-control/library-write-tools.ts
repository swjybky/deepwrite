import {
  CatalogLibraryEntrySchema,
  CatalogReadDocumentResultSchema,
  DuplicateCatalogProjectResultSchema,
  ExternalControlLocateProjectResultSchema,
  RemoveLibraryEntryResultSchema,
  createShortWorkspaceContentRevision
} from "@deepwrite/contracts";
import {
  ExternalMutationResultSchema,
  type ExternalManageEntryInput,
  type ExternalManageLibraryInput,
  type ExternalMutationResult,
  type ExternalWriteEntryInput
} from "@deepwrite/contracts/external-control";
import { readCore } from "./core-client";
import { ExternalControlError } from "./errors";
import { findLibrary } from "./library-read-tools";
import {
  ANY_PAYLOAD,
  assertNoActiveRun,
  createdId,
  requireField,
  runCommand,
  type MutationContext
} from "./mutation-client";
import { readCatalogIndex } from "./work-read-tools";

const ENTRY_NOT_FOUND = "找不到这个条目。请用 get_library 重新确认条目 ID。";

function changed(context: MutationContext, libraryId: string): void {
  context.broadcastChange({ domain: "library", resourceId: libraryId });
}

async function libraryOf(context: MutationContext, libraryId: string) {
  return findLibrary(await readCatalogIndex(context.core), libraryId);
}

function entryOf(
  library: Awaited<ReturnType<typeof libraryOf>>,
  entryId: string
) {
  const entry = library.value.entries.find(({ id }) => id === entryId);
  if (!entry) {
    throw new ExternalControlError("external.not_found", ENTRY_NOT_FOUND);
  }
  return entry;
}

function readEntryText(
  context: MutationContext,
  libraryId: string,
  entryId: string
) {
  return readCore(
    context.core,
    "catalog.readDocument",
    { projectId: libraryId, target: "document", documentId: entryId },
    CatalogReadDocumentResultSchema,
    ENTRY_NOT_FOUND
  );
}

export async function writeEntry(
  context: MutationContext,
  input: ExternalWriteEntryInput
): Promise<ExternalMutationResult> {
  assertNoActiveRun(context, [input.libraryId]);
  const { libraryId, entryId, content, baseRevision } = input;
  const { domain } = await libraryOf(context, libraryId);
  const saved = await runCommand(
    context,
    "catalog.saveLibraryEntry",
    { domain, libraryId, entryId, content, baseRevision },
    CatalogLibraryEntrySchema
  );
  changed(context, libraryId);
  return ExternalMutationResultSchema.parse({
    id: entryId,
    title: saved.title,
    revision: createShortWorkspaceContentRevision(content)
  });
}

async function deleteEntry(
  context: MutationContext,
  libraryId: string,
  entryId: string
): Promise<ExternalMutationResult> {
  const library = await libraryOf(context, libraryId);
  const entry = entryOf(library, entryId);
  const text = await readEntryText(context, libraryId, entryId);
  const record = await context.trash.save({
    kind: "entry",
    title: entry.title,
    client: context.client.name,
    domain: library.domain,
    libraryId,
    stageId: entry.stageId,
    content: text.content
  });
  try {
    const { deleted } = await runCommand(
      context,
      "catalog.removeLibraryEntry",
      {
        domain: library.domain,
        libraryId,
        entryId,
        baseRevision: text.revision
      },
      RemoveLibraryEntryResultSchema
    );
    if (!deleted) {
      throw new ExternalControlError("external.not_found", ENTRY_NOT_FOUND);
    }
  } catch (error: unknown) {
    await context.trash.remove(record.id);
    throw error;
  }
  return { id: entryId, title: entry.title, trashId: record.id };
}

export async function manageEntry(
  context: MutationContext,
  input: ExternalManageEntryInput
): Promise<ExternalMutationResult> {
  assertNoActiveRun(context, [
    input.libraryId,
    ...(input.targetLibraryId ? [input.targetLibraryId] : [])
  ]);
  const { action, libraryId, title } = input;
  const run = async (): Promise<ExternalMutationResult> => {
    const library = await libraryOf(context, libraryId);
    const { domain } = library;
    if (action === "create") {
      const created = await runCommand(
        context,
        "catalog.createLibraryEntry",
        {
          domain,
          libraryId,
          title: requireField(title, "create", "title"),
          content: input.content ?? "",
          ...(input.stageId ? { stageId: input.stageId } : {})
        },
        CatalogLibraryEntrySchema
      );
      return { id: created.id, title: created.title };
    }
    const entryId = requireField(input.entryId, action, "entryId");
    switch (action) {
      case "rename": {
        const nextTitle = requireField(title, "rename", "title");
        const text = await readEntryText(context, libraryId, entryId);
        await runCommand(
          context,
          "catalog.saveLibraryEntry",
          {
            domain,
            libraryId,
            entryId,
            title: nextTitle,
            content: text.content,
            baseRevision: text.revision
          },
          CatalogLibraryEntrySchema
        );
        return { id: entryId, title: nextTitle };
      }
      case "move": {
        const targetLibraryId = requireField(
          input.targetLibraryId,
          "move",
          "targetLibraryId"
        );
        await runCommand(
          context,
          "catalog.moveLibraryEntry",
          {
            domain,
            sourceLibraryId: libraryId,
            targetLibraryId,
            entryId,
            ...(input.stageId ? { targetStageId: input.stageId } : {})
          },
          ANY_PAYLOAD
        );
        changed(context, targetLibraryId);
        return { id: entryId };
      }
      case "duplicate": {
        const entry = entryOf(library, entryId);
        const text = await readEntryText(context, libraryId, entryId);
        const copy = await runCommand(
          context,
          "catalog.createLibraryEntry",
          {
            domain,
            libraryId,
            title: `${entry.title} 副本`,
            content: text.content,
            stageId: entry.stageId
          },
          CatalogLibraryEntrySchema
        );
        return { id: copy.id, title: copy.title };
      }
      case "delete":
        return deleteEntry(context, libraryId, entryId);
    }
  };
  const result = await run();
  changed(context, libraryId);
  return ExternalMutationResultSchema.parse(result);
}

async function createLibrary(
  context: MutationContext,
  input: ExternalManageLibraryInput
): Promise<ExternalMutationResult> {
  const domain = requireField(input.domain, "create", "domain");
  const name = requireField(input.title, "create", "title");
  const kind = requireField(input.kind, "create", "kind");
  const created = await runCommand(
    context,
    "catalog.createLibrary",
    domain === "material"
      ? { domain, name, materialKind: kind }
      : { domain, name, skillKind: kind },
    ANY_PAYLOAD
  );
  const id = createdId(created);
  return { ...(id ? { id } : {}), title: name };
}

async function deleteLibrary(
  context: MutationContext,
  libraryId: string,
  domain: "material" | "skill",
  title: string
): Promise<ExternalMutationResult> {
  const { projectDirectory } = await readCore(
    context.core,
    "externalControl.locateProject",
    { source: "catalog", projectId: libraryId },
    ExternalControlLocateProjectResultSchema,
    "找不到这个库。请用 list_libraries 重新确认库 ID。"
  );
  const record = await context.trash.save({
    kind: "project",
    title,
    client: context.client.name,
    domain,
    projectId: libraryId,
    projectDirectory
  });
  try {
    await runCommand(
      context,
      "catalog.unregisterProject",
      { domain, projectId: libraryId },
      ANY_PAYLOAD
    );
  } catch (error: unknown) {
    await context.trash.remove(record.id);
    throw error;
  }
  return { id: libraryId, title, trashId: record.id };
}

export async function manageLibrary(
  context: MutationContext,
  input: ExternalManageLibraryInput
): Promise<ExternalMutationResult> {
  assertNoActiveRun(
    context,
    input.action === "create" ? [] : [input.libraryId ?? ""]
  );
  const { action } = input;
  if (action === "create") {
    const created = await createLibrary(context, input);
    changed(context, created.id ?? "unknown");
    return ExternalMutationResultSchema.parse(created);
  }
  const libraryId = requireField(input.libraryId, action, "libraryId");
  const { domain, value } = await libraryOf(context, libraryId);
  const run = async (): Promise<ExternalMutationResult> => {
    switch (action) {
      case "rename": {
        const title = requireField(input.title, "rename", "title");
        await runCommand(
          context,
          "catalog.updateLibrary",
          { domain, libraryId, title },
          ANY_PAYLOAD
        );
        return { id: libraryId, title };
      }
      case "duplicate": {
        const copy = await runCommand(
          context,
          "catalog.duplicateProject",
          { domain, projectId: libraryId },
          DuplicateCatalogProjectResultSchema
        );
        return { id: copy.projectId, title: copy.title };
      }
      case "delete":
        return deleteLibrary(context, libraryId, domain, value.title);
    }
  };
  const result = await run();
  changed(context, libraryId);
  return ExternalMutationResultSchema.parse(result);
}
