import {
  SUBAGENT_DRAW_MAX_COUNT,
  SUBAGENT_DRAW_MIN_COUNT,
  SUBAGENT_DRAW_VARIANT_MAX_LENGTH,
  SUBAGENT_TASK_BATCH_MAX_COUNT
} from "@deepwrite/contracts";
import { subagentDrawSettings } from "./subagent-mode";
import type {
  RuntimeSubagentDefinition,
  SubagentDrawPlan,
  SubagentTaskRequest
} from "./subagent-types";

/** Also the limit of the task text progress events carry. */
export const SUBAGENT_TASK_MAX_LENGTH = 20_000;
const TASK_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;

interface RawSubagentTask {
  key?: unknown;
  subagent_id?: unknown;
  task?: unknown;
  depends_on?: unknown;
  library_id?: unknown;
  draw_variants?: unknown;
}

function stringArray(value: unknown, field: string, key: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`任务 ${key} 的 ${field} 必须是字符串数组。`);
  }
  return value.map((item: string) => item.trim()).filter(Boolean);
}

function stringList(value: unknown, field: string, key: string): string[] {
  return [...new Set(stringArray(value, field, key))];
}

/**
 * Fixed draws keep the member's count. Auto draws take one draw per listed
 * requirement; none runs the task once, and a single one joins the task.
 */
function planDraw(
  definition: RuntimeSubagentDefinition,
  key: string,
  task: string,
  rawVariants: unknown
): { task: string; draw?: SubagentDrawPlan } {
  const variants = stringArray(rawVariants, "draw_variants", key);
  const settings = subagentDrawSettings(definition);
  const auto = settings?.countMode === "auto";
  if (variants.length > 0 && !auto) {
    throw new Error(
      settings
        ? `成员「${definition.name}」每次固定抽 ${settings.count} 份，不接受 draw_variants，未执行任何任务。去掉任务 ${key} 的 draw_variants 即可。`
        : `只有按需抽卡成员接受 draw_variants，成员「${definition.name}」不是，未执行任何任务。去掉任务 ${key} 的 draw_variants 即可。`
    );
  }
  if (!settings) return { task };
  if (!auto) return { task, draw: { count: settings.count } };
  const tooLong = variants.findIndex(
    (variant) => variant.length > SUBAGENT_DRAW_VARIANT_MAX_LENGTH
  );
  if (tooLong >= 0) {
    throw new Error(
      `任务 ${key} 的第 ${tooLong + 1} 条 draw_variants 超过 ${SUBAGENT_DRAW_VARIANT_MAX_LENGTH} 字，未执行任何任务。共同要求写进 task，这里只写差异。`
    );
  }
  if (variants.length > SUBAGENT_DRAW_MAX_COUNT) {
    throw new Error(
      `任务 ${key} 的 draw_variants 有 ${variants.length} 条，超过上限 ${SUBAGENT_DRAW_MAX_COUNT}，未执行任何任务。请删减到 ${SUBAGENT_DRAW_MAX_COUNT} 条以内。`
    );
  }
  if (variants.length >= SUBAGENT_DRAW_MIN_COUNT) {
    return { task, draw: { count: variants.length, variants } };
  }
  if (variants.length === 0) return { task };
  const joined = `${task}\n\n【补充要求】${variants[0]}`;
  if (joined.length > SUBAGENT_TASK_MAX_LENGTH) {
    throw new Error(
      `任务 ${key} 并入 draw_variants 后超过 ${SUBAGENT_TASK_MAX_LENGTH} 字，未执行任何任务。请精简 task。`
    );
  }
  return { task: joined };
}

function assertAcyclic(tasks: readonly SubagentTaskRequest[]): void {
  const byKey = new Map(tasks.map((task) => [task.key, task]));
  const state = new Map<string, "visiting" | "done">();
  const visit = (key: string, path: string[]): void => {
    if (state.get(key) === "done") return;
    if (state.get(key) === "visiting") {
      throw new Error(`任务依赖形成循环：${[...path, key].join(" → ")}。`);
    }
    state.set(key, "visiting");
    for (const dependency of byKey.get(key)?.dependsOn ?? []) {
      visit(dependency, [...path, key]);
    }
    state.set(key, "done");
  };
  for (const task of tasks) visit(task.key, []);
}

/**
 * Validates one `spawn_subagent` task list. Throwing returns the message to
 * the parent model as a tool error so it can correct the arrangement.
 */
export function planSubagentTasks(
  rawTasks: unknown,
  definitions: readonly RuntimeSubagentDefinition[]
): SubagentTaskRequest[] {
  if (!Array.isArray(rawTasks) || rawTasks.length === 0) {
    throw new Error(
      `tasks 必须包含 1 到 ${SUBAGENT_TASK_BATCH_MAX_COUNT} 个子任务。`
    );
  }
  if (rawTasks.length > SUBAGENT_TASK_BATCH_MAX_COUNT) {
    throw new Error(
      `tasks 必须包含 1 到 ${SUBAGENT_TASK_BATCH_MAX_COUNT} 个子任务，本次提交了 ${rawTasks.length} 个，未执行任何任务。请按依赖关系拆成多次调用，每次不超过 ${SUBAGENT_TASK_BATCH_MAX_COUNT} 个。`
    );
  }
  const keys = new Set<string>();
  const tasks = rawTasks.map((value: unknown, index): SubagentTaskRequest => {
    const raw = (
      typeof value === "object" && value !== null ? value : {}
    ) as RawSubagentTask;
    const key =
      typeof raw.key === "string" && raw.key.trim()
        ? raw.key.trim()
        : `t${index + 1}`;
    if (!TASK_KEY_PATTERN.test(key)) {
      throw new Error(
        `任务 key「${key}」无效：只能使用字母、数字、下划线和连字符，最长 40 个字符。`
      );
    }
    if (keys.has(key)) throw new Error(`任务 key 重复：${key}。`);
    keys.add(key);

    const subagentId = String(raw.subagent_id ?? "");
    const definition = definitions.find(
      (candidate) => candidate.id === subagentId
    );
    if (!definition) {
      throw new Error(`未知或已停用的子智能体：${subagentId}`);
    }
    const libraryManager = definition.toolSource === "library-management";
    const libraryId =
      typeof raw.library_id === "string" && raw.library_id.trim()
        ? raw.library_id.trim()
        : undefined;
    if (!libraryManager && libraryId) {
      throw new Error("普通团队成员不能指定资料库管理目标。");
    }
    const rawTask = String(raw.task ?? "").trim();
    if (!rawTask) throw new Error("子智能体任务不能为空。");
    const { task, draw } = planDraw(
      definition,
      key,
      rawTask,
      raw.draw_variants
    );

    return {
      index,
      key,
      definition,
      task,
      ...(libraryId ? { libraryId } : {}),
      dependsOn: stringList(raw.depends_on, "depends_on", key),
      ...(libraryManager ? { exclusive: true } : {}),
      ...(draw ? { draw } : {})
    };
  });

  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      if (dependency === task.key) {
        throw new Error(`任务 ${task.key} 不能依赖自己。`);
      }
      if (!keys.has(dependency)) {
        throw new Error(`任务 ${task.key} 依赖了不存在的任务：${dependency}。`);
      }
    }
  }
  assertAcyclic(tasks);
  return tasks;
}
