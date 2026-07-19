import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";

export const WorkspaceDirectorySettingsSchema = z.object({
  path: z.string().trim().min(1).nullable()
});
export type WorkspaceDirectorySettings = z.infer<
  typeof WorkspaceDirectorySettingsSchema
>;

export const WorkspaceDirectoryListCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("workspaceDirectory.list"),
    payload: z.object({})
  });
export const WorkspaceDirectoryChooseCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("workspaceDirectory.choose"),
    payload: z.object({})
  });
