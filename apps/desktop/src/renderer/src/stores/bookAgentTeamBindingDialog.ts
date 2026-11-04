import { ref } from "vue";
import type { AgentTeamWorkspaceType } from "@deepwrite/contracts";

export interface BookAgentTeamBindingTarget {
  bookId: string;
  title: string;
  workspaceType: AgentTeamWorkspaceType;
}

/** Book whose team binding dialog is open; set from the book action menus. */
export const bookAgentTeamBindingTarget =
  ref<BookAgentTeamBindingTarget | null>(null);
