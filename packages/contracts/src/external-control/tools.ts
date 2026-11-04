import { z } from "zod";
import {
  ExternalGetLibraryInputSchema,
  ExternalGetWorkInputSchema,
  ExternalListAgentTeamsInputSchema,
  ExternalListLibrariesInputSchema,
  ExternalListWorksInputSchema,
  ExternalReadDocumentInputSchema,
  ExternalReadEntryInputSchema,
  ExternalSearchTextInputSchema
} from "./read-tools";
import {
  ExternalAgentRunInputSchema,
  ExternalAnswerAgentQuestionInputSchema,
  ExternalOpenInAppInputSchema,
  ExternalRunAgentInputSchema
} from "./run-tools";
import {
  ExternalListTrashInputSchema,
  ExternalManageAgentTeamInputSchema,
  ExternalManageDocumentInputSchema,
  ExternalManageEntryInputSchema,
  ExternalManageLibraryInputSchema,
  ExternalManageWorkInputSchema,
  ExternalRestoreTrashItemInputSchema,
  ExternalSaveAgentTeamInputSchema,
  ExternalWriteDocumentInputSchema,
  ExternalWriteEntryInputSchema
} from "./write-tools";

export const GetAppStatusInputSchema = z.object({}).strict();

export const GetAppStatusResultSchema = z
  .object({
    appVersion: z.string().min(1),
    protocolVersion: z.number().int().positive(),
    platform: z.string().min(1),
    /** False while the window is missing or still loading. */
    rendererReady: z.boolean(),
    activeRunCount: z.number().int().nonnegative(),
    permissionMode: z.string().min(1),
    /** Must be true before a built-in agent can be started externally. */
    crossStageAutoApprove: z.boolean()
  })
  .strict();
export type GetAppStatusResult = z.infer<typeof GetAppStatusResultSchema>;

interface ExternalControlToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export interface ExternalControlToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodType;
  annotations: ExternalControlToolAnnotations;
}

const READ_ONLY: ExternalControlToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
};

/**
 * Not destructive: stale writes are refused and deletes can be restored. The
 * hint also decides policy, since Codex refuses destructive tools outright
 * when it cannot ask, and these tools are meant to run without approval.
 */
const WRITE: ExternalControlToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false
};

