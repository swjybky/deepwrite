import type {
  ExtrasChatTask,
  LongWorkspaceRuntimeContext,
  MysteryWorkspaceRuntimeContext,
  UserPromptAttachment,
  WorkspaceRuntimeContext
} from "@deepwrite/contracts";
import type { ConversationMessageRewriteRequest } from "../../types/conversation";
import type { WorkspaceDocument } from "../../types/workspace";
import type { WorkspaceContextAttachments } from "./types";
export interface SendEntrypointsOperations {
  sendAssistantMessage(
    task: ExtrasChatTask,
    attachments?: UserPromptAttachment[]
  ): Promise<void>;
  resendMessage(
    request: ConversationMessageRewriteRequest,
    activeDocument: WorkspaceDocument,
    workspaceDocuments?: WorkspaceDocument[],
    attachments?: WorkspaceContextAttachments
  ): Promise<boolean>;
  sendLongMessage(
    context: LongWorkspaceRuntimeContext,
    attachments?: Pick<
      WorkspaceRuntimeContext,
      "attachedSkills" | "attachedMaterials"
    >,
    promptAttachments?: UserPromptAttachment[]
  ): Promise<void>;
  resendLongMessage(
    request: ConversationMessageRewriteRequest,
    context: LongWorkspaceRuntimeContext,
    attachments?: Pick<
      WorkspaceRuntimeContext,
      "attachedSkills" | "attachedMaterials"
    >
  ): Promise<boolean>;
  sendMysteryMessage(
    context: MysteryWorkspaceRuntimeContext,
    attachments?: Pick<
      WorkspaceRuntimeContext,
      "attachedSkills" | "attachedMaterials"
    >,
    promptAttachments?: UserPromptAttachment[]
  ): Promise<void>;
  resendMysteryMessage(
    request: ConversationMessageRewriteRequest,
    context: MysteryWorkspaceRuntimeContext,
    attachments?: Pick<
      WorkspaceRuntimeContext,
      "attachedSkills" | "attachedMaterials"
    >
  ): Promise<boolean>;
}
