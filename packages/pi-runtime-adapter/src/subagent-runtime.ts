import {
  SUBAGENT_CHILD_RUN_MAX_CONCURRENCY,
  SUBAGENT_DRAW_MAX_COUNT,
  SUBAGENT_DRAW_MIN_COUNT,
  SUBAGENT_DRAW_VARIANT_MAX_LENGTH,
  SUBAGENT_PARALLEL_MAX_CONCURRENCY,
  SUBAGENT_TASK_BATCH_MAX_COUNT
} from "@deepwrite/contracts";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { StringEnum, Type, type Static } from "@earendil-works/pi-ai";
import { piStrictToolSampling } from "./pi-tool-schema";
import {
  childRuntime,
  reportUnstartedSubagentTask,
  runSubagentTask,
  type SubagentTaskContext
} from "./subagent-child";
import { runSubagentDrawTask } from "./subagent-draw";
import { textResult } from "./subagent-helpers";
import {
  subagentAgentMode,
  subagentDrawLabel,
  subagentDrawSettings,
  subagentModeLabel,
  subagentsAcceptDrawVariants
} from "./subagent-mode";
import { createConcurrencyLimiter } from "./concurrency-limiter";
import { runSubagentTasks } from "./subagent-scheduler";
import {
  planSubagentTasks,
  SUBAGENT_TASK_MAX_LENGTH
} from "./subagent-task-plan";
import { createSubagentWriteLock } from "./subagent-write-lock";
import type {
  BuildSpawnSubagentToolInput,
  RuntimeSubagentDefinition,
  SubagentTaskOutcome,
  SubagentTaskRequest,
  SubagentToolDetails
} from "./subagent-types";
export * from "./subagent-types";
export { buildSubagentSystemPrompt } from "./subagent-helpers";
export { DEFAULT_SUBAGENT_TIMEOUT_MS } from "./subagent-timeout";

const BATCH_RESULT_MAX_LENGTH = 40_000;
// 60 tasks × 600 characters stays within BATCH_RESULT_MAX_LENGTH.
const BATCH_RESULT_MIN_PER_TASK = 600;
const STATUS_LABELS: Record<SubagentTaskOutcome["status"], string> = {
  completed: "已完成",
  error: "失败",
  aborted: "已中止",
  skipped: "已跳过"
};

function spawnParameters(definitions: readonly RuntimeSubagentDefinition[]) {
  const taskKey = Type.String({
    minLength: 1,
    maxLength: 40,
    pattern: "^[A-Za-z0-9][A-Za-z0-9_-]*$"
  });
  // Only teams with an auto-count draw member see the field at all.
  const drawVariants = subagentsAcceptDrawVariants(definitions)
    ? {
        draw_variants: Type.Optional(
          Type.Array(
            Type.String({
              minLength: 1,
              maxLength: SUBAGENT_DRAW_VARIANT_MAX_LENGTH
            }),
            {
              description: `仅用于标有［按需抽卡］的成员。每条写一份候选相对 task 的差异要求，条数就是抽卡份数，${SUBAGENT_DRAW_MIN_COUNT} 到 ${SUBAGENT_DRAW_MAX_COUNT} 条。各份共同的背景和要求写在 task 里，这里只写差异。不需要多个版本时不填，任务只运行一次。`
            }
          )
        )
      }
    : {};
  return Type.Object({
    tasks: Type.Array(
      Type.Object({
        key: Type.Optional(
          Type.String({
            ...taskKey,
            description:
              "任务标识，供 depends_on 引用；不填时按位置自动编为 t1、t2……"
          })
        ),
        subagent_id: StringEnum(definitions.map((definition) => definition.id)),
        task: Type.String({
          minLength: 1,
          maxLength: SUBAGENT_TASK_MAX_LENGTH
        }),
        depends_on: Type.Optional(
          Type.Array(taskKey, { description: "必须先完成的任务 key。" })
        ),
        library_id: Type.Optional(
          Type.String({
            minLength: 1,
            maxLength: 512,
            description: "管理子智能体的目标绑定库 id；普通团队成员不填写。"
          })
        ),
        ...drawVariants
      }),
      // The count limit is checked at execution (planSubagentTasks): a schema
      // `maxItems` would reject the whole call before any task ran.
      { minItems: 1 }
    )
  });
}

