import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";

export const LEARNING_IMITATION_STAGE_IDS = [
  "material_split",
  "plot_learning",
  "style_learning"
] as const;

export const LearningImitationStageIdSchema = z.enum(
  LEARNING_IMITATION_STAGE_IDS
);
export type LearningImitationStageId = z.infer<
  typeof LearningImitationStageIdSchema
>;

export const LEARNING_IMITATION_STAGE_LABELS = {
  material_split: "素材拆分",
  plot_learning: "剧情设计学习",
  style_learning: "文风学习"
} as const satisfies Record<LearningImitationStageId, string>;

export const LEARNING_IMITATION_STAGE_DESCRIPTIONS = {
  material_split: "拆出人设、梗、剧情结构、导语、剧情细化与优秀正文片段。",
  plot_learning: "沉淀可复用的剧情设计与剧情细化技能。",
  style_learning: "提炼可直接交给分节写手执行的文风技能。"
} as const satisfies Record<LearningImitationStageId, string>;

export const LEARNING_IMITATION_MIN_DOCUMENTS = 1;
export const LEARNING_IMITATION_MAX_DOCUMENTS = 5;
// Samples are read lazily in 12k chunks by tools, so they do not consume the
// provider context window all at once. Keep full novel-sized documents instead
// of inheriting the ordinary chat attachment's 100k preview limit.
export const LEARNING_IMITATION_DOCUMENT_MAX_CHARACTERS = 10_000_000;
export const LEARNING_IMITATION_DOCUMENTS_MAX_CHARACTERS = 50_000_000;
export const LEARNING_IMITATION_RESULT_FIELD_MAX_CHARACTERS = 200_000;
export const LEARNING_IMITATION_PROMPT_MAX_CHARACTERS = 500_000;

const LearningResultTextSchema = z
  .string()
  .max(LEARNING_IMITATION_RESULT_FIELD_MAX_CHARACTERS);

export const LearningImitationDocumentSchema = z.object({
  id: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(240),
  extension: z.string().max(24),
  mediaType: z.string().trim().min(1).max(120),
  size: z.number().int().nonnegative().max(25 * 1024 * 1024),
  text: z.string().trim().min(1).max(LEARNING_IMITATION_DOCUMENT_MAX_CHARACTERS),
  charCount: z.number().int().positive().max(50_000_000),
  truncated: z.boolean().optional(),
  originalLength: z.number().int().positive().max(50_000_000).optional()
}).superRefine((value, context) => {
  if (
    value.truncated === true &&
    (value.originalLength === undefined || value.originalLength <= value.text.length)
  ) {
    context.addIssue({
      code: "custom",
      path: ["originalLength"],
      message: "A truncated learning document must report its original length."
    });
  }
});
export type LearningImitationDocument = z.infer<
  typeof LearningImitationDocumentSchema
>;

export const LearningImitationDocumentsSchema = z
  .array(LearningImitationDocumentSchema)
  .min(LEARNING_IMITATION_MIN_DOCUMENTS)
  .max(LEARNING_IMITATION_MAX_DOCUMENTS)
  .superRefine((documents, context) => {
    const ids = new Set<string>();
    let textLength = 0;
    documents.forEach((document, index) => {
      if (ids.has(document.id)) {
        context.addIssue({
          code: "custom",
          path: [index, "id"],
          message: "Learning document ids must be unique."
        });
      }
      ids.add(document.id);
      textLength += document.text.length;
    });
    if (textLength > LEARNING_IMITATION_DOCUMENTS_MAX_CHARACTERS) {
      context.addIssue({
        code: "custom",
        message: "Learning documents exceed the total extracted-content limit."
      });
    }
  });

export const LearningMaterialSplitResultSchema = z.object({
  gimmick: LearningResultTextSchema,
  character: LearningResultTextSchema,
  pacing: LearningResultTextSchema,
  intro: LearningResultTextSchema,
  plot_refine: LearningResultTextSchema,
  draft_excerpt: LearningResultTextSchema
});
export type LearningMaterialSplitResult = z.infer<
  typeof LearningMaterialSplitResultSchema
>;

export const LEARNING_MATERIAL_STAGE_IDS = [
  "gimmick",
  "character",
  "pacing",
  "intro",
  "plot_refine",
  "draft_excerpt"
] as const;
export type LearningMaterialStageId = typeof LEARNING_MATERIAL_STAGE_IDS[number];

export const LEARNING_MATERIAL_STAGE_LABELS = {
  gimmick: "梗",
  character: "人设",
  pacing: "剧情设计",
  intro: "导语设计",
  plot_refine: "剧情细化",
  draft_excerpt: "优秀正文片段"
} as const satisfies Record<LearningMaterialStageId, string>;

export const LearningPlotResultSchema = z.object({
  plotDesignSkill: LearningResultTextSchema,
  plotRefineSkill: LearningResultTextSchema
});
export type LearningPlotResult = z.infer<typeof LearningPlotResultSchema>;

