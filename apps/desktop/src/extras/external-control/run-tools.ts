import {
  ExternalAgentRunSchema,
  ExternalMutationResultSchema,
  ExternalRestartAppResultSchema,
  type ExternalAgentRunInput,
  type ExternalAnswerAgentQuestionInput,
  type ExternalMutationResult,
  type ExternalOpenInAppInput,
  type ExternalRestartAppInput,
  type ExternalRestartAppResult,
  type ExternalRunAgentInput,
  type ExternalWindowTarget
} from "@deepwrite/contracts/external-control";
import { ExternalControlError } from "./errors";
import { findLibrary } from "./library-read-tools";
import { assertNoActiveRun, type MutationContext } from "./mutation-client";
import type { ExternalControlAppState } from "./tool-routes";
import { getWork, readCatalogIndex } from "./work-read-tools";

const { parse: parseRun } = ExternalAgentRunSchema;

async function resolveTarget(
  context: MutationContext,
  input: { workId?: string | undefined; libraryId?: string | undefined }
): Promise<ExternalWindowTarget> {
  const { workId, libraryId } = input;
  if ((workId === undefined) === (libraryId === undefined)) {
    throw new ExternalControlError(
      "external.invalid_input",
      "需要且只能传 workId 或 libraryId 其中一个。"
    );
  }
  if (workId) {
    const { type } = await getWork(context.core, { workId });
    return { kind: type, id: workId };
  }
  const { value } = findLibrary(
    await readCatalogIndex(context.core),
    libraryId as string
  );
  return { kind: "library", id: value.id };
}

async function maybeEnsureWindow(context: MutationContext): Promise<void> {
  if (!context.rendererReady() && context.ensureWindow) {
    await context.ensureWindow();
  }
}

async function ensureWindowReady(context: MutationContext): Promise<void> {
  await maybeEnsureWindow(context);
  if (!context.rendererReady()) {
    throw new ExternalControlError(
      "external.not_ready",
      "DeepWrite 窗口还没有加载完成。请稍后重试。"
    );
  }
}

export async function openInApp(
  context: MutationContext,
  input: ExternalOpenInAppInput
): Promise<ExternalMutationResult> {
  await ensureWindowReady(context);
  const target = await resolveTarget(context, input);
  await context.windowRequest({ action: "open_target", target });
  return ExternalMutationResultSchema.parse({ id: target.id });
}

export async function runAgent(
  context: MutationContext,
  input: ExternalRunAgentInput
) {
  await ensureWindowReady(context);
  assertNoActiveRun(context, [input.workId ?? input.libraryId ?? ""]);
  const target = await resolveTarget(context, input);
  return parseRun(
    await context.windowRequest({
      action: "start_run",
      target,
      message: input.message,
      ...(input.newConversation ? { newConversation: true } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.mode ? { mode: input.mode } : {})
    })
  );
}

export async function getAgentRun(
  context: MutationContext,
  input: ExternalAgentRunInput
) {
  await maybeEnsureWindow(context);
  return parseRun(
    await context.windowRequest({ action: "run_status", runId: input.runId })
  );
}

export async function answerAgentQuestion(
  context: MutationContext,
  input: ExternalAnswerAgentQuestionInput
) {
  await maybeEnsureWindow(context);
  return parseRun(
    await context.windowRequest({
      action: "answer_run",
      runId: input.runId,
      answers: input.answers
    })
  );
}

export async function stopAgentRun(
  context: MutationContext,
  input: ExternalAgentRunInput
) {
  await maybeEnsureWindow(context);
  return parseRun(
    await context.windowRequest({ action: "stop_run", runId: input.runId })
  );
}

export async function restartApp(
  state: ExternalControlAppState,
  input: ExternalRestartAppInput
): Promise<ExternalRestartAppResult> {
  if (!state.requestRestart) {
    throw new ExternalControlError(
      "external.not_ready",
      "当前 DeepWrite 运行环境不支持外部重启。"
    );
  }
  const force = input.force === true;
  if (!force && state.activeRunCount() > 0) {
    throw new ExternalControlError(
      "external.busy",
      "当前有智能体正在运行，暂时不能重启 DeepWrite。请等待任务结束、先调用 stop_agent_run，或传 force: true 强制重启。"
    );
  }
  return ExternalRestartAppResultSchema.parse(
    await state.requestRestart({ force })
  );
}
