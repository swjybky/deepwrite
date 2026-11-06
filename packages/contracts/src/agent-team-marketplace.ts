import { z } from "zod";
import {
  AgentTeamSettingsSchema,
  ScriptAgentTeamSettingsSchema,
  type ShortAgentSubagentDefinition,
  type SubagentDrawEvaluator
} from "./agent-team";
import {
  AGENT_TEAM_PROFILE_NAME_MAX_LENGTH,
  AgentTeamCatalogSnapshotSchema,
  AgentTeamProfileIdSchema,
  AgentTeamProfileNameSchema,
  AgentTeamWorkspaceTypeSchema,
  type AgentTeamProfile
} from "./agent-team-catalog";
import { LongAgentTeamSettingsSchema } from "./long-agent-team";
import {
  MarketplaceLikeResultSchema,
  MarketplaceStatusSchema
} from "./marketplace";

/**
 * The agent team plaza publishes and installs whole teams only. Login and
 * sessions are shared with the skill marketplace (`marketplace` API).
 */
export const AGENT_TEAM_MARKETPLACE_IPC_CHANNEL =
  "deepwrite:agent-team-marketplace" as const;
/** Server limit on the compact team JSON; checked before uploading. */
export const AGENT_TEAM_MARKETPLACE_TEAM_MAX_BYTES = 1024 * 1024;
export const AGENT_TEAM_MARKETPLACE_OVERVIEW_MAX_LENGTH = 2_000;

const RemoteTeamIdSchema = z.string().trim().min(1).max(512);
const TimestampSchema = z.string().datetime();

export const AgentTeamMarketplaceSettingsSchema = z.discriminatedUnion(
  "workspaceType",
  [
    AgentTeamSettingsSchema,
    ScriptAgentTeamSettingsSchema,
    LongAgentTeamSettingsSchema
  ]
);
export type AgentTeamMarketplaceSettings = z.infer<
  typeof AgentTeamMarketplaceSettingsSchema
>;

export const AgentTeamMarketplaceSortSchema = z.enum([
  "latest",
  "popular",
  "downloads",
  "likes"
]);
export type AgentTeamMarketplaceSort = z.infer<
  typeof AgentTeamMarketplaceSortSchema
>;

export const AgentTeamMarketplaceListFilterSchema = z
  .object({
    query: z.string().trim().max(256).optional(),
    workspaceType: AgentTeamWorkspaceTypeSchema.optional(),
    status: MarketplaceStatusSchema.optional(),
    sort: AgentTeamMarketplaceSortSchema.optional(),
    page: z.number().int().min(1).max(1_000_000).optional(),
    pageSize: z.number().int().min(1).max(200).optional()
  })
  .strict();
export type AgentTeamMarketplaceListFilter = z.infer<
  typeof AgentTeamMarketplaceListFilterSchema
>;

