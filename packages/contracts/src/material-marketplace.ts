import { z } from "zod";
import {
  CATALOG_PROJECT_MAX_CONTENT_ITEMS,
  CatalogIdSchema,
  CatalogTitleSchema,
  LibraryTypeSchema,
  MaterialLibraryKindSchema,
  MaterialStageIdSchema
} from "./catalog/kinds";
import { EnvelopeBaseSchema } from "./envelope";

export const MarketplaceMaterialFilterSchema = z
  .object({
    query: z.string().trim().max(256).optional(),
    kind: MaterialLibraryKindSchema.optional()
  })
  .strict();
export type MarketplaceMaterialFilter = z.infer<
  typeof MarketplaceMaterialFilterSchema
>;

export const MarketplaceMaterialSummarySchema = z
  .object({
    id: CatalogIdSchema,
    title: CatalogTitleSchema,
    overview: z.string(),
    kind: MaterialLibraryKindSchema,
    version: z.number().int().positive()
  })
  .strict();
export type MarketplaceMaterialSummary = z.infer<
  typeof MarketplaceMaterialSummarySchema
>;
export const MarketplaceMaterialListSchema = z
  .array(MarketplaceMaterialSummarySchema)
  .max(200);

export const MarketplaceMaterialDetailSchema =
  MarketplaceMaterialSummarySchema.extend({
    libraryType: LibraryTypeSchema,
    parentGenre: z.string(),
    subGenre: z.string(),
    entries: z
      .array(
        z
          .object({
            stageId: MaterialStageIdSchema,
            title: CatalogTitleSchema,
            body: z.string()
          })
          .strict()
      )
      .max(CATALOG_PROJECT_MAX_CONTENT_ITEMS)
  }).strict();
export type MarketplaceMaterialDetail = z.infer<
  typeof MarketplaceMaterialDetailSchema
>;

export const MarketplaceMaterialRefSchema =
  MarketplaceMaterialSummarySchema.pick({
    id: true,
    version: true
  });
export type MarketplaceMaterialRef = z.infer<
  typeof MarketplaceMaterialRefSchema
>;

export const MarketplaceMaterialInstallResultSchema = z
  .object({
    libraryId: CatalogIdSchema,
    title: CatalogTitleSchema,
    alreadyInstalled: z.boolean()
  })
  .strict();
export type MarketplaceMaterialInstallResult = z.infer<
  typeof MarketplaceMaterialInstallResultSchema
>;

export const CatalogInstallMarketplaceMaterialCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("catalog.installMarketplaceMaterial"),
    payload: MarketplaceMaterialDetailSchema
  });
