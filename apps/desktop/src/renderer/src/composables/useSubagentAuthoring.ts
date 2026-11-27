import { createScopedTranslator } from "../i18n";
import {
  SUBAGENT_AUTHORING_SKILL_BODY_MAX_LENGTH,
  SubagentAuthoringDraftSchema,
  type SubagentAuthoringDraft,
  type SubagentAuthoringRuntimeContext,
  type SystemEventEnvelope
} from "@deepwrite/contracts";
import { createId } from "@deepwrite/shared";
import { computed, ref, type Ref } from "vue";
import { formatError } from "../i18n/errors";

const t = createScopedTranslator("workspace.subagentAuthoring");

type SessionApi = {
  prompt: (payload: {
    sessionId: string;
    message: string;
    modelId?: string;
    workspaceContext?: { subagentAuthoring: SubagentAuthoringRuntimeContext };
  }) => Promise<{ sessionId: string; runId: string }>;
  abort: (payload: { sessionId: string; runId: string }) => Promise<unknown>;
};

type CatalogApi = {
  readDocument: (input: {
    projectId: string;
    target: "document";
    documentId: string;
  }) => Promise<{ content: string }>;
};

export type SubagentAuthoringRunStatus =
  "idle" | "starting" | "running" | "stopping" | "completed" | "error";

export interface UseSubagentAuthoringOptions {
  api: () => { session: SessionApi; catalog?: CatalogApi } | undefined;
  createId?: (prefix: string) => string;
}

async function hydrateSkillBodies(
  context: SubagentAuthoringRuntimeContext,
  catalog: CatalogApi | undefined
): Promise<SubagentAuthoringRuntimeContext> {
  const skills = await Promise.all(
    context.skills.map(async (skill) => {
      if (skill.body || !skill.libraryId || !skill.entryId || !catalog) {
        return skill;
      }
      const document = await catalog.readDocument({
        projectId: skill.libraryId,
        target: "document",
        documentId: skill.entryId
      });
      return {
        ...skill,
        body: document.content.slice(
          0,
          SUBAGENT_AUTHORING_SKILL_BODY_MAX_LENGTH
        )
      };
    })
  );
  return { ...context, skills };
}

export interface SubagentAuthoringController {
  draft: Ref<SubagentAuthoringDraft | null>;
  status: Ref<SubagentAuthoringRunStatus>;
  error: Ref<string | null>;
  statusText: Ref<string | null>;
  isBusy: Ref<boolean>;
  generate: (
    context: SubagentAuthoringRuntimeContext,
    modelId: string
  ) => Promise<boolean>;
  stop: () => Promise<void>;
  reset: () => void;
  handleEvent: (event: SystemEventEnvelope) => void;
}

function fallbackId(prefix: string): string {
  return createId(prefix);
}

