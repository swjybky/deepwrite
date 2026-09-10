import {
  DEFAULT_MATERIAL_LIBRARY_AGENT_SKILLS,
  DEFAULT_SKILL_LIBRARY_AGENT_SKILLS,
  DEFAULT_MATERIAL_LIBRARY_AGENT_SYSTEM_PROMPT,
  DEFAULT_SKILL_LIBRARY_AGENT_SYSTEM_PROMPT
} from "./library-agent-defaults";
export {
  DEFAULT_MATERIAL_LIBRARY_AGENT_SKILLS,
  DEFAULT_SKILL_LIBRARY_AGENT_SKILLS,
  DEFAULT_MATERIAL_LIBRARY_AGENT_SYSTEM_PROMPT,
  DEFAULT_SKILL_LIBRARY_AGENT_SYSTEM_PROMPT
} from "./library-agent-defaults";
import { z } from "zod";
import {
  LibraryTypeSchema,
  MaterialLibraryKindSchema,
  MaterialStageIdSchema,
  SkillKindSchema,
  SkillStageIdSchema
} from "./catalog";
import { EnvelopeBaseSchema } from "./envelope";

export const LIBRARY_AGENT_SKILL_MAX_CONTENT_LENGTH = 20_000;

export const LIBRARY_AGENT_DOMAINS = ["material", "skill"] as const;
export const LibraryAgentDomainSchema = z.enum(LIBRARY_AGENT_DOMAINS);
export type LibraryAgentDomain = z.infer<typeof LibraryAgentDomainSchema>;

export const LIBRARY_AGENT_MAX_ENTRIES = 128;
/** Hard cap for library-agent overview snapshots and writes. */
export const LIBRARY_AGENT_OVERVIEW_MAX_CHARACTERS = 100_000;
/** Hard cap for library-agent entry snapshots and writes. */
export const LIBRARY_AGENT_ENTRY_MAX_CHARACTERS = 100_000;
export const LIBRARY_AGENT_TOTAL_SNAPSHOT_MAX_CHARACTERS = 320_000;

const LibraryAgentSystemPromptSchema = z
  .string()
  .min(1)
  .max(60_000)
  .refine((value) => value.trim().length > 0, {
    message: "System prompt must contain non-whitespace text."
  });

export const LIBRARY_AGENT_SKILL_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const LIBRARY_AGENT_MAX_SKILLS = 32;

export const LibraryAgentSkillSchema = z.object({
  id: z.string().trim().regex(LIBRARY_AGENT_SKILL_ID_PATTERN),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500),
  content: z
    .string()
    .trim()
    .min(1)
    .max(LIBRARY_AGENT_SKILL_MAX_CONTENT_LENGTH)
    .refine((value) => value.trim().length > 0, {
      message: "Skill content must contain non-whitespace text."
    })
});
export type LibraryAgentSkill = z.infer<typeof LibraryAgentSkillSchema>;

const UniqueLibraryAgentSkillsSchema = z
  .array(LibraryAgentSkillSchema)
  .min(1)
  .max(LIBRARY_AGENT_MAX_SKILLS)
  .superRefine((values, context) => {
    const ids = values.map((value) => value.id);
    const names = values.map((value) => value.name);
    values.forEach((value, index) => {
      if (ids.indexOf(value.id) !== index) {
        context.addIssue({
          code: "custom",
          path: [index, "id"],
          message: `Duplicate library agent skill id: ${value.id}`
        });
      }
      if (names.indexOf(value.name) !== index) {
        context.addIssue({
          code: "custom",
          path: [index, "name"],
          message: `Duplicate library agent skill name: ${value.name}`
        });
      }
    });
  });

export const LibraryAgentReadAccessSchema = z.object({
  skills: UniqueLibraryAgentSkillsSchema
});
export type LibraryAgentReadAccess = z.infer<
  typeof LibraryAgentReadAccessSchema
>;

/** Configured skills are attached for load_skill; they are not tied to catalog skill libraries. */
export const DEFAULT_LIBRARY_AGENT_READ_ACCESS: Record<
  LibraryAgentDomain,
  LibraryAgentReadAccess
