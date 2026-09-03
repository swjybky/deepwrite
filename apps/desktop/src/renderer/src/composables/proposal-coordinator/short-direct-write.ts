import type { SaveDocumentInput } from "@deepwrite/contracts";

type DirectDocumentWriteInput = Omit<
  SaveDocumentInput,
  "baseRevision" | "baseProjectRevision" | "force"
>;

/**
 * Short-story and script agent proposals are complete-text writes. Their
 * ordering is owned by the proposal queue, so persistence must not reintroduce
 * a stale content/project revision gate after that queue has selected a write.
 */
export function shortAgentDirectDocumentWrite(
  input: DirectDocumentWriteInput
): SaveDocumentInput {
  return { ...input, force: true };
}
