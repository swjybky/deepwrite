import {
  LongCommitChapterInputSchema,
  longCommitInputChapterIds,
  type DocumentVersionOrigin,
  type LongWorkspaceOperationBatch,
  type SystemEventEnvelope
} from "@deepwrite/contracts";
import type { LongWorkspaceRendererApi } from "../types/longWorkspace";
import { jsonClone } from "@deepwrite/shared";

export type LongContinuityFinalizationEvent = Extract<
  SystemEventEnvelope,
  { type: "long.ledger_commit_proposal" }
>;

export function continuityFinalizationKey(
  event: LongContinuityFinalizationEvent
): string {
  const chapterIds = longCommitInputChapterIds(event.payload.input);
  return `${event.payload.bookId}\u0000${chapterIds.join("\u0000")}`;
}

export async function commitLongContinuityFinalization(
  api: LongWorkspaceRendererApi,
  event: LongContinuityFinalizationEvent,
  versionOrigin?: DocumentVersionOrigin,
  batch?: LongWorkspaceOperationBatch
): Promise<void> {
  const parsedInput = LongCommitChapterInputSchema.parse(event.payload.input);
  const input =
    parsedInput.mode === "text_files_batch" && parsedInput.preparation
      ? {
          ...parsedInput,
          preparation: {
            ...parsedInput.preparation,
            ...(versionOrigin ? { versionOrigin } : {}),
            ...(batch ? { batch } : {})
          }
        }
      : parsedInput;
  await api.commitChapter(jsonClone(input));
}
