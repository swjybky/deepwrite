import { MarketplaceEmailSchema } from "./marketplace-email";
export * from "./marketplace-email";
import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";

const MarketplaceIdSchema = z.string().trim().min(1).max(512);
const MarketplaceTitleSchema = z.string().trim().min(1).max(256);
const MarketplaceTimestampSchema = z.string().datetime();

export const MARKETPLACE_CONTENT_MAX_CHARACTERS = 100_000;

export const MARKETPLACE_CONTENT_TYPES = ["group", "library", "skill"] as const;
export const MarketplaceContentTypeSchema = z.enum(MARKETPLACE_CONTENT_TYPES);
export type MarketplaceContentType = z.infer<
  typeof MarketplaceContentTypeSchema
>;

export const MarketplaceContentRefSchema = z
  .object({
    contentType: MarketplaceContentTypeSchema,
    id: MarketplaceIdSchema
  })
  .strict();
export type MarketplaceContentRef = z.infer<typeof MarketplaceContentRefSchema>;

export const MarketplaceStatusSchema = z.enum([
  "draft",
  "pending",
  "published",
  "rejected",
  "archived",
  "deleted"
]);
export type MarketplaceStatus = z.infer<typeof MarketplaceStatusSchema>;

export const MarketplaceSkillKindSchema = z.enum([
  "general",
  "plot",
  "style",
  "other"
]);
export type MarketplaceSkillKind = z.infer<typeof MarketplaceSkillKindSchema>;

export const MarketplaceLibraryTypeSchema = z.enum(["short", "long", "script"]);
export type MarketplaceLibraryType = z.infer<
  typeof MarketplaceLibraryTypeSchema
>;

export const MarketplaceSkillStageSchema = z.enum([
  "character_design",
  "plot_design",
  "outline",
  "draft",
  "expert_section_writer"
]);
export type MarketplaceSkillStage = z.infer<typeof MarketplaceSkillStageSchema>;

export const MarketplaceUserSchema = z
  .object({
    id: MarketplaceIdSchema,
    username: z.string().trim().min(1).max(120),
    email: z.string().email().optional(),
    emailVerifiedAt: MarketplaceTimestampSchema.optional(),
    displayName: z.string().trim().min(1).max(120),
    avatarUrl: z.string(),
    bio: z.string(),
    createdAt: MarketplaceTimestampSchema
  })
  .strict();
export type MarketplaceUser = z.infer<typeof MarketplaceUserSchema>;

export const MarketplaceSessionSchema = z
  .object({
    authenticated: z.boolean(),
    user: MarketplaceUserSchema.optional(),
    expiresAt: MarketplaceTimestampSchema.optional(),
    persistent: z.boolean(),
    insecureTransport: z.boolean()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.authenticated && !value.user) {
      context.addIssue({
        code: "custom",
        path: ["user"],
        message: "Authenticated marketplace sessions require a user."
      });
    }
  });
export type MarketplaceSession = z.infer<typeof MarketplaceSessionSchema>;

export const MarketplaceRegisterInputSchema = z
  .object({
    username: z.string().trim().min(3).max(120),
    password: z.string().min(8).max(128),
    displayName: z.string().trim().max(120).optional(),
    email: MarketplaceEmailSchema,
    emailCode: z
      .string()
      .trim()
      .regex(/^[0-9]{6}$/u)
  })
  .strict();
export type MarketplaceRegisterInput = z.infer<
  typeof MarketplaceRegisterInputSchema
>;

export const MarketplaceLoginInputSchema = z.union([
  z
    .object({
      username: z.string().trim().min(1).max(120),
      password: z.string().min(1).max(128)
    })
    .strict(),
  z
    .object({
      email: MarketplaceEmailSchema,
      password: z.string().min(1).max(128)
    })
    .strict()
]);
export type MarketplaceLoginInput = z.infer<typeof MarketplaceLoginInputSchema>;

