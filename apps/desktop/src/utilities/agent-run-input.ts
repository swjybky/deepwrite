import type {
  AgentPromptCommandPayload,
  CommandResult
} from "@deepwrite/contracts";
import type {
  AgentRunInput,
  LongCommandExecutor,
  LibraryManagementCommandExecutor,
  MaterialCommandExecutor,
  TeamManagementCommandExecutor
} from "@deepwrite/pi-runtime-adapter";
import type { UtilityCommandHandlerContext } from "./runtime";

function abortedError(): Error {
  const error = new Error("Long workspace Core request was aborted.");
  error.name = "AbortError";
  return error;
}

/** Agent -> Core query bridge; Main authorizes each command per run. */
export function createCoreCommandExecutor(
  context: UtilityCommandHandlerContext
): (
  command:
    | Parameters<LongCommandExecutor>[0]
    | Parameters<MaterialCommandExecutor>[0]
    | Parameters<LibraryManagementCommandExecutor>[0]
    | Parameters<TeamManagementCommandExecutor>[0],
  signal?: AbortSignal
) => Promise<CommandResult> {
  return (command, signal) => {
    if (signal?.aborted) return Promise.reject(abortedError());
    const request = context.requestInternalCommand("core", command, {
      timeoutMs: 60_000
    });
    if (!signal) return request;
    return new Promise((resolve, reject) => {
      const onAbort = (): void => {
        signal.removeEventListener("abort", onAbort);
        reject(abortedError());
      };
      signal.addEventListener("abort", onAbort, { once: true });
      void request.then(
        (result) => {
          signal.removeEventListener("abort", onAbort);
          if (signal.aborted) reject(abortedError());
          else resolve(result);
        },
        (error: unknown) => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        }
      );
    });
  };
}

export function createAgentRunInput(
  payload: AgentPromptCommandPayload,
  runId: string,
  signal: AbortSignal,
  context?: UtilityCommandHandlerContext
): AgentRunInput {
  return {
    runId,
    sessionId: payload.sessionId,
    prompt: payload.message,
    ...(payload.conversationHistory?.length
      ? { conversationHistory: payload.conversationHistory }
      : {}),
    ...(payload.conversationHistoryMode
      ? { conversationHistoryMode: payload.conversationHistoryMode }
      : {}),
    ...(payload.conversationCheckpoint
      ? { conversationCheckpoint: payload.conversationCheckpoint }
      : {}),
    ...(payload.contextCompaction
      ? { contextCompaction: payload.contextCompaction }
      : {}),
    ...(payload.contextCompactionSettings
      ? { contextCompactionSettings: payload.contextCompactionSettings }
      : {}),
    ...(payload.compactionRuntimeConfig
      ? { compactionRuntimeConfig: payload.compactionRuntimeConfig }
      : {}),
    ...(payload.attachments?.length
      ? { attachments: payload.attachments }
      : {}),
    ...(payload.writeApprovalMode
      ? { writeApprovalMode: payload.writeApprovalMode }
      : {}),
    ...(payload.proposalSettlements
      ? { proposalSettlements: payload.proposalSettlements }
      : {}),
    ...(payload.autoApproveCrossStageOperations !== undefined
      ? {
          autoApproveCrossStageOperations:
            payload.autoApproveCrossStageOperations
        }
      : {}),
    ...(payload.thinkingLevel ? { thinkingLevel: payload.thinkingLevel } : {}),
    ...(payload.temperature !== undefined
      ? { temperature: payload.temperature }
      : {}),
    ...(payload.runtimeConfig ? { runtimeConfig: payload.runtimeConfig } : {}),
    ...(payload.webSearch ? { webSearch: payload.webSearch } : {}),
    ...(payload.webSearchEnabled === true ? { webSearchEnabled: true } : {}),
    ...(payload.agentProfile ? { agentProfile: payload.agentProfile } : {}),
    ...(payload.scriptAgentProfile
      ? { scriptAgentProfile: payload.scriptAgentProfile }
      : {}),
    ...(payload.longAgentProfile
      ? { longAgentProfile: payload.longAgentProfile }
      : {}),
    ...(payload.longAgentProfile && context
      ? { longCommandExecutor: createCoreCommandExecutor(context) }
      : {}),
    ...(payload.workspaceContext?.materialCatalog && context
      ? { materialCommandExecutor: createCoreCommandExecutor(context) }
      : {}),
    ...(payload.subagentDefinitions
      ? { subagentDefinitions: payload.subagentDefinitions }
      : {}),
    ...(payload.subagentRuntimeConfigs
      ? { subagentRuntimeConfigs: payload.subagentRuntimeConfigs }
      : {}),
    ...(payload.parallelSubagents ? { parallelSubagents: true } : {}),
    ...(payload.libraryManagement && context
      ? {
          libraryManagement: payload.libraryManagement,
          libraryManagementCommandExecutor: createCoreCommandExecutor(context)
        }
      : {}),
    ...(payload.teamManagement && context
      ? {
          teamManagement: payload.teamManagement,
          teamManagementCommandExecutor: createCoreCommandExecutor(context)
        }
      : {}),
    ...(payload.libraryAgentProfile
      ? { libraryAgentProfile: payload.libraryAgentProfile }
      : {}),
    ...(payload.workspaceContext
      ? { workspaceContext: payload.workspaceContext }
      : {}),
    signal
  };
}
