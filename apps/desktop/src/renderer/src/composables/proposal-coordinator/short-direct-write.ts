import type { SaveDocumentInput } from "@deepwrite/contracts";

type DirectDocumentWriteInput = Omit<
  SaveDocumentInput,
  "baseRevision" | "baseProjectRevision" | "force"
>;

/**
 * Structure-only writes such as a section rename keep the current body
 * (`preserveCurrentContent`), so they never need a content precondition.
 */
export function shortAgentDirectDocumentWrite(
  input: DirectDocumentWriteInput
): SaveDocumentInput {
  return { ...input, force: true };
}

/**
 * Full-text agent proposals. Editing stays open while agents run, so Core
 * must find exactly the expected text in this one document; the book-level
 * project revision is not checked, edits to other documents never conflict.
 */
export function shortAgentCheckedDocumentWrite(
  input: DirectDocumentWriteInput,
  baseRevision: string | undefined
): SaveDocumentInput {
  return baseRevision === undefined ? input : { ...input, baseRevision };
}
