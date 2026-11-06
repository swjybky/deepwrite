import { chatAssistantProjectKey } from "@deepwrite/contracts";
import type { BookIdentityRunRegistration } from "../extras/book-identity/run-registration";
import type {
  CommandEnvelope,
  MaterialReadScope,
  LibraryManagementScope
} from "@deepwrite/contracts";
import type {
  UtilityInternalCommandAuthorizationContext,
  UtilityInternalCommandAuthorizationResult
} from "./supervisor";

export const AGENT_CORE_LONG_QUERY_COMMANDS = [
  "long.getWorkspaceIndex",
  "long.readDocument",
  "long.search"
] as const satisfies readonly CommandEnvelope["type"][];

export const AGENT_CORE_QUERY_COMMANDS = [
  ...AGENT_CORE_LONG_QUERY_COMMANDS,
  "catalog.queryMaterials",
  "catalog.queryLibraryManagement",
  "agentTeams.listActivePrompts",
  "agentTeams.readActivePrompt",
  "agentTeams.applyActivePrompt",
  "longBookDecomposition.query",
  "longBookDecomposition.submitUnit",
  "longBookDecomposition.planTopic",
  "bookIdentity.submitRound"
] as const;

const LONG_QUERY_COMMAND_TYPES = new Set<string>(
  AGENT_CORE_LONG_QUERY_COMMANDS
);

export interface MainInternalCommandActiveRun {
  sessionId: string;
  /** Resources held by a creation/library run, for external write isolation. */
  externalResourceIds?: string[];
  /** Present only for a long-form run accepted from Main's session.prompt. */
  resourceId?: string;
  /** Main->Agent transport request that created the accepted run. */
  promptRequestId?: string;
  accepted: boolean;
  bookIdentity?: BookIdentityRunRegistration;
  materialScope?: MaterialReadScope;
  libraryManagementScope?: LibraryManagementScope;
  teamManagementScope?: LibraryManagementScope;
  decompositionJobId?: string;
  decompositionOutputVersion?: number;
  decompositionAttemptId?: string;
  decompositionUnitIds?: string[];
  decompositionPhase?: string;
}

function denied(
  code: string,
  message: string
): UtilityInternalCommandAuthorizationResult {
  return { authorized: false, code, message };
}

/**
 * Authorizes only query commands bound to a Main-accepted long-form run.
 * All compared identities originate from the validated session.prompt and
 * its acceptance chain; command context supplied by Agent is only evidence
 * to compare, never the source of authority.
 */
