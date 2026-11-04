import { z } from "zod";
import type { AgentTeamCatalogSnapshot } from "./agent-team-catalog";
import {
  SHORT_AGENT_SUBAGENT_ID_MAX_LENGTH,
  SHORT_AGENT_SUBAGENT_NAME_MAX_LENGTH,
  type ShortAgentSubagentDefinition
} from "./agent-team";

export const AGENT_TEAM_BOOK_BINDING_MAX_TEAMS = 20;

export const AgentTeamProfileIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);

export const LinkedAgentTeamIdsSchema = z
  .array(AgentTeamProfileIdSchema)
  .max(AGENT_TEAM_BOOK_BINDING_MAX_TEAMS)
  .refine((ids) => new Set(ids).size === ids.length, "绑定的团队不能重复");
export type LinkedAgentTeamIds = z.infer<typeof LinkedAgentTeamIdsSchema>;

export const AgentTeamBookIdSchema = z.string().trim().min(1).max(512);

/** Book id → bound teams, in the order the user bound them. */
export const AgentTeamBookBindingsSchema = z.record(
  AgentTeamBookIdSchema,
  LinkedAgentTeamIdsSchema.min(1)
);
export type AgentTeamBookBindings = z.infer<typeof AgentTeamBookBindingsSchema>;

export const AgentTeamBookBindingDiskSchema = z.object({
  version: z.literal(1),
  bindings: AgentTeamBookBindingsSchema
});

type ActiveTeamCatalog = Pick<
  AgentTeamCatalogSnapshot,
  "enabledTeamIds" | "teams" | "bookBindings"
>;
type ActiveTeamProfile = AgentTeamCatalogSnapshot["teams"][number];

export interface ActiveAgentTeams {
  /** `bound` never falls back to the enabled team, even with no teams left. */
  source: "enabled" | "bound";
  teams: ActiveTeamProfile[];
}

/**
 * The only place that decides which teams a book runs with. Main resolves runs
 * with it and the Renderer previews with it, so both sides cannot drift apart.
 */
export function activeAgentTeams(
  catalog: ActiveTeamCatalog,
  workspaceType: ActiveTeamProfile["workspaceType"],
  bookId: string | undefined
): ActiveAgentTeams {
  const boundIds = bookId ? catalog.bookBindings?.[bookId] : undefined;
  if (boundIds?.length) {
    return {
      source: "bound",
      teams: boundIds.flatMap((id) =>
        catalog.teams.filter(
          (team) => team.id === id && team.workspaceType === workspaceType
        )
      )
    };
  }
  const enabledId = catalog.enabledTeamIds[workspaceType];
  return {
    source: "enabled",
    teams: catalog.teams.filter(
      (team) => team.id === enabledId && team.workspaceType === workspaceType
    )
  };
}

function uniqueMemberIdentity(
  member: ShortAgentSubagentDefinition,
  teamName: string,
  usedIds: ReadonlySet<string>,
  usedNames: ReadonlySet<string>
): Pick<ShortAgentSubagentDefinition, "id" | "name"> {
  let id = member.id;
  for (let copy = 2; usedIds.has(id.toLocaleLowerCase()); copy += 1) {
    const suffix = `-${copy}`;
    id = `${member.id.slice(0, SHORT_AGENT_SUBAGENT_ID_MAX_LENGTH - suffix.length)}${suffix}`;
  }
  const clipped = (value: string, suffix: string): string =>
    `${value.slice(0, SHORT_AGENT_SUBAGENT_NAME_MAX_LENGTH - suffix.length).trimEnd()}${suffix}`;
  let name = member.name;
  if (usedNames.has(name.toLocaleLowerCase())) {
    name = clipped(member.name, `（${teamName}）`);
  }
  for (let copy = 2; usedNames.has(name.toLocaleLowerCase()); copy += 1) {
    name = clipped(member.name, `（${teamName} ${copy}）`);
  }
  return { id, name };
}

/**
 * Enabled members of the active teams for one main agent. A run requires unique
 * member ids and names, so identical members collapse and clashing ones are
 * renamed deterministically rather than dropped.
 */
export function activeAgentTeamMembers(
  active: ActiveAgentTeams,
  parentAgentId: string
): ShortAgentSubagentDefinition[] {
  const members: ShortAgentSubagentDefinition[] = [];
  const seen = new Set<string>();
  const usedIds = new Set<string>();
  const usedNames = new Set<string>();
  for (const team of active.teams) {
    const candidates: readonly {
      parentAgentId: string;
      subagents: readonly ShortAgentSubagentDefinition[];
    }[] = team.settings.teams;
    const subagents = candidates.find(
      (candidate) => candidate.parentAgentId === parentAgentId
    )?.subagents;
    for (const member of subagents ?? []) {
      if (!member.enabled) continue;
      const fingerprint = JSON.stringify(member);
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      const identity = uniqueMemberIdentity(
        member,
        team.name,
        usedIds,
        usedNames
      );
      usedIds.add(identity.id.toLocaleLowerCase());
      usedNames.add(identity.name.toLocaleLowerCase());
      members.push({ ...member, ...identity });
    }
  }
  return members;
}

/** Runs in parallel only when every active team allows it. */
export function activeAgentTeamsParallel(active: ActiveAgentTeams): boolean {
  return (
    active.teams.length > 0 &&
    active.teams.every((team) => team.settings.parallelSubagents)
  );
}

export function agentTeamBoundBookCount(
  bindings: AgentTeamBookBindings | undefined,
  teamId: string
): number {
  return Object.values(bindings ?? {}).filter((ids) => ids.includes(teamId))
    .length;
}

/** Drops a deleted team; a book left with no teams returns to the default. */
export function withoutAgentTeamBindings(
  bindings: AgentTeamBookBindings,
  teamId: string
): AgentTeamBookBindings {
  const next: AgentTeamBookBindings = {};
  for (const [bookId, ids] of Object.entries(bindings)) {
    const remaining = ids.filter((id) => id !== teamId);
    if (remaining.length > 0) next[bookId] = remaining;
  }
  return next;
}