export function useSubagentAuthoring(
  options: UseSubagentAuthoringOptions
): SubagentAuthoringController {
  const makeId = options.createId ?? fallbackId;
  const sessionId = ref(makeId("subagent_authoring_session"));
  const draft = ref<SubagentAuthoringDraft | null>(null);
  const status = ref<SubagentAuthoringRunStatus>("idle");
  const error = ref<string | null>(null);
  const statusText = ref<string | null>(null);
  const activeRunId = ref<string | null>(null);
  const observedRunId = ref<string | null>(null);
  let stopRequested = false;

  const isBusy = computed(
    () =>
      status.value === "starting" ||
      status.value === "running" ||
      status.value === "stopping"
  );

  function reset(): void {
    if (isBusy.value) return;
    sessionId.value = makeId("subagent_authoring_session");
    draft.value = null;
    status.value = "idle";
    error.value = null;
    statusText.value = null;
    activeRunId.value = null;
    observedRunId.value = null;
    stopRequested = false;
  }

  function bindRun(runId: string): boolean {
    if (activeRunId.value && activeRunId.value !== runId) return false;
    if (observedRunId.value && observedRunId.value !== runId) return false;
    observedRunId.value = runId;
    activeRunId.value = runId;
    if (!stopRequested) status.value = "running";
    return true;
  }

  async function generate(
    context: SubagentAuthoringRuntimeContext,
    modelId: string
  ): Promise<boolean> {
    const api = options.api();
    if (!api) {
      error.value = t("agentsAreNotAvailableInThisEnvironment");
      status.value = "error";
      return false;
    }
    if (isBusy.value) {
      error.value = t("generationIsInProgressStopItOrWaitFor");
      return false;
    }
    if (!modelId.trim()) {
      error.value = t("addAnAvailableModelInModelSettingsFirst");
      status.value = "error";
      return false;
    }

    sessionId.value = makeId("subagent_authoring_session");
    draft.value = null;
    error.value = null;
    statusText.value = t("readingSelectedSkillContent");
    status.value = "starting";
    activeRunId.value = null;
    observedRunId.value = null;
    stopRequested = false;

    try {
      const runtimeContext = await hydrateSkillBodies(context, api.catalog);
      if (stopRequested) {
        status.value = "idle";
        statusText.value = null;
        return false;
      }
      statusText.value = t("generatingASubagentDraftFromTheSelectedSkills");
      const modeLabel =
        runtimeContext.outputMode === "write"
          ? t("writeDirectlyToDocuments")
          : t("returnFindingsOnly");
      const skillTitles = runtimeContext.skills
        .map((skill) => `${skill.libraryTitle} · ${skill.title}`)
        .join("、");
      const message = [
        t("generateASubagentDraftForUsingTheSelectedSkills", {
          parentAgentLabel: runtimeContext.parentAgentLabel
        }),
        t("outputModeConfirmedByTheUser", {
          modeLabel: modeLabel
        }),
        t("selectedSkills", {
          skillTitles: skillTitles
        }),
        t("readTheSkillContentFirstThenCallWriteSubagent")
      ].join("\n");
      const accepted = await api.session.prompt({
        sessionId: sessionId.value,
        message,
        modelId,
        workspaceContext: { subagentAuthoring: runtimeContext }
      });
      if (stopRequested) {
        status.value = "idle";
        statusText.value = null;
        return false;
      }
      bindRun(accepted.runId);
      return true;
    } catch (cause: unknown) {
      status.value = "error";
      error.value = formatError(cause, t("failedToGenerateTheSubagentDraft"));
      statusText.value = null;
      return false;
    }
  }

  async function stop(): Promise<void> {
    const api = options.api();
    if (!api || !activeRunId.value || !isBusy.value) return;
    stopRequested = true;
    status.value = "stopping";
    statusText.value = t("stopping");
    try {
      await api.session.abort({
        sessionId: sessionId.value,
        runId: activeRunId.value
      });
    } catch (cause: unknown) {
      error.value = formatError(cause, t("failedToStopGeneration"));
      status.value = "error";
      statusText.value = null;
    }
  }

  function handleEvent(event: SystemEventEnvelope): void {
    if (
      event.type !== "agent.turn_started" &&
      event.type !== "agent.retry_scheduled" &&
      event.type !== "agent.message_delta" &&
      event.type !== "agent.message_completed" &&
      event.type !== "agent.error" &&
      event.type !== "tool.call_requested" &&
      event.type !== "tool.execution_completed" &&
      event.type !== "subagent_authoring.draft_updated"
    ) {
      return;
    }
    if (event.payload.sessionId !== sessionId.value) return;
    if (!bindRun(event.payload.runId)) return;

    if (event.type === "agent.retry_scheduled") {
      const retryNumber = Math.max(1, event.payload.nextAttempt - 1);
      const maxRetries = Math.max(1, event.payload.maxAttempts - 1);
      statusText.value = t("networkInterruptionRetryingInS", {
        ceil: Math.ceil(event.payload.delayMs / 1_000),
        retryNumber: retryNumber,
        maxRetries: maxRetries
      });
      return;
    }

    if (event.type === "agent.turn_started") {
      if (event.payload.attempt > 1) {
        const retryNumber = event.payload.attempt - 1;
        const maxRetries = Math.max(1, event.payload.maxAttempts - 1);
        statusText.value = t("retrying", {
          retryNumber: retryNumber,
          maxRetries: maxRetries
        });
      }
      return;
    }

    if (event.type === "subagent_authoring.draft_updated") {
      const parsed = SubagentAuthoringDraftSchema.safeParse(
        event.payload.draft
      );
      if (parsed.success) {
        draft.value = parsed.data;
        statusText.value = t("draftUpdatedConfirmToAddItToTheTeam");
      }
      return;
    }

    if (event.type === "tool.call_requested") {
      statusText.value = t("calling", {
        toolName: event.payload.toolName
      });
      return;
    }

    if (event.type === "agent.message_completed") {
      status.value = draft.value ? "completed" : "error";
      if (!draft.value) {
        error.value = t(
          "generationFinishedWithoutASubagentDraftPleaseTryAgain"
        );
        statusText.value = null;
      } else {
        statusText.value = t("draftReadyConfirmToAddItToTheCurrent");
      }
      activeRunId.value = null;
      return;
    }

    if (event.type === "agent.error") {
      status.value = "error";
      error.value =
        event.payload.message || t("failedToGenerateTheSubagentDraft");
      statusText.value = null;
      activeRunId.value = null;
    }
  }

  return {
    draft,
    status,
    error,
    statusText,
    isBusy,
    generate,
    stop,
    reset,
    handleEvent
  };
}