export function authorizeMainInternalCommand(
  context: UtilityInternalCommandAuthorizationContext,
  activeRuns: ReadonlyMap<string, MainInternalCommandActiveRun>
): UtilityInternalCommandAuthorizationResult {
  const { source, target, message } = context;
  if (source !== "agent" || message.worker !== "agent" || target !== "core") {
    return denied(
      "main.invalid_bridge_route",
      "Only Agent-to-Core internal commands are authorized."
    );
  }
  if (
    message.command.type === "agentTeams.listActivePrompts" ||
    message.command.type === "agentTeams.readActivePrompt" ||
    message.command.type === "agentTeams.applyActivePrompt"
  ) {
    const command = message.command;
    const run = command.context.runId
      ? activeRuns.get(command.context.runId)
      : undefined;
    const scope = run?.teamManagementScope;
    if (
      !run?.accepted ||
      !scope ||
      !run.promptRequestId ||
      message.parentRequestId !== run.promptRequestId ||
      command.context.sessionId !== run.sessionId ||
      command.context.resourceId !== scope.bookId ||
      command.payload.scope.bookId !== scope.bookId ||
      command.payload.scope.bookType !== scope.bookType
    ) {
      return denied(
        "main.team_management_not_authorized",
        "团队提示词管理必须属于 Main 接受的当前作品与运行。"
      );
    }
    return true;
  }
  if (message.command.type === "bookIdentity.submitRound") {
    const command = message.command;
    const run = command.context.runId
      ? activeRuns.get(command.context.runId)
      : undefined;
    const identity = run?.bookIdentity;
    if (
      !run?.accepted ||
      !identity ||
      !run.promptRequestId ||
      message.parentRequestId !== run.promptRequestId ||
      command.context.sessionId !== run.sessionId ||
      command.context.resourceId !== chatAssistantProjectKey(identity.book) ||
      chatAssistantProjectKey(command.payload.book) !==
        chatAssistantProjectKey(identity.book) ||
      command.payload.roundId !== identity.roundId ||
      command.payload.field !== identity.field ||
      command.payload.candidates.length !== identity.candidateCount ||
      identity.submitted ||
      identity.submitting
    )
      return denied(
        "main.book_identity_not_authorized",
        "设计提交必须属于 Main 接受的作品、字段与轮次，且只能提交一次。"
      );
    return true;
  }
  if (
    message.command.type === "longBookDecomposition.query" ||
    message.command.type === "longBookDecomposition.submitUnit" ||
    message.command.type === "longBookDecomposition.planTopic"
  ) {
    const command = message.command;
    const run = command.context.runId
      ? activeRuns.get(command.context.runId)
      : undefined;
    if (
      !run?.accepted ||
      !run.decompositionJobId ||
      !run.promptRequestId ||
      message.parentRequestId !== run.promptRequestId ||
      command.context.sessionId !== run.sessionId ||
      command.context.resourceId !== run.decompositionJobId ||
      command.payload.jobId !== run.decompositionJobId
    ) {
      return denied(
        "main.decomposition_not_authorized",
        "拆解查询和提交必须属于 Main 接受的当前任务工作包。"
      );
    }
    if (
      command.type === "longBookDecomposition.submitUnit" &&
      (command.payload.outputVersion !== run.decompositionOutputVersion ||
        command.payload.attemptId !== run.decompositionAttemptId ||
        !(
          run.decompositionUnitIds?.includes(command.payload.unitId) ||
          (["integrate", "review"].includes(run.decompositionPhase ?? "") &&
            new RegExp(`^topic:${run.decompositionAttemptId}:[1-5]$`, "u").test(
              command.payload.unitId
            ))
        ))
    ) {
      return denied(
        "main.decomposition_submission_out_of_scope",
        "拆解提交不能跨任务、输出版本、工作包或尝试。"
      );
    }
    if (
      command.type === "longBookDecomposition.planTopic" &&
      (command.payload.outputVersion !== run.decompositionOutputVersion ||
        command.payload.attemptId !== run.decompositionAttemptId ||
        !["integrate", "review"].includes(run.decompositionPhase ?? ""))
    )
      return denied(
        "main.decomposition_topic_out_of_scope",
        "专题登记不能跨工作包或阶段。"
      );
    return true;
  }
  if (message.command.type === "catalog.queryLibraryManagement") {
    const command = message.command;
    const run = command.context.runId
      ? activeRuns.get(command.context.runId)
      : undefined;
    const scope = run?.libraryManagementScope;
    if (
      !run?.accepted ||
      !scope ||
      !run.promptRequestId ||
      message.parentRequestId !== run.promptRequestId ||
      command.context.sessionId !== run.sessionId ||
      command.context.resourceId !== scope.bookId ||
      command.payload.scope.bookId !== scope.bookId ||
      command.payload.scope.bookType !== scope.bookType
    ) {
      return denied(
        "main.library_management_not_authorized",
        "Library management queries require the accepted owning work and prompt."
      );
    }
    return true;
  }
  if (
    message.target === "core" &&
    message.command.type === "catalog.queryMaterials"
  ) {
    const command = message.command;
    const run = command.context.runId
      ? activeRuns.get(command.context.runId)
      : undefined;
    const scope = run?.materialScope;
    const requested = command.payload.scope;
    if (
      !run?.accepted ||
      !scope ||
      !run.promptRequestId ||
      message.parentRequestId !== run.promptRequestId ||
      command.context.sessionId !== run.sessionId ||
      command.context.resourceId !== scope.bookId
    ) {
      return denied(
        "main.material_run_not_authorized",
        "Material queries require the active accepted run and its prompt context."
      );
    }
    if (
      requested.bookId !== scope.bookId ||
      requested.bookType !== scope.bookType ||
      requested.stageId !== scope.stageId ||
      requested.kinds.some((kind) => !scope.kinds.includes(kind))
    ) {
      return denied(
        "main.material_scope_mismatch",
        "Material queries cannot expand the accepted book, stage or kinds."
      );
    }
    return true;
  }
  if (
    message.target !== "core" ||
    !LONG_QUERY_COMMAND_TYPES.has(message.command.type)
  ) {
    return denied(
      "main.command_not_long_query",
      "Only long-form query commands are authorized."
    );
  }

  const command = message.command;
  if (
    command.type !== "long.getWorkspaceIndex" &&
    command.type !== "long.readDocument" &&
    command.type !== "long.search"
  ) {
    return denied(
      "main.command_not_long_query",
      "Only long-form query commands are authorized."
    );
  }

  const runId = command.context.runId;
  const sessionId = command.context.sessionId;
  const resourceId = command.context.resourceId;
  if (!runId || !sessionId || !resourceId) {
    return denied(
      "main.missing_command_context",
      "Long-form internal commands require sessionId, runId and resourceId."
    );
  }

  const run = activeRuns.get(runId);
  if (!run || !run.accepted) {
    return denied(
      "main.run_not_accepted",
      "The long-form agent run is not active and accepted."
    );
  }
  if (!run.resourceId) {
    return denied(
      "main.run_not_long_form",
      "The active run is not bound to a long-form resource."
    );
  }
  if (run.sessionId !== sessionId) {
    return denied(
      "main.session_mismatch",
      "The internal command session does not match its active run."
    );
  }
  if (run.resourceId !== resourceId) {
    return denied(
      "main.resource_mismatch",
      "The internal command resource does not match its active run."
    );
  }
  if (command.payload.bookId !== resourceId) {
    return denied(
      "main.book_mismatch",
      "The internal command book does not match its bound resource."
    );
  }
  if (!run.promptRequestId || message.parentRequestId !== run.promptRequestId) {
    return denied(
      "main.parent_request_mismatch",
      "The internal command is not attached to the prompt that created its run."
    );
  }
  return true;
}