> = {
  material: {
    skills: [...DEFAULT_MATERIAL_LIBRARY_AGENT_SKILLS]
  },
  skill: {
    skills: [...DEFAULT_SKILL_LIBRARY_AGENT_SKILLS]
  }
};

export const LibraryAgentProfileSchema = z.object({
  domain: LibraryAgentDomainSchema,
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(1_000),
  systemPrompt: LibraryAgentSystemPromptSchema,
  readAccess: LibraryAgentReadAccessSchema
});
export type LibraryAgentProfile = z.infer<typeof LibraryAgentProfileSchema>;

export const DEFAULT_LIBRARY_AGENT_PROFILES: readonly LibraryAgentProfile[] = [
  {
    domain: "material",
    label: "素材库管理智能体",
    description:
      "创建、修改、检索和整理当前素材库，维护条目名称、使用说明与库介绍。",
    systemPrompt: DEFAULT_MATERIAL_LIBRARY_AGENT_SYSTEM_PROMPT,
    readAccess: {
      skills: [...DEFAULT_LIBRARY_AGENT_READ_ACCESS.material.skills]
    }
  },
  {
    domain: "skill",
    label: "技能库管理智能体",
    description:
      "创建、修改和管理可复用写作技能，维护方法步骤、使用说明与技能库索引。",
    systemPrompt: DEFAULT_SKILL_LIBRARY_AGENT_SYSTEM_PROMPT,
    readAccess: {
      skills: [...DEFAULT_LIBRARY_AGENT_READ_ACCESS.skill.skills]
    }
  }
];

function validateCompleteLibraryAgentSet(
  agents: readonly { domain: LibraryAgentDomain }[],
  context: z.core.$RefinementCtx<unknown>
): void {
  const domains = agents.map((agent) => agent.domain);
  domains.forEach((domain, index) => {
    if (domains.indexOf(domain) !== index) {
      context.addIssue({
        code: "custom",
        path: ["agents", index, "domain"],
        message: `Duplicate library agent profile: ${domain}`
      });
    }
  });
  for (const domain of LIBRARY_AGENT_DOMAINS) {
    if (!domains.includes(domain)) {
      context.addIssue({
        code: "custom",
        path: ["agents"],
        message: `Missing library agent profile: ${domain}`
      });
    }
  }
}

export const LibraryAgentSettingsSchema = z
  .object({
    agents: z
      .array(LibraryAgentProfileSchema)
      .length(LIBRARY_AGENT_DOMAINS.length)
  })
  .superRefine((value, context) =>
    validateCompleteLibraryAgentSet(value.agents, context)
  );
export type LibraryAgentSettings = z.infer<typeof LibraryAgentSettingsSchema>;

export const LibraryAgentSettingsInputAgentSchema = z.object({
  domain: LibraryAgentDomainSchema,
  systemPrompt: LibraryAgentSystemPromptSchema,
  readAccess: LibraryAgentReadAccessSchema
});
export const LibraryAgentSettingsInputSchema = z
  .object({
    agents: z
      .array(LibraryAgentSettingsInputAgentSchema)
      .length(LIBRARY_AGENT_DOMAINS.length)
  })
  .superRefine((value, context) =>
    validateCompleteLibraryAgentSet(value.agents, context)
  );
export type LibraryAgentSettingsInput = z.infer<
  typeof LibraryAgentSettingsInputSchema
>;

export const DEFAULT_LIBRARY_AGENT_SETTINGS: LibraryAgentSettings = {
  agents: [...DEFAULT_LIBRARY_AGENT_PROFILES]
};

