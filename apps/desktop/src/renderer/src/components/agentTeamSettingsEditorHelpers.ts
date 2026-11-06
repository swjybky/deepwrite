import { createScopedTranslator } from "../i18n";
import {
  BUILT_IN_REASONING_LEVELS,
  activeSubagentDraw,
  isJevModel,
  resolveDrawEvaluationMethod,
  type BuiltInReasoningLevel,
  type ModelConfig,
  type ShortAgentSubagentDefinition,
  type SubagentWebSearchMode,
  type ThinkingLevel
} from "@deepwrite/contracts";
import { cloneSubagentDraw, savedSubagentDraw } from "./agentTeamDrawDraft";
import { BUILT_IN_THINKING_LABELS } from "./agentTeamSettingsMeta";

const t = createScopedTranslator("components.agentTeamSettingsEditorHelpers");

interface DraftTeamLike {
  parentAgentId: string;
  subagents: readonly ShortAgentSubagentDefinition[];
}

/**
 * The persisted form of a member's web search mode: following the main agent
 * is the default and is not stored, so choosing it again leaves no trace.
 */
export function savedWebSearchField(mode: SubagentWebSearchMode | undefined): {
  webSearchMode?: SubagentWebSearchMode;
} {
  return mode === "on" || mode === "off" ? { webSearchMode: mode } : {};
}

export function agentTeamThinkingLabel(level: ThinkingLevel): string {
  if (level === "off") return t("off");
  return BUILT_IN_REASONING_LEVELS.includes(level as BuiltInReasoningLevel)
    ? BUILT_IN_THINKING_LABELS[level as BuiltInReasoningLevel]
    : t("customValue", {
        arg0: level
      });
}

export function agentTeamModelDefaults(model: ModelConfig | undefined): {
  thinkingLevel: ThinkingLevel;
  temperature: number;
} {
  return {
    thinkingLevel: model?.defaultThinkingLevel ?? "medium",
    temperature: model?.temperatureOptions[1] ?? 0.7
  };
}

export function nextCopiedSubagentName(
  name: string,
  existingNames: readonly string[],
  maxLength: number
): string {
  const trimmed = name.trim() || t("untitledSubagent");
  const existing = new Set(
    existingNames.map((item) => item.trim().toLocaleLowerCase())
  );
  const numbered = trimmed.match(/^(.*) (\d+)$/);
  const base = numbered?.[1]?.trim() || trimmed;
  let index = numbered ? Number(numbered[2]) + 1 : 2;

  for (let attempt = 0; attempt < 10_000; attempt += 1, index += 1) {
    const suffix = ` ${index}`;
    const allowedBaseLength = Math.max(1, maxLength - suffix.length);
    const candidateBase =
      base.length <= allowedBaseLength
        ? base
        : base.slice(0, allowedBaseLength).trimEnd();
    const candidate = `${candidateBase}${suffix}`.slice(0, maxLength);
    if (!existing.has(candidate.toLocaleLowerCase())) {
      return candidate;
    }
  }

  return `${base} ${Date.now()}`.slice(0, maxLength);
}

export function createCopiedSubagent(
  source: ShortAgentSubagentDefinition,
  existing: readonly Pick<ShortAgentSubagentDefinition, "name">[],
  nextId: string,
  maxNameLength: number
): ShortAgentSubagentDefinition {
  const draw = cloneSubagentDraw(source.draw);
  return {
    ...source,
    ...(draw ? { draw } : {}),
    id: nextId,
    name: nextCopiedSubagentName(
      source.name,
      existing.map((item) => item.name),
      maxNameLength
    )
  };
}

