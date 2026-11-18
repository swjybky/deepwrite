import { createBookProjectResolver } from "../book-project-resolver";
import {
  BookIdentityUpdatedEventEnvelopeSchema,
  createEnvelope,
  type CommandEnvelope
} from "@deepwrite/contracts";
import type { FolderCatalogStore } from "../folder-catalog-store";
import type { LongWorkspaceService } from "../long-workspace-service";
import type { UtilityRuntimeOptions } from "../runtime";
import { BookIdentityStore } from "./store";
import {
  addManualCandidate,
  appendRound,
  deleteRound,
  findCandidate,
  pruneRounds,
  updateCandidate
} from "./records";
import {
  adopt,
  clearAdoption,
  saveComposedCover,
  writeCoverAsset
} from "./cover-operations";
import { readCandidate, readContext, resolveCoverAsset } from "./queries";

export function withBookIdentityCommands(
  requireCatalog: () => Promise<FolderCatalogStore>,
  longs: LongWorkspaceService,
  handler: NonNullable<UtilityRuntimeOptions["commandHandler"]>
): NonNullable<UtilityRuntimeOptions["commandHandler"]> {
  const store = new BookIdentityStore({
    resolveProject: createBookProjectResolver(requireCatalog, longs)
  });

  return async (command, emitEvent, context) => {
    if (!command.type.startsWith("bookIdentity."))
      return handler(command, emitEvent, context);
    try {
      const result = await dispatch(store, command);
      if (!result) return handler(command, emitEvent, context);
      if (result.changed && "book" in command.payload)
        emitEvent(
          BookIdentityUpdatedEventEnvelopeSchema.parse(
            createEnvelope(
              "book_identity.updated",
              {
                bookKey: bookKey(command.payload.book),
                revision: result.revision
              },
              { id: `${command.id}-identity`, context: command.context }
            )
          )
        );
      return {
        status: "accepted",
        requestId: command.id,
        payload: result.payload
      };
    } catch (error) {
      return {
        status: "rejected",
        requestId: command.id,
        error: {
          code: "book_identity.command_failed",
          message: error instanceof Error ? error.message : "书名设计操作失败。"
        }
      };
    }
  };
}

function bookKey(book: { projectType: string; projectId: string }) {
  return `${book.projectType}:${book.projectId}`;
}

async function dispatch(
  store: BookIdentityStore,
  command: CommandEnvelope
): Promise<
  { payload: unknown; revision?: number; changed?: boolean } | undefined
> {
  if (command.type === "bookIdentity.get")
    return { payload: await store.get(command.payload.book) };
  if (command.type === "bookIdentity.readContext")
    return {
      payload: await readContext(
        store,
        command.payload.book,
        command.payload.seedCandidateIds
      )
    };
  if (command.type === "bookIdentity.readCandidate")
    return {
      payload: await readCandidate(
        store,
        command.payload.book,
        command.payload.roundId,
        command.payload.candidateId
      )
    };
  if (command.type === "bookIdentity.resolveCoverAsset")
    return {
      payload: await resolveCoverAsset(
        store,
        command.payload.book,
        command.payload.file
      )
    };
  if (command.type === "bookIdentity.appendRound") {
    const receipt = await appendRound(
      store,
      command.payload.book,
      command.payload.round
    );
    return { payload: receipt, revision: receipt.revision, changed: true };
  }
  let record;
  if (command.type === "bookIdentity.inheritBook")
    record = await store.inherit(command.payload.book);
  else if (command.type === "bookIdentity.addManualCandidate")
    record = await addManualCandidate(
      store,
      command.payload.book,
      command.payload.field,
      command.payload.candidate
    );
  else if (command.type === "bookIdentity.updateCandidate")
    record = await updateCandidate(
      store,
      command.payload.book,
      command.payload.roundId,
      command.payload.candidateId,
      command.payload.patch
    );
  else if (command.type === "bookIdentity.adopt")
    record = await adopt(
      store,
      command.payload.book,
      command.payload.field,
      command.payload.roundId,
      command.payload.candidateId,
      command.payload.imageId
    );
  else if (command.type === "bookIdentity.clearAdoption")
    record = await clearAdoption(
      store,
      command.payload.book,
      command.payload.field
    );
  else if (command.type === "bookIdentity.deleteRound")
    record = await deleteRound(
      store,
      command.payload.book,
      command.payload.roundId
    );
  else if (command.type === "bookIdentity.pruneRounds")
    record = await pruneRounds(
      store,
      command.payload.book,
      command.payload.field
    );
  else if (command.type === "bookIdentity.writeCoverAsset")
    record = await writeCoverAsset(
      store,
      command.payload.book,
      command.payload.roundId,
      command.payload.candidateId,
      command.payload
    );
  else if (command.type === "bookIdentity.saveComposedCover")
    record = await saveComposedCover(
      store,
      command.payload.book,
      command.payload.roundId,
      command.payload.candidateId,
      command.payload.imageId,
      command.payload.layout,
      command.payload.pngBase64
    );
  else if (command.type === "bookIdentity.recordRenderError")
    record = await store.mutate(command.payload.book, (record) => {
      const { candidate } = findCandidate(
        record,
        command.payload.roundId,
        command.payload.candidateId
      );
      if (!("images" in candidate)) throw new Error("此候选不是封面方案。");
      candidate.lastRenderError = command.payload.error;
    });
  if (!record) return undefined;
  return { payload: record, revision: record.revision, changed: true };
}