const LibraryAgentEntrySnapshotBaseSchema = z
  .object({
    id: z.string().trim().min(1).max(512),
    documentId: z.string().trim().min(1).max(4_096),
    title: z.string().trim().min(1).max(256),
    content: z.string().max(LIBRARY_AGENT_ENTRY_MAX_CHARACTERS),
    revision: z.string().regex(/^v1:\d+:[0-9a-f]{8}$/),
    readOnly: z.boolean(),
    /** Owning library when the entry comes from a peer member of the same group. */
    sourceLibraryId: z.string().trim().min(1).max(512).optional(),
    sourceLibraryTitle: z.string().trim().min(1).max(256).optional(),
    truncated: z.boolean().optional(),
    originalLength: z
      .number()
      .int()
      .nonnegative()
      .max(32 * 1024 * 1024)
      .optional()
  })
  .superRefine((value, context) => {
    if (
      value.truncated === true &&
      (value.originalLength === undefined ||
        value.originalLength <= value.content.length)
    ) {
      context.addIssue({
        code: "custom",
        path: ["originalLength"],
        message: "A truncated library entry must report its original length."
      });
    }
    if (value.truncated !== true && value.originalLength !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["originalLength"],
        message: "An untruncated library entry must omit originalLength."
      });
    }
    if (
      (value.sourceLibraryId !== undefined) !==
      (value.sourceLibraryTitle !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["sourceLibraryId"],
        message:
          "Peer library entries must include both sourceLibraryId and sourceLibraryTitle."
      });
    }
  });

export const MaterialLibraryAgentEntrySnapshotSchema =
  LibraryAgentEntrySnapshotBaseSchema.extend({
    stageId: MaterialStageIdSchema
  });
export const SkillLibraryAgentEntrySnapshotSchema =
  LibraryAgentEntrySnapshotBaseSchema.extend({
    stageId: SkillStageIdSchema
  });
export type MaterialLibraryAgentEntrySnapshot = z.infer<
  typeof MaterialLibraryAgentEntrySnapshotSchema
>;
export type SkillLibraryAgentEntrySnapshot = z.infer<
  typeof SkillLibraryAgentEntrySnapshotSchema
>;
export type LibraryAgentEntrySnapshot =
  MaterialLibraryAgentEntrySnapshot | SkillLibraryAgentEntrySnapshot;

export const LibraryAgentReadableLibrarySchema = z.object({
  libraryId: z.string().trim().min(1).max(512),
  title: z.string().trim().min(1).max(256),
  kind: z.string().trim().min(1).max(64)
});
export type LibraryAgentReadableLibrary = z.infer<
  typeof LibraryAgentReadableLibrarySchema
>;

const LibraryAgentWorkspaceBaseSchema = z.object({
  libraryId: z.string().trim().min(1).max(512),
  title: z.string().trim().min(1).max(256),
  libraryType: LibraryTypeSchema,
  overviewDocumentId: z.string().trim().min(1).max(4_096),
  overview: z.string().max(LIBRARY_AGENT_OVERVIEW_MAX_CHARACTERS),
  overviewRevision: z.string().regex(/^v1:\d+:[0-9a-f]{8}$/),
  overviewTruncated: z.boolean().optional(),
  overviewOriginalLength: z
    .number()
    .int()
    .nonnegative()
    .max(32 * 1024 * 1024)
    .optional(),
  readOnly: z.boolean(),
  activeEntryId: z.string().trim().min(1).max(512).optional(),
  projectRevision: z.number().int().nonnegative().optional(),
  omittedEntryCount: z.number().int().nonnegative().max(4_096).optional(),
  /** Present when the current library belongs to a material/skill group. */
  groupId: z.string().trim().min(1).max(512).optional(),
  groupTitle: z.string().trim().min(1).max(256).optional(),
  /**
   * Libraries readable in this turn: the current library plus peer members of the
   * same group. Writes still target libraryId only.
   */
  readableLibraries: z
    .array(LibraryAgentReadableLibrarySchema)
    .min(1)
    .max(8)
    .optional()
});

