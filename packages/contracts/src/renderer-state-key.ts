import { z } from "zod";

export const RENDERER_STATE_KEY_MAX_LENGTH = 240;
export const RENDERER_STATE_KEY_PREFIXES = [
  "conversation-history:",
  "conversation-preferences:"
] as const;

const RENDERER_STATE_KEY_PATTERN =
  /^(?:conversation-history:|conversation-preferences:)(?:[A-Za-z0-9!()*'._~:-]|%[0-9A-Fa-f]{2})+$/u;

export const RendererStateKeySchema = z
  .string()
  .max(RENDERER_STATE_KEY_MAX_LENGTH)
  .regex(
    RENDERER_STATE_KEY_PATTERN,
    "Renderer state key must use an allowed conversation prefix and encoded suffix."
  );
export type RendererStateKey = z.infer<typeof RendererStateKeySchema>;
