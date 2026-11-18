import { z } from "zod";
import { AcademicAgentTeamSettingsInputSchema } from "./academic-agent-team";
import { WorkspaceAgentTeamSettingsInputSchema } from "./agent-team";
import {
  AgentTeamProfileIdSchema,
  AgentTeamProfileSchema
} from "./agent-team-catalog";
import { LongAgentTeamSettingsSchema } from "./long-agent-team";

/** File imports always receive a new local id, so a hand-written team may omit it. */
export const AgentTeamImportProfileSchema = z.discriminatedUnion(
  "workspaceType",
  [
    AgentTeamProfileSchema.options[0].extend({
      id: AgentTeamProfileIdSchema.optional()
    }),
    AgentTeamProfileSchema.options[1].extend({
      id: AgentTeamProfileIdSchema.optional()
    }),
    AgentTeamProfileSchema.options[2].extend({
      id: AgentTeamProfileIdSchema.optional()
    }),
    AgentTeamProfileSchema.options[3].extend({
      id: AgentTeamProfileIdSchema.optional()
    })
  ]
);

/** Settings-only JSON uses the selected file name as its team name. */
export const AgentTeamImportSettingsSchema = z.discriminatedUnion(
  "workspaceType",
  [
    ...WorkspaceAgentTeamSettingsInputSchema.options,
    LongAgentTeamSettingsSchema,
    AcademicAgentTeamSettingsInputSchema
  ]
);
