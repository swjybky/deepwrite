import { z } from "zod";

export const APP_ALERT_GET_CHANNEL = "deepwrite:app-alert:get";
export const APP_ALERT_ACKNOWLEDGE_DESKTOP_CHANNEL =
  "deepwrite:app-alert:acknowledge-desktop";

const AlertMessageSchema = z.string().trim().min(1).max(500);
const OfficialDocsUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !/[\\\s]/u.test(value)
      );
    } catch {
      return false;
    }
  })
  .optional()
  .catch(undefined);
const AlertVersionSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/^[vV]/u, ""))
  .pipe(
    z
      .string()
      .max(64)
      .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/u)
  )
  .optional()
  .catch(undefined);

export const AppAlertManifestSchema = z.object({
  // Keep the upstream spelling for compatibility with the published file.
  desketop: z.array(AlertMessageSchema).max(20),
  model: z.array(AlertMessageSchema).max(20).default([]),
  pcLatestVersion: AlertVersionSchema,
  officialDocsUrl: OfficialDocsUrlSchema
});
export type AppAlertManifest = z.infer<typeof AppAlertManifestSchema>;

export const AppAlertDesktopRevisionSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/u);

export const AppAlertHistoryEntrySchema = z.object({
  revision: AppAlertDesktopRevisionSchema,
  receivedAt: z.string().datetime(),
  messages: z.array(AlertMessageSchema).min(1).max(20)
});
export type AppAlertHistoryEntry = z.infer<typeof AppAlertHistoryEntrySchema>;

export const AppAlertSnapshotSchema = z.object({
  desktopMessages: z.array(AlertMessageSchema).max(20),
  modelMessages: z.array(AlertMessageSchema).max(20),
  pcLatestVersion: AlertVersionSchema,
  officialDocsUrl: OfficialDocsUrlSchema,
  desktopRevision: AppAlertDesktopRevisionSchema,
  shouldShowDesktop: z.boolean(),
  history: z.array(AppAlertHistoryEntrySchema).optional()
});
export type AppAlertSnapshot = z.infer<typeof AppAlertSnapshotSchema>;
