/**
 * Decides how a same-run write to `pending:section:*` should be staged after
 * (or before) the matching chapter-creation proposal is accepted.
 */
export type ProvisionalWriteStagingMode =
  | "provisional"
  | "mapped-real"
  | "unavailable";

export function resolveProvisionalWriteStagingMode(input: {
  hasPendingCreation: boolean;
  provisionalSectionId: string;
  resolvedSectionId: string;
}): ProvisionalWriteStagingMode {
  if (input.hasPendingCreation) return "provisional";
  if (input.resolvedSectionId !== input.provisionalSectionId) {
    return "mapped-real";
  }
  return "unavailable";
}
