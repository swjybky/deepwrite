import type {
  SessionPromptCommandPayload,
  ModelUsageModule
} from "@deepwrite/contracts";
/** Usage module of a `session.prompt` run; extras runs map by agent id. */
export function usageModuleForPrompt(
  payload: SessionPromptCommandPayload
): ModelUsageModule {
  const context = payload.workspaceContext;
  if (!context) return "unknown";
  if (context.shortWorkspace) return "short-writing";
  if (context.scriptWorkspace) return "script-writing";
  if (context.longWorkspace) return "long-writing";
  if (context.academicWorkspace) return "academic-writing";
  if (context.mysteryWorkspace) return "mystery-writing";
  if (context.libraryWorkspace) {
    return context.libraryWorkspace.domain === "skill"
      ? "skill-library"
      : "material-library";
  }
  if (context.subagentAuthoring) return "subagent-authoring";
  return "unknown";
}
