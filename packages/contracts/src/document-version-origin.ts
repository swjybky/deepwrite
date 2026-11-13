import { z } from "zod";

// Kept independent of write results so mutation schemas can use it without cycles.
export const DocumentVersionOriginSchema = z
  .object({
    sessionId: z.string().trim().min(1).max(512),
    runId: z.string().trim().min(1).max(512),
    summary: z.string().trim().min(1).max(120)
  })
  .strict();
export type DocumentVersionOrigin = z.infer<typeof DocumentVersionOriginSchema>;
