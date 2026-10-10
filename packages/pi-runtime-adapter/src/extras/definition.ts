import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { FauxResponseStep } from "@earendil-works/pi-ai";
import type {
  ExtrasAgentId,
  ExtrasAgentOutput,
  ExtrasAgentResolvedTaskOf,
  ExtrasConversationAgentId
} from "@deepwrite/contracts";
import type {
  DecompositionQuery,
  DecompositionQueryResult,
  DecompositionSubmitInput,
  DecompositionReceipt,
  DecompositionTopicPlanInput,
  DecompositionUnit
} from "@deepwrite/contracts";
import type { BuildSpawnSubagentToolInput } from "../subagent-types";
import type { ContextTaskKind, ToolCompactor } from "../kernel/context/types";
import type { LongCommandExecutor } from "../long-agent-tools";

export type ExtrasTaskAgentId = Exclude<
  ExtrasAgentId,
  ExtrasConversationAgentId
>;

/** Run-scoped services a definition may hand to its tools. */
export interface ExtrasAgentRunServices {
  runId: string;
  sessionId: string;
  localFaux?: boolean;
  /** Agent Utility -> Core query bridge, authorized by Main per run. */
  longCommandExecutor?: LongCommandExecutor;
  decompositionQuery?(
    jobId: string,
    request: DecompositionQuery
  ): Promise<DecompositionQueryResult>;
  bookIdentitySubmit?(
    input: import("@deepwrite/contracts").BookIdentitySubmitInput
  ): Promise<import("@deepwrite/contracts").BookIdentityRoundReceipt>;
  decompositionSubmit?(
    input: DecompositionSubmitInput
  ): Promise<DecompositionReceipt>;
  decompositionPlanTopic?(
    input: DecompositionTopicPlanInput
  ): Promise<{ unitId: string; unit: DecompositionUnit }>;
}

export interface ExtrasTaskOrchestration {
  definitions: BuildSpawnSubagentToolInput["definitions"];
  prepareChild: NonNullable<BuildSpawnSubagentToolInput["prepareChild"]>;
}

/**
 * Developer-owned half of an extras agent. Users customize the profile's
 * system prompt; tools, the run boundary and the output contract stay here.
 *
 * System prompts are layered the same way for every agent: the profile prompt
 * first, then the non-editable `【<title>运行边界】` section.
 */
interface ExtrasAgentDefinitionBase<A extends ExtrasAgentId> {
  id: A;
  boundaryTitle: string;
  boundary(task: ExtrasAgentResolvedTaskOf<A>): string[];
  tools(
    task: ExtrasAgentResolvedTaskOf<A>,
    services: ExtrasAgentRunServices
  ): AgentTool[];
}

/** Runs one self-contained task per run; the task becomes the user message. */
export interface ExtrasTaskAgentDefinition<
  A extends ExtrasTaskAgentId
> extends ExtrasAgentDefinitionBase<A> {
  interaction?: "task";
  /**
   * `data` keeps the profile prompt out of the system prompt and hands it to
   * `userMessage` as task data instead, so it can adjust the analysis but not
   * the boundary or output contract.
   */
  profilePrompt?: "system" | "data";
  orchestration?(
    task: ExtrasAgentResolvedTaskOf<A>,
    services: ExtrasAgentRunServices
  ): ExtrasTaskOrchestration;
  contextTask?: ContextTaskKind;
  toolCompactors?: Readonly<Record<string, ToolCompactor>>;
  userMessage(task: ExtrasAgentResolvedTaskOf<A>): string;
  /** Phase-specific result tool that must successfully submit before completion. */
  requiredOutputTool?(task: ExtrasAgentResolvedTaskOf<A>): string;
  /** Parses the result from the final message for agents without a result tool. */
  finalOutput?(content: string): ExtrasAgentOutput;
  /** Shown when the final message is cut off before the output is complete. */
  truncatedOutputMessage?: string;
  faux(task: ExtrasAgentResolvedTaskOf<A>, runId: string): FauxResponseStep[];
}

/**
 * Holds a conversation: every run answers the user's latest turn, and the
 * Agent Utility keeps the conversation cached under `conversationKey`.
 */
export interface ExtrasConversationAgentDefinition<
  A extends ExtrasConversationAgentId
