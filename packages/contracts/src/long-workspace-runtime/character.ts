import { z } from "zod";
import {
  LongCharacterGroupSchema,
  LongCharacterIdSchema
} from "../long-workspace";
import { LONG_CHARACTER_FOCUS_MAX_CHARACTERS } from "../long-workspace-limits";

const LongCharacterFocusTextSnapshotSchema = z
  .object({
    content: z.string().max(LONG_CHARACTER_FOCUS_MAX_CHARACTERS * 2),
    truncated: z.literal(true).optional(),
    originalLength: z.number().int().nonnegative().optional()
  })
  .strict()
  .superRefine((value, context) => {
    const contentLength = Array.from(value.content).length;
    if (contentLength > LONG_CHARACTER_FOCUS_MAX_CHARACTERS) {
      context.addIssue({
        code: "custom",
        path: ["content"],
        message:
          "Long character focus text exceeds the maximum character count."
      });
    }
    if (
      value.truncated === true &&
      (value.originalLength === undefined ||
        value.originalLength <= contentLength)
    ) {
      context.addIssue({
        code: "custom",
        path: ["originalLength"],
        message:
          "A truncated long character focus text must report its original length."
      });
    }
    if (value.truncated !== true && value.originalLength !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["originalLength"],
        message:
          "An untruncated long character focus text must omit its original length."
      });
    }
  });

export const LongCharacterFocusSnapshotSchema = z
  .object({
    characterId: LongCharacterIdSchema.optional(),
    characterName: z.string().trim().min(1).max(256).optional(),
    group: LongCharacterGroupSchema.optional(),
    currentDocument: z
      .object({
        kind: z.enum([
          "overview",
          "core_profile",
          "relationships",
          "current_state",
          "history"
        ]),
        title: z.string().trim().min(1).max(256),
        text: LongCharacterFocusTextSnapshotSchema.optional()
      })
      .strict(),
    overview: LongCharacterFocusTextSnapshotSchema.optional(),
    coreProfile: LongCharacterFocusTextSnapshotSchema.optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.currentDocument.kind === "overview") {
      if (
        value.characterId !== undefined ||
        value.characterName !== undefined ||
        value.group !== undefined
      ) {
        context.addIssue({
          code: "custom",
          path: ["characterName"],
          message:
            "A focused character overview must not include a character name or group."
        });
      }
      if (value.overview !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["overview"],
          message:
            "A focused character overview must not duplicate the overview snapshot."
        });
      }
      if (value.coreProfile !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["coreProfile"],
          message:
            "A focused character overview must not include a core profile snapshot."
        });
      }
    } else {
      if (!value.characterName || !value.group) {
        context.addIssue({
          code: "custom",
          path: ["characterName"],
          message:
            "A focused character document must include the character name and group."
        });
      }
      if (
        value.currentDocument.text !== undefined &&
        value.overview === undefined
      ) {
        context.addIssue({
          code: "custom",
          path: ["overview"],
          message:
            "A focused character document must include the stage overview."
        });
      }
      if (
        value.currentDocument.kind !== "core_profile" &&
        value.currentDocument.text !== undefined &&
        value.coreProfile === undefined
      ) {
        context.addIssue({
          code: "custom",
          path: ["coreProfile"],
          message:
            "A focused secondary character document must include the core profile."
        });
      }
      if (
        value.currentDocument.kind === "core_profile" &&
        value.coreProfile !== undefined
      ) {
        context.addIssue({
          code: "custom",
          path: ["coreProfile"],
          message:
            "A focused core profile must not duplicate the core profile snapshot."
        });
      }
    }
    const totalCharacters =
      Array.from(value.currentDocument.text?.content ?? "").length +
      Array.from(value.overview?.content ?? "").length +
      Array.from(value.coreProfile?.content ?? "").length;
    if (totalCharacters > LONG_CHARACTER_FOCUS_MAX_CHARACTERS) {
      context.addIssue({
        code: "custom",
        path: ["currentDocument", "text", "content"],
        message:
          "Combined long character focus text exceeds the maximum character count."
      });
    }
  });
export type LongCharacterFocusSnapshot = z.infer<
  typeof LongCharacterFocusSnapshotSchema
>;