export const MarketplaceListFilterSchema = z
  .object({
    query: z.string().trim().max(256).optional(),
    contentType: MarketplaceContentTypeSchema.optional(),
    kind: MarketplaceSkillKindSchema.optional(),
    libraryType: MarketplaceLibraryTypeSchema.optional(),
    status: MarketplaceStatusSchema.optional(),
    sort: z.enum(["latest", "popular", "downloads", "likes"]).optional(),
    page: z.number().int().min(1).max(1_000_000).optional(),
    pageSize: z.number().int().min(1).max(200).optional()
  })
  .strict();
export type MarketplaceListFilter = z.infer<typeof MarketplaceListFilterSchema>;

export const MarketplaceContentSummarySchema = z
  .object({
    contentType: MarketplaceContentTypeSchema,
    id: MarketplaceIdSchema,
    ownerUserId: MarketplaceIdSchema.optional(),
    title: MarketplaceTitleSchema,
    overview: z.string(),
    kind: MarketplaceSkillKindSchema.optional(),
    libraryType: MarketplaceLibraryTypeSchema.optional(),
    stageId: MarketplaceSkillStageSchema.optional(),
    version: z.number().int().positive(),
    coverUrl: z.string(),
    visibility: z.enum(["private", "unlisted", "public"]),
    status: MarketplaceStatusSchema,
    enabled: z.boolean(),
    downloadCount: z.number().int().nonnegative(),
    likeCount: z.number().int().nonnegative(),
    likedByMe: z.boolean(),
    itemCount: z.number().int().nonnegative(),
    ownerUsername: z.string(),
    ownerName: z.string(),
    ownerAvatarUrl: z.string(),
    metadata: z.record(z.string(), z.unknown()),
    publishedAt: MarketplaceTimestampSchema.optional(),
    deletedAt: MarketplaceTimestampSchema.optional(),
    purgeAt: MarketplaceTimestampSchema.optional(),
    createdAt: MarketplaceTimestampSchema,
    updatedAt: MarketplaceTimestampSchema
  })
  .strict();
export type MarketplaceContentSummary = z.infer<
  typeof MarketplaceContentSummarySchema
>;

export const MarketplaceContentPageSchema = z
  .object({
    items: z.array(MarketplaceContentSummarySchema).max(200),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(200),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative()
  })
  .strict();
export type MarketplaceContentPage = z.infer<
  typeof MarketplaceContentPageSchema
>;

const MarketplaceDetailBaseSchema = z.object({
  id: MarketplaceIdSchema,
  ownerUserId: MarketplaceIdSchema.optional(),
  title: MarketplaceTitleSchema,
  overview: z.string(),
  version: z.number().int().positive(),
  coverUrl: z.string(),
  visibility: z.enum(["private", "unlisted", "public"]),
  status: MarketplaceStatusSchema,
  enabled: z.boolean().default(false),
  downloadCount: z.number().int().nonnegative(),
  metadata: z.record(z.string(), z.unknown()),
  publishedAt: MarketplaceTimestampSchema.optional(),
  createdAt: MarketplaceTimestampSchema,
  updatedAt: MarketplaceTimestampSchema
});

export const MarketplaceSkillDetailSchema = MarketplaceDetailBaseSchema.extend({
  contentType: z.literal("skill"),
  stageId: MarketplaceSkillStageSchema,
  kind: MarketplaceSkillKindSchema.optional(),
  libraryType: MarketplaceLibraryTypeSchema,
  content: z.string()
}).strict();
export type MarketplaceSkillDetail = z.infer<
  typeof MarketplaceSkillDetailSchema
>;

export const MarketplaceLibraryDetailSchema =
  MarketplaceDetailBaseSchema.extend({
    contentType: z.literal("library"),
    kind: MarketplaceSkillKindSchema,
    libraryType: MarketplaceLibraryTypeSchema,
    skills: z.array(MarketplaceSkillDetailSchema).max(4_096)
  }).strict();
export type MarketplaceLibraryDetail = z.infer<
  typeof MarketplaceLibraryDetailSchema
>;

export const MarketplaceGroupDetailSchema = MarketplaceDetailBaseSchema.extend({
  contentType: z.literal("group"),
  items: z.array(MarketplaceContentSummarySchema).max(200)
}).strict();
export type MarketplaceGroupDetail = z.infer<
  typeof MarketplaceGroupDetailSchema
