import { describe, expect, it } from "vitest";
import type { ProposalSettlements } from "@deepwrite/contracts";
import {
  buildFollowUpRawUserMessageContent,
  buildRawUserMessage,
  buildRuntimeUserPrompt
} from "./prompts";
import type { AgentRunInput } from "./runtime-types";
import {
  PROPOSAL_SETTLEMENTS_HEADING,
  renderProposalSettlements,
  renderWriteApprovalResults,
  WRITE_APPROVAL_RESULTS_HEADING,
  writeApprovalBoundary
} from "./write-approval";

const settlements: ProposalSettlements = {
  items: [
    { title: "第三章", summary: "收紧开头节奏", status: "saved" },
    { title: "林岚", status: "rejected" },
    {
      title: "第二章",
      status: "conflict",
      detail: "文件已被其他修改更新，请重新读取后再提交"
    },
    { title: "世界观", status: "reverted" }
  ],
  omittedCount: 2
};

function input(overrides: Partial<AgentRunInput> = {}): AgentRunInput {
  return {
    runId: "run_settlement",
    sessionId: "session_settlement",
    prompt: "继续写第四章",
    ...overrides
  };
}

describe("write approval semantics", () => {
  it("treats a submitted proposal as a finished step in both modes", () => {
    const auto = writeApprovalBoundary("auto-approve");
    expect(auto).toContain("【写入审批方式：自动保存】");
    expect(auto).toContain("写入工具成功返回即表示提案已提交、这一步已完成");
    expect(auto).toContain("没有收到这类通知即视为已保存");
    expect(auto).not.toContain("审批卡确认成功前");

    const manual = writeApprovalBoundary(undefined);
    expect(manual).toBe(writeApprovalBoundary("request-approval"));
    expect(manual).toContain("【写入审批方式：用户审批】");
    expect(manual).toContain("客户端会暂停运行，等用户处理完这一步的全部提案");
    expect(manual).toContain(WRITE_APPROVAL_RESULTS_HEADING);
    expect(manual).toContain("用户修改后保存的以用户版本为准");
    expect(manual).not.toContain("不要等待审批");
  });

  it("reports a paused step's outcomes, edited text included", () => {
    const text = renderWriteApprovalResults({
      items: [
        { title: "第三章", summary: "收紧开头", status: "saved" },
        {
          title: "林岚",
          status: "saved",
          edited: true,
          editedText: "林岚，二十七岁。"
        },
        { title: "世界观", status: "rejected" }
      ]
    });
    expect(text.split("\n")).toEqual([
      WRITE_APPROVAL_RESULTS_HEADING,
      "运行在这一步暂停，等待用户审批了你提交的修改。以下是用户的处理结果，以此为准，继续完成任务：",
      "- 《第三章》（收紧开头）：已保存",
      "- 《林岚》：用户修改后保存，最终内容如下：",
      "<<<",
      "林岚，二十七岁。",
      ">>>",
      "- 《世界观》：用户已拒绝，未写入",
      "已保存的不要重复提交；被拒绝的不要原样重提，除非用户再次要求；用户修改后保存的以用户版本为准；冲突或失败的如仍需要，先重新读取最新内容再提交。"
    ]);
  });

  it("never lets a missing or empty report read as saved", () => {
    expect(renderWriteApprovalResults(undefined)).toContain(
      "不要假定这些修改已写入作品"
    );
    expect(renderWriteApprovalResults({ items: [] })).toContain("视为未写入");
  });

  it("renders every reported outcome with its follow-up rule", () => {
    const text = renderProposalSettlements(settlements);
    expect(text.split("\n")).toEqual([
      PROPOSAL_SETTLEMENTS_HEADING,
      "以下是客户端回报的提案落盘结果，以此为准：",
      "- 《第三章》（收紧开头节奏）：已保存",
      "- 《林岚》：用户已拒绝，未写入",
      "- 《第二章》：版本冲突，未写入。文件已被其他修改更新，请重新读取后再提交",
      "- 《世界观》：保存后已被用户撤销，作品已恢复原内容",
      "- 另有 2 项结果未列出",
      expect.stringContaining("已保存的不要重复提交")
    ]);
    expect(renderProposalSettlements(undefined)).toBe("");
  });

  it("places outcomes right before the user message in a refreshed turn", () => {
    const prompt = buildRuntimeUserPrompt(
      input({ proposalSettlements: settlements })
    );
    const outcome = prompt.indexOf(PROPOSAL_SETTLEMENTS_HEADING);
    const message = prompt.indexOf("【用户消息与上传附件】");
    expect(outcome).toBeGreaterThan(0);
    expect(message).toBeGreaterThan(outcome);
    expect(prompt.endsWith("继续写第四章")).toBe(true);
    expect(buildRuntimeUserPrompt(input())).not.toContain(
      PROPOSAL_SETTLEMENTS_HEADING
    );
  });

  it("keeps a raw follow-up turn unchanged unless something settled", () => {
    const plain = input();
    expect(buildFollowUpRawUserMessageContent(plain)).toBe(
      buildRawUserMessage(plain).content
    );

    const reported = buildFollowUpRawUserMessageContent(
      input({
        proposalSettlements: settlements,
        attachments: [
          {
            id: "image_1",
            kind: "image",
            name: "map.png",
            mediaType: "image/png",
            size: 4,
            data: "AAAA"
          }
        ]
      })
    );
    expect(Array.isArray(reported)).toBe(true);
    const [text, image] = reported as Exclude<typeof reported, string>;
    expect(text).toMatchObject({ type: "text" });
    expect(text?.type === "text" ? text.text : "").toMatch(
      /^【上一轮修改的处理结果】[\s\S]*【用户消息与上传附件】\n继续写第四章/u
    );
    expect(image).toMatchObject({ type: "image", mimeType: "image/png" });
  });
});
