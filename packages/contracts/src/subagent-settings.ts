import { z } from "zod";
import { TemperatureSchema, ThinkingLevelSchema } from "./models";

export const SHORT_AGENT_SUBAGENT_MODEL_ID_MAX_LENGTH = 120;

/**
 * How much of the work a subagent sees. `standard` is the full working
 * surface; the pure modes shrink it: `pure-read` keeps context injection and
 * read tools but no write tools, `pure-bare` has no context and no tools.
 */
export const SubagentAgentModeSchema = z.enum([
  "standard",
  "pure-read",
  "pure-bare"
]);
export type SubagentAgentMode = z.infer<typeof SubagentAgentModeSchema>;

/**
 * Whether a member may search the web: `inherit` follows the main agent's
 * switch for the run, `on` and `off` ignore it. A bare member has no tools,
 * so it never searches whatever this says.
 */
export const SubagentWebSearchModeSchema = z.enum(["inherit", "on", "off"]);
export type SubagentWebSearchMode = z.infer<typeof SubagentWebSearchModeSchema>;

/** The member's search permission once the main agent's switch is known. */
export function subagentWebSearchAllowed(
  mode: SubagentWebSearchMode | undefined,
  mainEnabled: boolean
): boolean {
  if (mode === "on") return true;
  if (mode === "off") return false;
  return mainEnabled;
}

/** True when a member that can use tools asks for search on its own. */
export function subagentsNeedWebSearch(
  definitions:
    | readonly {
        webSearchMode?: SubagentWebSearchMode | undefined;
        agentMode?: SubagentAgentMode | undefined;
      }[]
    | undefined
): boolean {
  return (definitions ?? []).some(
    (definition) =>
      definition.webSearchMode === "on" && definition.agentMode !== "pure-bare"
  );
}

export const ShortAgentSubagentModelModeSchema = z.enum(["inherit", "custom"]);
export type ShortAgentSubagentModelMode = z.infer<
  typeof ShortAgentSubagentModelModeSchema
>;

interface SubagentModelSettings {
  modelMode: ShortAgentSubagentModelMode;
  modelId?: string | undefined;
  thinkingLevel?: string | undefined;
  temperature?: number | undefined;
}

/** Shared by team members and their draw evaluators. */
export function validateSubagentCustomModel(
  value: SubagentModelSettings,
  context: z.core.$RefinementCtx<unknown>
): void {
  if (value.modelMode !== "custom") return;
  if (!value.modelId) {
    context.addIssue({
      code: "custom",
      path: ["modelId"],
      message: "单独配置模型时必须选择模型。"
    });
  }
  if (value.thinkingLevel === undefined) {
    context.addIssue({
      code: "custom",
      path: ["thinkingLevel"],
      message: "单独配置模型时必须选择思考等级。"
    });
  } else if (value.thinkingLevel === "off" && value.temperature === undefined) {
    context.addIssue({
      code: "custom",
      path: ["temperature"],
      message: "思考等级关闭时必须选择温度。"
    });
  }
}

export const SUBAGENT_DRAW_MIN_COUNT = 2;
export const SUBAGENT_DRAW_MAX_COUNT = 10;
export const SUBAGENT_DRAW_DEFAULT_COUNT = 3;
export const SUBAGENT_DRAW_EVALUATOR_PROMPT_MAX_LENGTH = 20_000;
/** One per-draw requirement the parent writes for an auto-count draw. */
export const SUBAGENT_DRAW_VARIANT_MAX_LENGTH = 1_000;
/**
 * Upper bound of child runs (ordinary tasks, draws and evaluators) one
 * `spawn_subagent` call keeps running at the same time.
 */
export const SUBAGENT_CHILD_RUN_MAX_CONCURRENCY = 10;

export const DEFAULT_SUBAGENT_DRAW_EVALUATOR_PROMPT = [
  "你是抽卡评估助手。同一个子任务被独立执行了多次，你要从这些候选结果里选出最适合交给主智能体的一份。",
  "",
  "评估步骤：",
  "1. 先读懂任务：明确硬性要求（字数、格式、视角、必须包含或不得出现的内容）和任务想达到的效果。",
  "2. 排除不合格的候选：偏离任务、遗漏硬性要求、设定或事实前后矛盾、明显没写完的，优先排除。",
  "3. 在剩余候选中比较：任务完成度、内容质量（准确、具体、有新意）、文字表达（通顺、有节奏、风格符合任务要求）。",
  "4. 几份都不理想时，选问题最少、最容易修改的一份，并在理由里写明它的主要缺点。",
  "",
  "理由要具体，指出选中的候选胜在哪里，不要泛泛而谈。"
].join("\n");

