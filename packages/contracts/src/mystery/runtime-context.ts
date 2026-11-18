import { z } from "zod";
import { CatalogTitleSchema } from "../catalog/kinds";
import {
  MYSTERY_AGENTS_MD_MAX_CHARACTERS,
  MysteryBookGenreSchema,
  MysteryBookIdSchema,
  MysteryDocumentTargetSchema,
  MysteryStageIdSchema,
  MysteryWorkspaceIndexSnapshotSchema
} from "./manifest";
import { MysteryAgentIdSchema } from "./agent-settings";

export const MysteryWorkspaceFocusSchema = z
  .object({
    stage: MysteryStageIdSchema,
    target: MysteryDocumentTargetSchema.optional()
  })
  .strict();
export type MysteryWorkspaceFocus = z.infer<typeof MysteryWorkspaceFocusSchema>;

export const MysteryWorkspaceRuntimeContextSchema = z
  .object({
    bookId: MysteryBookIdSchema,
    title: CatalogTitleSchema,
    genre: MysteryBookGenreSchema,
    activeAgentId: MysteryAgentIdSchema,
    focus: MysteryWorkspaceFocusSchema,
    workspaceIndex: MysteryWorkspaceIndexSnapshotSchema,
    agentsMd: z
      .string()
      .max(MYSTERY_AGENTS_MD_MAX_CHARACTERS * 2)
      .optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.workspaceIndex.bookId !== value.bookId) {
      context.addIssue({
        code: "custom",
        path: ["workspaceIndex", "bookId"],
        message: "Mystery workspace index must match the active book."
      });
    }
  });
export type MysteryWorkspaceRuntimeContext = z.infer<
  typeof MysteryWorkspaceRuntimeContextSchema
>;
