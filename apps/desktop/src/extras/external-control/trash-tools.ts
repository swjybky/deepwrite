import {
  CatalogDraftSectionSchema,
  CatalogLibraryEntrySchema,
  CatalogOpenProjectResultSchema,
  LongOpenBookResultSchema,
  SaveDocumentResultSchema
} from "@deepwrite/contracts";
import {
  ExternalListTrashResultSchema,
  ExternalMutationResultSchema,
  type ExternalMutationResult,
  type ExternalRestoreTrashItemInput,
  type ExternalTrashRecord
} from "@deepwrite/contracts/external-control";
import { readCore } from "./core-client";
import { ExternalControlError } from "./errors";
import {
  assertNoActiveRun,
  runCommand,
  type MutationContext
} from "./mutation-client";
import {
  availableTeamName,
  createTeam,
  writeTeamSettings
} from "./team-write-tools";
import { trashExpiry } from "./trash-store";

const FOLDER_MISSING =
  "这个项目的文件夹已不在原位置，无法恢复。请让用户确认文件夹是否被移动。";

export async function listTrash(context: MutationContext) {
  const records = await context.trash.list();
  return ExternalListTrashResultSchema.parse({
    items: records.map((record) => ({
      trashId: record.id,
      kind: record.kind,
      title: record.title,
      deletedAt: record.deletedAt,
      expiresAt: trashExpiry(record)
    }))
  });
}

async function restoreSection(
  context: MutationContext,
  record: Extract<ExternalTrashRecord, { kind: "section" }>
): Promise<ExternalMutationResult> {
  const { bookId, title, body, characterState } = record;
  const created = await runCommand(
    context,
    "catalog.createDraftSection",
    {
      bookId,
      title,
      ...(record.wordCountRequirement
        ? { wordCountRequirement: record.wordCountRequirement }
        : {})
    },
    CatalogDraftSectionSchema
  );
  for (const [documentId, content] of [
    [created.body.id, body],
    [created.characterState.id, characterState]
  ] as const) {
    await runCommand(
      context,
      "catalog.saveDocument",
      { bookId, documentId, content },
      SaveDocumentResultSchema
    );
  }
  context.broadcastChange({ domain: "work", resourceId: bookId });
  return { id: created.body.id, title };
}

async function restoreEntry(
  context: MutationContext,
  record: Extract<ExternalTrashRecord, { kind: "entry" }>
): Promise<ExternalMutationResult> {
  const { domain, libraryId, title, content, stageId } = record;
  const created = await runCommand(
    context,
    "catalog.createLibraryEntry",
    { domain, libraryId, title, content, stageId },
    CatalogLibraryEntrySchema
  );
  context.broadcastChange({ domain: "library", resourceId: libraryId });
  return { id: created.id, title };
}

async function restoreTeam(
  context: MutationContext,
  record: Extract<ExternalTrashRecord, { kind: "team" }>
): Promise<ExternalMutationResult> {
  const restored = await createTeam(
    context,
    record.workspaceType,
    await availableTeamName(context, record.title)
  );
  await writeTeamSettings(context, restored.id ?? "", record.settings);
  context.broadcastChange({
    domain: "agent_team",
    resourceId: restored.id ?? ""
  });
  return restored;
}

async function restoreProject(
  context: MutationContext,
  record: Extract<ExternalTrashRecord, { kind: "project" }>
): Promise<ExternalMutationResult> {
  const { domain, projectDirectory, projectId, title } = record;
  // Opening by path is internal to Main, so this goes straight to Core.
  if (domain === "long") {
    await readCore(
      context.core,
      "long.openAtPath",
      { projectDirectory },
      LongOpenBookResultSchema,
      FOLDER_MISSING
    );
  } else {
    await readCore(
      context.core,
      "catalog.openProjectAtPath",
      { domain, projectDirectory },
      CatalogOpenProjectResultSchema,
      FOLDER_MISSING
    );
  }
  context.broadcastChange({
    domain: domain === "material" || domain === "skill" ? "library" : "work",
    resourceId: projectId
  });
  return { id: projectId, title };
}

export async function restoreTrashItem(
  context: MutationContext,
  input: ExternalRestoreTrashItemInput
): Promise<ExternalMutationResult> {
  assertNoActiveRun(context);
  const record = await context.trash.get(input.trashId);
  if (!record) {
    throw new ExternalControlError(
      "external.not_found",
      "找不到这个回收项，可能已恢复或已过期。请用 list_trash 重新确认。"
    );
  }
  const restored =
    record.kind === "section"
      ? await restoreSection(context, record)
      : record.kind === "entry"
        ? await restoreEntry(context, record)
        : record.kind === "team"
          ? await restoreTeam(context, record)
          : await restoreProject(context, record);
  await context.trash.remove(record.id);
  return ExternalMutationResultSchema.parse(restored);
}
