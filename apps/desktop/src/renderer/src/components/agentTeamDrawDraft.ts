import {
  DEFAULT_SUBAGENT_DRAW_EVALUATOR_PROMPT,
  SUBAGENT_DRAW_DEFAULT_COUNT,
  type SubagentDrawEvaluator,
  type SubagentDrawSettings
} from "@deepwrite/contracts/renderer";

export function newSubagentDraw(): SubagentDrawSettings {
  return {
    enabled: true,
    count: SUBAGENT_DRAW_DEFAULT_COUNT,
    selection: "manual",
    evaluator: { modelMode: "inherit" }
  };
}

/** Drafts edit draw settings in place, so they never share saved objects. */
export function cloneSubagentDraw(
  draw: SubagentDrawSettings | undefined
): SubagentDrawSettings | undefined {
  return draw ? { ...draw, evaluator: { ...draw.evaluator } } : undefined;
}

function savedEvaluator(
  evaluator: SubagentDrawEvaluator
): SubagentDrawEvaluator {
  const prompt = evaluator.prompt?.trim();
  const customPrompt =
    prompt && prompt !== DEFAULT_SUBAGENT_DRAW_EVALUATOR_PROMPT
      ? { prompt }
      : {};
  const modelId = evaluator.modelId?.trim();
  if (evaluator.modelMode !== "custom" || !modelId) {
    return { ...customPrompt, modelMode: "inherit" };
  }
  return {
    ...customPrompt,
    modelMode: "custom",
    modelId,
    ...(evaluator.thinkingLevel !== undefined
      ? { thinkingLevel: evaluator.thinkingLevel }
      : {}),
    ...(evaluator.thinkingLevel === "off" && evaluator.temperature !== undefined
      ? { temperature: evaluator.temperature }
      : {})
  };
}

/**
 * The persisted form: an untouched default prompt is not stored, and a
 * switched-off draw with default settings is dropped altogether, so turning
 * the switch on and off again leaves no trace and no unsaved change.
 */
export function savedSubagentDraw(
  draw: SubagentDrawSettings | undefined
): SubagentDrawSettings | undefined {
  if (!draw) return undefined;
  const saved: SubagentDrawSettings = {
    enabled: draw.enabled,
    // `fixed` is the default and is not stored.
    ...(draw.countMode === "auto" ? { countMode: "auto" as const } : {}),
    count: draw.count,
    selection: draw.selection,
    evaluator: savedEvaluator(draw.evaluator)
  };
  const untouched =
    !saved.enabled &&
    saved.countMode === undefined &&
    saved.count === SUBAGENT_DRAW_DEFAULT_COUNT &&
    saved.selection === "manual" &&
    saved.evaluator.modelMode === "inherit" &&
    saved.evaluator.prompt === undefined;
  return untouched ? undefined : saved;
}

/** Spread helpers for the team panels' draft copy and save mapping. */
export function clonedDrawField(draw: SubagentDrawSettings | undefined): {
  draw?: SubagentDrawSettings;
} {
  const cloned = cloneSubagentDraw(draw);
  return cloned ? { draw: cloned } : {};
}

export function savedDrawField(draw: SubagentDrawSettings | undefined): {
  draw?: SubagentDrawSettings;
} {
  const saved = savedSubagentDraw(draw);
  return saved ? { draw: saved } : {};
}
