import type { BodyTextKind } from "@deepwrite/contracts";
import type { WorkspaceDocument } from "../types/workspace";

export function catalogBodyTextKind(
  document: WorkspaceDocument
): BodyTextKind | undefined {
  return document.domain === "creation" &&
    document.draftFileKind === "body" &&
    (document.workspaceType === "short" || document.workspaceType === "script")
    ? document.workspaceType
    : undefined;
}

export function longBodyTextKind(
  root: string | undefined,
  role: string | undefined
): BodyTextKind | undefined {
  return root === "draft" && role === "body" ? "long" : undefined;
}
