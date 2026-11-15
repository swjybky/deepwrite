import { vi } from "vitest";
import {
  createShortWorkspaceContentRevision,
  type LibraryAgentWorkspaceSnapshot,
  type LibraryManagementQueryResult
} from "@deepwrite/contracts";
import type { LibraryManagementCommandExecutor } from "../library-management-runtime";

/** A mutable saved snapshot behind the authorized query bridge. */
export function libraryExecutor(workspace: LibraryAgentWorkspaceSnapshot) {
  return vi.fn<LibraryManagementCommandExecutor>(async (command) => {
    const request = command.payload.request;
    let payload: LibraryManagementQueryResult = { libraries: [] };
    if (request?.kind === "directory")
      payload = {
        ...payload,
        directory: {
          libraryId: workspace.libraryId,
          title: workspace.title,
          readOnly: workspace.readOnly,
          projectRevision: workspace.projectRevision,
          overviewDocumentId: workspace.overviewDocumentId,
          entries: workspace.entries.map((entry) => ({
            entryId: entry.id,
            documentId: entry.documentId,
            title: entry.title,
            stageId: entry.stageId,
            contentBytes: new TextEncoder().encode(entry.content).length
          }))
        }
      };
    if (request?.kind === "read")
      payload = {
        ...payload,
        documents: [
          ...workspace.entries
            .filter((entry) => request.entryIds.includes(entry.id))
            .map((entry) => ({
              target: "entry" as const,
              entryId: entry.id,
              documentId: entry.documentId,
              title: entry.title,
              stageId: entry.stageId,
              content: entry.content,
              revision: createShortWorkspaceContentRevision(entry.content),
              truncated: entry.truncated
            })),
          ...(request.overview
            ? [
                {
                  target: "overview" as const,
                  documentId: workspace.overviewDocumentId,
                  title: workspace.title,
                  content: workspace.overview,
                  revision: createShortWorkspaceContentRevision(
                    workspace.overview
                  )
                }
              ]
            : [])
        ]
      };
    return { status: "accepted", requestId: command.id, payload };
  });
}
