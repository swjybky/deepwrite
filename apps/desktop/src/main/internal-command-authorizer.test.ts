import { describe, expect, it } from "vitest";
import {
  CommandEnvelopeSchema,
  createEnvelope,
  type CommandEnvelope,
  type UtilityInternalCommandRequestMessage
} from "@deepwrite/contracts";
import {
  AGENT_CORE_LONG_QUERY_COMMANDS,
  authorizeMainInternalCommand,
  type MainInternalCommandActiveRun
} from "./internal-command-authorizer";
import type { UtilityInternalCommandAuthorizationContext } from "./supervisor";

const RUN_ID = "run-long-authorized";
const SESSION_ID = "session-long-authorized";
const BOOK_ID = "longbook_authorized";
const PROMPT_REQUEST_ID = "command-session-prompt";

function queryCommand(
  type: (typeof AGENT_CORE_LONG_QUERY_COMMANDS)[number],
  overrides: {
    runId?: string;
    sessionId?: string;
    resourceId?: string;
    bookId?: string;
  } = {}
): CommandEnvelope {
  const bookId = overrides.bookId ?? BOOK_ID;
  const payload =
    type === "long.getWorkspaceIndex"
      ? { bookId }
      : type === "long.readDocument"
        ? {
            bookId,
            fileId: "file_world_rules:content",
            offset: 0,
            maxCharacters: 100
          }
        : {
            bookId,
            query: "规则",
            scope: "worldbuilding" as const,
            limit: 20,
            maxSnippetCharacters: 320
          };
  return CommandEnvelopeSchema.parse(
    createEnvelope(type, payload, {
      id: `query-${type}`,
      context: {
        sessionId: overrides.sessionId ?? SESSION_ID,
        runId: overrides.runId ?? RUN_ID,
        resourceId: overrides.resourceId ?? BOOK_ID
      }
    })
  );
}

function authorizationContext(
  command: CommandEnvelope,
  overrides: Partial<
    Pick<UtilityInternalCommandAuthorizationContext, "source" | "target">
  > & {
    parentRequestId?: string;
  } = {}
): UtilityInternalCommandAuthorizationContext {
  const message: UtilityInternalCommandRequestMessage = {
    kind: "utility.internal.command.request",
    worker: "agent",
    target: overrides.target ?? "core",
    requestId: `bridge-${command.id}`,
    parentRequestId: overrides.parentRequestId ?? PROMPT_REQUEST_ID,
    timeoutMs: 60_000,
    command
  };
  return {
    source: overrides.source ?? "agent",
    target: overrides.target ?? "core",
    message
  };
}

function acceptedRun(
  overrides: Partial<MainInternalCommandActiveRun> = {}
): Map<string, MainInternalCommandActiveRun> {
  return new Map([
    [
      RUN_ID,
      {
        sessionId: SESSION_ID,
        resourceId: BOOK_ID,
        promptRequestId: PROMPT_REQUEST_ID,
        accepted: true,
        ...overrides
      }
    ]
  ]);
}

