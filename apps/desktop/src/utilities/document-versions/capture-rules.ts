import type {
  DocumentVersionOrigin,
  DocumentVersionSummary
} from "@deepwrite/contracts";

export interface VersionCaptureAction {
  action: "append" | "update";
  kind: DocumentVersionSummary["kind"];
  content: string;
  origin?: DocumentVersionOrigin;
  reason?: "restore";
  restoredFromSeq?: number;
}

export interface VersionCaptureInput {
  latest?: Pick<DocumentVersionSummary, "kind" | "origin"> & {
    content: string;
  };
  before: string;
  after: string;
  origin?: DocumentVersionOrigin;
  restoredFromSeq?: number;
}

/** The caller serializes the history and commits these actions after the text. */
export function planDocumentVersionCapture(
  input: VersionCaptureInput
): VersionCaptureAction[] {
  const actions: VersionCaptureAction[] = [];
  let latest = input.latest;
  if (input.before && input.before !== latest?.content) {
    const saved = {
      action: "append" as const,
      kind: "pre_conversation" as const,
      content: input.before,
      ...(input.restoredFromSeq === undefined
        ? {}
        : { reason: "restore" as const })
    };
    actions.push(saved);
    latest = saved;
  }
  if (input.restoredFromSeq !== undefined) {
    actions.push({
      action: "append",
      kind: "restore",
      content: input.after,
      restoredFromSeq: input.restoredFromSeq
    });
    return actions;
  }
  if (!input.origin || !input.after || input.after === latest?.content)
    return actions;
  actions.push({
    action:
      latest?.kind === "conversation" &&
      latest.origin?.runId === input.origin.runId
        ? "update"
        : "append",
    kind: "conversation",
    content: input.after,
    origin: input.origin
  });
  return actions;
}
