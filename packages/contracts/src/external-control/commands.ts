import { z } from "zod";
import { EnvelopeBaseSchema } from "../envelope";

/** Main asks Core where a project lives before taking it off the list. */
export const ExternalControlLocateProjectInputSchema = z
  .object({
    source: z.enum(["catalog", "long"]),
    projectId: z.string().trim().min(1).max(512)
  })
  .strict();

export const ExternalControlLocateProjectResultSchema = z
  .object({ projectDirectory: z.string().min(1) })
  .strict();

/** Internal Main -> Core command. Not exposed by the Preload API. */
export const ExternalControlLocateProjectCommandEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("externalControl.locateProject"),
    payload: ExternalControlLocateProjectInputSchema
  });

/** What the settings page shows. Everything here stays on this machine. */
export const ExternalControlOverviewSchema = z
  .object({
    enabled: z.boolean(),
    clients: z.array(
      z
        .object({
          name: z.string().min(1),
          approvedAt: z.string().datetime()
        })
        .strict()
    ),
    trash: z.array(
      z
        .object({
          trashId: z.string().min(1),
          kind: z.enum(["section", "entry", "team", "project"]),
          title: z.string().min(1),
          deletedAt: z.string().datetime(),
          expiresAt: z.string().datetime().nullable()
        })
        .strict()
    ),
    activity: z.array(
      z
        .object({
          time: z.string(),
          client: z.string(),
          tool: z.string(),
          result: z.string()
        })
        .strict()
    ),
    configs: z.array(
      z
        .object({
          id: z.string().min(1),
          label: z.string().min(1),
          /** Where this text goes: a terminal, or the named config file. */
          kind: z.enum(["command", "file"]),
          file: z.string().optional(),
          text: z.string().min(1)
        })
        .strict()
    ),
    skillTargets: z.array(
      z
        .object({
          id: z.string().min(1),
          label: z.string().min(1),
          installed: z.boolean()
        })
        .strict()
    )
  })
  .strict();
export type ExternalControlOverview = z.infer<
  typeof ExternalControlOverviewSchema
>;

const commandEnvelope = <Type extends string, Payload extends z.ZodType>(
  type: Type,
  payload: Payload
) =>
  EnvelopeBaseSchema.extend({
    type: z.literal(type),
    payload
  });

export const ExternalControlSettingsCommandSchemas = [
  commandEnvelope("externalControl.overview", z.object({}).strict()),
  commandEnvelope(
    "externalControl.revokeClient",
    z.object({ name: z.string().min(1).max(120) }).strict()
  ),
  commandEnvelope(
    "externalControl.restoreTrash",
    z.object({ trashId: z.string().min(1).max(512) }).strict()
  ),
  commandEnvelope("externalControl.emptyTrash", z.object({}).strict()),
  commandEnvelope(
    "externalControl.installSkill",
    z.object({ targetId: z.string().min(1).max(40) }).strict()
  )
] as const;

const SETTINGS_COMMAND_TYPES = new Set<string>(
  ExternalControlSettingsCommandSchemas.map((schema) => schema.shape.type.value)
);

export function isExternalControlSettingsCommand(type: string): boolean {
  return SETTINGS_COMMAND_TYPES.has(type);
}

/** Tells the window something changed on disk behind its back. */
export const ExternalControlResourceChangedEventEnvelopeSchema =
  EnvelopeBaseSchema.extend({
    type: z.literal("externalControl.resource_changed"),
    payload: z
      .object({
        domain: z.enum(["work", "library", "agent_team"]),
        resourceId: z.string().min(1).max(512)
      })
      .strict()
  });
export type ExternalControlResourceChange = z.infer<
  typeof ExternalControlResourceChangedEventEnvelopeSchema
>["payload"];
