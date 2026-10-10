import { computed, ref, watch } from "vue";
import { createId } from "@deepwrite/shared";
import {
  LONG_MATERIAL_GUIDE_MIN_CONTEXT_WINDOW,
  type DeepWriteApi,
  type LongMaterialConvertResult,
  type LongMaterialGuideSubmission,
  type ModelConfig,
  type SystemEventEnvelope,
  type ThinkingLevel
} from "@deepwrite/contracts/renderer";
import { packT } from "./pack-labels";
import { formatError } from "../../i18n/errors";
import { uiMessage } from "../../ui-feedback";
import {
  startExtrasAgentTask,
  type ExtrasAgentTaskHandle
} from "../agent-runtime/extrasAgentTask";
import { createPromptProfile } from "../agent-runtime/promptProfile";

const t = packT;

export type MaterialGuideStatus = "idle" | "running" | "applying" | "stopping";

/**
 * One imitation-guide run: the agent submits structured text, then Core
 * writes it into the pack through `applyGuide`.
 */
export function createMaterialGuideRun(options: {
  api(): DeepWriteApi;
  onApplied(result: LongMaterialConvertResult): void;
}) {
  const profile = createPromptProfile(options.api, "long-material-guide");
  const modelId = ref("");
  const thinkingLevel = ref<ThinkingLevel>("off");
  const status = ref<MaterialGuideStatus>("idle");
  const busy = computed(() => status.value !== "idle");
  let task: ExtrasAgentTaskHandle | null = null;

  function usable(model: ModelConfig | undefined): model is ModelConfig {
    return Boolean(
      model &&
      model.enabled !== false &&
      // Main re-checks with the catalog capacity when the model omits it.
      (model.contextWindow ?? LONG_MATERIAL_GUIDE_MIN_CONTEXT_WINDOW) >=
        LONG_MATERIAL_GUIDE_MIN_CONTEXT_WINDOW
    );
  }

  async function start(packId: string, model: ModelConfig | undefined) {
    if (busy.value) return;
    if (!usable(model)) {
      uiMessage.error(t("guideNeedsModel"));
      return;
    }
    status.value = "running";
    let submission: LongMaterialGuideSubmission | undefined;
    try {
      const saved = await profile.ensureSaved();
      const api = options.api();
      const running = startExtrasAgentTask(
        api,
        {
          modelId: model.id,
          thinkingLevel: thinkingLevel.value,
          task: {
            agentId: "long-material-guide",
            profileId: saved.id,
            input: { jobId: createId("long_material_guide"), packId }
          }
        },
        {
          onOutput(output) {
            if (
              output.kind === "long-material-guide" &&
              output.packId === packId
            )
              submission = output.submission;
          }
        }
      );
      task = running;
      const outcome = await running.outcome;
      if (outcome.status === "stopped") {
        uiMessage.info(t("guideStopped"));
        return;
      }
      if (!submission) throw new Error(t("guideNoResult"));
      status.value = "applying";
      options.onApplied(
        await api.longMaterialPack.applyGuide({
          packId,
          submission,
          modelLabel: model.label
        })
      );
      uiMessage.success(t("guideDone"));
    } catch (error) {
      uiMessage.error(formatError(error, t("guideFailed")));
    } finally {
      task = null;
      status.value = "idle";
    }
  }

  async function stop() {
    if (!task || status.value !== "running") return;
    status.value = "stopping";
    try {
      await task.stop();
    } catch (error) {
      status.value = "running";
      uiMessage.error(formatError(error, t("guideFailed")));
    }
  }

  // The focus note saves itself shortly after edits, like other method notes.
  let focusSave: ReturnType<typeof setTimeout> | undefined;
  let focusReady = false;
  async function saveFocus() {
    try {
      if (profile.dirty.value) await profile.save();
    } catch (error) {
      uiMessage.error(formatError(error, t("guideFailed")));
    }
  }
  watch(profile.systemPrompt, () => {
    if (!focusReady || !profile.dirty.value) return;
    clearTimeout(focusSave);
    focusSave = setTimeout(() => void saveFocus(), 800);
  });
  function loadFocus() {
    void profile.load().then(
      () => (focusReady = true),
      (error: unknown) => uiMessage.error(formatError(error, t("guideFailed")))
    );
  }

  return {
    profile,
    loadFocus,
    modelId,
    thinkingLevel,
    status,
    busy,
    usable,
    start,
    stop,
    handleEvent(event: SystemEventEnvelope) {
      task?.handleEvent(event);
    },
    dispose() {
      clearTimeout(focusSave);
      if (focusReady) void saveFocus();
      task?.dispose();
      task = null;
    }
  };
}