function spawnDescription(
  definitions: readonly RuntimeSubagentDefinition[],
  parallel: boolean,
  workspaceWrites: boolean
): string {
  return [
    parallel
      ? `调用预先配置的子智能体完成明确、边界清晰的子任务。当前团队已开启并行：互不依赖的任务同时运行，最多 ${SUBAGENT_PARALLEL_MAX_CONCURRENCY} 个。调用会阻塞到全部任务结束，只返回各任务的最终交接摘要。`
      : "调用预先配置的子智能体完成明确、边界清晰的子任务。tasks 按依赖关系和列表顺序逐个执行；调用会阻塞到全部任务结束，只返回各任务的最终交接摘要。单个委派只需提交一个任务。",
    `单次调用最多 ${SUBAGENT_TASK_BATCH_MAX_COUNT} 个任务；任务多于可同时运行的数量时会自动排队，无需自行分批。`,
    "depends_on 填写必须先完成的任务 key：前置任务失败时本任务跳过，前置交接摘要会自动提供给本任务。每个任务都要独立写清背景与要求，子智能体看不到彼此的过程。",
    ...(parallel && workspaceWrites
      ? [
          "把前后无关的子任务放进同一次调用，让它们并行。并行任务的写入由系统逐个执行，但先后顺序和是否冲突由你安排：不要让并行任务修改同一对象；某任务要读取或接着改另一任务的成果，用 depends_on 排在它后面；新增、删除对象和提交连续性记录要按需要的顺序用 depends_on 串起来。后写的任务发现对象已被改动会被拒绝并要求重读。"
        ]
      : []),
    ...(definitions.some(
      (definition) => subagentAgentMode(definition) !== "standard"
    )
      ? [
          "带［纯净］标记的成员是受限运行模式：只读成员不能修改作品，无工具成员既看不到作品与素材也不能调用任何工具，需要写入时交给常规成员，或自行根据它们的交接摘要写入。"
        ]
      : []),
    ...(subagentsAcceptDrawVariants(definitions)
      ? [
          `带［按需抽卡］标记的成员由你决定每次抽几份：用户指明了份数或差异方向，就照用户的写；只说了份数，由你拟定互不相同、贴合任务的方向；用户没提但任务明显值得多试（标题、开头、关键段落的不同处理），可以自行决定份数，宁少勿多。用户要的份数超过 ${SUBAGENT_DRAW_MAX_COUNT}，按 ${SUBAGENT_DRAW_MAX_COUNT} 份执行，并在回复里告诉用户。draw_variants 写的是同一任务的不同处理方向（语气、节奏、视角、切入点、篇幅），不同的任务拆成多个 task；不要在 task 里要求成员给几个版本。`
        ]
      : []),
    "用户消息里写作 #成员名 的是点名：对应工作必须交给该成员，不要自己做或改派他人。",
    "可用子智能体：",
    ...definitions.map((definition) => {
      const label = subagentModeLabel(subagentAgentMode(definition));
      const draw = subagentDrawSettings(definition);
      return `- ${definition.name} (${definition.id})${label ?? ""}${draw ? subagentDrawLabel(draw) : ""}：${definition.description}`;
    })
  ].join("\n");
}

/** Drops `write_scope`, which earlier versions of this tool accepted. */
function withoutLegacyWriteScope(tasks: unknown): unknown {
  if (!Array.isArray(tasks)) return tasks;
  return tasks.map((task: unknown) => {
    if (typeof task !== "object" || task === null || !("write_scope" in task)) {
      return task;
    }
    const { write_scope: _legacy, ...rest } = task as Record<string, unknown>;
    return rest;
  });
}

/** Older conversations called the tool with one flat task or `write_scope`. */
function normalizeSpawnArguments(args: unknown): unknown {
  if (typeof args !== "object" || args === null) return args;
  if ("tasks" in args) {
    return {
      ...args,
      tasks: withoutLegacyWriteScope((args as { tasks: unknown }).tasks)
    };
  }
  const legacy = args as Record<string, unknown>;
  if (legacy.subagent_id === undefined) return args;
  return {
    tasks: [
      {
        subagent_id: legacy.subagent_id,
        task: legacy.task,
        ...(legacy.library_id !== undefined
          ? { library_id: legacy.library_id }
          : {})
      }
    ]
  };
}

