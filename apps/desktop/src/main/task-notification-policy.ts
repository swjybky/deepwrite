import type {
  ModelUsageModule,
  SystemEventEnvelope
} from "@deepwrite/contracts";

export type TaskOutcome = "completed" | "failed" | "paused";

export interface TaskNotice {
  outcome: TaskOutcome;
  module?: ModelUsageModule;
}

export interface NotificationWindow {
  isDestroyed(): boolean;
  isVisible(): boolean;
  isFocused(): boolean;
  isMinimized(): boolean;
}

/** What Main knew about a run before its terminal event arrived. */
export interface RunNoticeContext {
  module?: ModelUsageModule | undefined;
  /** Set for runs that belong to a book decomposition task. */
  decompositionJobId?: string | undefined;
  /** The run already reported its end, so this event is a repeat. */
  previouslyTerminal: boolean;
}

/** The user is looking at the app, so a system notification is only noise. */
export function isWindowInUse(window: NotificationWindow | undefined): boolean {
  return Boolean(
    window &&
    !window.isDestroyed() &&
    window.isVisible() &&
    window.isFocused() &&
    !window.isMinimized()
  );
}

/**
 * A run's end becomes a notice. Stopping a run, a connection test and the many
 * runs of a decomposition task stay silent; the task reports once instead.
 */
export function noticeForRunEnd(
  event: SystemEventEnvelope,
  context: RunNoticeContext
): TaskNotice | undefined {
  if (context.previouslyTerminal || context.decompositionJobId)
    return undefined;
  if (
    context.module === "model-test" ||
    context.module === "long-book-decomposition"
  )
    return undefined;
  const notice = (outcome: TaskOutcome): TaskNotice => ({
    outcome,
    ...(context.module ? { module: context.module } : {})
  });
  if (event.type === "agent.message_completed") return notice("completed");
  if (event.type === "agent.error" && event.payload.code !== "pi_agent.aborted")
    return notice("failed");
  return undefined;
}

export function noticeForJobEvent(
  event: SystemEventEnvelope
): TaskNotice | undefined {
  if (event.type !== "decomposition.job_settled") return undefined;
  return {
    outcome: event.payload.outcome,
    module: "long-book-decomposition"
  };
}
