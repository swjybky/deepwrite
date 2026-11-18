import {
  AgentPromptCommandPayloadSchema,
  DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES,
  type UtilityInternalCommandRequestMessage,
  createShortWorkspaceContentRevision
} from "@deepwrite/contracts";
import { createWritingReader } from "../../../../packages/pi-runtime-adapter/src/short-agent-tools/core-reader";
import {
  buildShortWorkspaceTools,
  buildScriptWorkspaceTools,
  createShortWorkspaceToolSharedState
} from "../../../../packages/pi-runtime-adapter/src/short-agent-tools";
import { settleWritingMutations } from "../../../../packages/pi-runtime-adapter/src/short-agent-tools/settlement";
import {
  shortWorkspace,
  shortProfile,
  toolByName,
  resultText
} from "../../../../packages/pi-runtime-adapter/src/short-agent-tools.test-support";
import { authorizeMainInternalCommand } from "../main/internal-command-authorizer";
import { createAgentRunInput } from "./agent-run-input";
import {
  FolderCatalogStore,
  makeTemporaryRoot,
  join,
  describe,
  it,
  expect
} from "./folder-catalog-store.test-support";

describe("authorized Agent-to-Core writing reads", () => {
  it.each(["short", "script"] as const)(
    "reads and proposes against current %s files across a single run",
    async (bookType) => {
      const root = await makeTemporaryRoot("writing-bridge-");
      const store = new FolderCatalogStore({
        userDataPath: join(root, "profile")
      });
      const book = await (bookType === "short"
        ? store.createShortBook({ title: "短篇", genre: "其他" }, root)
        : store.createScriptBook({ title: "剧本", genre: "其他" }, root));
      const bookId = book.resource.id;
      const section = book.resource.draft.sections[0]!;
      const file = section.characterState;

      const workspace = {
        ...shortWorkspace("draft"),
        id: bookId,
        readSource: "core" as const
      };
      const sessionId = "session-writing",
        runId = "run-writing",
        requestId = "prompt-writing";
      const runs = new Map([
        [
          runId,
          {
            sessionId,
            accepted: true,
            promptRequestId: requestId,
            writingScope: { bookId, bookType }
          }
        ]
      ]);
      const requests: string[] = [];
      const payload = AgentPromptCommandPayloadSchema.parse({
        sessionId,
        message: "read",
        ...(bookType === "short"
          ? { agentProfile: shortProfile() }
          : { scriptAgentProfile: DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES[0] }),
        workspaceContext:
          bookType === "short"
            ? { shortWorkspace: workspace }
            : { scriptWorkspace: workspace }
      });
      const input = createAgentRunInput(
        payload,
        runId,
        new AbortController().signal,
        {
          worker: "agent",
          requestId,
          async requestInternalCommand(target, command) {
            const message: UtilityInternalCommandRequestMessage = {
              kind: "utility.internal.command.request",
              worker: "agent",
              target,
              command,
              requestId: command.id,
              parentRequestId: requestId,
              timeoutMs: 60000
            };
            expect(
              authorizeMainInternalCommand(
                { source: "agent", target, message },
                runs
              )
            ).toBe(true);
            if (command.type !== "catalog.readWritingWorkspace")
              throw new Error("Unexpected Core command");
            requests.push(
              command.payload.query.mode === "index"
                ? "index"
                : command.payload.query.documentId
            );
            return {
              status: "accepted",
              requestId: command.id,
              payload: await store.readWritingWorkspace(command.payload, runId)
            };
          }
        }
      );
      const writingReader = createWritingReader(input, bookId, bookType);
      const sharedState = createShortWorkspaceToolSharedState(workspace);
      const options = {
        workspace,
        sharedState,
        writingReader,
        promptLocale: "en-US" as const
      };
      const tools =
        bookType === "short"
          ? buildShortWorkspaceTools({ ...options, profile: shortProfile() })
          : buildScriptWorkspaceTools({
              ...options,
              workspace: { ...workspace, activeAgentId: "script" },
              profile: DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES[0]!
            });
      const read = toolByName(tools, "read"),
        edit = toolByName(tools, "edit");
      const target = {
        kind: "draft_section",
        id: section.id,
        document: "state"
      };
      let revision = createShortWorkspaceContentRevision("");
      async function save(content: string) {
        await store.saveDocument({
          bookId,
          documentId: file.id,
          baseRevision: revision,
          baseProjectRevision: 0,
          content
        });
        revision = createShortWorkspaceContentRevision(content);
      }
      await save("first version");
      expect(resultText(await read.execute("read", target))).toContain(
        "first version"
      );
      expect(requests).toEqual(["index", file.id]);
      await save("");
      expect(
        (await edit.execute("cleared-during-run", { ...target, append: "!" }))
          .details.kind
      ).toBe("none");
      await save("new state");
      expect(
        (await edit.execute("stale", { ...target, append: "!" })).details.kind
      ).toBe("none");
      expect(resultText(await read.execute("reread", target))).toContain(
        "new state"
      );
      expect(
        (await edit.execute("propose", { ...target, append: "!" })).details
      ).toMatchObject({ text: "new state!", baseRevision: revision });
      expect(resultText(await read.execute("pending", target))).toContain(
        "new state!"
      );
      expect(
        resultText(
          await read.execute("range", { ...target, offset: 4, limit: 3 })
        )
      ).toMatch(/\nsta$/u);
      expect(
        resultText(
          await read.execute("directory", {
            kind: "workspace",
            id: "workspace"
          })
        )
      ).toContain("State 9 characters");
      settleWritingMutations(sharedState, ["propose"]);
      expect(resultText(await read.execute("rejected", target))).toMatch(
        /\nnew state$/u
      );
      await edit.execute("again", { ...target, append: " OK" });
      await save("edited during review");
      settleWritingMutations(sharedState, ["again"], {
        items: [
          {
            title: "State",
            status: "saved",
            edited: true,
            editedTextTruncated: true,
            toolCallIds: ["again"]
          }
        ]
      });
      expect(resultText(await read.execute("saved", target))).toContain(
        "edited during review"
      );
      await save(" ".repeat(50000) + "end");
      expect(resultText(await read.execute("large", target))).toContain(
        "50003"
      );
      expect(
        resultText(
          await read.execute("slice", { ...target, offset: 50000, limit: 3 })
        )
      ).toMatch(/\nend$/u);
      expect(
        (await edit.execute("no-evidence", { ...target, append: "x" })).details
          .kind
      ).toBe("none");
      requests.length = 0;
      expect(
        resultText(
          await read.execute("all", {
            kind: "draft",
            id: "draft",
            document: "state",
            section_scope: "all_sections"
          })
        )
      ).toContain("Full text not returned");
      expect(requests).toEqual(["index"]);
      // Saved creations switch from the proposal id to the real on-disk id.
      const create = toolByName(tools, "create");
      const result = await create.execute("batch", {
        kind: "draft_section",
        meta: { title: "Later" },
        content: "new body"
      });
      const provisional = result.details.sections[0]
        .provisionalSectionId as string;
      expect(
        resultText(
          await read.execute("provisional", {
            kind: "draft_section",
            id: provisional,
            document: "body"
          })
        )
      ).toMatch(/\nnew body$/u);
      const receipt = await store.createDraftSections({
        bookId,
        operationId: `agent-draft-sections:${runId}:test`,
        baseProjectRevision: await store.getProjectRevision(bookId, "book"),
        sections: [
          {
            clientSectionId: provisional,
            title: "Later",
            wordCountRequirement: "",
            bodyContent: "saved body"
          }
        ]
      });
      settleWritingMutations(sharedState, ["batch"]);
      expect(
        resultText(
          await read.execute("remapped", {
            kind: "draft_section",
            id: provisional,
            document: "body"
          })
        )
      ).toMatch(/\nsaved body$/u);
      const directory = resultText(
        await read.execute("after-create", {
          kind: "workspace",
          id: "workspace"
        })
      );
      expect(directory).toContain(receipt.sections[0]!.section.id);
      expect(directory).not.toContain(provisional);
      const autoOptions = {
        ...options,
        writeApprovalMode: "auto-approve" as const
      };
      const auto =
        bookType === "short"
          ? buildShortWorkspaceTools({
              ...autoOptions,
              profile: shortProfile()
            })
          : buildScriptWorkspaceTools({
              ...autoOptions,
              workspace: { ...workspace, activeAgentId: "script" },
              profile: DEFAULT_SCRIPT_WORKSPACE_AGENT_PROFILES[0]!
            });
      const autoTarget = {
        kind: "draft_section",
        id: receipt.sections[0]!.section.id,
        document: "body"
      };
      const autoRead = toolByName(auto, "read");
      await autoRead.execute("auto-read", autoTarget);
      const proposed = await toolByName(auto, "edit").execute("auto-write", {
        ...autoTarget,
        append: "!"
      });
      expect(
        resultText(await autoRead.execute("auto-pending", autoTarget))
      ).toMatch(/\nsaved body!$/u);
      await store.saveDocument({
        bookId,
        documentId: receipt.sections[0]!.section.body.id,
        baseProjectRevision: receipt.projectRevision,
        baseRevision: proposed.details.baseRevision,
        content: "saved body!"
      });
      await autoRead.execute("auto-saved", autoTarget);
      await store.saveDocument({
        bookId,
        documentId: receipt.sections[0]!.section.body.id,
        baseProjectRevision: receipt.projectRevision,
        baseRevision: createShortWorkspaceContentRevision("saved body!"),
        content: "external update"
      });
      expect(
        resultText(await autoRead.execute("external", autoTarget))
      ).toMatch(/\nexternal update$/u);
    }
  );
});
