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
  useAgentConversation,
  vi,
  type WorkspaceDocument
} from "./useAgentConversation.test-support";

function characterDocuments(workspaceType: "short" | "script") {
  const documents =
    workspaceType === "short"
      ? createShortWorkspaceDocuments()
      : createScriptWorkspaceDocuments();
  const overview = documents.find(
    ({ stageId }) => stageId === "character_design"
  )!;
  overview.title = "概览";
  overview.path = [overview.workspaceTitle!, "人物", "概览"];
  overview.characterFileKind = "overview";
  overview.content = "女主与男主的姓名、定位和摘要。";
  const items: WorkspaceDocument[] = ["女主", "男主"].map((title, index) => ({
    ...overview,
    id: `book-document:${overview.workspaceId}:character-${index + 1}`,
    title,
    path: [overview.workspaceTitle!, "人物", title],
    content: `${title}的独立人物设定。`,
    characterFileKind: "item",
    characterItemId: `character-${index + 1}`,
    characterItemOrder: index + 1
  }));
  documents.push(...items);
  return { documents, overview, items };
}

describe.each(["short", "script"] as const)(
  "%s character card prompt context",
  (workspaceType) => {
    it.each(["女主", "男主", "概览"])(
      "sends the selected %s structure without text through the validated session prompt",
      async (title) => {
        const { documents, overview, items } =
          characterDocuments(workspaceType);
        const active =
          title === "概览"
            ? overview
            : items.find((item) => item.title === title)!;
        const deferred = createDeferredApi();
        const prompt = deferred.api.session.prompt;
        vi.spyOn(deferred.api.session, "prompt").mockImplementation((payload) =>
          prompt({
            ...payload,
            workspaceContext: WorkspaceRuntimeContextSchema.parse(
              payload.workspaceContext
            )
          })
        );
        const controller = useAgentConversation({ api: () => deferred.api });
        controller.draft.value = "继续完善当前人物设定";
        deferred.resolveAccepted(0, {
          sessionId: controller.sessionId.value,
          runId: `run-${workspaceType}-${active.characterItemId ?? "overview"}`,
          acceptedAt: new Date().toISOString(),
          runtime
        });
        try {
          await controller.sendMessage(active, documents);

          expect(controller.conversationError.value).toBeNull();
          expect(deferred.prompts).toHaveLength(1);
          const context = deferred.prompts[0]!.workspaceContext!;
          const workspace = context.shortWorkspace ?? context.scriptWorkspace;
          expect(workspace).toMatchObject({
            activeStageId: "character_design",
            characterStructure: {
              format: "list",
              items: items.map((item) => ({
                id: item.characterItemId,
                content: "",
                revision: createShortWorkspaceContentRevision("")
              }))
            }
          });
          expect(context.activeResource).toMatchObject({
            id: active.id,
            title: active.title,
            content: ""
          });
          expect(workspace?.readSource).toBe("core");
          expect(
            workspace?.stages.find(
              ({ stageId }) => stageId === "character_design"
            )?.content
          ).toBe("");
        } finally {
          controller.dispose();
        }
      }
    );

    it("does not send a newly edited long card text and keeps the card structure", async () => {
      const { documents, items } = characterDocuments(workspaceType);
      const stale = items[0]!;
      stale.content = "尚未刷新的目录内容。";
      const sentContent = `${"人物细节".repeat(5_010)}完整卡片的结尾。`;
      const active = { ...stale, content: sentContent };
      const deferred = createDeferredApi();
      const prompt = deferred.api.session.prompt;
      vi.spyOn(deferred.api.session, "prompt").mockImplementation((payload) =>
        prompt({
          ...payload,
          workspaceContext: WorkspaceRuntimeContextSchema.parse(
            payload.workspaceContext
          )
        })
      );
      const controller = useAgentConversation({ api: () => deferred.api });
      controller.draft.value = "检查当前人物卡";
      deferred.resolveAccepted(0, {
        sessionId: controller.sessionId.value,
        runId: `run-${workspaceType}-live-character`,
        acceptedAt: new Date().toISOString(),
        runtime
      });
      try {
        const sending = controller.sendMessage(active, documents);
        active.content = "发送后继续编辑的内容。";
        await sending;

        expect(controller.conversationError.value).toBeNull();
        expect(deferred.prompts).toHaveLength(1);
        const context = deferred.prompts[0]!.workspaceContext!;
        const workspace = context.shortWorkspace ?? context.scriptWorkspace;
        expect(context.activeResource).toMatchObject({ content: "" });
        expect(context.activeResource?.truncated).toBeUndefined();
        expect(workspace?.characterStructure).toMatchObject({
          format: "list",
          items: [
            {
              id: stale.characterItemId,
              content: "",
              revision: createShortWorkspaceContentRevision("")
            },
            {
              id: items[1]!.characterItemId,
              content: "",
              revision: createShortWorkspaceContentRevision("")
            }
          ]
        });
        expect(stale.content).toBe("尚未刷新的目录内容。");
      } finally {
        controller.dispose();
      }
    });
  }
);
