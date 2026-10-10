import {
  ExtrasAgentResolvedTaskSchema,
  LongMaterialGuideEvidenceSchema,
  longMaterialGuideEvidenceTokens,
  type CommandEnvelope,
  type ExtrasAgentTask
} from "@deepwrite/contracts";
import type { ExtrasAgentCommandContext } from "../index";
import type { ExtrasAgentConfigStore } from "../config-store";
import type { ExtrasTaskResolution } from "../task-resolver";
import { longMaterialCore } from "./commands";

/** The saved profile plus evidence Core sizes to the resolved model. */
export async function resolveLongMaterialGuideTask(
  context: Pick<
    ExtrasAgentCommandContext,
    "core" | "coreLong" | "getWorkspaceDirectory"
  >,
  configStore: ExtrasAgentConfigStore,
  command: CommandEnvelope,
  task: Extract<ExtrasAgentTask, { agentId: "long-material-guide" }>,
  capacity: {
    contextWindow?: number | undefined;
    maxTokens?: number | undefined;
  }
): Promise<ExtrasTaskResolution> {
  const result = await longMaterialCore(context, command, {
    operation: "evidence",
    packId: task.input.packId,
    evidenceTokens: longMaterialGuideEvidenceTokens(capacity)
  });
  if (result.status !== "accepted") throw new Error(result.error.message);
  return {
    task: ExtrasAgentResolvedTaskSchema.parse({
      agentId: task.agentId,
      profile: await configStore.resolve(task.agentId, task.profileId),
      input: {
        ...task.input,
        ...LongMaterialGuideEvidenceSchema.parse(result.payload)
      }
    })
  };
}