>;

export const MarketplaceContentDetailSchema = z.discriminatedUnion(
  "contentType",
  [
    MarketplaceSkillDetailSchema,
    MarketplaceLibraryDetailSchema,
    MarketplaceGroupDetailSchema
  ]
);
export type MarketplaceContentDetail = z.infer<
  typeof MarketplaceContentDetailSchema
>;

export const MarketplacePublishEntrySchema = z
  .object({
    stageId: MarketplaceSkillStageSchema,
    title: MarketplaceTitleSchema,
    content: z.string().min(1).max(MARKETPLACE_CONTENT_MAX_CHARACTERS)
  })
  .strict();
export type MarketplacePublishEntry = z.infer<
  typeof MarketplacePublishEntrySchema
>;

const MarketplacePublishBaseSchema = z.object({
  title: MarketplaceTitleSchema,
  overview: z.string().max(MARKETPLACE_CONTENT_MAX_CHARACTERS)
});

export const MarketplacePublishSkillInputSchema =
  MarketplacePublishBaseSchema.extend({
    contentType: z.literal("skill"),
    stageId: MarketplaceSkillStageSchema,
    kind: MarketplaceSkillKindSchema.optional(),
    libraryType: MarketplaceLibraryTypeSchema,
    content: z.string().min(1).max(MARKETPLACE_CONTENT_MAX_CHARACTERS)
  }).strict();

export const MarketplacePublishLibraryInputSchema =
  MarketplacePublishBaseSchema.extend({
    contentType: z.literal("library"),
    kind: MarketplaceSkillKindSchema,
    libraryType: MarketplaceLibraryTypeSchema,
    entries: z.array(MarketplacePublishEntrySchema).min(1).max(4_096)
  }).strict();

export const MarketplacePublishGroupLibrarySchema =
  MarketplacePublishLibraryInputSchema.omit({
    contentType: true
  });
export type MarketplacePublishGroupLibrary = z.infer<
  typeof MarketplacePublishGroupLibrarySchema
>;

const MarketplacePublishGroupReferencesInputSchema =
  MarketplacePublishBaseSchema.extend({
    contentType: z.literal("group"),
    items: z
      .array(
        MarketplaceContentRefSchema.refine(
          (value) => value.contentType !== "group",
          "技能组成员只能是技能库或单技能。"
        )
      )
      .min(1)
      .max(200)
  }).strict();

const MarketplacePublishLocalGroupInputSchema =
  MarketplacePublishBaseSchema.extend({
    contentType: z.literal("group"),
    libraries: z.array(MarketplacePublishGroupLibrarySchema).min(1).max(4)
  }).strict();

export const MarketplacePublishGroupInputSchema = z.union([
  MarketplacePublishLocalGroupInputSchema,
  MarketplacePublishGroupReferencesInputSchema
]);

export const MarketplacePublishInputSchema = z.union([
  MarketplacePublishSkillInputSchema,
  MarketplacePublishLibraryInputSchema,
  MarketplacePublishGroupInputSchema
]);
export type MarketplacePublishInput = z.infer<
  typeof MarketplacePublishInputSchema
>;

export const MarketplaceUpdateInputSchema = z
  .object({
    id: MarketplaceIdSchema,
    content: MarketplacePublishInputSchema
  })
  .strict();
export type MarketplaceUpdateInput = z.infer<
  typeof MarketplaceUpdateInputSchema
>;

export const MarketplaceSetEnabledInputSchema =
  MarketplaceContentRefSchema.extend({
    enabled: z.boolean()
  }).strict();
export type MarketplaceSetEnabledInput = z.infer<
  typeof MarketplaceSetEnabledInputSchema
>;

export const MarketplaceLikeInputSchema = MarketplaceContentRefSchema.extend({
  liked: z.boolean()
}).strict();
export type MarketplaceLikeInput = z.infer<typeof MarketplaceLikeInputSchema>;

export const MarketplaceLikeResultSchema = z
  .object({
    liked: z.boolean(),
    likeCount: z.number().int().nonnegative()
  })
  .strict();
export type MarketplaceLikeResult = z.infer<typeof MarketplaceLikeResultSchema>;

