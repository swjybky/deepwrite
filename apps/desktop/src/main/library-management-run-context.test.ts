import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LIBRARY_AGENT_PROFILES,
  AgentTeamCatalogSnapshotSchema,
  DEFAULT_AGENT_TEAM_SETTINGS,
  createEnvelope,
  CommandEnvelopeSchema,
  type CommandResult
} from "@deepwrite/contracts";
import { prepareLibraryManagementRunContext } from "./library-management-run-context";
import {
  authorizeMainInternalCommand,
  type MainInternalCommandActiveRun
} from "./internal-command-authorizer";

// Profiles and scope come from Main-owned settings, never caller-supplied capabilities.
describe("Main management run authority", () => {
  it.each(["short", "script", "long"] as const)(
    "resolves managers independently of a selected %s team",
    async (bookType) => {
      const catalog = AgentTeamCatalogSnapshotSchema.parse({
        enabledTeamIds: {},
        teams: [
          {
            id: "default",
            name: "默认",
            workspaceType: "short",
            settings: DEFAULT_AGENT_TEAM_SETTINGS
          }
        ]
      });
      catalog.builtinSubagents.material.enabled = false;
      const request = vi.fn(async (): Promise<CommandResult> => ({
        status: "accepted",
        requestId: "query",
        payload: { libraries: [] }
      }));
      const workspace =
        bookType === "long"
          ? { longWorkspace: { bookId: "book" } }
          : {
              [bookType === "short" ? "shortWorkspace" : "scriptWorkspace"]: {
                id: "book"
              }
            };
      const result = await prepareLibraryManagementRunContext(
        workspace as Parameters<typeof prepareLibraryManagementRunContext>[0],
        { list: async () => catalog },
        {
          resolve: async (domain) =>
            DEFAULT_LIBRARY_AGENT_PROFILES.find(
              (profile) => profile.domain === domain
            )!
        },
        request
      );
      expect(result?.scope).toEqual({ bookId: "book", bookType });
      expect(result?.managers.map((manager) => manager.domain)).toEqual([
        "skill"
      ]);
      expect(request).toHaveBeenCalledOnce();
    }
  );
  it("authorizes only accepted runs with matching work, session and parent request", () => {
    const scope = { bookId: "book", bookType: "short" as const };
    const command = CommandEnvelopeSchema.parse(
      createEnvelope(
        "catalog.queryLibraryManagement",
        { scope, domain: "skill", libraryId: "skills" },
        {
          id: "query",
          context: { runId: "run", sessionId: "session", resourceId: "book" }
        }
      )
    );
    const context = {
      source: "agent" as const,
      target: "core" as const,
      message: {
        kind: "utility.internal.command.request" as const,
        worker: "agent" as const,
        target: "core" as const,
        requestId: "bridge",
        parentRequestId: "prompt",
        timeoutMs: 60000,
        command
      }
    };
    const run: MainInternalCommandActiveRun = {
      sessionId: "session",
      accepted: true,
      promptRequestId: "prompt",
      libraryManagementScope: scope
    };
    expect(authorizeMainInternalCommand(context, new Map([["run", run]]))).toBe(
      true
    );
    for (const changed of [
      { accepted: false },
      { sessionId: "other" },
      { promptRequestId: "other" },
      { libraryManagementScope: { ...scope, bookId: "other" } }
    ])
      expect(
        authorizeMainInternalCommand(
          context,
          new Map([["run", { ...run, ...changed }]])
        )
      ).toMatchObject({ authorized: false });
  });
});