export const SubagentDrawSelectionSchema = z.enum(["manual", "auto"]);
export type SubagentDrawSelection = z.infer<typeof SubagentDrawSelectionSchema>;

/**
 * `fixed` draws `count` identical copies of every task. `auto` lets the parent
 * decide per task: one draw for each requirement it lists, up to
 * `SUBAGENT_DRAW_MAX_COUNT`, and a single ordinary run when it lists none.
 */
export const SubagentDrawCountModeSchema = z.enum(["fixed", "auto"]);
export type SubagentDrawCountMode = z.infer<typeof SubagentDrawCountModeSchema>;

export const SubagentDrawEvaluatorSchema = z
  .object({
    /** Absent: `DEFAULT_SUBAGENT_DRAW_EVALUATOR_PROMPT`. */
    prompt: z
      .string()
      .trim()
      .min(1)
      .max(SUBAGENT_DRAW_EVALUATOR_PROMPT_MAX_LENGTH)
      .optional(),
    modelMode: ShortAgentSubagentModelModeSchema.default("inherit"),
    modelId: z
      .string()
      .trim()
      .min(1)
      .max(SHORT_AGENT_SUBAGENT_MODEL_ID_MAX_LENGTH)
      .optional(),
    thinkingLevel: ThinkingLevelSchema.optional(),
    temperature: TemperatureSchema.optional()
  })
  .superRefine((value, context) => validateSubagentCustomModel(value, context));
export type SubagentDrawEvaluator = z.infer<typeof SubagentDrawEvaluatorSchema>;

/**
 * Draw mode: a pure member runs every task several times in the background
 * and only the selected result goes back to the parent. Ignored for
 * `standard` members, whose write tools would apply every draw.
 */
export const SubagentDrawSettingsSchema = z.object({
  enabled: z.boolean(),
  /**
   * Absent means `fixed`, and `fixed` is not stored. A separate field rather
   * than `count: "auto"`, so older clients drop it and draw `count` copies.
   */
  countMode: SubagentDrawCountModeSchema.optional(),
  /** Draws per task in `fixed` mode; kept but unused in `auto` mode. */
  count: z
    .number()
    .int()
    .min(SUBAGENT_DRAW_MIN_COUNT)
    .max(SUBAGENT_DRAW_MAX_COUNT)
    .default(SUBAGENT_DRAW_DEFAULT_COUNT),
  selection: SubagentDrawSelectionSchema.default("manual"),
  evaluator: SubagentDrawEvaluatorSchema.default({ modelMode: "inherit" })
});
export type SubagentDrawSettings = z.infer<typeof SubagentDrawSettingsSchema>;

/** The draw settings that take effect: enabled on a pure member. */
export function activeSubagentDraw(definition: {
  agentMode?: SubagentAgentMode | undefined;
  draw?: SubagentDrawSettings | undefined;
}): SubagentDrawSettings | undefined {
  const pure = (definition.agentMode ?? "standard") !== "standard";
  return pure && definition.draw?.enabled ? definition.draw : undefined;
}

/**
 * Model config ids a team needs resolved before a run: members with their own
 * model and the custom evaluators of their active auto draws.
 */
export function subagentCustomModelIds(
  definitions: readonly {
    modelMode: ShortAgentSubagentModelMode;
    modelId?: string | undefined;
    agentMode?: SubagentAgentMode | undefined;
    draw?: SubagentDrawSettings | undefined;
  }[]
): string[] {
  const ids = new Set<string>();
  for (const definition of definitions) {
    if (definition.modelMode === "custom" && definition.modelId) {
      ids.add(definition.modelId);
    }
    const draw = activeSubagentDraw(definition);
    if (
      draw?.selection === "auto" &&
      draw.evaluator.modelMode === "custom" &&
      draw.evaluator.modelId
    ) {
      ids.add(draw.evaluator.modelId);
    }
  }
  return [...ids];
}