/** Ships with the bridge, so MCP clients can list tools before the app runs. */
export const EXTERNAL_CONTROL_TOOLS: readonly ExternalControlToolDefinition[] =
  [
    {
      name: "get_app_status",
      title: "Get DeepWrite status",
      description:
        "Reads the running DeepWrite app's version, window readiness, active agent runs and approval settings. Call this first; it starts DeepWrite when the app is not running.",
      inputSchema: GetAppStatusInputSchema,
      annotations: READ_ONLY
    },
    {
      name: "list_works",
      title: "List works",
      description:
        "Lists the user's short stories, scripts and long-form novels in DeepWrite's creative workspace.",
      inputSchema: ExternalListWorksInputSchema,
      annotations: READ_ONLY
    },
    {
      name: "get_work",
      title: "Get work structure",
      description:
        "Returns one work's stages, documents and linked libraries. Use the document ids with read_document. Contains no document text.",
      inputSchema: ExternalGetWorkInputSchema,
      annotations: READ_ONLY
    },
    {
      name: "read_document",
      title: "Read a document",
      description:
        "Reads one document of a work, one page at a time. Keep reading with nextOffset until it is null to get the whole text.",
      inputSchema: ExternalReadDocumentInputSchema,
      annotations: READ_ONLY
    },
    {
      name: "search_text",
      title: "Search text",
      description:
        "Finds text inside one work or one library and returns matching snippets. Pass exactly one of workId and libraryId.",
      inputSchema: ExternalSearchTextInputSchema,
      annotations: READ_ONLY
    },
    {
      name: "list_libraries",
      title: "List libraries",
      description:
        "Lists the user's material libraries, skill libraries and their groups.",
      inputSchema: ExternalListLibrariesInputSchema,
      annotations: READ_ONLY
    },
    {
      name: "get_library",
      title: "Get library entries",
      description:
        "Returns one material or skill library's details and entry list. Use the entry ids with read_entry. Contains no entry text.",
      inputSchema: ExternalGetLibraryInputSchema,
      annotations: READ_ONLY
    },
    {
      name: "read_entry",
      title: "Read a library entry",
      description:
        "Reads one library entry, or the library overview when entryId is omitted, one page at a time. Keep reading with nextOffset until it is null.",
      inputSchema: ExternalReadEntryInputSchema,
      annotations: READ_ONLY
    },
    {
      name: "list_agent_teams",
      title: "List agent teams",
      description:
        "Lists DeepWrite's agent teams and which ones are enabled. Pass teamId to also get that team's full settings.",
      inputSchema: ExternalListAgentTeamsInputSchema,
      annotations: READ_ONLY
    },
    {
      name: "write_document",
      title: "Write a document",
      description:
        "Replaces one document's whole text, immediately and without review. Read it first and pass its revision as baseRevision; external.stale_revision means it changed, so read it again and redo the edit instead of retrying.",
      inputSchema: ExternalWriteDocumentInputSchema,
      annotations: WRITE
    },
    {
      name: "manage_document",
      title: "Manage draft sections",
      description:
        "Creates, renames, moves, duplicates or deletes draft sections of a short or script work. Takes effect immediately. Delete keeps a copy that restore_trash_item brings back. Long-form chapters are not supported.",
      inputSchema: ExternalManageDocumentInputSchema,
      annotations: WRITE
    },
    {
      name: "manage_work",
      title: "Manage works",
      description:
        "Creates, renames, duplicates or deletes a work. Takes effect immediately. Delete takes the work off the list and keeps its folder, so restore_trash_item brings it back.",
      inputSchema: ExternalManageWorkInputSchema,
      annotations: WRITE
    },
    {
      name: "write_entry",
      title: "Write a library entry",
      description:
        "Replaces one library entry's whole text, immediately and without review. Read it first and pass its revision as baseRevision; external.stale_revision means it changed, so read it again and redo the edit.",
      inputSchema: ExternalWriteEntryInputSchema,
      annotations: WRITE
    },
    {
      name: "manage_entry",
      title: "Manage library entries",
      description:
        "Creates, renames, moves, duplicates or deletes entries of a material or skill library. Takes effect immediately. Delete keeps a copy that restore_trash_item brings back.",
      inputSchema: ExternalManageEntryInputSchema,
      annotations: WRITE
    },
    {
      name: "manage_library",
      title: "Manage libraries",
      description:
        "Creates, renames, duplicates or deletes a material or skill library. Takes effect immediately. Delete takes the library off the list and keeps its folder, so restore_trash_item brings it back.",
      inputSchema: ExternalManageLibraryInputSchema,
      annotations: WRITE
    },
    {
      name: "save_agent_team",
      title: "Save agent team settings",
      description:
        "Replaces one team's whole settings, immediately and without review. Read the team with list_agent_teams and teamId first, then pass its revision as baseRevision; external.stale_revision means it changed, so read it again.",
      inputSchema: ExternalSaveAgentTeamInputSchema,
      annotations: WRITE
    },
    {
      name: "manage_agent_team",
      title: "Manage agent teams",
      description:
        "Creates, renames, enables, disables or deletes an agent team. Takes effect immediately. Only one team per work type is enabled. An enabled team must be disabled before deletion. Delete keeps a copy that restore_trash_item brings back.",
      inputSchema: ExternalManageAgentTeamInputSchema,
      annotations: WRITE
    },
    {
      name: "open_in_app",
      title: "Open in DeepWrite",
      description:
        "Shows a work or library in the DeepWrite window. Pass exactly one of workId and libraryId.",
      inputSchema: ExternalOpenInAppInputSchema,
      annotations: { ...READ_ONLY, readOnlyHint: false }
    },
    {
      name: "run_agent",
      title: "Run DeepWrite's agent",
      description:
        "Sends a message to DeepWrite's built-in writing agent on a work or library, using the models set up in DeepWrite and, when the work has one, its agent team. The window switches to that target. Its edits save automatically. Setup is briefly queued; different targets run concurrently in independent conversations. Use newConversation for a new task; use a returned sessionId for later steps on the same target. Returns runId and sessionId after send acceptance, without waiting for generation. Other work may proceed while it runs; check each runId separately.",
      inputSchema: ExternalRunAgentInputSchema,
      annotations: WRITE
    },
    {
      name: "get_agent_run",
      title: "Check an agent run",
      description:
        "Reads a run's status and latest reply. waiting_for_input means the agent asked something: answer it with answer_agent_question, asking the user if needed. waiting_for_user means the user must act in DeepWrite.",
      inputSchema: ExternalAgentRunInputSchema,
      annotations: READ_ONLY
    },
    {
      name: "answer_agent_question",
      title: "Answer an agent's question",
      description:
        "Answers the questions a run is waiting on, then the run continues. Ask the user when the choice is theirs to make.",
      inputSchema: ExternalAnswerAgentQuestionInputSchema,
      annotations: WRITE
    },
    {
      name: "stop_agent_run",
      title: "Stop an agent run",
      description: "Stops a running agent.",
      inputSchema: ExternalAgentRunInputSchema,
      annotations: WRITE
    },
    {
      name: "list_trash",
      title: "List deleted items",
      description:
        "Lists what external agents have deleted and can still be restored.",
      inputSchema: ExternalListTrashInputSchema,
      annotations: READ_ONLY
    },
    {
      name: "restore_trash_item",
      title: "Restore a deleted item",
      description:
        "Brings back a deleted section, entry, agent team, work or library. Restored sections, entries and teams come back as new items with new ids.",
      inputSchema: ExternalRestoreTrashItemInputSchema,
      annotations: WRITE
    }
  ];

export function findExternalControlTool(
  name: string
): ExternalControlToolDefinition | undefined {
  return EXTERNAL_CONTROL_TOOLS.find((tool) => tool.name === name);
}

/** JSON Schema object for MCP `tools/list`, without the draft marker. */
export function externalControlToolInputJsonSchema(
  tool: ExternalControlToolDefinition
): { type: "object" } & Record<string, unknown> {
  const { $schema: _draft, ...schema } = z.toJSONSchema(tool.inputSchema);
  return { ...schema, type: "object" };
}