export const MarketplaceSourceSchema = z
  .object({
    contentType: MarketplaceContentTypeSchema,
    contentId: MarketplaceIdSchema,
    version: z.number().int().positive(),
    installedAt: MarketplaceTimestampSchema,
    bucketKind: MarketplaceSkillKindSchema.optional()
  })
  .strict();
export type MarketplaceSource = z.infer<typeof MarketplaceSourceSchema>;

export const MarketplaceInstallEntrySchema = z
  .object({
    marketplaceSkillId: MarketplaceIdSchema,
    title: MarketplaceTitleSchema,
    stageId: MarketplaceSkillStageSchema,
    content: z.string().max(MARKETPLACE_CONTENT_MAX_CHARACTERS)
  })
  .strict();
export type MarketplaceInstallEntry = z.infer<
  typeof MarketplaceInstallEntrySchema
>;

export const MarketplaceInstallBucketSchema = z
  .object({
    kind: MarketplaceSkillKindSchema,
    libraryType: MarketplaceLibraryTypeSchema,
    availableLibraryTypes: z.array(MarketplaceLibraryTypeSchema).min(1).max(3),
    entries: z.array(MarketplaceInstallEntrySchema).min(1).max(4_096)
  })
  .strict();
export type MarketplaceInstallBucket = z.infer<
  typeof MarketplaceInstallBucketSchema
>;

export const MarketplaceInstallPackageSchema = z
  .object({
    source: MarketplaceSourceSchema.omit({
      installedAt: true,
      bucketKind: true
    }),
    title: MarketplaceTitleSchema,
    overview: z.string().max(MARKETPLACE_CONTENT_MAX_CHARACTERS),
    buckets: z.array(MarketplaceInstallBucketSchema).min(1).max(4),
    createGroup: z.boolean(),
    targetLibraryId: MarketplaceIdSchema.optional()
  })
  .strict();
export type MarketplaceInstallPackage = z.infer<
  typeof MarketplaceInstallPackageSchema
>;

export const MarketplaceInstallPreviewSchema = z
  .object({
    ref: MarketplaceContentRefSchema,
    title: MarketplaceTitleSchema,
    version: z.number().int().positive(),
    alreadyInstalled: z.boolean(),
    buckets: z.array(MarketplaceInstallBucketSchema).min(1).max(4),
    orderNotice: z.string().optional()
  })
  .strict();
export type MarketplaceInstallPreview = z.infer<
  typeof MarketplaceInstallPreviewSchema
>;

export const MarketplaceInstallInputSchema = z
  .object({
    ref: MarketplaceContentRefSchema,
    targetLibraryId: MarketplaceIdSchema.optional(),
    libraryTypesByKind: z
      .object({
        general: MarketplaceLibraryTypeSchema.optional(),
        plot: MarketplaceLibraryTypeSchema.optional(),
        style: MarketplaceLibraryTypeSchema.optional(),
        other: MarketplaceLibraryTypeSchema.optional()
      })
      .strict()
      .optional()
  })
  .strict();
export type MarketplaceInstallInput = z.infer<
  typeof MarketplaceInstallInputSchema
>;

export const MarketplaceInstallResultSchema = z
  .object({
    source: MarketplaceContentRefSchema,
    version: z.number().int().positive(),
    title: MarketplaceTitleSchema,
    alreadyInstalled: z.boolean(),
    libraryIds: z.array(MarketplaceIdSchema),
    groupId: MarketplaceIdSchema.optional(),
    downloadCounted: z.boolean()
  })
  .strict();
export type MarketplaceInstallResult = z.infer<
  typeof MarketplaceInstallResultSchema
>;

export const CatalogInstallMarketplaceSkillContentResultSchema =
  MarketplaceInstallResultSchema.omit({ downloadCounted: true });
export type CatalogInstallMarketplaceSkillContentResult = z.infer<
  typeof CatalogInstallMarketplaceSkillContentResultSchema
>;

export const CatalogInstallMarketplaceSkillContentCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.installMarketplaceSkillContent"),
    payload: MarketplaceInstallPackageSchema
  });
