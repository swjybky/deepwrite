import type { AgentConversationContext } from "./context";
import type {
  ChatAssistantRequestContext,
  LongWorkspaceRuntimeContext,
  UserPromptAttachment,
  WorkspaceRuntimeContext
} from "@deepwrite/contracts";
import { LongWorkspaceRuntimeContextSchema } from "@deepwrite/contracts/renderer";
import type { ConversationMessageRewriteRequest } from "../../types/conversation";
import type { WorkspaceDocument } from "../../types/workspace";
import type { WorkspaceContextAttachments } from "./types";

type SendEntrypointsContext = Pick<
  AgentConversationContext,
  "sendMessage" | "sessionId" | "messages"
>;
export async function sendAssistantMessage(
  ctx: SendEntrypointsContext,
  context: ChatAssistantRequestContext = { mode: "normal" }
): Promise<void> {
  await ctx.sendMessage(null, [], {}, [], undefined, "chat-assistant", context);
}
export async function resendMessage(
  ctx: SendEntrypointsContext,
  request: ConversationMessageRewriteRequest,
  activeDocument: WorkspaceDocument,
  workspaceDocuments: WorkspaceDocument[] = [],
  attachments: WorkspaceContextAttachments = {}
): Promise<boolean> {
  const sourceSessionId = ctx.sessionId.value;
  await ctx.sendMessage(
    activeDocument,
    workspaceDocuments,
    attachments,
    [],
    undefined,
    "workspace",
    undefined,
    request
  );
  return (
    ctx.sessionId.value === sourceSessionId &&
    !ctx.messages.value.some((message) => message.id === request.messageId)
  );
}
export async function sendLongMessage(
  ctx: SendEntrypointsContext,
  context: LongWorkspaceRuntimeContext,
  attachments: Pick<
    WorkspaceRuntimeContext,
    "attachedSkills" | "attachedMaterials"
  > = {},
  promptAttachments: UserPromptAttachment[] = []
): Promise<void> {
  const longWorkspace = LongWorkspaceRuntimeContextSchema.parse(context);
  await ctx.sendMessage(
    {
      id: longWorkspace.bookId,
      domain: "creation",
      title: longWorkspace.title,
      eyebrow: "长篇创作",
      path: [longWorkspace.title],
      content: "",
      readOnly: true
    },
    [],
    attachments,
    promptAttachments,
    { longWorkspace }
  );
}
export async function resendLongMessage(
  ctx: SendEntrypointsContext,
  request: ConversationMessageRewriteRequest,
  context: LongWorkspaceRuntimeContext,
  attachments: Pick<
    WorkspaceRuntimeContext,
    "attachedSkills" | "attachedMaterials"
  > = {}
): Promise<boolean> {
  const longWorkspace = LongWorkspaceRuntimeContextSchema.parse(context);
  const sourceSessionId = ctx.sessionId.value;
  await ctx.sendMessage(
    {
      id: longWorkspace.bookId,
      domain: "creation",
      title: longWorkspace.title,
      eyebrow: "长篇创作",
      path: [longWorkspace.title],
      content: "",
      readOnly: true
    },
    [],
    attachments,
    [],
    { longWorkspace },
    "workspace",
    undefined,
    request
  );
  return (
    ctx.sessionId.value === sourceSessionId &&
    !ctx.messages.value.some((message) => message.id === request.messageId)
  );
}
