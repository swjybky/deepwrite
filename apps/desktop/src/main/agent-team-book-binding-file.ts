import {
  AgentTeamBookBindingDiskSchema,
  type AgentTeamBookBindings
} from "@deepwrite/contracts";
import {
  atomicWriteAgentTeamJson,
  readAgentTeamJson
} from "./agent-team-config-migration";

/** The file only exists once a book has been bound. */
export async function readAgentTeamBookBindings(
  path: string
): Promise<AgentTeamBookBindings> {
  const raw = await readAgentTeamJson(path);
  if (raw === undefined) return {};
  const parsed = AgentTeamBookBindingDiskSchema.safeParse(raw);
  if (!parsed.success) {
    // Reading it as empty would silently hand bound books the enabled team.
    throw new Error("作品团队绑定配置无效，请检查配置文件后重试。");
  }
  return parsed.data.bindings;
}

export async function writeAgentTeamBookBindings(
  path: string,
  bindings: AgentTeamBookBindings
): Promise<void> {
  await atomicWriteAgentTeamJson(path, { version: 1, bindings });
}

export function withAgentTeamBookBinding(
  bindings: AgentTeamBookBindings,
  bookId: string,
  teamIds: readonly string[]
): AgentTeamBookBindings {
  const { [bookId]: _previous, ...others } = bindings;
  return teamIds.length > 0 ? { ...others, [bookId]: [...teamIds] } : others;
}
