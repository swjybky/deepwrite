import type { LongApplyOperationsResult } from "@deepwrite/contracts";
import type { AgentEditProposal } from "../../types/conversation";

/** Keep Core's restore point on the card so an accepted deletion can be undone. */
export function longRestorePatch(
  result: Pick<LongApplyOperationsResult, "restorePoint">
): Pick<AgentEditProposal, "discardSnapshot"> {
  return result.restorePoint
    ? { discardSnapshot: { longRestorePointId: result.restorePoint.id } }
    : {};
}
