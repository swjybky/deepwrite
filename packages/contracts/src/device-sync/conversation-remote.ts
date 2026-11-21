import { z } from "zod";
import { syncHashSchema } from "./connection-schemas";

/**
 * `remote` on messages received through the retired conversation sync. Stored conversations keep it, so the
 * schema stays exactly as it was written; nothing new produces it.
 */
const id = z.string().min(1).max(240);
const time = z
  .string()
  .min(1)
  .max(64)
  .refine(
    (value) => Number.isFinite(Date.parse(value)),
    "Invalid conversation time."
  );
const count = z.number().int().nonnegative();

const proposal = z
  .object({
    id,
    title: z.string().max(512),
    summary: z.string().max(4000),
    status: z.enum([
      "pending",
      "accepted",
      "rejected",
      "conflict",
      "error",
      "discarded"
    ]),
    additions: count,
    deletions: count
  })
  .strict();
const subagent = z
  .object({
    id,
    name: z.string().min(1).max(240),
    toolCallId: id.optional(),
    status: z.enum(["completed", "error", "stopped", "skipped"]),
    task: z.string().max(4000).optional(),
    summary: z.string().max(4000).optional(),
    output: z.string().optional()
  })
  .strict();
const compaction = z
  .object({ id, summary: z.string().min(1), createdAt: time })
  .strict();
const attachment = z
  .object({
    id,
    name: z.string().min(1).max(512),
    kind: z.enum(["text", "image"]),
    mediaType: z.string().min(1).max(255),
    size: count
  })
  .strict();

export const conversationSyncRemoteSchema = z
  .object({
    recordHash: syncHashSchema,
    device: z.string().min(1).max(80),
    proposals: z.array(proposal).max(1024).optional(),
    subagents: z.array(subagent).max(256).optional(),
    compactions: z.array(compaction).max(64).optional(),
    attachments: z.array(attachment).max(32).optional()
  })
  .strict();
export type ConversationSyncRemote = z.infer<
  typeof conversationSyncRemoteSchema
>;