describe("Main internal command authorizer", () => {
  it("allows only the three long queries for the exact accepted run binding", () => {
    expect(AGENT_CORE_LONG_QUERY_COMMANDS).toEqual([
      "long.getWorkspaceIndex",
      "long.readDocument",
      "long.search"
    ]);
    for (const type of AGENT_CORE_LONG_QUERY_COMMANDS) {
      expect(
        authorizeMainInternalCommand(
          authorizationContext(queryCommand(type)),
          acceptedRun()
        )
      ).toBe(true);
    }
  });

  it.each([
    {
      name: "unknown run",
      command: queryCommand("long.getWorkspaceIndex", {
        runId: "run-other"
      }),
      runs: acceptedRun(),
      code: "main.run_not_accepted"
    },
    {
      name: "unaccepted run",
      command: queryCommand("long.getWorkspaceIndex"),
      runs: acceptedRun({ accepted: false }),
      code: "main.run_not_accepted"
    },
    {
      name: "non-long run",
      command: queryCommand("long.getWorkspaceIndex"),
      runs: new Map([
        [
          RUN_ID,
          {
            sessionId: SESSION_ID,
            promptRequestId: PROMPT_REQUEST_ID,
            accepted: true
          }
        ]
      ]),
      code: "main.run_not_long_form"
    },
    {
      name: "session mismatch",
      command: queryCommand("long.getWorkspaceIndex", {
        sessionId: "session-other"
      }),
      runs: acceptedRun(),
      code: "main.session_mismatch"
    },
    {
      name: "resource mismatch",
      command: queryCommand("long.getWorkspaceIndex", {
        resourceId: "longbook_other"
      }),
      runs: acceptedRun(),
      code: "main.resource_mismatch"
    },
    {
      name: "payload book mismatch",
      command: queryCommand("long.getWorkspaceIndex", {
        bookId: "longbook_other"
      }),
      runs: acceptedRun(),
      code: "main.book_mismatch"
    }
  ])("rejects $name", ({ command, runs, code }) => {
    expect(
      authorizeMainInternalCommand(authorizationContext(command), runs)
    ).toMatchObject({
      authorized: false,
      code
    });
  });

  it("rejects commands detached from the accepted prompt request", () => {
    expect(
      authorizeMainInternalCommand(
        authorizationContext(queryCommand("long.search"), {
          parentRequestId: "command-other-prompt"
        }),
        acceptedRun()
      )
    ).toMatchObject({
      authorized: false,
      code: "main.parent_request_mismatch"
    });
  });

  it("rejects non-Agent routes and long mutation commands defensively", () => {
    expect(
      authorizeMainInternalCommand(
        authorizationContext(queryCommand("long.search"), {
          source: "tool"
        }),
        acceptedRun()
      )
    ).toMatchObject({
      authorized: false,
      code: "main.invalid_bridge_route"
    });

    const write = CommandEnvelopeSchema.parse(
      createEnvelope(
        "long.writeDocument",
        {
          bookId: BOOK_ID,
          fileId: "file_world_rules:content",
          content: "不得直写"
        },
        {
          id: "long-write-forbidden",
          context: {
            sessionId: SESSION_ID,
            runId: RUN_ID,
            resourceId: BOOK_ID
          }
        }
      )
    );
    expect(
      authorizeMainInternalCommand(authorizationContext(write), acceptedRun())
    ).toMatchObject({
      authorized: false,
      code: "main.command_not_long_query"
    });
  });
});

describe("domain library agent read authorization", () => {
  const command = CommandEnvelopeSchema.parse(
    createEnvelope(
      "catalog.readLibraryAgentLibrary",
      {
        domain: "material",
        libraryId: "other-library"
      },
      { id: "domain-query", context: { sessionId: SESSION_ID, runId: RUN_ID } }
    )
  );
  it("accepts only the accepted matching domain, session and parent prompt", () => {
    const runs = acceptedRun({ libraryAgentScope: { domain: "material" } });
    expect(
      authorizeMainInternalCommand(authorizationContext(command), runs)
    ).toBe(true);
    for (const overrides of [
      { accepted: false },
      { libraryAgentScope: { domain: "skill" as const } },
      { sessionId: "other" },
      {}
    ]) {
      expect(
        authorizeMainInternalCommand(
          authorizationContext(command),
          acceptedRun(overrides)
        )
      ).toMatchObject({ authorized: false });
    }
    expect(
      authorizeMainInternalCommand(
        authorizationContext(command, { parentRequestId: "other" }),
        runs
      )
    ).toMatchObject({ authorized: false });
  });
});

describe("library structure preview authorization", () => {
  const preview = () =>
    CommandEnvelopeSchema.parse(
      createEnvelope(
        "catalog.previewLibraryStructure",
        {
          domain: "material",
          requestId: "organize",
          operations: [
            { action: "rename-library", id: "library", title: "新名称" }
          ]
        },
        {
          id: "preview-test",
          context: { runId: RUN_ID, sessionId: SESSION_ID }
        }
      )
    );
  it("permits previews only for the accepted domain and prompt", () => {
    expect(
      authorizeMainInternalCommand(
        authorizationContext(preview()),
        acceptedRun({ libraryAgentScope: { domain: "material" } })
      )
    ).toBe(true);
    for (const runs of [
      acceptedRun(),
      acceptedRun({ libraryAgentScope: { domain: "skill" } }),
      acceptedRun({
        libraryAgentScope: { domain: "material" },
        accepted: false
      })
    ]) {
      expect(
        authorizeMainInternalCommand(authorizationContext(preview()), runs)
      ).toMatchObject({ authorized: false });
    }
    expect(
      authorizeMainInternalCommand(
        authorizationContext(preview(), { parentRequestId: "other" }),
        acceptedRun({ libraryAgentScope: { domain: "material" } })
      )
    ).toMatchObject({ authorized: false });
  });
  it("never permits the agent bridge to apply a plan", () => {
    const command = preview();
    const apply = CommandEnvelopeSchema.parse({
      ...command,
      type: "catalog.applyLibraryStructure",
      payload: {
        ...command.payload,
        baseVersion: "a".repeat(64),
        summary: "改名"
      }
    });
    expect(
      authorizeMainInternalCommand(
        authorizationContext(apply),
        acceptedRun({ libraryAgentScope: { domain: "material" } })
      )
    ).toMatchObject({ authorized: false });
  });
});
