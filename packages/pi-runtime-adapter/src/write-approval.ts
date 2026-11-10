import type {
  AgentWriteApprovalMode,
  PromptLocale,
  ProposalSettlementStatus,
  ProposalSettlements
} from "@deepwrite/contracts";

export const PROPOSAL_SETTLEMENTS_HEADING = "【上一轮修改的处理结果】";

/**
 * Tool-result tail for a proposal in auto-approve mode. The agent cannot see
 * approval cards, so a submitted proposal must read as a finished step.
 */
export const AUTO_APPROVE_PROPOSAL_SUBMITTED =
  "已提交自动保存，这一步已完成；继续后续步骤，不要等待保存确认，也不要重复提交。";

/**
 * Run-level write approval boundary shared by creation and library agents.
 * Approval is the client's job; the agent only needs to know when a step is
 * done and where the outcome is reported.
 */
export function writeApprovalBoundary(
  mode: AgentWriteApprovalMode | undefined,
  locale?: PromptLocale
): string {
  if (locale === "en-US") {
    return mode === "auto-approve"
      ? `[Write approval: auto-save] The client saves the proposals your write tools create automatically; the user does not approve them one by one. A successful write tool call means the proposal is submitted and the step is done: move on to the next step, do not wait for a save confirmation, do not resubmit, and do not describe a submitted change as unfinished or ask the user to approve it. Deletions and their cascading effects are saved directly too; the user can undo them from the change card. Changes that fail to save, conflict or are undone are reported in the ${PROPOSAL_SETTLEMENTS_HEADING} block (outcomes of earlier changes) before the next user message; without such a notice, treat the change as saved.`
      : `[Write approval: user review] Proposals created by your write tools are saved only after the user accepts them on the approval card. A successful write tool call means the proposal is submitted and the step is delivered: move on to the next step, do not wait for approval and do not resubmit the same change. In your reply, say it is submitted and awaiting the user's review; never claim it has been written into the work. The user's decisions are reported in the ${PROPOSAL_SETTLEMENTS_HEADING} block (outcomes of earlier changes) before the next user message.`;
  }
  return mode === "auto-approve"
    ? `【写入审批方式：自动保存】写入工具形成的提案由客户端自动保存，用户不逐笔审批。写入工具成功返回即表示提案已提交、这一步已完成：直接继续后续步骤，不要等待保存确认，不要重复提交，也不要把已提交的修改说成未完成或请用户审批。删除及其关联影响也会直接保存，用户可在修改卡片上撤销。保存失败、冲突或被撤销的修改会在下一轮用户消息前的${PROPOSAL_SETTLEMENTS_HEADING}中告知；没有收到这类通知即视为已保存。`
    : `【写入审批方式：用户审批】写入工具形成的提案要由用户在审批卡上接受后才会保存。写入工具成功返回即表示提案已提交、这一步已交付：继续后续步骤，不要等待审批，也不要重复提交同一修改；回复时说明已提交、待用户审阅，不要声称已写入作品。用户的处理结果会在下一轮用户消息前的${PROPOSAL_SETTLEMENTS_HEADING}中告知。`;
}

const STATUS_TEXT: Record<ProposalSettlementStatus, string> = {
  saved: "已保存",
  rejected: "用户已拒绝，未写入",
  conflict: "版本冲突，未写入",
  failed: "保存失败，未写入",
  reverted: "保存后已被用户撤销，作品已恢复原内容"
};

/** Renders the client-reported outcomes; empty when nothing settled. */
export function renderProposalSettlements(
  settlements: ProposalSettlements | undefined
): string {
  if (!settlements?.items.length) return "";
  const lines = settlements.items.map((item) => {
    const summary = item.summary?.trim();
    const detail = item.detail?.trim();
    return `- 《${item.title}》${summary ? `（${summary}）` : ""}：${
      STATUS_TEXT[item.status]
    }${detail ? `。${detail}` : ""}`;
  });
  if (settlements.omittedCount) {
    lines.push(`- 另有 ${settlements.omittedCount} 项结果未列出`);
  }
  return [
    PROPOSAL_SETTLEMENTS_HEADING,
    "以下是客户端回报的提案落盘结果，以此为准：",
    ...lines,
    "已保存的不要重复提交；被拒绝的不要原样重提，除非用户再次要求；冲突、失败或被撤销的如仍需要，先重新读取最新内容再提交。"
  ].join("\n");
}
