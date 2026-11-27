import type {
  AgentTeamRunMode,
  ExternalAgentRun,
  ExternalRunRecovery,
  ExternalWindowTarget
} from "@deepwrite/contracts";
import { externalToolUsage } from "./tool-usage";
import { watch } from "vue";
import type { AgentEditProposal, ChatMessage } from "../../types/conversation";
import type { AgentConversationController } from "../../composables/useAgentConversation";
import { agentEditProposalLaneId } from "../../utils/agentEditReview";
import { jsonClone } from "@deepwrite/shared";

const terminal = (status: ExternalAgentRun["status"]) =>
  status === "completed" ||
  status === "failed" ||
  status === "stopped" ||
  status === "interrupted";

const unsaved = (status: AgentEditProposal["status"]) =>
  status === "conflict" || status === "error";

/**
 * Auto-approved proposals and accepted ones still writing are the run's own
 * tail, not a user decision; only proposals held for review wait on the user.
 * Failures count the latest generation per document, which supersedes older.
 */
export function summarizeRunProposals(replies: readonly ChatMessage[]) {
  const proposals = replies.flatMap(({ editProposals }) => editProposals ?? []);
  const latest = new Map<string, AgentEditProposal>();
  for (const proposal of proposals) {
    const lane = agentEditProposalLaneId(proposal);
    const current = latest.get(lane);
    if (!current || (proposal.generation ?? 1) >= (current.generation ?? 1)) {
      latest.set(lane, proposal);
    }
  }
  const failed = [...latest.values()].filter(({ status }) => unsaved(status));
  return {
    changes: [
      ...new Set(
        proposals
          .filter(({ status }) => !unsaved(status))
          .map(({ title }) => title)
      )
    ],
    awaitingUser: proposals.some(
      ({ status, approvalMode }) =>
        status === "pending" && approvalMode !== "auto-approve"
    ),
    saving: proposals.some(
      ({ status, approvalMode }) =>
        status === "accepting" ||
        (status === "pending" && approvalMode === "auto-approve")
    ),
    error: failed.length
      ? `${failed.length} 处修改未能保存：${failed
          .map(
            ({ title, statusMessage }) =>
              `「${title}」${statusMessage ? `（${statusMessage}）` : ""}`
          )
          .join("；")}`
      : undefined
  };
}

/** Keep the placeholder reference: acceptance can rename it and assign a run id. */
export function trackExternalRun(
  runId: string,
  conversation: AgentConversationController,
  assistant: ChatMessage,
  mode?: AgentTeamRunMode,
  target?: ExternalWindowTarget,
  options: {
    recovered?: boolean;
    lastStatus?: ExternalAgentRun["status"] | undefined;
    internalRunId?: string | undefined;
    onIdentity?(value: ExternalRunRecovery): void;
  } = {}
) {
  const sessionId = conversation.sessionId.value;
  const modeField = {
    ...(mode ? { mode } : {}),
    sessionId,
    ...(target
      ? target.kind === "library"
        ? { libraryId: target.id }
        : { workId: target.id }
      : {})
  };
  let snapshot: ExternalAgentRun = {
    runId,
    ...modeField,
    reply: "",
    changes: [],
    status: "running"
  };
  let finished = false;
  let internalRunId = options.internalRunId;
  let identityKey = "";
  let stopWatching = (): void => undefined;

  function refresh(): ExternalAgentRun {
    if (finished) return snapshot;
    internalRunId ??= assistant.runId;
    const anchor = conversation.messages.value.find(
      (message) =>
        message.id === assistant.id ||
        (internalRunId !== undefined &&
          message.runId === internalRunId &&
          message.role === "assistant")
    );
    if (conversation.sessionId.value !== sessionId || !anchor) {
      snapshot = {
        ...snapshot,
        status: "failed",
        error: "这次运行的会话已切换或被移除。"
      };
    } else {
      internalRunId ??= anchor.runId;
      const replies = conversation.messages.value.filter(
        (message) =>
          message.role === "assistant" &&
          (internalRunId
            ? message.runId === internalRunId
            : message.id === assistant.id)
      );
      const proposals = summarizeRunProposals(replies);
      const base = {
        runId,
        ...modeField,
        reply: replies.at(-1)?.content ?? "",
        ...externalToolUsage(replies),
        changes: proposals.changes
      };
      const owns = ownsActiveRun();
      const question = owns ? conversation.pendingUserInput.value : null;
      const error = replies
        .filter((reply) => reply.errorMessage)
        .at(-1)?.errorMessage;
      if (question?.source === "write_approval") {
        // Only the user can settle proposals; the run resumes afterwards.
        snapshot = { ...base, status: "waiting_for_user" };
      } else if (question) {
        snapshot = {
          ...base,
          status: "waiting_for_input",
          questionSource: question.source,
          questions: jsonClone(question.questions)
        };
      } else if (
        owns ||
        (!internalRunId &&
          anchor.status === "streaming" &&
          conversation.isBusy.value)
      ) {
        snapshot = { ...base, status: "running" };
      } else if (proposals.awaitingUser) {
        snapshot = { ...base, status: "waiting_for_user" };
      } else if (proposals.saving) {
        snapshot = { ...base, status: "running" };
      } else if (
        options.recovered &&
        options.lastStatus !== "stopped" &&
        replies.some(
          ({ status }) => status === "streaming" || status === "stopped"
        )
      ) {
        snapshot = {
          ...base,
          status: "interrupted",
          error:
            "软件重启中断了这次运行。请先核对已保存修改，再用原 sessionId 继续未完成步骤。"
        };
      } else if (replies.some(({ status }) => status === "stopped")) {
        snapshot = { ...base, status: "stopped" };
      } else if (error || replies.some(({ status }) => status === "error")) {
        snapshot = {
          ...base,
          status: "failed",
          error: error ?? "这次运行未能完成。"
        };
      } else if (proposals.error) {
        snapshot = { ...base, status: "failed", error: proposals.error };
      } else {
        snapshot = { ...base, status: "completed" };
      }
    }
    if (target) {
      const identity: ExternalRunRecovery = {
        runId,
        sessionId,
        assistantId: assistant.id,
        target,
        lastStatus: snapshot.status,
        ...(mode ? { mode } : {}),
        ...(internalRunId ? { internalRunId } : {})
      };
      const nextKey = JSON.stringify(identity);
      if (nextKey !== identityKey) {
        identityKey = nextKey;
        options.onIdentity?.(identity);
      }
    }

    finished = terminal(snapshot.status);
    if (finished) stopWatching();
    return snapshot;
  }

  function ownsActiveRun(): boolean {
    return (
      !finished &&
      conversation.sessionId.value === sessionId &&
      internalRunId !== undefined &&
      conversation.activeRunId.value === internalRunId
    );
  }

  stopWatching = watch(
    [
      conversation.messages,
      conversation.activeRunId,
      conversation.sessionId,
      conversation.isBusy,
      conversation.pendingUserInput
    ],
    refresh,
    { deep: true }
  );
  refresh();
  return {
    conversation,
    snapshot: refresh,
    ownsActiveRun,
    dispose: () => stopWatching()
  };
}

export type TrackedRun = ReturnType<typeof trackExternalRun>;
