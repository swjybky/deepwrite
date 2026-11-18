import type { MysteryWorkspaceRuntimeContext } from "@deepwrite/contracts";
import { MysteryWorkspaceRuntimeContextSchema } from "@deepwrite/contracts/renderer";

/** Mystery context validation is only needed when a user submits a turn. */
export function validateMysteryRuntimeContext(
  context: MysteryWorkspaceRuntimeContext
): MysteryWorkspaceRuntimeContext {
  return MysteryWorkspaceRuntimeContextSchema.parse(context);
}
