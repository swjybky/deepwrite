import { describe, expect, it } from "vitest";
import {
  AgentMessageCompletedEventEnvelopeSchema,
  AgentMessageDeltaEventEnvelopeSchema,
  ActiveResourceSnapshotSchema,
  CommandEnvelopeSchema,
  ExpertDraftFileSnapshotSchema,
  ExpertDraftSchema,
  ModelSettingsInputSchema,
  ModelSettingsSchema,
  PROTOCOL_VERSION,
  PROMPT_IMAGE_ATTACHMENT_MAX_BYTES,
  SHORT_WORKSPACE_FILE_MAX_CHARACTERS,
  SHORT_WORKSPACE_TEXT_STAGE_IDS,
  ShortWorkspaceStageSnapshotSchema,
  SessionPromptAcceptedPayloadSchema,
  SystemEventEnvelopeSchema,
  SystemHealthPayloadSchema,
  UtilityInboundMessageSchema,
  UtilityOutboundMessageSchema,
  UserPromptAttachmentsSchema,
  WorkspaceRuntimeContextSchema,
  WorkspaceEditorMutationPayloadSchema,
  createShortWorkspaceContentRevision,
  createEnvelope
} from "./index";

const runtime = {
  provider: "deepwrite",
  model: "deepwrite-writing-faux",
  mode: "local-faux" as const
};

function shortWorkspaceRuntimeFixture() {
  const contentRevision = (content: string): string =>
    createShortWorkspaceContentRevision(content);

  return {
    id: "book_runtime",
    title: "运行时正文",
    categories: ["悬疑"],
    activeStageId: "draft" as const,
    activeAgentId: "expert_draft_coordinator" as const,
    expertDraft: {
      id: "draft" as const,
      title: "正文",
      revision: contentRevision("draft-directory"),
      sections: [
        {
          id: "section-1",
          title: "第一节",
          wordCountRequirement: "1000 字",
          body: {
            documentId: "draft:section-1:body",
            title: "第一节·正文",
            content: "第一节正文。",
            revision: contentRevision("第一节正文。")
          },
          characterState: {
            documentId: "draft:section-1:state",
            title: "第一节·人物状态",
            content: "人物仍在雨中。",
            revision: contentRevision("人物仍在雨中。")
          }
        },
        {
          id: "section-2",
          title: "第二节",
          wordCountRequirement: "1200 字",
          body: {
            documentId: "draft:section-2:body",
            title: "第二节·正文",
            content: "第二节正文。",
            revision: contentRevision("第二节正文。")
          },
          characterState: {
            documentId: "draft:section-2:state",
            title: "第二节·人物状态",
            content: "人物进入车站。",
            revision: contentRevision("人物进入车站。")
          }
        }
      ]
    },
    stages: SHORT_WORKSPACE_TEXT_STAGE_IDS.map((stageId) => {
      const content = stageId === "outline" ? "第一节：雨夜。" : "";
      return {
        stageId,
        title: stageId,
        content,
        revision: contentRevision(content)
      };
    })
  };
}