> extends ExtrasAgentDefinitionBase<A> {
  interaction: "conversation";
  /** Distinguishes cached conversations of one session, e.g. per project. */
  conversationKey(task: ExtrasAgentResolvedTaskOf<A>): string;
  webSearch?(task: ExtrasAgentResolvedTaskOf<A>): boolean;
  faux(
    task: ExtrasAgentResolvedTaskOf<A>,
    turn: { message: string; thinking: boolean }
  ): FauxResponseStep[];
}

interface BoundExtrasAgentBase {
  agentId: ExtrasAgentId;
  systemPrompt: string;
  tools(services: ExtrasAgentRunServices): AgentTool[];
}

/** A definition bound to one resolved task, so callers need no agent switch. */
export interface BoundExtrasTaskAgent extends BoundExtrasAgentBase {
  interaction: "task";
  jobId: string;
  orchestration?(services: ExtrasAgentRunServices): ExtrasTaskOrchestration;
  contextTask?: ContextTaskKind;
  toolCompactors?: Readonly<Record<string, ToolCompactor>>;
  userMessage: string;
  requiredOutputTool?: string;
  finalOutput?(content: string): ExtrasAgentOutput;
  truncatedOutputMessage?: string;
  faux(runId: string): FauxResponseStep[];
}

export interface BoundExtrasConversationAgent extends BoundExtrasAgentBase {
  interaction: "conversation";
  conversationKey: string;
  webSearchEnabled: boolean;
  faux(turn: { message: string; thinking: boolean }): FauxResponseStep[];
}

export type BoundExtrasAgent =
  BoundExtrasTaskAgent | BoundExtrasConversationAgent;

export function composeExtrasSystemPrompt(
  profilePrompt: string | undefined,
  boundaryTitle: string,
  boundary: readonly string[]
): string {
  return [
    ...(profilePrompt?.trim() ? [profilePrompt.trim(), ""] : []),
    `【${boundaryTitle}运行边界】`,
    ...boundary
  ].join("\n");
}

export function bindExtrasAgent<A extends ExtrasTaskAgentId>(
  definition: ExtrasTaskAgentDefinition<A>,
  task: ExtrasAgentResolvedTaskOf<A>
): BoundExtrasTaskAgent {
  // Widened from the generic task: TypeScript cannot read shared fields
  // through `Extract<…, { agentId: A }>` directly.
  const { profile, input } =
    task as ExtrasAgentResolvedTaskOf<ExtrasTaskAgentId>;
  return {
    interaction: "task",
    agentId: definition.id,
    jobId: input.jobId,
    systemPrompt: composeExtrasSystemPrompt(
      definition.profilePrompt === "data" ? undefined : profile.systemPrompt,
      definition.boundaryTitle,
      definition.boundary(task)
    ),
    userMessage: definition.userMessage(task),
    ...(definition.requiredOutputTool
      ? { requiredOutputTool: definition.requiredOutputTool(task) }
      : {}),
    tools: (services) => definition.tools(task, services),
    ...(definition.orchestration
      ? {
          orchestration: (services: ExtrasAgentRunServices) =>
            definition.orchestration!(task, services)
        }
      : {}),
    ...(definition.contextTask ? { contextTask: definition.contextTask } : {}),
    ...(definition.toolCompactors
      ? { toolCompactors: definition.toolCompactors }
      : {}),
    ...(definition.finalOutput
      ? { finalOutput: definition.finalOutput.bind(definition) }
      : {}),
    ...(definition.truncatedOutputMessage
      ? { truncatedOutputMessage: definition.truncatedOutputMessage }
      : {}),
    faux: (runId) => definition.faux(task, runId)
  };
}

export function bindExtrasConversationAgent<
  A extends ExtrasConversationAgentId
>(
  definition: ExtrasConversationAgentDefinition<A>,
  task: ExtrasAgentResolvedTaskOf<A>
): BoundExtrasConversationAgent {
  const { profile } =
    task as ExtrasAgentResolvedTaskOf<ExtrasConversationAgentId>;
  return {
    interaction: "conversation",
    agentId: definition.id,
    systemPrompt: composeExtrasSystemPrompt(
      profile.systemPrompt,
      definition.boundaryTitle,
      definition.boundary(task)
    ),
    tools: (services) => definition.tools(task, services),
    conversationKey: `${definition.id}:${definition.conversationKey(task)}`,
    webSearchEnabled: definition.webSearch?.(task) === true,
    faux: (turn) => definition.faux(task, turn)
  };
}
