import type {
  ChatAssistantRequestContext,
  UserPromptAttachment,
  WorkspaceRuntimeContext
} from "@deepwrite/contracts";
import type { ConversationMessageRewriteRequest } from "../../types/conversation";
import type { WorkspaceDocument } from "../../types/workspace";
import type { WorkspaceContextAttachments } from "./types";
export interface SendMessageOperations {
  sendMessage(
    activeDocument: WorkspaceDocument | null,
    workspaceDocuments?: WorkspaceDocument[],
    attachments?: WorkspaceContextAttachments,
    promptAttachments?: UserPromptAttachment[],
    contextOverride?: WorkspaceRuntimeContext,
    mode?: "workspace" | "chat-assistant",
    chatAssistant?: ChatAssistantRequestContext,
    rewriteRequest?: ConversationMessageRewriteRequest
  ): Promise<void>;
}
