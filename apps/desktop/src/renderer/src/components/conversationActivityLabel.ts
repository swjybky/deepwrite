import { createScopedTranslator } from "../i18n";
import type { AgentSubagentRun } from "../types/conversation";
import {
  workGroupActivity,
  type WorkGroupDisplayItem
} from "./conversationWorkGroups";

const t = createScopedTranslator("components.conversationActivityLabel");

const TOOL_ACTIVITY: Readonly<Record<string, string>> = {
  get read() {
    return t("readFile");
  },
  get list() {
    return t("listScope");
  },
  get create() {
    return t("createFile");
  },
  get edit() {
    return t("editContent");
  },
  get delete() {
    return t("deleteObject");
  },
  get load_skill() {
    return t("loadSkill");
  },
  get query_linked_material_entries() {
    return t("queryMaterials");
  },
  get ask_user_question() {
    return t("askUser");
  },
  get propose_continuity_commit() {
    return t("commitContinuity");
  },
  get web_search() {
    return t("webSearch");
  },
  get web_fetch() {
    return t("webFetch");
  },
  get switch_storyline_stage() {
    return t("switchStage");
  },
  get spawn_subagent() {
    return t("assigningTask");
  }
};

/** Short stage name for a real tool call. Unknown tools stay generic. */
export function toolActivityLabel(toolName: string): string {
  const known = TOOL_ACTIVITY[toolName];
  if (known) return known;
  if (toolName.startsWith("read_") || toolName.startsWith("get_")) {
    return t("readFile");
  }
  if (toolName.startsWith("list_")) return t("listScope");
  if (toolName.startsWith("search_")) return t("searchContent");
  if (toolName.startsWith("query_")) return t("queryReferences");
  if (toolName.startsWith("create_")) return t("createFile");
  if (toolName.startsWith("delete_")) return t("deleteObject");
  if (
    toolName.startsWith("write_") ||
    toolName.startsWith("edit_") ||
    toolName.startsWith("replace_") ||
    toolName.startsWith("rename_") ||
    toolName.startsWith("move_")
  ) {
    return t("editContent");
  }
  return t("runTool");
}

/** Name the active call rather than a completed or queued call beside it. */
export function workGroupActivityLabel(
  group: Pick<WorkGroupDisplayItem, "running" | "items">
): string {
  if (!group.running) return t("finished");
  const activity = workGroupActivity(group.items);
  if (activity?.type === "thinking") return t("thinking");
  if (activity?.type === "compaction") return t("compactingContext");
  if (activity?.type === "tool") {
    if (activity.tool.status === "preparing") {
      return activity.tool.argumentsComplete
        ? t("waitingForExecution")
        : t("preparingToolCall");
    }
    return toolActivityLabel(activity.tool.name);
  }
  return t("finished");
}

/** Parent badge while a child run is still open. */
export function subagentPhaseLabel(
  run: Pick<
    AgentSubagentRun,
    "thinking" | "output" | "toolCalls" | "processingSteps"
  >
): string {
  const working =
    Boolean(
      run.thinking?.length || run.output?.length || run.toolCalls.length
    ) ||
    run.processingSteps.some(
      (step) =>
        step.type === "tool" ||
        ((step.type === "thinking" || step.type === "response") &&
          step.content.length > 0)
    );
  return working ? t("subagentRunning") : t("assigningTask");
}
