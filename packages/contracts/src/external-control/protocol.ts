import { z } from "zod";
import { EnvelopeBaseSchema } from "../envelope";

/** Bumped only when bridge and app can no longer understand each other. */
export const EXTERNAL_CONTROL_PROTOCOL_VERSION = 1 as const;

/** Tells the app it was started, or re-activated, by the MCP bridge. */
export const EXTERNAL_CONTROL_LAUNCH_FLAG = "--external-control-launch";

/** Nothing unauthenticated may make the app buffer more than this. */
export const EXTERNAL_CONTROL_HELLO_MAX_BYTES = 4 * 1024;
export const EXTERNAL_CONTROL_MESSAGE_MAX_BYTES = 20 * 1024 * 1024;

export const ExternalControlErrorCodeSchema = z.enum([
  "external.disabled",
  "external.unauthorized",
  "external.approval_pending",
  "external.incompatible",
  "external.app_unavailable",
  "external.not_ready",
  "external.not_found",
  "external.invalid_input",
  "external.busy",
  "external.stale_revision",
  "external.cross_stage_disabled"
]);
export type ExternalControlErrorCode = z.infer<
  typeof ExternalControlErrorCodeSchema
>;

const StateFileBaseSchema = z.object({
  protocolVersion: z.number().int().positive(),
  appVersion: z.string().min(1),
  pid: z.number().int().positive()
});

/** The bridge's only way to find the app. Readable by the same user only. */
export const ExternalControlStateFileSchema = z.discriminatedUnion("status", [
  StateFileBaseSchema.extend({
    status: z.literal("ready"),
    endpoint: z.string().min(1),
    token: z.string().min(32),
    startedAt: z.string().datetime()
  }),
  StateFileBaseSchema.extend({ status: z.literal("disabled") })
]);
export type ExternalControlStateFile = z.infer<
  typeof ExternalControlStateFileSchema
>;

export const ExternalControlClientSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    version: z.string().trim().min(1).max(60).optional()
  })
  .strict();
export type ExternalControlClient = z.infer<typeof ExternalControlClientSchema>;

/** Clients the user has allowed; stored under user data, not beside the token. */
export const ExternalControlAccessFileSchema = z
  .object({
    version: z.literal(1),
    clients: z.array(
      z
        .object({
          name: ExternalControlClientSchema.shape.name,
          approvedAt: z.string().datetime()
        })
        .strict()
    )
  })
  .strict();
export type ExternalControlAccessFile = z.infer<
  typeof ExternalControlAccessFileSchema
>;

export const ExternalControlHelloEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("externalControl.hello"),
  payload: z
    .object({
      protocolVersion: z.number().int().positive(),
      token: z.string().min(1).max(256),
      client: ExternalControlClientSchema
    })
    .strict()
});
export type ExternalControlHelloEnvelope = z.infer<
  typeof ExternalControlHelloEnvelopeSchema
>;

export const ExternalControlCallEnvelopeSchema = EnvelopeBaseSchema.extend({
  type: z.literal("externalControl.call"),
  payload: z
    .object({
      tool: z.string().min(1).max(120),
      arguments: z.record(z.string(), z.unknown())
    })
    .strict()
});
export type ExternalControlCallEnvelope = z.infer<
  typeof ExternalControlCallEnvelopeSchema
>;

/** Same accepted/rejected shape as Main's command results. */
export const ExternalControlResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("accepted"),
    requestId: z.string().min(1),
    payload: z.unknown()
  }),
  z.object({
    status: z.literal("rejected"),
    requestId: z.string().min(1),
    error: z.object({
      code: ExternalControlErrorCodeSchema,
      message: z.string().min(1)
    })
  })
]);
export type ExternalControlResult = z.infer<typeof ExternalControlResultSchema>;
