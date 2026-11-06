import {
  AgentTeamPromptChangeSchema,
  type AgentTeamPromptChange,
  type AgentUserInputRequestedPayload,
  type SessionUserInputResponsePayload
} from "@deepwrite/contracts";

/** A one-use consent for the exact text shown in the window's review card. */
export class TeamPromptReviews {
  private readonly pending = new Map<
    string,
    {
      request: AgentUserInputRequestedPayload;
      accepted: boolean;
    }
  >();

  receive(request: AgentUserInputRequestedPayload): void {
    if (request.source !== "agent_team_prompt" || !request.promptReview) return;
    this.pending.set(request.runId, { request, accepted: false });
  }

  answer(response: SessionUserInputResponsePayload): void {
    const pending = this.pending.get(response.runId);
    if (
      !pending ||
      pending.request.sessionId !== response.sessionId ||
      pending.request.requestId !== response.requestId
    )
      return;
    const answer = response.answers[0];
    pending.accepted =
      response.answers.length === 1 &&
      answer?.id === "team-prompt" &&
      answer.selectedOptionIds?.length === 1 &&
      answer.selectedOptionIds[0] === "accept" &&
      !answer.text?.trim();
  }

  take(
    runId: string,
    sessionId: string,
    requestId: string,
    change: AgentTeamPromptChange
  ): void {
    const pending = this.pending.get(runId);
    if (
      !pending?.accepted ||
      pending.request.sessionId !== sessionId ||
      pending.request.requestId !== requestId ||
      JSON.stringify(
        AgentTeamPromptChangeSchema.strip().parse(pending.request.promptReview)
      ) !== JSON.stringify(AgentTeamPromptChangeSchema.strip().parse(change))
    ) {
      throw new Error("提示词修改尚未通过对应的差异审阅，不能保存。");
    }
    this.clear(runId);
  }

  clear(runId: string): void {
    this.pending.delete(runId);
  }

  clearRequest(runId: string, requestId: string): void {
    if (this.pending.get(runId)?.request.requestId === requestId)
      this.clear(runId);
  }
}

export const teamPromptReviews = new TeamPromptReviews();
