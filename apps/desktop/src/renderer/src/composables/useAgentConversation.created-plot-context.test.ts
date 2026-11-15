import { WorkspaceRuntimeContextSchema } from "@deepwrite/contracts/renderer";
import {
  createDeferredApi,
  createScriptWorkspaceDocuments,
  createShortWorkspaceContentRevision,
  createShortWorkspaceDocuments,
  describe,
  expect,
  it,
  runtime,
  useAgentConversation
} from "./useAgentConversation.test-support";

describe("new plot stage prompt context", () => {
  it.each([
    ["short", "empty"],
    ["script", "empty"],
    ["short", "missing"],
    ["script", "missing"]
  ] as const)(
    "keeps the %s plot stage structure without sending text when its directory body is %s",
    async (workspaceType, directoryBody) => {
      const deferred = createDeferredApi();
      const controller = useAgentConversation({ api: () => deferred.api });
      const documents =
        workspaceType === "short"
          ? createShortWorkspaceDocuments()
          : createScriptWorkspaceDocuments();
      const source = documents.find(
        ({ stageId }) => stageId === "plot_design"
      )!;
      const stageId = "plot-stage-agent:created-ending";
      const active = {
        ...source,
        id: `${source.workspaceId}:${stageId}`,
        stageId,
        title: "终局回收",
        plotStageDescription: "回收前文伏笔。",
        plotStageOrder: documents.length,
        content: `${"线索".repeat(10_010)}\n真相在此揭晓。`
      };
      const stale = { ...active, content: "", catalogContentLoaded: false };
      if (directoryBody === "empty") documents.push(stale);
      controller.draft.value = "继续完善新建的剧情结构";
      deferred.resolveAccepted(0, {
        sessionId: controller.sessionId.value,
        runId: `run-created-plot-${workspaceType}`,
        acceptedAt: new Date().toISOString(),
        runtime
      });

      try {
        await controller.sendMessage(active, documents);

        const context = WorkspaceRuntimeContextSchema.parse(
          deferred.prompts[0]?.workspaceContext
        );
        const workspace = context.shortWorkspace ?? context.scriptWorkspace;
        expect(workspace?.activeStageId).toBe(stageId);
        expect(
          workspace?.stages.find((stage) => stage.stageId === stageId)
        ).toMatchObject({
          title: "终局回收",
          content: "",
          revision: createShortWorkspaceContentRevision("")
        });
        expect(workspace?.readSource).toBe("core");
        expect(context.activeResource).toMatchObject({ content: "" });
        expect(context.activeResource?.truncated).toBeUndefined();
        expect(stale.content).toBe("");
      } finally {
        controller.dispose();
      }
    }
  );

  it("captures the active stage before asynchronous context loading without sending its text", async () => {
    const deferred = createDeferredApi();
    const controller = useAgentConversation({ api: () => deferred.api });
    const documents = createShortWorkspaceDocuments();
    const active = documents.find(({ stageId }) => stageId === "plot_design")!;
    controller.draft.value = "检查当前剧情";
    deferred.resolveAccepted(0, {
      sessionId: controller.sessionId.value,
      runId: "run-context-snapshot",
      acceptedAt: new Date().toISOString(),
      runtime
    });

    try {
      const sending = controller.sendMessage(active, documents);
      active.content = "发送后编辑器发生的新修改。";
      await sending;

      const context = WorkspaceRuntimeContextSchema.parse(
        deferred.prompts[0]?.workspaceContext
      );
      expect(context.activeResource?.id).toBe(active.id);
      expect(context.activeResource?.content).toBe("");
      expect(context.shortWorkspace?.activeStageId).toBe("plot_design");
      expect(
        context.shortWorkspace?.stages.find(
          (stage) => stage.stageId === "plot_design"
        )
      ).toMatchObject({
        content: "",
        revision: createShortWorkspaceContentRevision("")
      });
    } finally {
      controller.dispose();
    }
  });
});