describe("DeepWrite desktop contracts", () => {
  it("creates a versioned command envelope with a correlation id", () => {
    const envelope = createEnvelope("system.health", {}, { id: "cmd_health" });

    expect(CommandEnvelopeSchema.parse(envelope)).toMatchObject({
      protocolVersion: PROTOCOL_VERSION,
      id: "cmd_health",
      type: "system.health",
      context: { correlationId: "cmd_health" }
    });
  });

  it("rejects unknown protocol versions", () => {
    const envelope = createEnvelope("system.health", {}, { id: "cmd_health" });

    expect(() => CommandEnvelopeSchema.parse({ ...envelope, protocolVersion: 2 })).toThrow();
  });

  it("accepts three healthy utility workers", () => {
    const workers = ["core", "agent", "tool"].map((name, index) => ({
      name,
      status: "ok",
      pid: 1000 + index,
      details: {}
    }));

    expect(
      SystemHealthPayloadSchema.parse({
        status: "ok",
        checkedAt: new Date().toISOString(),
        workers
      }).workers
    ).toHaveLength(3);
  });

  it("accepts a prompt with a matching session and live editor snapshot", () => {
    const envelope = createEnvelope(
      "session.prompt",
      {
        sessionId: "session_1",
        message: "续写这一段",
        thinkingLevel: "medium" as const,
        writeApprovalMode: "auto-approve" as const,
        workspaceContext: {
          activeResource: {
            id: "chapter_1",
            domain: "creation" as const,
            title: "第一章",
            path: ["长篇小说", "第一章"],
            format: "markdown",
            source: "live-editor" as const,
            content: "窗外正在下雨。"
          }
        }
      },
      {
        id: "cmd_prompt",
        context: { sessionId: "session_1", resourceId: "chapter_1" }
      }
    );

    expect(CommandEnvelopeSchema.parse(envelope)).toMatchObject({
      type: "session.prompt",
      payload: { writeApprovalMode: "auto-approve" }
    });
  });

  it("accepts extracted text and base64 image prompt attachments", () => {
    const attachments = UserPromptAttachmentsSchema.parse([
      {
        id: "attachment_notes",
        kind: "text",
        name: "notes.md",
        mediaType: "text/markdown",
        size: 18,
        content: "雨夜场景需要更压抑。"
      },
      {
        id: "attachment_reference",
        kind: "image",
        name: "reference.png",
        mediaType: "image/png",
        size: 3,
        data: "AQID"
      }
    ]);

    expect(attachments.map((attachment) => attachment.kind)).toEqual(["text", "image"]);
    expect(() =>
      UserPromptAttachmentsSchema.parse([
        {
          id: "too_large",
          kind: "image",
          name: "too-large.png",
          mediaType: "image/png",
          size: PROMPT_IMAGE_ATTACHMENT_MAX_BYTES + 1,
          data: "AQID"
        }
      ])
    ).toThrow();
    expect(() =>
      UserPromptAttachmentsSchema.parse([
        {
          id: "forged_size",
          kind: "image",
          name: "forged.png",
          mediaType: "image/png",
          size: 1,
          data: "AQID"
        }
      ])
    ).toThrow();
  });

  it("normalizes public model settings without exposing API keys", () => {
    const settings = ModelSettingsSchema.parse({
      defaultModelId: "deepseek",
      models: [
        {
          id: "deepseek",
          label: "DeepSeek",
          provider: "deepseek",
          modelId: "deepseek-chat",
          api: "openai-completions",
          baseUrl: "https://api.deepseek.com/v1",
          reasoning: true,
          defaultThinkingLevel: "xhigh",
          hasApiKey: true,
          apiKey: "must-not-cross-the-boundary"
        }
      ]
    });

    expect(settings.models[0]?.defaultThinkingLevel).toBe("xhigh");
    expect(settings.models[0]?.thinkingLevelOptions).toEqual([
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max"
    ]);
    expect(settings.models[0]?.temperatureOptions).toEqual([0.1, 0.7, 1]);
    expect("apiKey" in (settings.models[0] ?? {})).toBe(false);
  });

  it("accepts max and one custom provider thinking level", () => {
    const settings = ModelSettingsInputSchema.parse({
      defaultModelId: "writer",
      models: [
        {
          id: "writer",
          label: "Writer",
          provider: "custom",
          modelId: "writer-model",
          api: "openai-responses",
          baseUrl: "http://127.0.0.1:11434/v1",
          reasoning: true,
          defaultThinkingLevel: "ultra",
          thinkingLevelOptions: ["low", "medium", "high", "xhigh", "max", "ultra"],
          temperatureOptions: [0.1, 0.7, 1]
        }
      ]
    });

    expect(settings.models[0]?.thinkingLevelOptions).toContain("max");
    expect(settings.models[0]?.defaultThinkingLevel).toBe("ultra");
  });

  it("rejects invalid model defaults and reasoning defaults", () => {
    const model = {
      id: "plain",
      label: "Plain model",
      provider: "custom",
      modelId: "plain-model",
      api: "openai-completions" as const,
      baseUrl: "http://127.0.0.1:11434/v1",
      reasoning: false,
      defaultThinkingLevel: "high" as const
    };

    expect(() =>
      ModelSettingsInputSchema.parse({ models: [model], defaultModelId: "plain" })
    ).toThrow();
    expect(() =>
      ModelSettingsInputSchema.parse({
        models: [{ ...model, reasoning: true, defaultThinkingLevel: "medium" }],
        defaultModelId: "missing"
      })
    ).toThrow();
    expect(() =>
      ModelSettingsInputSchema.parse({
        models: [
          {
            ...model,
            reasoning: true,
            defaultThinkingLevel: "high",
            thinkingLevelOptions: ["low", "medium"]
          }
        ],
        defaultModelId: "plain"
      })
    ).toThrow();
    expect(() =>
      ModelSettingsInputSchema.parse({
        models: [
          {
            ...model,
            defaultThinkingLevel: "off",
            temperatureOptions: [0.7, 0.7, 1]
          }
        ],
        defaultModelId: "plain"
      })
    ).toThrow();
  });

  it("accepts an unsaved model draft for a connection test", () => {
    const envelope = createEnvelope(
      "models.test",
      {
        model: {
          id: "draft-model",
          label: "Draft model",
          provider: "custom",
          modelId: "draft-v1",
          api: "openai-completions" as const,
          baseUrl: "http://127.0.0.1:11434/v1",
          reasoning: false,
          defaultThinkingLevel: "off" as const,
          apiKey: "not-yet-saved"
        }
      },
      { id: "cmd_test_draft" }
    );

    expect(CommandEnvelopeSchema.parse(envelope).type).toBe("models.test");
  });

  it("rejects blank prompts and mismatched session context", () => {
    const blank = createEnvelope(
      "session.prompt",
      { sessionId: "session_1", message: "   " },
      { id: "cmd_blank", context: { sessionId: "session_1" } }
    );
    const mismatch = createEnvelope(
      "session.prompt",
      { sessionId: "session_1", message: "继续" },
      { id: "cmd_mismatch", context: { sessionId: "session_2" } }
    );

    expect(() => CommandEnvelopeSchema.parse(blank)).toThrow();
    expect(() => CommandEnvelopeSchema.parse(mismatch)).toThrow();
  });

  it("validates a session abort against its session and run context", () => {
    const abort = createEnvelope(
      "session.abort",
      { sessionId: "session_1", runId: "run_1" },
      {
        id: "cmd_abort",
        context: { sessionId: "session_1", runId: "run_1" }
      }
    );
    const mismatch = createEnvelope(
      "session.abort",
      { sessionId: "session_1", runId: "run_1" },
      {
        id: "cmd_abort_mismatch",
        context: { sessionId: "session_1", runId: "run_2" }
      }
    );

    expect(CommandEnvelopeSchema.parse(abort).type).toBe("session.abort");
    expect(() => CommandEnvelopeSchema.parse(mismatch)).toThrow();
  });

  it("validates quick acceptance independently from streamed events", () => {
    expect(
      SessionPromptAcceptedPayloadSchema.parse({
        sessionId: "session_1",
        runId: "run_1",
        acceptedAt: new Date().toISOString(),
        runtime
      })
    ).toMatchObject({ runId: "run_1", runtime });
  });

  it("accepts delta and completion events with consistent envelope identity", () => {
    const delta = createEnvelope(
      "agent.message_delta",
      {
        sessionId: "session_1",
        runId: "run_1",
        messageId: "message_1",
        delta: "第一段",
        runtime
      },
      {
        id: "event_delta",
        context: { sessionId: "session_1", runId: "run_1" }
      }
    );
    const completed = createEnvelope(
      "agent.message_completed",
      {
        sessionId: "session_1",
        runId: "run_1",
        messageId: "message_1",
        role: "assistant" as const,
        content: "第一段",
        thinking: "先理解上下文。",
        stopReason: "stop",
        runtime
      },
      {
        id: "event_completed",
        context: { sessionId: "session_1", runId: "run_1" }
      }
    );

    expect(AgentMessageDeltaEventEnvelopeSchema.parse(delta).payload.delta).toBe("第一段");
    expect(AgentMessageCompletedEventEnvelopeSchema.parse(completed).payload.content).toBe(
      "第一段"
    );
    expect(SystemEventEnvelopeSchema.parse(completed).type).toBe("agent.message_completed");
  });

  it("rejects an event whose run context differs from its payload", () => {
    const event = createEnvelope(
      "agent.message_delta",
      {
        sessionId: "session_1",
        runId: "run_1",
        messageId: "message_1",
        delta: "内容",
        runtime
      },
      {
        id: "event_bad_run",
        context: { sessionId: "session_1", runId: "run_2" }
      }
    );

    expect(() => AgentMessageDeltaEventEnvelopeSchema.parse(event)).toThrow();
  });

  it("validates targeted expert-draft file mutations", () => {
    const event = createEnvelope(
      "workspace.editor_mutation",
      {
        sessionId: "session_section_mutation",
        runId: "run_section_mutation",
        toolCallId: "tool_section_mutation",
        workspaceId: "book-1",
        stageId: "draft" as const,
        text: "第三节的新正文。",
        mutationTarget: {
          kind: "expert-draft-file" as const,
          documentId: "draft:section-3:body",
          sectionId: "section-3",
          fileKind: "body" as const
        },
        baseRevision: "v1:100:1234abcd",
        summary: "已生成第三节正文变更。",
        runtime
      },
      {
        id: "event_section_mutation",
        context: {
          sessionId: "session_section_mutation",
          runId: "run_section_mutation"
        }
      }
    );

    expect(SystemEventEnvelopeSchema.parse(event)).toMatchObject({
      payload: {
        mutationTarget: {
          documentId: "draft:section-3:body",
          sectionId: "section-3",
          fileKind: "body"
        }
      }
    });
    expect(() =>
      SystemEventEnvelopeSchema.parse({
        ...event,
        payload: { ...event.payload, stageId: "outline" }
      })
    ).toThrow();
    expect(() =>
      SystemEventEnvelopeSchema.parse({
        ...event,
        payload: { ...event.payload, mutationTarget: undefined }
      })
    ).toThrow();
  });

  it("validates command and event messages at the Utility boundary", () => {
    const command = createEnvelope(
      "session.prompt",
      { sessionId: "session_1", message: "分析人物动机" },
      { id: "cmd_utility", context: { sessionId: "session_1" } }
    );
    const event = createEnvelope(
      "agent.message_delta",
      {
        sessionId: "session_1",
        runId: "run_1",
        messageId: "message_1",
        delta: "正在分析",
        runtime
      },
      {
        id: "event_utility",
        context: { sessionId: "session_1", runId: "run_1" }
      }
    );

    expect(
      UtilityInboundMessageSchema.parse({
        kind: "utility.command.request",
        requestId: "request_1",
        command
      }).kind
    ).toBe("utility.command.request");
    expect(
      UtilityOutboundMessageSchema.parse({
        kind: "utility.command.event",
        worker: "agent",
        requestId: "request_1",
        event
      }).kind
    ).toBe("utility.command.event");
  });

  it("validates streamed tool arguments before tool execution", () => {
    const event = createEnvelope(
      "tool.call_stream",
      {
        sessionId: "session_tool_stream",
        runId: "run_tool_stream",
        streamId: "message_tool_stream:0",
        toolCallId: "tool_write_1",
        toolName: "write_workspace_editor",
        phase: "delta" as const,
        argumentsDelta: '{"text":"开场',
        runtime
      },
      {
        id: "event_tool_stream",
        context: { sessionId: "session_tool_stream", runId: "run_tool_stream" }
      }
    );

    expect(SystemEventEnvelopeSchema.parse(event).type).toBe("tool.call_stream");
  });

  it("requires truthful truncation metadata for a shortened live snapshot", () => {
    const snapshot = {
      id: "chapter_long",
      domain: "creation" as const,
      title: "长章节",
      path: ["作品", "长章节"],
      source: "live-editor" as const,
      content: "字".repeat(20_000),
      truncated: true,
      originalLength: 20_010
    };

    expect(ActiveResourceSnapshotSchema.parse(snapshot).originalLength).toBe(20_010);
    expect(() =>
      ActiveResourceSnapshotSchema.parse({ ...snapshot, originalLength: 20_000 })
    ).toThrow();
  });

  it("uses one 32 MiB character boundary across stored and runtime text files", () => {
    const atLimit = "a".repeat(SHORT_WORKSPACE_FILE_MAX_CHARACTERS);
    const overLimit = `${atLimit}a`;
    const revision = "v1:0:811c9dc5";
    const draftSection = {
      id: "section-1",
      title: "第一节",
      wordCountRequirement: "",
      body: atLimit,
      characterState: ""
    };
    const draftFile = {
      documentId: "d".repeat(4_096),
      title: "第一节·正文",
      content: atLimit,
      revision
    };
    const activeResource = {
      id: "draft:section-1:body",
      domain: "creation" as const,
      title: "第一节·正文",
      path: ["正文", "第一节", "正文"],
      source: "live-editor" as const,
      content: atLimit
    };
    const stage = {
      stageId: "outline" as const,
      title: "大纲",
      content: atLimit,
      revision
    };
    const mutation = {
      sessionId: "session-boundary",
      runId: "run-boundary",
      toolCallId: "tool-boundary",
      workspaceId: "book-boundary",
      stageId: "draft" as const,
      text: atLimit,
      mutationTarget: {
        kind: "expert-draft-file" as const,
        documentId: "d".repeat(4_096),
        sectionId: "section-1",
        fileKind: "body" as const
      },
      baseRevision: revision,
      summary: "边界写入",
      runtime
    };

    expect(ExpertDraftSchema.safeParse({ sections: [draftSection] }).success).toBe(true);
    expect(ExpertDraftFileSnapshotSchema.safeParse(draftFile).success).toBe(true);
    expect(
      ExpertDraftFileSnapshotSchema.safeParse({
        ...draftFile,
        title: "节".repeat(256),
        content: ""
      }).success
    ).toBe(true);
    expect(ActiveResourceSnapshotSchema.safeParse(activeResource).success).toBe(true);
    expect(
      ActiveResourceSnapshotSchema.safeParse({
        ...activeResource,
        content: "",
        truncated: true,
        originalLength: SHORT_WORKSPACE_FILE_MAX_CHARACTERS
      }).success
    ).toBe(true);
    expect(ShortWorkspaceStageSnapshotSchema.safeParse(stage).success).toBe(true);
    expect(WorkspaceEditorMutationPayloadSchema.safeParse(mutation).success).toBe(true);

    expect(
      ExpertDraftSchema.safeParse({
        sections: [{ ...draftSection, body: overLimit }]
      }).success
    ).toBe(false);
    expect(
      ExpertDraftFileSnapshotSchema.safeParse({
        ...draftFile,
        content: overLimit
      }).success
    ).toBe(false);
    expect(
      ExpertDraftFileSnapshotSchema.safeParse({
        ...draftFile,
        documentId: "d".repeat(4_097),
        content: ""
      }).success
    ).toBe(false);
    expect(
      ExpertDraftFileSnapshotSchema.safeParse({
        ...draftFile,
        title: "节".repeat(257),
        content: ""
      }).success
    ).toBe(false);
    expect(
      ActiveResourceSnapshotSchema.safeParse({
        ...activeResource,
        content: "",
        originalLength: SHORT_WORKSPACE_FILE_MAX_CHARACTERS + 1
      }).success
    ).toBe(false);
    expect(
      ShortWorkspaceStageSnapshotSchema.safeParse({
        ...stage,
        content: overLimit
      }).success
    ).toBe(false);
    expect(
      WorkspaceEditorMutationPayloadSchema.safeParse({
        ...mutation,
        text: overLimit
      }).success
    ).toBe(false);
    expect(
      WorkspaceEditorMutationPayloadSchema.safeParse({
        ...mutation,
        text: "",
        mutationTarget: {
          ...mutation.mutationTarget,
          documentId: "d".repeat(4_097)
        }
      }).success
    ).toBe(false);
  });

  it("allows a draft coordinator to bind the virtual draft directory", () => {
    const shortWorkspace = shortWorkspaceRuntimeFixture();

    expect(() =>
      WorkspaceRuntimeContextSchema.parse({
        shortWorkspace,
        activeResource: {
          id: "draft",
          domain: "creation",
          title: "正文",
          path: ["运行时正文", "正文"],
          source: "live-editor",
          content: ""
        }
      })
    ).not.toThrow();
  });

  it("restricts a draft section writer to the active section's physical files", () => {
    const base = shortWorkspaceRuntimeFixture();
    const shortWorkspace = {
      ...base,
      activeAgentId: "expert_section_writer" as const,
      activeSectionId: "section-1"
    };

    expect(() =>
      WorkspaceRuntimeContextSchema.parse({
        shortWorkspace,
        activeResource: {
          id: "draft:section-1:body",
          domain: "creation",
          title: "第一节·正文",
          path: ["运行时正文", "正文", "第一节", "正文"],
          source: "live-editor",
          content: "第一节正文。"
        }
      })
    ).not.toThrow();
    expect(() =>
      WorkspaceRuntimeContextSchema.parse({
        shortWorkspace,
        activeResource: {
          id: "draft:section-2:body",
          domain: "creation",
          title: "第二节·正文",
          path: ["运行时正文", "正文", "第二节", "正文"],
          source: "live-editor",
          content: "第二节正文。"
        }
      })
    ).toThrow();
    expect(() =>
      WorkspaceRuntimeContextSchema.parse({
        shortWorkspace,
        activeResource: {
          id: "draft",
          domain: "creation",
          title: "正文",
          path: ["运行时正文", "正文"],
          source: "live-editor",
          content: ""
        }
      })
    ).toThrow();
  });

  it("does not allow material snapshots in the attached skill list", () => {
    expect(() =>
      WorkspaceRuntimeContextSchema.parse({
        attachedSkills: [
          {
            id: "material_1",
            title: "雨夜声音",
            source: "attached-material",
            content: "雨声素材"
          }
        ]
      })
    ).toThrow();
  });
});
