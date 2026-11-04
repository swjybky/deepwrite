import type {
  AgentTeamRunMode,
  ExternalAgentRun,
  ExternalWindowTarget
} from "@deepwrite/contracts";
import { watch } from "vue";
import type { ChatMessage } from "../../types/conversation";
import type { AgentConversationController } from "../../composables/useAgentConversation";
import { countPendingEditReviews } from "../../composables/agent-conversation/pending-review";

const terminal = (status: ExternalAgentRun["status"]) =>
  status === "completed" || status === "failed" || status === "stopped";

/** Keep the placeholder reference: acceptance can rename it and assign a run id. */
export function trackExternalRun(
  runId: string,
  conversation: AgentConversationController,
  assistant: ChatMessage,
  mode?: AgentTeamRunMode,
  target?: ExternalWindowTarget
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
  let internalRunId: string | undefined;
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
      const base = {
        runId,
        ...modeField,
        reply: replies.at(-1)?.content ?? "",
        changes: [
          ...new Set(
            replies.flatMap(({ editProposals }) =>
              (editProposals ?? []).map(({ title }) => title)
            )
          )
        ]
      };
      const owns = ownsActiveRun();
      const question = owns ? conversation.pendingUserInput.value : null;
      const error = replies
        .filter((reply) => reply.errorMessage)
        .at(-1)?.errorMessage;
      if (question) {
        snapshot = {
          ...base,
          status: "waiting_for_input",
          questionSource: question.source,
          questions: JSON.parse(JSON.stringify(question.questions))
        };
      } else if (
        owns ||
        (!internalRunId &&
          anchor.status === "streaming" &&
          conversation.isBusy.value)
      ) {
        snapshot = { ...base, status: "running" };
      } else if (countPendingEditReviews(replies)) {
        snapshot = { ...base, status: "waiting_for_user" };
      } else if (replies.some(({ status }) => status === "stopped")) {
        snapshot = { ...base, status: "stopped" };
      } else if (error || replies.some(({ status }) => status === "error")) {
        snapshot = {
          ...base,
          status: "failed",
          error: error ?? "这次运行未能完成。"
        };
      } else {
        snapshot = { ...base, status: "completed" };
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
