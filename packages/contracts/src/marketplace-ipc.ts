import { z } from "zod";
import {
  MarketplaceBindEmailInputSchema,
  MarketplaceEmailCodeInputSchema,
  MarketplaceEmailLoginInputSchema
} from "./marketplace-email";
import {
  MarketplaceContentRefSchema,
  MarketplaceInstallInputSchema,
  MarketplaceLikeInputSchema,
  MarketplaceListFilterSchema,
  MarketplaceLoginInputSchema,
  MarketplacePublishInputSchema,
  MarketplaceRegisterInputSchema,
  MarketplaceSetEnabledInputSchema,
  MarketplaceUpdateInputSchema
} from "./marketplace";
import {
  MarketplaceMaterialFilterSchema,
  MarketplaceMaterialRefSchema
} from "./material-marketplace";

export const MARKETPLACE_IPC_CHANNEL = "deepwrite:marketplace" as const;

export const MarketplaceIpcRequestSchema = z.discriminatedUnion("operation", [
  z
    .object({
      operation: z.literal("sendEmailCode"),
      input: MarketplaceEmailCodeInputSchema
    })
    .strict(),
  z
    .object({
      operation: z.literal("bindEmail"),
      input: MarketplaceBindEmailInputSchema
    })
    .strict(),
  z.object({ operation: z.literal("session") }).strict(),
  z
    .object({
      operation: z.literal("register"),
      input: MarketplaceRegisterInputSchema
    })
    .strict(),
  z
    .object({
      operation: z.literal("login"),
      input: MarketplaceLoginInputSchema
    })
    .strict(),
  z
    .object({
      operation: z.literal("loginWithEmailCode"),
      input: MarketplaceEmailLoginInputSchema
    })
    .strict(),
  z.object({ operation: z.literal("logout") }).strict(),
  z
    .object({
      operation: z.literal("list"),
      filter: MarketplaceListFilterSchema
    })
    .strict(),
  z
    .object({
      operation: z.literal("detail"),
      ref: MarketplaceContentRefSchema
    })
    .strict(),
  z
    .object({
      operation: z.literal("listMine"),
      filter: MarketplaceListFilterSchema
    })
    .strict(),
  z
    .object({
      operation: z.literal("myDetail"),
      ref: MarketplaceContentRefSchema
    })
    .strict(),
  z
    .object({
      operation: z.literal("publish"),
      input: MarketplacePublishInputSchema
    })
    .strict(),
  z
    .object({
      operation: z.literal("update"),
      input: MarketplaceUpdateInputSchema
    })
    .strict(),
  z
    .object({
      operation: z.literal("setEnabled"),
      input: MarketplaceSetEnabledInputSchema
    })
    .strict(),
  z
    .object({
      operation: z.literal("delete"),
      ref: MarketplaceContentRefSchema
    })
    .strict(),
  z
    .object({ operation: z.literal("like"), input: MarketplaceLikeInputSchema })
    .strict(),
  z
    .object({
      operation: z.literal("previewInstall"),
      ref: MarketplaceContentRefSchema
    })
    .strict(),
  z
    .object({
      operation: z.literal("install"),
      input: MarketplaceInstallInputSchema
    })
    .strict(),
  z
    .object({
      operation: z.literal("listMaterials"),
      filter: MarketplaceMaterialFilterSchema
    })
    .strict(),
  z
    .object({
      operation: z.literal("materialDetail"),
      id: MarketplaceMaterialRefSchema.shape.id
    })
    .strict(),
  z
    .object({
      operation: z.literal("installMaterial"),
      ref: MarketplaceMaterialRefSchema
    })
    .strict()
]);
export type MarketplaceIpcRequest = z.infer<typeof MarketplaceIpcRequestSchema>;
