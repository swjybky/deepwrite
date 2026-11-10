import { z } from "zod";
import { EnvelopeBaseSchema } from "../envelope";
import { WebSearchProviderIdSchema } from "./providers";
import {
  WEB_SEARCH_API_KEY_MAX_LENGTH,
  WebSearchBaseUrlSchema,
  WebSearchSettingsInputSchema
} from "./settings";

const ModelIdSchema = z.string().trim().min(1).max(120);

export const WebSearchTestInputSchema = z
  .object({
    providerId: WebSearchProviderIdSchema,
    baseUrl: WebSearchBaseUrlSchema.optional(),
    /** A key typed but not yet saved; otherwise the saved key is used. */
    apiKey: z.string().trim().max(WEB_SEARCH_API_KEY_MAX_LENGTH).optional(),
    query: z.string().trim().min(1).max(128).optional()
  })
  .strict();
export type WebSearchTestInput = z.infer<typeof WebSearchTestInputSchema>;

const HttpUrlSchema = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      return ["http:", "https:"].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }, "链接必须是 http 或 https 地址。");

export const WebSearchTestResultSchema = z
  .object({
    resultCount: z.number().int().nonnegative(),
    elapsedMs: z.number().int().nonnegative(),
    samples: z
      .array(
        z
          .object({
            title: z.string().max(200),
            url: HttpUrlSchema,
            siteName: z.string().max(60).optional()
          })
          .strict()
      )
      .max(3)
  })
  .strict();
export type WebSearchTestResult = z.infer<typeof WebSearchTestResultSchema>;

export const WebSearchSetEnabledInputSchema = z
  .object({ enabled: z.boolean() })
  .strict();
export type WebSearchSetEnabledInput = z.infer<
  typeof WebSearchSetEnabledInputSchema
>;

export const WebSearchListKeyImportCandidatesInputSchema = z
  .object({ providerId: WebSearchProviderIdSchema })
  .strict();
export type WebSearchListKeyImportCandidatesInput = z.infer<
  typeof WebSearchListKeyImportCandidatesInputSchema
>;

/** One distinct key; several models sharing it are listed together. */
export const WebSearchKeyImportCandidateSchema = z
  .object({
    sourceModelId: ModelIdSchema,
    /** Last four characters like `…a1b2`; empty when the key is too short. */
    keyHint: z.string().max(16),
    models: z
      .array(
        z
          .object({ id: ModelIdSchema, label: z.string().min(1).max(120) })
          .strict()
      )
      .min(1)
      .max(100),
    matchesCurrentKey: z.boolean()
  })
  .strict();
export type WebSearchKeyImportCandidate = z.infer<
  typeof WebSearchKeyImportCandidateSchema
>;

export const WebSearchKeyImportCandidatesSchema = z
  .object({
    candidates: z.array(WebSearchKeyImportCandidateSchema).max(100),
    hasCurrentKey: z.boolean()
  })
  .strict();
export type WebSearchKeyImportCandidates = z.infer<
  typeof WebSearchKeyImportCandidatesSchema
>;

export const WebSearchImportKeyInputSchema = z
  .object({
    providerId: WebSearchProviderIdSchema,
    sourceModelId: ModelIdSchema
  })
  .strict();
export type WebSearchImportKeyInput = z.infer<
  typeof WebSearchImportKeyInputSchema
>;

const envelope = <T extends string, S extends z.ZodType>(type: T, payload: S) =>
  EnvelopeBaseSchema.extend({ type: z.literal(type), payload });

export const WebSearchCommandSchemas = [
  envelope("webSearch.getSettings", z.object({}).strict()),
  envelope("webSearch.saveSettings", WebSearchSettingsInputSchema),
  envelope("webSearch.setEnabled", WebSearchSetEnabledInputSchema),
  envelope("webSearch.test", WebSearchTestInputSchema),
  envelope(
    "webSearch.listKeyImportCandidates",
    WebSearchListKeyImportCandidatesInputSchema
  ),
  envelope("webSearch.importKey", WebSearchImportKeyInputSchema)
] as const;
