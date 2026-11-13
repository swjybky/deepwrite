import { formatError } from "../../i18n/errors";
import { createScopedTranslator } from "../../i18n";
import { ref, type Ref } from "vue";
import type {
  AgentUserInputAnswer,
  AgentUserInputRequestedPayload,
  AgentWriteApprovalResponse,
  DeepWriteApi
} from "@deepwrite/contracts";

const t = createScopedTranslator("workspace.userInput");

export interface AgentUserInputController {
  request: Ref<AgentUserInputRequestedPayload | null>;
  submitting: Ref<boolean>;
  receive(request: AgentUserInputRequestedPayload): void;
  submit(
    answers: AgentUserInputAnswer[],
    writeApproval?: AgentWriteApprovalResponse
  ): Promise<boolean>;
  clearSubmitted(runId: string): void;
  clear(runId?: string): void;
}

function cloneAnswersForIpc(
  answers: AgentUserInputAnswer[]
): AgentUserInputAnswer[] {
  return answers.map((answer) => ({
    id: answer.id,
    ...(answer.selectedOptionIds !== undefined
      ? { selectedOptionIds: [...answer.selectedOptionIds] }
      : {}),
    ...(answer.text !== undefined ? { text: answer.text } : {})
  }));
}

export function createAgentUserInputController(options: {
  api(): DeepWriteApi | undefined;
  onResume(runId: string): void;
  onError(message: string): void;
}): AgentUserInputController {
  const request = ref<AgentUserInputRequestedPayload | null>(null);
  const submitting = ref(false);
  let inFlight: AgentUserInputRequestedPayload | null = null;

  function clear(runId?: string): void {
    if (runId && (request.value ?? inFlight)?.runId !== runId) return;
    inFlight = null;
    request.value = null;
    submitting.value = false;
  }

  async function submit(
    answers: AgentUserInputAnswer[],
    writeApproval?: AgentWriteApprovalResponse
  ): Promise<boolean> {
    const pending = request.value;
    const api = options.api();
    if (!pending || !api || submitting.value) return false;
    // Dismiss immediately; transport and the model's next output must not
    // keep an already answered question on screen.
    inFlight = pending;
    request.value = null;
    submitting.value = true;
    try {
      const accepted = await api.session.submitUserInput({
        sessionId: pending.sessionId,
        runId: pending.runId,
        requestId: pending.requestId,
        answers: cloneAnswersForIpc(answers),
        ...(writeApproval
          ? {
              writeApproval: JSON.parse(
                JSON.stringify(writeApproval)
              ) as AgentWriteApprovalResponse
            }
          : {})
      });
      if (
        accepted.sessionId !== pending.sessionId ||
        accepted.runId !== pending.runId ||
        accepted.requestId !== pending.requestId
      ) {
        throw new Error(t("theUserResponseResultDoesNotMatchTheCurrent"));
      }
      if (inFlight === pending) {
        inFlight = null;
        submitting.value = false;
        options.onResume(pending.runId);
      }
      return true;
    } catch (error: unknown) {
      if (inFlight === pending) {
        inFlight = null;
        request.value = pending;
        submitting.value = false;
        options.onError(formatError(error, t("couldNotSubmitTheUserResponse")));
      }
      return false;
    }
  }

  return {
    request,
    submitting,
    receive(nextRequest) {
      inFlight = null;
      request.value = nextRequest;
      submitting.value = false;
    },
    submit,
    clearSubmitted(runId) {
      if (inFlight?.runId !== runId) return;
      clear(runId);
    },
    clear
  };
}
