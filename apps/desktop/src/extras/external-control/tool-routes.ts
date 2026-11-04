import type {
  AgentTeamCatalogSnapshot,
  GeneralSettings
} from "@deepwrite/contracts";
import {
  EXTERNAL_CONTROL_PROTOCOL_VERSION,
  GetAppStatusResultSchema,
  findExternalControlTool,
  type ExternalControlClient,
  type ExternalControlResourceChange,
  type ExternalControlToolDefinition,
  type ExternalAgentRunInput,
  type ExternalAnswerAgentQuestionInput,
  type ExternalOpenInAppInput,
  type ExternalRunAgentInput,
  type ExternalWindowRequest,
  type ExternalGetLibraryInput,
  type ExternalGetWorkInput,
  type ExternalListAgentTeamsInput,
  type ExternalListLibrariesInput,
  type ExternalListWorksInput,
  type ExternalManageAgentTeamInput,
  type ExternalManageDocumentInput,
  type ExternalManageEntryInput,
  type ExternalManageLibraryInput,
  type ExternalManageWorkInput,
  type ExternalReadDocumentInput,
  type ExternalReadEntryInput,
  type ExternalRestoreTrashItemInput,
  type ExternalSaveAgentTeamInput,
  type ExternalSearchTextInput,
  type ExternalWriteDocumentInput,
  type ExternalWriteEntryInput
} from "@deepwrite/contracts/external-control";
import type { CommandEnvelope, CommandResult } from "@deepwrite/contracts";
import type { CoreRequest } from "./core-client";
import { ExternalControlError } from "./errors";
import { queueExternalOperation } from "./operation-queue";
import { getLibrary, listLibraries, readEntry } from "./library-read-tools";
import { manageEntry, manageLibrary, writeEntry } from "./library-write-tools";
import type { MutationContext } from "./mutation-client";
import {
  answerAgentQuestion,
  getAgentRun,
  openInApp,
  runAgent,
  stopAgentRun
} from "./run-tools";
import { searchText } from "./search-text";
import { manageDocument } from "./section-write-tools";
import { listAgentTeams } from "./team-read-tools";
import { manageAgentTeam, saveAgentTeam } from "./team-write-tools";
import { listTrash, restoreTrashItem } from "./trash-tools";
import type { TrashStore } from "./trash-store";
import { getWork, listWorks, readDocument } from "./work-read-tools";
import { manageWork, writeDocument } from "./work-write-tools";

export interface ExternalControlAppState {
  appVersion: string;
  platform: NodeJS.Platform;
  rendererReady(): boolean;
  activeRunCount(): number;
  activeResourceIds?(): ReadonlySet<string>;
  generalSettings(): GeneralSettings;
  core: CoreRequest;
  /** The window's own command route; see MutationContext. */
  command(command: CommandEnvelope): Promise<CommandResult>;
  broadcastChange(change: ExternalControlResourceChange): void;
  windowRequest(request: ExternalWindowRequest): Promise<unknown>;
  agentTeams(): Promise<AgentTeamCatalogSnapshot>;
  dataDirectory(): string;
}

export interface ExternalControlCallScope {
  trash: TrashStore;
  client: ExternalControlClient;
}

function getAppStatus(state: ExternalControlAppState) {
  const settings = state.generalSettings();
  return GetAppStatusResultSchema.parse({
    appVersion: state.appVersion,
    protocolVersion: EXTERNAL_CONTROL_PROTOCOL_VERSION,
    platform: state.platform,
    rendererReady: state.rendererReady(),
    activeRunCount: state.activeRunCount(),
    permissionMode: settings.permissionMode,
    crossStageAutoApprove: settings.autoApproveCrossStageOperations
  });
}

function parseInput<T>(
  tool: ExternalControlToolDefinition,
  rawArguments: Record<string, unknown>
): T {
  const parsed = tool.inputSchema.safeParse(rawArguments);
  if (parsed.success) return parsed.data as T;
  const issue = parsed.error.issues[0];
  const field = issue?.path.join(".");
  throw new ExternalControlError(
    "external.invalid_input",
    `${tool.name} 的参数不正确${field ? `（${field}）` : ""}：${issue?.message ?? "格式无效"}`
  );
}

/** The allowlist: a tool without a case here cannot reach the app. */
export async function callExternalControlTool(
  state: ExternalControlAppState,
  name: string,
  rawArguments: Record<string, unknown>,
  scope: ExternalControlCallScope
): Promise<unknown> {
  const mutation: MutationContext = { ...state, ...scope };
  const tool = findExternalControlTool(name);
  if (!tool) {
    throw new ExternalControlError(
      "external.invalid_input",
      `未知工具 ${name}。请重新读取工具列表。`
    );
  }
  const input = <T>() => parseInput<T>(tool, rawArguments);
  const dispatch = async (): Promise<unknown> => {
    switch (tool.name) {
      case "get_app_status":
        input<Record<string, never>>();
        return getAppStatus(state);
      case "list_works":
        return listWorks(state.core, input<ExternalListWorksInput>());
      case "get_work":
        return getWork(state.core, input<ExternalGetWorkInput>());
      case "read_document":
        return readDocument(state.core, input<ExternalReadDocumentInput>());
      case "search_text":
        return searchText(state.core, input<ExternalSearchTextInput>());
      case "list_libraries":
        return listLibraries(state.core, input<ExternalListLibrariesInput>());
      case "get_library":
        return getLibrary(state.core, input<ExternalGetLibraryInput>());
      case "read_entry":
        return readEntry(state.core, input<ExternalReadEntryInput>());
      case "list_agent_teams":
        return listAgentTeams(
          await state.agentTeams(),
          input<ExternalListAgentTeamsInput>()
        );
      case "write_document":
        return writeDocument(mutation, input<ExternalWriteDocumentInput>());
      case "manage_document":
        return manageDocument(mutation, input<ExternalManageDocumentInput>());
      case "manage_work":
        return manageWork(mutation, input<ExternalManageWorkInput>());
      case "write_entry":
        return writeEntry(mutation, input<ExternalWriteEntryInput>());
      case "manage_entry":
        return manageEntry(mutation, input<ExternalManageEntryInput>());
      case "manage_library":
        return manageLibrary(mutation, input<ExternalManageLibraryInput>());
      case "save_agent_team":
        return saveAgentTeam(mutation, input<ExternalSaveAgentTeamInput>());
      case "manage_agent_team":
        return manageAgentTeam(mutation, input<ExternalManageAgentTeamInput>());
      case "open_in_app":
        return openInApp(mutation, input<ExternalOpenInAppInput>());
      case "run_agent":
        return runAgent(mutation, input<ExternalRunAgentInput>());
      case "get_agent_run":
        return getAgentRun(mutation, input<ExternalAgentRunInput>());
      case "answer_agent_question":
        return answerAgentQuestion(
          mutation,
          input<ExternalAnswerAgentQuestionInput>()
        );
      case "stop_agent_run":
        return stopAgentRun(mutation, input<ExternalAgentRunInput>());
      case "list_trash":
        input<Record<string, never>>();
        return listTrash(mutation);
      case "restore_trash_item":
        return restoreTrashItem(
          mutation,
          input<ExternalRestoreTrashItemInput>()
        );
      default:
        throw new ExternalControlError(
          "external.invalid_input",
          `工具 ${name} 尚未开放。`
        );
    }
  };
  const concurrent =
    tool.annotations.readOnlyHint ||
    ["answer_agent_question", "stop_agent_run"].includes(tool.name);
  return concurrent ? dispatch() : queueExternalOperation(state, dispatch);
}
