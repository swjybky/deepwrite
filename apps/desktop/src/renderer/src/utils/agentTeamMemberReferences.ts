import type {
  AgentTeamCatalogSnapshot,
  AgentTeamWorkspaceType
} from "@deepwrite/contracts";
import type { ComposerReferenceOption } from "../types/conversation";
import { enabledTeamMembers } from "./agentTeamModeAvailability";

/** `#` menu entries: the bound team's enabled members for this main agent. */
export function agentTeamMemberReferences(
  catalog: AgentTeamCatalogSnapshot | null,
  workspaceType: AgentTeamWorkspaceType,
  parentAgentId: string,
  bookId?: string
): ComposerReferenceOption[] {
  if (!catalog) return [];
  return enabledTeamMembers(catalog, workspaceType, parentAgentId, bookId).map(
    (member) => ({
      id: member.id,
      label: member.name,
      detail: member.description.replace(/\s+/gu, " ").trim()
    })
  );
}