/** Shared by members and the evaluators of their auto draws. */
function customModelProblem(
  settings: Pick<
    ShortAgentSubagentDefinition,
    "modelMode" | "modelId" | "thinkingLevel" | "temperature"
  > & { evaluationMethod?: "llm" | "jev" | undefined },
  models: readonly ModelConfig[],
  owner: string,
  options?: { requireJev?: boolean }
): string | null {
  const requireJev = options?.requireJev === true;
  if (!requireJev && settings.modelMode !== "custom") return null;
  if (!settings.modelId?.trim()) {
    return requireJev
      ? t("selectAJevModelForEvaluation")
      : t("selectAModelForASeparateConfiguration");
  }
  const model = models.find((candidate) => candidate.id === settings.modelId);
  if (!model) {
    return t("theModelSelectedForSubagentValueNoLongerExists", {
      arg0: owner
    });
  }
  if (requireJev) {
    if (!isJevModel(model)) {
      return t("jevEvaluationRequiresAJevModel", { arg0: owner });
    }
    return null;
  }
  if (isJevModel(model)) {
    return t("textGenerationCannotUseAJevModel", { arg0: owner });
  }
  if (settings.thinkingLevel === undefined) {
    return t("selectAReasoningLevelForASeparateConfiguration");
  }
  if (
    settings.thinkingLevel !== "off" &&
    !model.thinkingLevelOptions.includes(settings.thinkingLevel)
  ) {
    return t("theReasoningLevelForSubagentValueIsNotAvailable", {
      arg0: owner
    });
  }
  if (settings.thinkingLevel !== "off") return null;
  if (settings.temperature === undefined) {
    return t("selectATemperatureWhenReasoningIsOff");
  }
  if (!model.temperatureOptions.includes(settings.temperature)) {
    return t("theTemperatureForSubagentValueIsNotAvailableIn", {
      arg0: owner
    });
  }
  return null;
}

export function validateAgentTeamDraft(
  teams: readonly Pick<DraftTeamLike, "subagents">[],
  models: readonly ModelConfig[]
): string | null {
  for (const team of teams) {
    const ids = new Set<string>();
    const names = new Set<string>();
    for (const subagent of team.subagents) {
      if (!subagent.name.trim()) return t("subagentNameIsRequired");
      if (!subagent.description.trim())
        return t("subagentCapabilitiesAreRequired");
      if (!subagent.systemPrompt.trim())
        return t("subagentSystemPromptIsRequired");
      const owner = subagent.name.trim() || t("untitled");
      const modelProblem = customModelProblem(subagent, models, owner);
      if (modelProblem) return modelProblem;
      const draw = activeSubagentDraw(subagent);
      if (draw?.selection === "auto") {
        const evaluatorProblem = customModelProblem(
          draw.evaluator,
          models,
          t("evaluatorOfValue", { arg0: owner }),
          {
            requireJev: resolveDrawEvaluationMethod(draw.evaluator) === "jev"
          }
        );
        if (evaluatorProblem) return evaluatorProblem;
      }
      const id = subagent.id.toLocaleLowerCase();
      const name = subagent.name.trim().toLocaleLowerCase();
      if (ids.has(id)) return t("subagentIDsMustBeUniqueWithinAPrimaryAgent");
      if (names.has(name))
        return t("subagentNamesMustBeUniqueWithinAPrimaryAgent");
      ids.add(id);
      names.add(name);
    }
  }
  return null;
}

/**
 * Stable signature of the editable team draft. Only fields that are persisted
 * take part, so toggling a model mode back and forth does not mark it dirty.
 */
export function agentTeamDraftSignature(
  parallelSubagents: boolean,
  teams: readonly DraftTeamLike[]
): string {
  return JSON.stringify([
    parallelSubagents,
    teams.map((team) => [
      team.parentAgentId,
      team.subagents.map((subagent) => {
        const custom = subagent.modelMode === "custom";
        return [
          subagent.id,
          subagent.name,
          subagent.description,
          subagent.systemPrompt,
          subagent.enabled,
          subagent.agentMode ?? "standard",
          savedWebSearchField(subagent.webSearchMode).webSearchMode ?? null,
          custom ? "custom" : "inherit",
          custom ? (subagent.modelId ?? null) : null,
          custom ? (subagent.thinkingLevel ?? null) : null,
          custom && subagent.thinkingLevel === "off"
            ? (subagent.temperature ?? null)
            : null,
          savedSubagentDraw(subagent.draw) ?? null
        ];
      })
    ])
  ]);
}
