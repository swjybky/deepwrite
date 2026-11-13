import { describe, expect, it } from "vitest";
import {
  AgentUserInputQuestionsSchema,
  AgentUserInputRequestedPayloadSchema,
  SessionUserInputResponsePayloadSchema,
  WRITE_APPROVAL_EDITED_TEXT_MAX_LENGTH,
  WRITE_APPROVAL_QUESTION_ID
} from "./user-input";

describe("agent user input contracts", () => {
  it("ties write approval waits to their tool calls and outcomes", () => {
    const request = {
      sessionId: "session",
      runId: "run",
      requestId: "run:user-input:1",
      toolCallId: "call_write",
      source: "write_approval",
      questions: [{ id: WRITE_APPROVAL_QUESTION_ID, question: "等待审批" }],
      runtime: { mode: "local-faux", provider: "example", model: "fixture" }
    };
    expect(() => AgentUserInputRequestedPayloadSchema.parse(request)).toThrow(
      /tool calls/u
    );
    expect(
      AgentUserInputRequestedPayloadSchema.parse({
        ...request,
        writeApproval: { toolCallIds: ["call_write"] }
      }).writeApproval
    ).toEqual({ toolCallIds: ["call_write"] });
    expect(() =>
      AgentUserInputRequestedPayloadSchema.parse({
        ...request,
        source: "ask_user_question",
        writeApproval: { toolCallIds: ["call_write"] }
      })
    ).toThrow(/tool calls/u);

    const response = {
      sessionId: "session",
      runId: "run",
      requestId: "run:user-input:1",
      answers: [{ id: WRITE_APPROVAL_QUESTION_ID, text: "settled" }]
    };
    expect(
      SessionUserInputResponsePayloadSchema.parse({
        ...response,
        writeApproval: {
          items: [
            { title: "第三章", status: "saved", edited: true, editedText: "新" }
          ]
        }
      }).writeApproval?.items[0]
    ).toMatchObject({ edited: true, editedText: "新" });
    expect(() =>
      SessionUserInputResponsePayloadSchema.parse({
        ...response,
        writeApproval: {
          items: [
            {
              title: "第三章",
              status: "saved",
              editedText: "字".repeat(WRITE_APPROVAL_EDITED_TEXT_MAX_LENGTH + 1)
            }
          ]
        }
      })
    ).toThrow();
  });

  it("accepts stable question and option ids", () => {
    expect(
      AgentUserInputQuestionsSchema.parse([
        {
          id: "tone",
          question: "选择叙事语气",
          options: [
            { id: "restrained", label: "克制" },
            { id: "intense", label: "强烈" }
          ]
        }
      ])
    ).toMatchObject([{ id: "tone" }]);
  });

  it("rejects duplicate ids and invalid option-only settings", () => {
    expect(() =>
      AgentUserInputQuestionsSchema.parse([
        { id: "duplicate", question: "第一个问题" },
        { id: "duplicate", question: "第二个问题" }
      ])
    ).toThrow(/Duplicate question id/u);
    expect(() =>
      AgentUserInputQuestionsSchema.parse([
        {
          id: "free_text",
          question: "填写说明",
          multi_select: true
        }
      ])
    ).toThrow(/require options/u);
  });

  it("requires every submitted answer to carry a selection or text", () => {
    expect(() =>
      SessionUserInputResponsePayloadSchema.parse({
        sessionId: "session_1",
        runId: "run_1",
        requestId: "request_1",
        answers: [{ id: "tone", selectedOptionIds: [] }]
      })
    ).toThrow(/selected option or text/u);
  });
});
