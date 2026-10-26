import type {
  AgentToolTrace,
  ChatContextCompaction
} from "../types/conversation";
import { activeToolCall } from "./conversationToolStatus";

export type WorkGroupMemberItem =
  | { id: string; type: "thinking"; content: string; createdAt: string }
  | { id: string; type: "tool"; tool: AgentToolTrace; createdAt?: string }
  | { id: string; type: "tool-group"; tools: AgentToolTrace[] }
  | {
      id: string;
      type: "compaction";
      compaction: ChatContextCompaction;
      createdAt: string;
    };

export type WorkGroupDisplayItem = {
  id: string;
  type: "work-group";
  running: boolean;
  items: WorkGroupMemberItem[];
};

type WorkGroupActivity =
  { type: "thinking" | "compaction" } | { type: "tool"; tool: AgentToolTrace };

/** Only explicit pending work or the latest thinking step is still active. */
export function workGroupActivity(
  items: readonly WorkGroupMemberItem[],
  allowThinking = true
): WorkGroupActivity | undefined {
  let pendingTool: AgentToolTrace | undefined;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]!;
    if (item.type === "compaction" && item.compaction.status === "running") {
      return { type: "compaction" };
    }
    const tool =
      item.type === "tool"
        ? activeToolCall([item.tool])
        : item.type === "tool-group"
          ? activeToolCall(item.tools)
          : undefined;
    if (tool?.status === "running") return { type: "tool", tool };
    pendingTool ??= tool;
  }
  if (pendingTool) return { type: "tool", tool: pendingTool };
  if (allowThinking && items.at(-1)?.type === "thinking") {
    return { type: "thinking" };
  }
  return undefined;
}

const WORK_MEMBER_TYPES = new Set([
  "thinking",
  "tool",
  "tool-group",
  "compaction"
]);

function isEmptyResponse(item: { type: string; content?: string }): boolean {
  return item.type === "response" && !item.content;
}

function isWorkMember(item: { type: string }): item is WorkGroupMemberItem {
  return WORK_MEMBER_TYPES.has(item.type);
}

export function foldWorkGroups<T extends { id: string; type: string }>(
  items: readonly T[],
  running: boolean
): Array<T | WorkGroupDisplayItem> {
  const result: Array<T | WorkGroupDisplayItem> = [];
  let current: WorkGroupDisplayItem | undefined;

  function flush(): void {
    if (!current) return;
    result.push(current);
    current = undefined;
  }

  for (const item of items) {
    if (isEmptyResponse(item)) continue;
    // Keep compaction beside the work that preceded it, without moving it
    // across a response, subagent or approval card.
    if (isWorkMember(item) && (item.type !== "compaction" || current)) {
      current ??= {
        id: `work:${item.id}`,
        type: "work-group",
        running: false,
        items: []
      };
      current.items.push(item as WorkGroupMemberItem);
      continue;
    }
    flush();
    result.push(item);
  }
  flush();

  if (running) {
    for (const [index, item] of result.entries()) {
      if (item.type !== "work-group" || !("items" in item)) continue;
      const group = item as WorkGroupDisplayItem;
      group.running = Boolean(
        workGroupActivity(group.items, index === result.length - 1)
      );
    }
  }
  return result;
}
