import { z } from "zod";

/** The owning work, independent of the active writing stage. */
export const LibraryManagementScopeSchema = z
  .object({
    bookId: z.string().trim().min(1).max(512),
    bookType: z.enum(["short", "script", "long"])
  })
  .strict();
export type LibraryManagementScope = z.infer<
  typeof LibraryManagementScopeSchema
>;