export const LibraryAgentWorkspaceSnapshotSchema = z
  .discriminatedUnion("domain", [
    LibraryAgentWorkspaceBaseSchema.extend({
      domain: z.literal("material"),
      kind: MaterialLibraryKindSchema,
      entries: z
        .array(MaterialLibraryAgentEntrySnapshotSchema)
        .max(LIBRARY_AGENT_MAX_ENTRIES)
    }),
    LibraryAgentWorkspaceBaseSchema.extend({
      domain: z.literal("skill"),
      kind: SkillKindSchema,
      entries: z
        .array(SkillLibraryAgentEntrySnapshotSchema)
        .max(LIBRARY_AGENT_MAX_ENTRIES)
    })
  ])
  .superRefine((value, context) => {
    if (
      value.overviewTruncated === true &&
      (value.overviewOriginalLength === undefined ||
        value.overviewOriginalLength <= value.overview.length)
    ) {
      context.addIssue({
        code: "custom",
        path: ["overviewOriginalLength"],
        message: "A truncated library overview must report its original length."
      });
    }
    if (
      value.overviewTruncated !== true &&
      value.overviewOriginalLength !== undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["overviewOriginalLength"],
        message:
          "An untruncated library overview must omit its original length."
      });
    }
    if ((value.groupId !== undefined) !== (value.groupTitle !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["groupId"],
        message: "A library group must include both groupId and groupTitle."
      });
    }
    const ids = value.entries.map((entry) => entry.id);
    const documentIds = value.entries.map((entry) => entry.documentId);
    ids.forEach((id, index) => {
      if (ids.indexOf(id) !== index) {
        context.addIssue({
          code: "custom",
          path: ["entries", index, "id"],
          message: `Duplicate library entry id: ${id}`
        });
      }
    });
    documentIds.forEach((documentId, index) => {
      if (documentIds.indexOf(documentId) !== index) {
        context.addIssue({
          code: "custom",
          path: ["entries", index, "documentId"],
          message: `Duplicate library entry document id: ${documentId}`
        });
      }
    });
    if (
      value.activeEntryId !== undefined &&
      !ids.includes(value.activeEntryId)
    ) {
      context.addIssue({
        code: "custom",
        path: ["activeEntryId"],
        message: "The active library entry must be present in the snapshot."
      });
    }
    const readableIds = new Set(
      (value.readableLibraries ?? [{ libraryId: value.libraryId }]).map(
        (library) => library.libraryId
      )
    );
    if (!readableIds.has(value.libraryId)) {
      context.addIssue({
        code: "custom",
        path: ["readableLibraries"],
        message: "readableLibraries must include the current libraryId."
      });
    }
    value.entries.forEach((entry, index) => {
      const sourceLibraryId = entry.sourceLibraryId ?? value.libraryId;
      if (!readableIds.has(sourceLibraryId)) {
        context.addIssue({
          code: "custom",
          path: ["entries", index, "sourceLibraryId"],
          message: "Entry sourceLibraryId must be listed in readableLibraries."
        });
      }
      if (sourceLibraryId !== value.libraryId && entry.readOnly !== true) {
        context.addIssue({
          code: "custom",
          path: ["entries", index, "readOnly"],
          message: "Peer group library entries must be read-only."
        });
      }
    });
    const totalCharacters =
      value.overview.length +
      value.entries.reduce((total, entry) => total + entry.content.length, 0);
    if (totalCharacters > LIBRARY_AGENT_TOTAL_SNAPSHOT_MAX_CHARACTERS) {
      context.addIssue({
        code: "custom",
        path: ["entries"],
        message:
          "The library agent snapshot exceeds its total character budget."
      });
    }
  });
export type LibraryAgentWorkspaceSnapshot = z.infer<
  typeof LibraryAgentWorkspaceSnapshotSchema
>;

export const LibraryAgentsListCommandEnvelopeSchema = EnvelopeBaseSchema.extend(
  {
    type: z.literal("libraryAgents.list"),
    payload: z.object({})
  }
);

export const LibraryAgentsSaveCommandEnvelopeSchema = EnvelopeBaseSchema.extend(
  {
    type: z.literal("libraryAgents.save"),
    payload: LibraryAgentSettingsInputSchema
  }
);

export const LibraryAgentsResetCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("libraryAgents.reset"),
    payload: z.object({ domain: LibraryAgentDomainSchema.optional() })
  });

export type LibraryAgentsListCommandEnvelope = z.infer<
  typeof LibraryAgentsListCommandEnvelopeSchema
>;
export type LibraryAgentsSaveCommandEnvelope = z.infer<
  typeof LibraryAgentsSaveCommandEnvelopeSchema
>;
export type LibraryAgentsResetCommandEnvelope = z.infer<
  typeof LibraryAgentsResetCommandEnvelopeSchema
>;
