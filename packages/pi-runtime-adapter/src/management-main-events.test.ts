import { expect, it } from "vitest";
import { toRuntimeEvents } from "./event-mapping";
import type { AgentRunInput } from "./runtime-types";
import { createLibraryManagementRuntime } from "./library-management-runtime";
import { materialWorkspace } from "./library-agent-tools/test-fixtures";

it.each(["request-approval", "auto-approve"] as const)(
  "maps main management proposals with work scope in %s",
  async (writeApprovalMode) => {
    const workspace = materialWorkspace();
    const scope = { bookId: "book", bookType: "short" as const };
    const input: AgentRunInput = {
      sessionId: "main-session",
      runId: "main-run",
      prompt: "创建素材",
      writeApprovalMode,
      libraryManagement: {
        scope,
        managers: [{ domain: "material", description: "按用户要求创建" }],
        libraries: [
          {
            domain: "material",
            libraryId: workspace.libraryId,
            title: workspace.title,
            readOnly: false
          }
        ]
      },
      libraryManagementCommandExecutor: async (command) => ({
        status: "accepted",
        requestId: command.id,
        payload: { libraries: [], workspace }
      })
    };
    const tool = createLibraryManagementRuntime(input).tools.find(
      (tool) => tool.name === "manage_material_create_material_entry"
    )!;
    const result = await tool.execute("main-call", {
      library_id: workspace.libraryId,
      stage_id: "pacing",
      name: "新素材",
      description: "测试素材",
      title: "新素材",
      body: "正文"
    });
    const events = toRuntimeEvents(
      {
        type: "tool_execution_end",
        toolCallId: "main-call",
        toolName: tool.name,
        isError: false,
        result
      },
      input,
      { provider: "test", model: "test", mode: "provider" },
      "message"
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "library.editor_mutation",
        sessionId: "main-session",
        runId: "main-run",
        payload: expect.objectContaining({
          managementScope: scope,
          libraryId: workspace.libraryId,
          baseProjectRevision: 7,
          toolCallId: "main-call"
        })
      })
    );
  }
);
