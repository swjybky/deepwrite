import { z } from "zod";
import { EnvelopeBaseSchema } from "./envelope";

export const TEXT_CONTEXT_MENU_EVENT_CHANNEL =
  "deepwrite:text-context-menu:event";
export const TEXT_CONTEXT_MENU_COMMAND_CHANNEL =
  "deepwrite:text-context-menu:command";

export const TextContextMenuActionSchema = z.enum([
  "undo",
  "redo",
  "cut",
  "copy",
  "paste",
  "delete",
  "selectAll",
  "insertReference",
  "insertImage"
]);
export type TextContextMenuAction = z.infer<typeof TextContextMenuActionSchema>;

export const TextContextMenuContextSchema = z
  .object({
    kind: z.enum(["editable", "readonly", "selection", "none"]),
    password: z.boolean(),
    hasSelection: z.boolean(),
    hasText: z.boolean(),
    canInsertReference: z.boolean(),
    canInsertImage: z.boolean(),
    history: z.object({ canUndo: z.boolean(), canRedo: z.boolean() }).optional()
  })
  .strict();
export type TextContextMenuContext = z.infer<
  typeof TextContextMenuContextSchema
>;

export const TextContextMenuEventSchema = EnvelopeBaseSchema.extend({
  type: z.literal("textContextMenu.event"),
  payload: z.discriminatedUnion("phase", [
    z.object({ phase: z.literal("prepare") }).strict(),
    z
      .object({
        phase: z.literal("action"),
        action: TextContextMenuActionSchema
      })
      .strict(),
    z.object({ phase: z.literal("closed") }).strict()
  ])
});
export const TextContextMenuCommandSchema = EnvelopeBaseSchema.extend({
  type: z.literal("textContextMenu.reply"),
  payload: z.discriminatedUnion("phase", [
    z
      .object({
        phase: z.literal("prepared"),
        context: TextContextMenuContextSchema
      })
      .strict(),
    z
      .object({
        phase: z.literal("actionReady"),
        action: TextContextMenuActionSchema,
        allowed: z.boolean(),
        handled: z.boolean()
      })
      .strict(),
    z.object({ phase: z.literal("cancel") }).strict()
  ])
});
export type TextContextMenuEvent = z.infer<typeof TextContextMenuEventSchema>;
export type TextContextMenuCommand = z.infer<
  typeof TextContextMenuCommandSchema
>;

export interface TextContextMenuApi {
  subscribe(listener: (event: TextContextMenuEvent) => void): () => void;
  reply(command: TextContextMenuCommand): void;
}
export interface TextContextMenuPreloadApi {
  textContextMenu?: TextContextMenuApi;
}