export const AgentTeamMarketplaceSummarySchema = z
  .object({
    id: RemoteTeamIdSchema,
    ownerUserId: RemoteTeamIdSchema.optional(),
    title: z.string().trim().min(1).max(256),
    overview: z.string(),
    workspaceType: AgentTeamWorkspaceTypeSchema,
    memberCount: z.number().int().nonnegative(),
    version: z.number().int().positive(),
    visibility: z.enum(["private", "unlisted", "public"]),
    status: MarketplaceStatusSchema,
    enabled: z.boolean(),
    downloadCount: z.number().int().nonnegative(),
    likeCount: z.number().int().nonnegative(),
    likedByMe: z.boolean(),
    ownerUsername: z.string(),
    ownerName: z.string(),
    publishedAt: TimestampSchema.optional(),
    deletedAt: TimestampSchema.optional(),
    purgeAt: TimestampSchema.optional(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema
  })
  .strict();
export type AgentTeamMarketplaceSummary = z.infer<
  typeof AgentTeamMarketplaceSummarySchema
>;

export const AgentTeamMarketplacePageSchema = z
  .object({
    items: z.array(AgentTeamMarketplaceSummarySchema).max(200),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(200),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative()
  })
  .strict();
export type AgentTeamMarketplacePage = z.infer<
  typeof AgentTeamMarketplacePageSchema
>;

export const AgentTeamMarketplaceDetailSchema =
  AgentTeamMarketplaceSummarySchema.extend({
    team: AgentTeamMarketplaceSettingsSchema
  })
    .strict()
    .refine((value) => value.team.workspaceType === value.workspaceType, {
      path: ["team", "workspaceType"],
      message: "团队配置类型与广场记录不一致。"
    });
export type AgentTeamMarketplaceDetail = z.infer<
  typeof AgentTeamMarketplaceDetailSchema
>;

const AgentTeamMarketplaceTargetSchema = z
  .object({ id: RemoteTeamIdSchema })
  .strict();
export type AgentTeamMarketplaceTarget = z.infer<
  typeof AgentTeamMarketplaceTargetSchema
>;

/** The Renderer names a local team; Main reads its settings from the store. */
export const AgentTeamMarketplacePublishInputSchema = z
  .object({
    teamId: AgentTeamProfileIdSchema,
    title: z.string().trim().min(1).max(AGENT_TEAM_PROFILE_NAME_MAX_LENGTH),
    overview: z.string().trim().max(AGENT_TEAM_MARKETPLACE_OVERVIEW_MAX_LENGTH)
  })
  .strict();
export type AgentTeamMarketplacePublishInput = z.infer<
  typeof AgentTeamMarketplacePublishInputSchema
>;

export const AgentTeamMarketplaceUpdateInputSchema =
  AgentTeamMarketplacePublishInputSchema.extend({
    id: RemoteTeamIdSchema
  }).strict();
export type AgentTeamMarketplaceUpdateInput = z.infer<
  typeof AgentTeamMarketplaceUpdateInputSchema
>;

export const AgentTeamMarketplaceSetEnabledInputSchema =
  AgentTeamMarketplaceTargetSchema.extend({ enabled: z.boolean() }).strict();
export type AgentTeamMarketplaceSetEnabledInput = z.infer<
  typeof AgentTeamMarketplaceSetEnabledInputSchema
>;

export const AgentTeamMarketplaceLikeInputSchema =
  AgentTeamMarketplaceTargetSchema.extend({ liked: z.boolean() }).strict();
export type AgentTeamMarketplaceLikeInput = z.infer<
  typeof AgentTeamMarketplaceLikeInputSchema
>;

export const AgentTeamMarketplaceLikeResultSchema = MarketplaceLikeResultSchema;

export const AgentTeamMarketplaceInstallResultSchema = z
  .object({
    teamId: AgentTeamProfileIdSchema,
    teamName: AgentTeamProfileNameSchema,
    catalog: AgentTeamCatalogSnapshotSchema,
    downloadCounted: z.boolean()
  })
  .strict();
export type AgentTeamMarketplaceInstallResult = z.infer<
  typeof AgentTeamMarketplaceInstallResultSchema
>;

export const AgentTeamMarketplaceIpcRequestSchema = z.discriminatedUnion(
  "operation",
  [
    z
      .object({
        operation: z.literal("list"),
        filter: AgentTeamMarketplaceListFilterSchema
      })
      .strict(),
    z
      .object({
        operation: z.literal("listMine"),
        filter: AgentTeamMarketplaceListFilterSchema
      })
      .strict(),
    z
      .object({
        operation: z.literal("detail"),
        target: AgentTeamMarketplaceTargetSchema
      })
      .strict(),
    z
      .object({
        operation: z.literal("myDetail"),
        target: AgentTeamMarketplaceTargetSchema
      })
      .strict(),
    z
      .object({
        operation: z.literal("publish"),
        input: AgentTeamMarketplacePublishInputSchema
      })
      .strict(),
    z
      .object({
        operation: z.literal("update"),
        input: AgentTeamMarketplaceUpdateInputSchema
      })
      .strict(),
    z
      .object({
        operation: z.literal("setEnabled"),
        input: AgentTeamMarketplaceSetEnabledInputSchema
      })
      .strict(),
    z
      .object({
        operation: z.literal("delete"),
        target: AgentTeamMarketplaceTargetSchema
      })
      .strict(),
    z
      .object({
        operation: z.literal("like"),
        input: AgentTeamMarketplaceLikeInputSchema
      })
      .strict(),
    z
      .object({
        operation: z.literal("install"),
        target: AgentTeamMarketplaceTargetSchema
      })
      .strict()
  ]
);
export type AgentTeamMarketplaceIpcRequest = z.infer<
  typeof AgentTeamMarketplaceIpcRequestSchema
>;

type TeamSettings = AgentTeamProfile["settings"];

function teamMembers(settings: TeamSettings): ShortAgentSubagentDefinition[] {
  return (
    settings.teams as readonly { subagents: ShortAgentSubagentDefinition[] }[]
  ).flatMap((team) => team.subagents);
}

export function agentTeamMemberCount(settings: TeamSettings): number {
  return teamMembers(settings).length;
}

/** Members and draw evaluators bound to a model configured on this machine. */
export function agentTeamCustomModelCount(settings: TeamSettings): number {
  return teamMembers(settings).reduce(
    (count, member) =>
      count +
      (member.modelMode === "custom" ? 1 : 0) +
      (member.draw?.evaluator.modelMode === "custom" ? 1 : 0),
    0
  );
}

function inheritModel(
  settings: ShortAgentSubagentDefinition | SubagentDrawEvaluator
): void {
  if ("evaluationMethod" in settings && settings.evaluationMethod === "jev") {
    delete settings.evaluationMethod;
  }
  if (settings.modelMode !== "custom") return;
  settings.modelMode = "inherit";
  delete settings.modelId;
  delete settings.thinkingLevel;
  delete settings.temperature;
}

/**
 * Model configs exist only on the author's machine, so a shared team follows
 * the installer's parent agent model. Applied on publish and again on install.
 */
export function withInheritedSubagentModels<Settings extends TeamSettings>(
  settings: Settings
): Settings {
  const next = structuredClone(settings);
  for (const member of teamMembers(next)) {
    inheritModel(member);
    if (member.draw) inheritModel(member.draw.evaluator);
  }
  return next;
}
