import { assertRevisionAnalysisBudget } from "@deepwrite/contracts";
import { RevisionAnalysisConfigStore } from "./revision-analysis/config-store";
import type {
  AgentProviderRuntimeConfig,
  CommandEnvelope,
  WorkspaceRuntimeContext
} from "@deepwrite/contracts";
import { LongBookAnalysisConfigStore } from "./long-book-analysis/config-store";
import { LongBookAnalysisPlanStore } from "./long-book-analysis/plan-store";
import { handleLongBookAnalysisCommands } from "./long-book-analysis/commands";
import { ShortBookAnalysisConfigStore } from "./short-book-analysis/config-store";
import {
  handleShortBookAnalysisCommands,
  type ShortAnalysisCommandContext
} from "./short-book-analysis/commands";
import { resolveShortAnalysisProfile } from "./short-book-analysis/run-profile";
/** Main owns preset resolution; source snapshot writes are delegated to Core. */
export function createBookAnalysisServices(userDataPath: string) {
  const revision = new RevisionAnalysisConfigStore(userDataPath);
  const long = new LongBookAnalysisConfigStore(userDataPath);
  // Batch plans live beside the preset config, under the same userData root.
  const longPlans = new LongBookAnalysisPlanStore(userDataPath);
  const short = new ShortBookAnalysisConfigStore(userDataPath);
  return {
    async handle(
      context: Omit<ShortAnalysisCommandContext, "configStore">,
      command: CommandEnvelope
    ) {
      return (
        (await revision.handle(command)) ??
        (await handleShortBookAnalysisCommands(
          { ...context, configStore: () => short },
          command
        )) ??
        handleLongBookAnalysisCommands(
          { ...context, configStore: () => long, planStore: () => longPlans },
          command
        )
      );
    },
    async resolve(
      context: WorkspaceRuntimeContext | undefined,
      model: AgentProviderRuntimeConfig | undefined
    ) {
      if (context?.revisionAnalysis) {
        if (!model) throw new Error("请选择可用模型。");
        assertRevisionAnalysisBudget(context.revisionAnalysis, model);
      }
      const shortBookAnalysisProfile = await resolveShortAnalysisProfile(
        context?.shortBookAnalysis,
        short,
        model
      );
      const longBookAnalysisProfile = context?.longBookAnalysis
        ? await long.resolve(context.longBookAnalysis.presetId)
        : undefined;
      return {
        ...(shortBookAnalysisProfile ? { shortBookAnalysisProfile } : {}),
        ...(longBookAnalysisProfile ? { longBookAnalysisProfile } : {})
      };
    }
  };
}
