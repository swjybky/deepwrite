import { z } from "zod";

export const UPDATE_MANIFEST_URL =
  "https://update.deepwrite.download/update.json";

export const UPDATE_GET_STATE_CHANNEL = "deepwrite:update:get-state";
export const UPDATE_CHECK_CHANNEL = "deepwrite:update:check";
export const UPDATE_DOWNLOAD_CHANNEL = "deepwrite:update:download";
export const UPDATE_INSTALL_CHANNEL = "deepwrite:update:install";
export const UPDATE_STATE_EVENT_CHANNEL = "deepwrite:update:state";

export const UpdateManifestSchema = z.object({
  schemaVersion: z.literal(1),
  enabled: z.boolean().default(true),
  channel: z.literal("stable").default("stable"),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
  title: z.string().min(1).max(120),
  publishedAt: z.string().datetime({ offset: true }),
  releaseNotes: z.array(z.string().min(1).max(500)).max(50),
  mandatory: z.boolean().default(false),
  minimumSupportedVersion: z
    .string()
    .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
    .optional(),
  releasePage: z.string().url(),
  feedUrl: z.string().url()
});
export type UpdateManifest = z.infer<typeof UpdateManifestSchema>;

export const UpdateStatusSchema = z.enum([
  "idle",
  "checking",
  "available",
  "not-available",
  "downloading",
  "downloaded",
  "installing",
  "error",
  "unsupported"
]);
export type UpdateStatus = z.infer<typeof UpdateStatusSchema>;

export const UpdateStateSchema = z.object({
  status: UpdateStatusSchema,
  currentVersion: z.string(),
  latestVersion: z.string().optional(),
  title: z.string().optional(),
  releaseNotes: z.array(z.string()).default([]),
  mandatory: z.boolean().default(false),
  releasePage: z.string().url().optional(),
  percent: z.number().min(0).max(100).optional(),
  transferred: z.number().nonnegative().optional(),
  total: z.number().nonnegative().optional(),
  bytesPerSecond: z.number().nonnegative().optional(),
  message: z.string().optional(),
  canDownload: z.boolean(),
  canInstall: z.boolean()
});
export type UpdateState = z.infer<typeof UpdateStateSchema>;
