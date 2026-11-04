import {
  ExternalAgentRunSchema,
  ExternalMutationResultSchema,
  type ExternalAgentRunInput,
  type ExternalAnswerAgentQuestionInput,
  type ExternalMutationResult,
  type ExternalOpenInAppInput,
  type ExternalRunAgentInput,
  type ExternalWindowTarget
} from "@deepwrite/contracts/external-control";
import { ExternalControlError } from "./errors";
import { findLibrary } from "./library-read-tools";
import { assertNoActiveRun, type MutationContext } from "./mutation-client";
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

function assertWindowReady(context: MutationContext): void {
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
  assertWindowReady(context);
  const target = await resolveTarget(context, input);
  await context.windowRequest({ action: "open_target", target });
  return ExternalMutationResultSchema.parse({ id: target.id });
}

/** External runs always auto-approve, so their cross-stage writes must too. */
function assertCrossStageAllowed(context: MutationContext): void {
  if (!context.generalSettings().autoApproveCrossStageOperations) {
    throw new ExternalControlError(
      "external.cross_stage_disabled",
      "DeepWrite 关闭了“跨阶段操作自动审批”。请让用户到“设置 → 常规”打开后重试。"
    );
  }
}

export async function runAgent(
  context: MutationContext,
  input: ExternalRunAgentInput
) {
  assertWindowReady(context);
  assertCrossStageAllowed(context);
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
  return parseRun(
    await context.windowRequest({ action: "run_status", runId: input.runId })
  );
}

export async function answerAgentQuestion(
  context: MutationContext,
  input: ExternalAnswerAgentQuestionInput
) {
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
  return parseRun(
    await context.windowRequest({ action: "stop_run", runId: input.runId })
  );
}