function formatSpawnResult(
  tasks: readonly SubagentTaskRequest[],
  outcomes: ReadonlyMap<string, SubagentTaskOutcome>
): string {
  if (tasks.length === 1) return outcomes.get(tasks[0]!.key)!.summary;
  const counts = new Map<SubagentTaskOutcome["status"], number>();
  for (const outcome of outcomes.values()) {
    counts.set(outcome.status, (counts.get(outcome.status) ?? 0) + 1);
  }
  const perTask = Math.max(
    BATCH_RESULT_MIN_PER_TASK,
    Math.floor(BATCH_RESULT_MAX_LENGTH / tasks.length)
  );
  return [
    `子智能体任务已全部结束：共 ${tasks.length} 个，完成 ${counts.get("completed") ?? 0} 个，失败 ${counts.get("error") ?? 0} 个，中止 ${counts.get("aborted") ?? 0} 个，跳过 ${counts.get("skipped") ?? 0} 个。`,
    ...tasks.map((task) => {
      const outcome = outcomes.get(task.key)!;
      const summary =
        outcome.summary.length > perTask
          ? `${outcome.summary.slice(0, perTask)}…（已截断）`
          : outcome.summary;
      return `【${task.key}｜${task.definition.name}｜${STATUS_LABELS[outcome.status]}】\n${summary}`;
    })
  ].join("\n\n");
}

/**
 * Builds the sole delegation capability exposed to a parent creative-workspace
 * agent. One call submits a task list; every task runs in a fresh, uncached
 * child Agent, concurrently only when the team enables parallel mode.
 */
export function buildSpawnSubagentTool(
  input: BuildSpawnSubagentToolInput
): AgentTool | undefined {
  const definitions = input.definitions.filter(
    (definition) => definition.enabled
  );
  if (definitions.length === 0 || (input.depth ?? 0) > 0) return undefined;
  const parallel = input.parallel === true;
  const workspaceWrites = input.workspaceAccess !== "none";
  const parameters = spawnParameters(definitions);

  const tool: AgentTool<typeof parameters, SubagentToolDetails> = {
    name: "spawn_subagent",
    label: "调用子智能体",
    description: spawnDescription(definitions, parallel, workspaceWrites),
    parameters,
    ...piStrictToolSampling(parameters),
    prepareArguments: (args) =>
      normalizeSpawnArguments(args) as Static<typeof parameters>,
    executionMode: "sequential",
    execute: async (
      parentToolCallId: string,
      params: Static<typeof parameters>,
      signal?: AbortSignal,
      onUpdate?: (partialResult: AgentToolResult<SubagentToolDetails>) => void
    ): Promise<AgentToolResult<SubagentToolDetails>> => {
      signal = input.parentSignal
        ? AbortSignal.any([input.parentSignal, ...(signal ? [signal] : [])])
        : signal;
      signal?.throwIfAborted();
      if ((input.depth ?? 0) !== 0) {
        throw new Error("子智能体不允许递归调用 spawn_subagent。");
      }
      const normalized = normalizeSpawnArguments(params) as {
        tasks?: unknown;
      };
      const tasks = planSubagentTasks(normalized.tasks, definitions);
      if (tasks.length > 1) {
        // Queued cards show member names and final ordering at once.
        onUpdate?.(
          textResult(`已排定 ${tasks.length} 个子任务。`, {
            kind: "subagent-progress",
            progress: {
              type: "planned",
              parentToolCallId,
              tasks: tasks.map((request) => ({
                index: request.index,
                key: request.key,
                dependsOn: [...request.dependsOn],
                subagentId: request.definition.id,
                name: request.definition.name,
                task: request.task,
                runtime: childRuntime(input, request),
                ...(request.draw ? { drawCount: request.draw.count } : {})
              }))
            }
          })
        );
      }
      const writeLock = createSubagentWriteLock();
      const limiter = createConcurrencyLimiter(
        SUBAGENT_CHILD_RUN_MAX_CONCURRENCY
      );
      const contextFor = (
        request: SubagentTaskRequest
      ): SubagentTaskContext => ({
        parentToolCallId,
        request,
        ...(tasks.length > 1
          ? {
              batchTask: {
                index: request.index,
                key: request.key,
                dependsOn: [...request.dependsOn]
              }
            }
          : {}),
        ...(signal ? { signal } : {}),
        writeLock,
        ...(onUpdate ? { onUpdate } : {})
      });
      const outcomes = await runSubagentTasks({
        tasks,
        maxConcurrency: parallel ? SUBAGENT_PARALLEL_MAX_CONCURRENCY : 1,
        ...(signal ? { signal } : {}),
        runTask: (request, handoffs) => {
          const settings = subagentDrawSettings(request.definition);
          return request.draw && settings
            ? runSubagentDrawTask(
                input,
                contextFor(request),
                handoffs,
                settings,
                request.draw,
                limiter
              )
            : limiter.run(() =>
                runSubagentTask(input, contextFor(request), handoffs)
              );
        },
        settleUnstarted: (request, outcome) =>
          reportUnstartedSubagentTask(input, contextFor(request), outcome)
      });
      return textResult(formatSpawnResult(tasks, outcomes), {
        kind: "subagent-result"
      });
    }
  };
  return tool;
}
