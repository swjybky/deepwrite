import { resolveBookIdentityTask } from "./book-identity-resolution";
import type { ImageModelCapability } from "@deepwrite/contracts";
import type { BookIdentityRunRegistration } from "../book-identity/run-registration";
import {
  CHAT_PROJECT_DEFAULT_PROFILE_ID,
  ExtrasAgentResolvedTaskSchema,
  type ExtrasAgentResolvedTask,
  type ExtrasAgentTask
} from "@deepwrite/contracts";
import {
  buildChatProjectRuntimeSnapshot,
  buildChatRuntimeSnapshot,
  type ChatRuntimeSources
} from "./chat/runtime-snapshot";
import type { ExtrasAgentConfigStore } from "./config-store";

export interface ExtrasTaskResolution {
  task: ExtrasAgentResolvedTask;
  /** Long-form book the run may read through Main's Core query bridge. */
  resourceId?: string;
  bookIdentity?: BookIdentityRunRegistration;
  decompositionJobId?: string;
  decompositionOutputVersion?: number;
  decompositionAttemptId?: string;
  decompositionUnitIds?: string[];
  decompositionPhase?: string;
}

/**
 * Turns a Renderer task into what the Agent Utility runs: the saved profile
 * and, for chat, the snapshot Main alone is allowed to read.
 */
export async function resolveExtrasTask(
  configStore: ExtrasAgentConfigStore,
  chatSources: ChatRuntimeSources,
  task: ExtrasAgentTask,
  imageCapability?: ImageModelCapability
): Promise<ExtrasTaskResolution> {
  switch (task.agentId) {
    case "book-title-design":
    case "book-synopsis-design":
    case "book-cover-design":
      return resolveBookIdentityTask(
        configStore,
        chatSources,
        task,
        imageCapability
      );
    case "chat-normal":
      return {
        task: ExtrasAgentResolvedTaskSchema.parse({
          agentId: task.agentId,
          profile: await configStore.resolve(task.agentId, task.profileId),
          input: {
            ...task.input,
            runtime: await buildChatRuntimeSnapshot(chatSources)
          }
        })
      };
    case "chat-project": {
      // A project without its own prompt chats with the default prompt.
      const profile =
        (await configStore.find(task.agentId, task.profileId)) ??
        (await configStore.resolve(
          task.agentId,
          CHAT_PROJECT_DEFAULT_PROFILE_ID
        ));
      const { project } = task.input;
      return {
        task: ExtrasAgentResolvedTaskSchema.parse({
          agentId: task.agentId,
          profile,
          input: {
            ...task.input,
            runtime: await buildChatProjectRuntimeSnapshot(chatSources, project)
          }
        }),
        ...(project.projectType === "long"
          ? { resourceId: project.projectId }
          : {})
      };
    }
    case "long-material-guide":
      throw new Error("仿写增强的证据须由 Main 从 Core 读取。");
    default:
      return {
        task: ExtrasAgentResolvedTaskSchema.parse({
          agentId: task.agentId,
          profile: await configStore.resolve(task.agentId, task.profileId),
          input: task.input
        })
      };
  }
}
