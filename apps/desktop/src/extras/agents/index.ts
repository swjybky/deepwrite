import {
  controlWithUsage,
  handleDecompositionCommands
} from "./long-book-decomposition/commands";
import { resolveDecompositionTask } from "./long-book-decomposition/task-resolution";
import { handleLongMaterialPackCommands } from "./long-material-pack/commands";
import { resolveLongMaterialGuideTask } from "./long-material-pack/task-resolution";
import type { BrowserWindow, Dialog } from "electron";
import type { CommandEnvelope, CommandResult } from "@deepwrite/contracts";
import { ExtrasAgentConfigStore } from "./config-store";
import { runExtrasAgent, type ExtrasAgentRunDependencies } from "./run-service";
import { handleLongBookSourceCommands } from "./sources/long-book-source-commands";
import { handleShortBookSourceCommands } from "./sources/short-book-source-commands";

export interface ExtrasAgentCommandContext extends Omit<
  ExtrasAgentRunDependencies,
  "configStore"
> {
  evaluationMode?: boolean;
  dialog: Pick<Dialog, "showOpenDialog">;
  getMainWindow(): BrowserWindow;
  getWorkspaceDirectory(): Promise<string | null>;
  core(command: CommandEnvelope): Promise<CommandResult>;
  /** Core with a longer timeout, for whole-book conversions. */
  coreLong?(command: CommandEnvelope): Promise<CommandResult>;
}

async function handleConfigCommand(
  configStore: ExtrasAgentConfigStore,
  command: CommandEnvelope
): Promise<CommandResult | undefined> {
  try {
    let payload: unknown;
    if (command.type === "extrasAgentConfig.list") {
      payload = await configStore.list(command.payload.agentId);
    } else if (command.type === "extrasAgentConfig.save") {
      payload = await configStore.save(command.payload);
    } else if (command.type === "extrasAgentConfig.reset") {
      payload = await configStore.reset(
        command.payload.agentId,
        command.payload.profileId
      );
    } else {
      return undefined;
    }
    return { status: "accepted", requestId: command.id, payload };
  } catch (error: unknown) {
    return {
      status: "rejected",
      requestId: command.id,
      error: {
        code: "extras_agent.settings_failed",
        message: error instanceof Error ? error.message : "更新分析预设失败。"
      }
    };
  }
}

/**
 * Main-side entry of the "更多功能" agent service: profile settings, runs,
 * and the source imports the analyses read from.
 */
export function createExtrasAgentService(userDataPath: string) {
  const configStore = new ExtrasAgentConfigStore(userDataPath);
  return {
    configStore,
    async handle(
      context: ExtrasAgentCommandContext,
      command: CommandEnvelope
    ): Promise<CommandResult | undefined> {
      if (command.type === "extrasAgent.run") {
        return runExtrasAgent(
          {
            ...context,
            configStore: () => configStore,
            resolveDecomposition: (task) =>
              resolveDecompositionTask(context, command, task),
            resolveLongMaterialGuide: (task, capacity) =>
              resolveLongMaterialGuideTask(
                context,
                configStore,
                command,
                task,
                capacity
              ),
            cancelDecomposition: async (resolution, code) => {
              if (!resolution.decompositionJobId) return;
              await controlWithUsage(context, command, {
                jobId: resolution.decompositionJobId,
                action:
                  code === "agent.capacity_reached" ||
                  code === "agent.extras_capacity_reached"
                    ? "stop"
                    : "finish-package",
                attemptId: resolution.decompositionAttemptId,
                error: "工作包启动失败，请检查模型设置后重试。"
              });
            }
          },
          command
        );
      }
      return (
        (await handleLongMaterialPackCommands(context, command)) ??
        (await handleDecompositionCommands(context, configStore, command)) ??
        (await handleConfigCommand(configStore, command)) ??
        (await handleShortBookSourceCommands(context, command)) ??
        handleLongBookSourceCommands(context, command)
      );
    }
  };
}

export type ExtrasAgentService = ReturnType<typeof createExtrasAgentService>;
