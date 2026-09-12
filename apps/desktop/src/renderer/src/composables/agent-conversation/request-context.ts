import type {
  DeepWriteApi,
  WorkspaceRuntimeContext
} from "@deepwrite/contracts";
import { LibraryAgentWorkspaceSnapshotSchema } from "@deepwrite/contracts/renderer";
import type { WorkspaceDocument } from "../../types/workspace";
import type { WorkspaceContextAttachments } from "./types";
import type { AgentConversationContext } from "./context";
type Context = Pick<
  AgentConversationContext,
  "epoch" | "sessionId" | "options"
>;
type RequestContext =
  { contextSnapshot: WorkspaceRuntimeContext | undefined } | undefined;
export function preparePromptContext(
  ctx: Context,
  api: DeepWriteApi,
  activeDocument: WorkspaceDocument | null,
  workspaceDocuments: WorkspaceDocument[],
  attachments: WorkspaceContextAttachments,
  contextOverride: WorkspaceRuntimeContext | undefined,
  mode: "workspace" | "chat-assistant",
  sendEpoch: number,
  sendSessionId: string
): RequestContext | Promise<RequestContext> {
  const originalLength = activeDocument?.content.length ?? 0;
  const snapshotContent =
    activeDocument &&
    (activeDocument.workspaceType === "short" ||
      activeDocument.workspaceType === "script") &&
    activeDocument.stageId === "draft"
      ? activeDocument.content
      : (activeDocument?.content.slice(0, 20000) ?? "");
  const contextSnapshot: WorkspaceRuntimeContext | undefined =
    mode === "chat-assistant"
      ? undefined
      : (contextOverride ??
        (activeDocument
          ? {
              activeResource: {
                id: activeDocument.id,
                domain: activeDocument.domain,
                title: activeDocument.title,
                path: [...activeDocument.path],
                ...(activeDocument.format
                  ? { format: activeDocument.format }
                  : {}),
                source: "live-editor" as const,
                content: snapshotContent,
                ...(originalLength > snapshotContent.length
                  ? { truncated: true as const, originalLength }
                  : {})
              }
            }
          : undefined));
  if (contextSnapshot && attachments.attachedSkills?.length) {
    contextSnapshot.attachedSkills = attachments.attachedSkills.map(
      (skill) => ({
        ...skill
      })
    );
  }
  if (contextSnapshot && attachments.attachedMaterials?.length) {
    contextSnapshot.attachedMaterials = attachments.attachedMaterials.map(
      (material) => ({
        ...material
      })
    );
  }
  if (!contextOverride && attachments.libraryWorkspace) {
    if (!contextSnapshot) return;
    contextSnapshot.libraryWorkspace =
      LibraryAgentWorkspaceSnapshotSchema.parse(attachments.libraryWorkspace);
  }
  if (
    !contextOverride &&
    contextSnapshot &&
    activeDocument &&
    (activeDocument.workspaceType === "short" ||
      activeDocument.workspaceType === "script") &&
    activeDocument.workspaceId &&
    activeDocument.workspaceTitle &&
    activeDocument.stageId
  ) {
    return (async () => {
      const { buildCreativeWorkspaceContext, loadWritingContextForPrompt } =
        await import("./creative-workspace-context");
      if (ctx.epoch !== sendEpoch || ctx.sessionId.value !== sendSessionId)
        return;
      const creativeContext = buildCreativeWorkspaceContext(
        activeDocument,
        workspaceDocuments
      );
      if (creativeContext) {
        const agentsMd = await loadWritingContextForPrompt(
          api.catalog,
          activeDocument.workspaceId!,
          activeDocument.workspaceType!,
          ctx.options.onContextWarning
        );
        if (ctx.epoch !== sendEpoch || ctx.sessionId.value !== sendSessionId)
          return;
        const creativeWorkspace =
          creativeContext.scriptWorkspace ?? creativeContext.shortWorkspace;
        if (creativeWorkspace && agentsMd !== undefined)
          creativeWorkspace.agentsMd = agentsMd;
        Object.assign(contextSnapshot, creativeContext);
      }
      return { contextSnapshot };
    })();
  }

  return { contextSnapshot };
}
