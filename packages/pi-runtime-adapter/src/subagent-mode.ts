import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  SUBAGENT_DRAW_MAX_COUNT,
  activeSubagentDraw,
  subagentWebSearchAllowed,
  type SubagentAgentMode,
  type SubagentWebSearchMode,
  type SubagentDrawSettings
} from "@deepwrite/contracts";
import type { ContextPolicy } from "./kernel/context";
import {
  WEB_FETCH_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME,
  WEB_TOOL_NAMES
} from "./web-search/tool-names";
import type {
  BuildSpawnSubagentToolInput,
  RuntimeSubagentDefinition
} from "./subagent-types";

/**
 * The only tools a `pure-read` child keeps: reading the work and the
 * materials, and looking things up on the web, which changes nothing. An allow
 * list, so tools added later never leak into pure modes.
 */
export const PURE_READ_TOOL_NAMES: ReadonlySet<string> = new Set([
  "read",
  "list",
  "query_linked_material_entries",
  WEB_SEARCH_TOOL_NAME,
  WEB_FETCH_TOOL_NAME
]);

/** Library managers own their tools and prompts, so they are never pure. */
export function subagentAgentMode(
  definition: Pick<RuntimeSubagentDefinition, "agentMode" | "toolSource">
): SubagentAgentMode {
  if (definition.toolSource === "library-management") return "standard";
  return definition.agentMode ?? "standard";
}

/** Draw settings in effect; library managers and standard members never draw. */
export function subagentDrawSettings(
  definition: Pick<
    RuntimeSubagentDefinition,
    "agentMode" | "toolSource" | "draw"
  >
): SubagentDrawSettings | undefined {
  return activeSubagentDraw({
    agentMode: subagentAgentMode(definition),
    draw: definition.draw
  });
}

/**
 * The child's own web search mode decides whether it keeps the tool the run's
 * tool sets carry whenever Main supplied settings. A child without the tool
 * cannot gain it here: the tool sets create it from the run's session.
 */
export function applySubagentWebSearch(
  tools: AgentTool[],
  mode: SubagentWebSearchMode | undefined,
  mainEnabled: boolean
): AgentTool[] {
  return subagentWebSearchAllowed(mode, mainEnabled)
    ? tools
    : tools.filter((tool) => !WEB_TOOL_NAMES.has(tool.name));
}

export function applySubagentAgentMode(
  tools: AgentTool[],
  mode: SubagentAgentMode
): AgentTool[] {
  if (mode === "standard") return tools;
  if (mode === "pure-bare") return [];
  return tools.filter((tool) => PURE_READ_TOOL_NAMES.has(tool.name));
}

/** Runtime-owned requirements appended to the child's editable role prompt. */
export function subagentModeSystemRequirements(
  input: Pick<
    BuildSpawnSubagentToolInput,
    "systemPromptRequirements" | "pureReadSystemPromptRequirements"
  >,
  mode: SubagentAgentMode
): string | undefined {
  if (mode === "pure-bare") return undefined;
  const requirements =
    mode === "pure-read"
      ? input.pureReadSystemPromptRequirements
      : input.systemPromptRequirements;
  return typeof requirements === "function" ? requirements() : requirements;
}

/** A bare child must not get manuscript text re-attached after compaction. */
export function subagentContextPolicyForMode(
  policy: ContextPolicy | undefined,
  mode: SubagentAgentMode
): ContextPolicy | undefined {
  if (mode !== "pure-bare" || !policy?.rehydrate) return policy;
  const { rehydrate: _rehydrate, ...rest } = policy;
  return rest;
}

/** Runtime fact appended to a pure child's system prompt. */
export function subagentModeNote(mode: SubagentAgentMode): string | undefined {
  if (mode === "pure-read") {
    return "你运行在纯净·只读模式：可以读取作品与素材，但没有任何写入工具，不能修改作品。把成果以文字形式写进交接摘要交给主智能体。";
  }
  if (mode === "pure-bare") {
    return "你运行在纯净·无工具模式：看不到作品、素材和主对话，只能依据主智能体在任务里给出的内容工作。信息不足时在回复中说明缺什么，不要编造作品内容。";
  }
  return undefined;
}

/** Marker after a member's name in the parent's `spawn_subagent` listing. */
export function subagentModeLabel(mode: SubagentAgentMode): string | undefined {
  if (mode === "pure-read") {
    return "［纯净·只读：可读取作品与素材，不能修改作品］";
  }
  if (mode === "pure-bare") {
    return "［纯净·无工具：看不到作品与素材，task 中须写全所需原文与要求］";
  }
  return undefined;
}

/** Marker telling the parent that a member answers with one selected draw. */
export function subagentDrawLabel(draw: SubagentDrawSettings): string {
  if (draw.countMode === "auto") {
    return `［按需抽卡：最多 ${SUBAGENT_DRAW_MAX_COUNT} 份。要多个版本时在该任务的 draw_variants 里逐条写出每份的差异要求，条数即份数；不填只运行一次。系统择优后只返回选中的一份］`;
  }
  return `［抽卡×${draw.count}：系统会自动生成 ${draw.count} 份结果并择优，只返回选中的一份］`;
}

/** True when some member lets the parent decide its draws per task. */
export function subagentsAcceptDrawVariants(
  definitions: readonly RuntimeSubagentDefinition[]
): boolean {
  return definitions.some(
    (definition) => subagentDrawSettings(definition)?.countMode === "auto"
  );
}
