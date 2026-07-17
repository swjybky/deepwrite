import { z } from "zod";

export const PROTOCOL_VERSION = 1 as const;

export const EnvelopeContextSchema = z.object({
  correlationId: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  resourceId: z.string().min(1).optional()
});
export type EnvelopeContext = z.infer<typeof EnvelopeContextSchema>;

export const EnvelopeBaseSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  id: z.string().min(1),
  type: z.string().min(1),
  timestamp: z.string().datetime(),
  context: EnvelopeContextSchema
});

export interface Envelope<TPayload, TType extends string = string> {
  protocolVersion: typeof PROTOCOL_VERSION;
  id: string;
  type: TType;
  timestamp: string;
  payload: TPayload;
  context: EnvelopeContext;
}

export interface EnvelopeOptions {
  id: string;
  timestamp?: string;
  correlationId?: string;
  context?: Omit<EnvelopeContext, "correlationId"> & { correlationId?: string };
}

export function createEnvelope<TType extends string, TPayload>(
  type: TType,
  payload: TPayload,
  options: EnvelopeOptions
): Envelope<TPayload, TType> {
  return {
    protocolVersion: PROTOCOL_VERSION,
    id: options.id,
    type,
    timestamp: options.timestamp ?? new Date().toISOString(),
    payload,
    context: {
      correlationId:
        options.context?.correlationId ?? options.correlationId ?? options.id,
      ...(options.context?.sessionId ? { sessionId: options.context.sessionId } : {}),
      ...(options.context?.runId ? { runId: options.context.runId } : {}),
      ...(options.context?.resourceId ? { resourceId: options.context.resourceId } : {})
    }
  };
}