export const LearningStyleResultSchema = z.object({
  title: z.string().max(256),
  body: LearningResultTextSchema
});
export type LearningStyleResult = z.infer<typeof LearningStyleResultSchema>;

export const LearningImitationResultSchema = z.object({
  material_split: LearningMaterialSplitResultSchema,
  plot_learning: LearningPlotResultSchema,
  style_learning: LearningStyleResultSchema
});
export type LearningImitationResult = z.infer<
  typeof LearningImitationResultSchema
>;

export const EMPTY_LEARNING_IMITATION_RESULT: LearningImitationResult = {
  material_split: {
    gimmick: "",
    character: "",
    pacing: "",
    intro: "",
    plot_refine: "",
    draft_excerpt: ""
  },
  plot_learning: {
    plotDesignSkill: "",
    plotRefineSkill: ""
  },
  style_learning: {
    title: "分节写手技能",
    body: ""
  }
};

export function cloneEmptyLearningImitationResult(): LearningImitationResult {
  return structuredClone(EMPTY_LEARNING_IMITATION_RESULT);
}

export const LearningImitationWritePayloadSchema = z.object({
  mode: z.enum(["replace", "append"]).optional(),
  gimmick: LearningResultTextSchema.optional(),
  character: LearningResultTextSchema.optional(),
  pacing: LearningResultTextSchema.optional(),
  intro: LearningResultTextSchema.optional(),
  plot_refine: LearningResultTextSchema.optional(),
  draft_excerpt: LearningResultTextSchema.optional(),
  plot_design_skill: LearningResultTextSchema.optional(),
  plot_refine_skill: LearningResultTextSchema.optional(),
  style_skill_title: z.string().max(256).optional(),
  style_skill_body: LearningResultTextSchema.optional()
}).superRefine((value, context) => {
  const hasOutput = Object.entries(value).some(
    ([key, item]) => key !== "mode" && typeof item === "string" && item.trim().length > 0
  );
  if (!hasOutput) {
    context.addIssue({
      code: "custom",
      message: "A learning result update must include at least one non-empty field."
    });
  }
});
export type LearningImitationWritePayload = z.infer<
  typeof LearningImitationWritePayloadSchema
>;

export const LearningImitationRuntimeContextSchema = z.object({
  stageId: LearningImitationStageIdSchema,
  documents: LearningImitationDocumentsSchema,
  result: LearningImitationResultSchema
});
export type LearningImitationRuntimeContext = z.infer<
  typeof LearningImitationRuntimeContextSchema
>;

export const LearningImitationPromptInputSchema = z.object({
  id: LearningImitationStageIdSchema,
  systemPrompt: z
    .string()
    .min(1)
    .max(LEARNING_IMITATION_PROMPT_MAX_CHARACTERS)
});
export type LearningImitationPromptInput = z.infer<
  typeof LearningImitationPromptInputSchema
>;

function validatePromptSet(
  prompts: readonly { id: LearningImitationStageId }[],
  context: z.core.$RefinementCtx<unknown>
): void {
  const ids = prompts.map((prompt) => prompt.id);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", message: "Learning prompt ids must be unique." });
  }
  for (const id of LEARNING_IMITATION_STAGE_IDS) {
    if (!ids.includes(id)) {
      context.addIssue({
        code: "custom",
        message: `Learning prompt settings are missing ${id}.`
      });
    }
  }
}

export const LearningImitationSettingsInputSchema = z.object({
  prompts: z.array(LearningImitationPromptInputSchema).length(
    LEARNING_IMITATION_STAGE_IDS.length
  )
}).superRefine((value, context) => validatePromptSet(value.prompts, context));
export type LearningImitationSettingsInput = z.infer<
  typeof LearningImitationSettingsInputSchema
>;

export const LearningImitationPromptProfileSchema =
  LearningImitationPromptInputSchema.extend({
    label: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(500),
    customized: z.boolean()
  });
export type LearningImitationPromptProfile = z.infer<
  typeof LearningImitationPromptProfileSchema
>;

export const LearningImitationSettingsSchema = z.object({
  prompts: z.array(LearningImitationPromptProfileSchema).length(
    LEARNING_IMITATION_STAGE_IDS.length
  ),
  updatedAt: z.string().datetime().optional()
}).superRefine((value, context) => validatePromptSet(value.prompts, context));
export type LearningImitationSettings = z.infer<
  typeof LearningImitationSettingsSchema
>;

export const LearningImitationAgentProfileSchema = z.object({
  id: LearningImitationStageIdSchema,
  label: z.string().trim().min(1).max(80),
  systemPrompt: z
    .string()
    .min(1)
    .max(LEARNING_IMITATION_PROMPT_MAX_CHARACTERS)
});
export type LearningImitationAgentProfile = z.infer<
  typeof LearningImitationAgentProfileSchema
>;

export const LearningImitationSettingsListCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("learningImitationSettings.list"),
    payload: z.object({})
  });

export const LearningImitationSettingsSaveCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("learningImitationSettings.save"),
    payload: LearningImitationSettingsInputSchema
  });

export const LearningImitationSettingsResetCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("learningImitationSettings.reset"),
    payload: z.object({ stageId: LearningImitationStageIdSchema.optional() })
  });

function appendLearningText(current: string, addition: string | undefined): string {
  const next = addition?.trim() ?? "";
  if (!next) return current;
  const base = current.trim();
  return base ? `${base}\n\n${next}` : next;
}

function mergeLearningText(
  current: string,
  incoming: string | undefined,
  mode: "replace" | "append"
): string {
  const next = incoming?.trim() ?? "";
  if (!next) return current;
  return mode === "append" ? appendLearningText(current, next) : next;
}

export function applyLearningImitationWrite(
  current: LearningImitationResult,
  stageId: LearningImitationStageId,
  rawPayload: LearningImitationWritePayload
): LearningImitationResult {
  const payload = LearningImitationWritePayloadSchema.parse(rawPayload);
  const mode = payload.mode === "append" ? "append" : "replace";
  const next = structuredClone(current);
  if (stageId === "material_split") {
    for (const key of LEARNING_MATERIAL_STAGE_IDS) {
      next.material_split[key] = mergeLearningText(
        next.material_split[key],
        payload[key],
        mode
      );
    }
  } else if (stageId === "plot_learning") {
    next.plot_learning.plotDesignSkill = mergeLearningText(
      next.plot_learning.plotDesignSkill,
      payload.plot_design_skill,
      mode
    );
    next.plot_learning.plotRefineSkill = mergeLearningText(
      next.plot_learning.plotRefineSkill,
      payload.plot_refine_skill,
      mode
    );
  } else {
    const title = payload.style_skill_title?.trim();
    if (title) next.style_learning.title = title;
    next.style_learning.body = mergeLearningText(
      next.style_learning.body,
      payload.style_skill_body,
      mode
    );
  }
  return LearningImitationResultSchema.parse(next);
}

export function learningImitationStageHasResult(
  stageId: LearningImitationStageId,
  result: LearningImitationResult
): boolean {
  if (stageId === "material_split") {
    return LEARNING_MATERIAL_STAGE_IDS.some(
      (key) => result.material_split[key].trim().length > 0
    );
  }
  if (stageId === "plot_learning") {
    return Boolean(
      result.plot_learning.plotDesignSkill.trim() ||
      result.plot_learning.plotRefineSkill.trim()
    );
  }
  return Boolean(result.style_learning.body.trim());
}

export function summarizeLearningImitationDocuments(
  documents: readonly LearningImitationDocument[]
): string {
  return documents.map((document, index) => {
    const firstLine = document.text
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find(Boolean);
    const preview = firstLine ? `；开头：${firstLine.slice(0, 80)}` : "";
    const chunks = Math.max(1, Math.ceil(document.text.length / 12_000));
    return `${index + 1}. ${document.name}（${document.extension || "文本"}，${document.charCount} 字，${chunks} 段）${preview}`;
  }).join("\n");
}

export function formatLearningImitationCurrentResult(
  stageId: LearningImitationStageId,
  result: LearningImitationResult
): string {
  if (stageId === "material_split") {
    return LEARNING_MATERIAL_STAGE_IDS.map((key) => {
      const body = result.material_split[key].trim();
      return body ? `## ${LEARNING_MATERIAL_STAGE_LABELS[key]}\n\n${body}` : "";
    }).filter(Boolean).join("\n\n");
  }
  if (stageId === "plot_learning") {
    return ([
      ["剧情设计技能", result.plot_learning.plotDesignSkill],
      ["剧情细化技能", result.plot_learning.plotRefineSkill]
    ] as Array<[string, string]>).filter(([, body]) => body.trim()).map(
      ([label, body]) => `## ${label}\n\n${body.trim()}`
    ).join("\n\n");
  }
  return [
    `## ${result.style_learning.title || "分节写手技能"}`,
    result.style_learning.body
  ].join("\n\n").trim();
}

export function renderLearningImitationSystemPrompt(
  template: string,
  context: LearningImitationRuntimeContext
): string {
  const replacements: Record<string, string> = {
    STAGE_ID: context.stageId,
    STAGE_LABEL: LEARNING_IMITATION_STAGE_LABELS[context.stageId],
    DOCUMENT_COUNT: String(context.documents.length),
    DOCUMENTS_SUMMARY:
      summarizeLearningImitationDocuments(context.documents) ||
      "（尚未上传可分析文档）",
    CURRENT_RESULT:
      formatLearningImitationCurrentResult(context.stageId, context.result) ||
      "（当前阶段暂未生成结果）"
  };
  return template.replace(
    /\{\{\s*(STAGE_ID|STAGE_LABEL|DOCUMENT_COUNT|DOCUMENTS_SUMMARY|CURRENT_RESULT)\s*\}\}/gu,
    (_match, key: string) => replacements[key] ?? ""
  );
}
