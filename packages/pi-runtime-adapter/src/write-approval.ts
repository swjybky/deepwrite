import type {
  AgentWriteApprovalMode,
  AgentWriteApprovalResponse,
  PromptLocale,
  ProposalSettlementStatus,
  ProposalSettlements
} from "@deepwrite/contracts";

export const PROPOSAL_SETTLEMENTS_HEADING = "【上一轮修改的处理结果】";
export const WRITE_APPROVAL_RESULTS_HEADING = "【本步修改的审批结果】";

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
      ? `[Write approval: auto-save] The client saves the proposals your write tools create automatically; the user does not approve them one by one. A successful write tool call means the proposal is submitted and the step is done: move on to the next step, do not wait for a save confirmation, do not resubmit, and do not describe a submitted change as unfinished or ask the user to approve it. Deletions and their cascading effects are saved directly too; the user can undo them from the change card. Changes that fail to save, conflict or are undone are reported in the [Outcomes of earlier changes] block before the next user message; without such a notice, treat the change as saved.`
      : `[Write approval: user review] Proposals created by your write tools are saved only after the user accepts them on the approval card. After a step that submits proposals, the client pauses the run until the user has handled every proposal of that step; the user may accept, reject, or edit the text before saving. The outcomes then arrive in the [Review results] block before you continue: follow it. Do not resubmit what was saved; do not resubmit a rejected change unchanged unless the user asks again; when the user edited a change before saving, the user's version is final and later changes build on it. Never ask the user in your reply to approve a change; the client already does.`;
  }
  return mode === "auto-approve"
    ? `【写入审批方式：自动保存】写入工具形成的提案由客户端自动保存，用户不逐笔审批。写入工具成功返回即表示提案已提交、这一步已完成：直接继续后续步骤，不要等待保存确认，不要重复提交，也不要把已提交的修改说成未完成或请用户审批。删除及其关联影响也会直接保存，用户可在修改卡片上撤销。保存失败、冲突或被撤销的修改会在下一轮用户消息前的${PROPOSAL_SETTLEMENTS_HEADING}中告知；没有收到这类通知即视为已保存。`
    : `【写入审批方式：用户审批】写入工具形成的提案要由用户在审批卡上接受后才会保存。提交提案的这一步结束后，客户端会暂停运行，等用户处理完这一步的全部提案（接受、拒绝，或修改内容后保存）再继续，处理结果以${WRITE_APPROVAL_RESULTS_HEADING}告知你，以它为准：已保存的不要重复提交；被拒绝的不要原样重提，除非用户再次要求；用户修改后保存的以用户版本为准，后续修改基于该版本。不要在回复里请用户审批，客户端会处理。`;
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
  settlements: ProposalSettlements | undefined,
  locale?: PromptLocale
): string {
  if (!settlements?.items.length) return "";
  if (locale === "en-US")
    return [
      "[Outcomes of earlier changes]",
      ...settlements.items.map(
        (item) =>
          `- ${item.title}: ${item.status}${item.summary ? ` (${item.summary})` : ""}${item.detail ? `. ${item.detail}` : ""}`
      ),
      ...(settlements.omittedCount
        ? [`${settlements.omittedCount} further outcomes omitted.`]
        : [])
    ].join("\n");
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

/**
 * Outcomes of a paused-for step, appended before the next model request. A
 * missing report means the wait was answered without the approval card.
 */
export function renderWriteApprovalResults(
  response: AgentWriteApprovalResponse | undefined,
  locale?: PromptLocale
): string {
  if (locale === "en-US") {
    if (!response?.items.length)
      return "[Review results] No saved outcome was reported. Read the target before proceeding.";
    return [
      "[Review results]",
      ...response.items.map((item) =>
        [
          `- ${item.title}: ${item.status}${item.summary ? ` (${item.summary})` : ""}${item.detail ? `. ${item.detail}` : ""}`,
          ...(item.edited
            ? [
                item.editedText === undefined || item.editedTextTruncated
                  ? "The user edited the saved text. Read the full saved version before further edits."
                  : "The user saved the following version:",
                ...(item.editedText !== undefined ? [item.editedText] : [])
              ]
            : [])
        ].join("\n")
      ),
      ...(response.omittedCount
        ? [`${response.omittedCount} further outcomes omitted.`]
        : []),
      "Use the reported outcomes. Do not resubmit saved or rejected changes. Read the latest version after a conflict."
    ].join("\n");
  }
  if (!response) {
    return [
      WRITE_APPROVAL_RESULTS_HEADING,
      "客户端没有回报本步修改的处理结果。不要假定这些修改已写入作品；需要时先重新读取确认。"
    ].join("\n");
  }
  if (!response.items.length) {
    return [
      WRITE_APPROVAL_RESULTS_HEADING,
      "客户端没有找到本步需要审批的修改卡片（可能没有实际改动），视为未写入；如仍需要，先重新读取最新内容再提交。"
    ].join("\n");
  }
  const lines = response.items.map((item) => {
    const summary = item.summary?.trim();
    const detail = item.detail?.trim();
    const head = `- 《${item.title}》${summary ? `（${summary}）` : ""}：`;
    if (item.status === "saved" && item.edited) {
      if (item.editedText === undefined) {
        return `${head}用户修改后保存，以作品中的最新内容为准，需要时重新读取。`;
      }
      return [
        `${head}用户修改后保存，最终内容如下${
          item.editedTextTruncated ? "（过长已截断，完整内容请重新读取）" : ""
        }：`,
        "<<<",
        item.editedText,
        ">>>"
      ].join("\n");
    }
    return `${head}${STATUS_TEXT[item.status]}${detail ? `。${detail}` : ""}`;
  });
  if (response.omittedCount) {
    lines.push(`- 另有 ${response.omittedCount} 项结果未列出`);
  }
  return [
    WRITE_APPROVAL_RESULTS_HEADING,
    "运行在这一步暂停，等待用户审批了你提交的修改。以下是用户的处理结果，以此为准，继续完成任务：",
    ...lines,
    "已保存的不要重复提交；被拒绝的不要原样重提，除非用户再次要求；用户修改后保存的以用户版本为准；冲突或失败的如仍需要，先重新读取最新内容再提交。"
  ].join("\n");
}
