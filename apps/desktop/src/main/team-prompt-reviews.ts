import {
  AgentTeamChangeSchema,
  type AgentTeamChange,
  type AgentUserInputRequestedPayload,
  type SessionUserInputResponsePayload
} from "@deepwrite/contracts";

/** A one-use consent for the exact change shown in the window's review card. */
export class TeamPromptReviews {
  private readonly pending = new Map<
    string,
    {
      request: AgentUserInputRequestedPayload;
      accepted: boolean;
    }
  >();

  receive(request: AgentUserInputRequestedPayload): void {
    if (request.source !== "agent_team_prompt" || !request.teamReview) return;
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
    change: AgentTeamChange
  ): void {
    const pending = this.pending.get(runId);
    if (
      !pending?.accepted ||
      pending.request.sessionId !== sessionId ||
      pending.request.requestId !== requestId ||
      JSON.stringify(
        AgentTeamChangeSchema.strip().parse(pending.request.teamReview)
      ) !== JSON.stringify(AgentTeamChangeSchema.strip().parse(change))
    ) {
      throw new Error("团队修改尚未通过对应的差异审阅，不能保存。");
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
