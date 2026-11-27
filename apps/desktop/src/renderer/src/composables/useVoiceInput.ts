import { createScopedTranslator } from "../i18n";
import { computed, nextTick, onScopeDispose, ref, watch, type Ref } from "vue";
import type {
  VoiceApi,
  VoiceProfileId,
  VoiceTranscribeResult
} from "@deepwrite/contracts/renderer";
import { uiMessage } from "../ui-feedback";
import type { RecordedVoice } from "../utils/voiceAudio";
import {
  createVoiceRecorder,
  type VoiceRecorder
} from "../utils/voiceRecorder";
import { deepwriteApi } from "../api/deepwrite";

const t = createScopedTranslator("workspace.voiceInput");

export type VoiceInputState =
  "idle" | "starting" | "recording" | "transcribing" | "error";

interface VoiceInputOptions {
  sessionKey: () => string;
  draft: () => string;
  input: Ref<HTMLTextAreaElement | null | undefined>;
  updateDraft: (text: string) => void;
  canStart?: () => boolean;
  canSend?: () => boolean;
  send?: () => void;
  profileId?: () => VoiceProfileId | undefined;
  onTranscribed?: (result: VoiceTranscribeResult) => void;
}

interface VoiceInputDependencies {
  api?: VoiceApi;
  createRecorder?: typeof createVoiceRecorder;
}

let cancelActiveInput: (() => void) | undefined;
const WAVE_HISTORY_LENGTH = 256;

function voiceError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "NotAllowedError")
      return t("microphoneAccessIsDisabledAllowDeepwriteToUseThe");
    if (error.name === "NotFoundError" || error.name === "OverconstrainedError")
      return t("theSelectedMicrophoneWasNotFoundSelectAnotherIn");
    if (error.name === "NotReadableError")
      return t("theMicrophoneIsUnavailableCheckWhetherItIsDisconnected");
    return error.message;
  }
  return t("speechRecognitionFailedPleaseTryAgain");
}

export function useVoiceInput(
  options: VoiceInputOptions,
  dependencies: VoiceInputDependencies = {}
) {
  const state = ref<VoiceInputState>("idle");
  const elapsedMs = ref(0);
  const levels = ref<number[]>(Array<number>(WAVE_HISTORY_LENGTH).fill(0));
  const active = computed(() => state.value !== "idle");
  const canRetry = computed(() => state.value === "error" && !!recorded);
  const api = (): VoiceApi => {
    const voiceApi = dependencies.api ?? deepwriteApi()?.voice;
    if (!voiceApi)
      throw new Error(t("voiceInputIsOnlyAvailableInTheDesktopApp"));
    return voiceApi;
  };
  let epoch = 0;
  let recorder: VoiceRecorder | undefined;
  let controller: AbortController | undefined;
  let recorded: RecordedVoice | undefined;
  let profileId: VoiceProfileId | undefined;
  let requestId: string | undefined;
  let sessionKey = "";
  let originalDraft = "";
  let selectionStart = 0;
  let selectionEnd = 0;

  function isCurrent(token: number): boolean {
    return token === epoch && sessionKey === options.sessionKey();
  }

  function releaseRecording(): void {
    controller?.abort();
    controller = undefined;
    recorder?.cancel();
    recorder = undefined;
  }

  function cancel(): void {
    epoch++;
    releaseRecording();
    if (requestId)
      void api()
        .cancel({ requestId })
        .catch(() => undefined);
    requestId = undefined;
    recorded = undefined;
    state.value = "idle";
    if (cancelActiveInput === cancel) cancelActiveInput = undefined;
  }

  async function start(): Promise<void> {
    if (options.canStart?.() === false) return;
    cancelActiveInput?.();
    cancel();
    cancelActiveInput = cancel;
    const token = epoch;
    sessionKey = options.sessionKey();
    originalDraft = options.draft();
    selectionStart =
      options.input.value?.selectionStart ?? originalDraft.length;
    selectionEnd = options.input.value?.selectionEnd ?? selectionStart;
    elapsedMs.value = 0;
    levels.value = Array<number>(WAVE_HISTORY_LENGTH).fill(0);
    state.value = "starting";
    try {
      const settings = await api().getSettings();
      if (!isCurrent(token)) return;
      profileId = options.profileId?.() ?? settings.activeProfileId;
      if (
        !settings.profiles.find((profile) => profile.id === profileId)
          ?.hasApiKey
      )
        throw new Error(t("saveTheSelectedProviderSApiKeyInSettings"));
      const allowed = await api().requestMicrophoneAccess();
      if (!isCurrent(token)) return;
      if (!allowed)
        throw new Error(t("microphoneAccessIsDisabledAllowDeepwriteToUseThe"));
      controller = new AbortController();
      const nextRecorder = await (
        dependencies.createRecorder ?? createVoiceRecorder
      )({
        microphoneId: settings.microphoneId,
        signal: controller.signal,
        onProgress(duration, level) {
          if (!isCurrent(token)) return;
          elapsedMs.value = duration;
          levels.value = [...levels.value.slice(1), level];
        },
        onLimit: () => {
          void stop();
        },
        onEnded: () => {
          if (!isCurrent(token)) return;
          cancel();
          uiMessage.error(
            t("theMicrophoneDisconnectedThisRecordingWasCanceled")
          );
        }
      });
      if (!isCurrent(token)) {
        nextRecorder.cancel();
        return;
      }
      recorder = nextRecorder;
      state.value = "recording";
    } catch (error) {
      if (!isCurrent(token)) return;
      cancel();
      uiMessage.error(voiceError(error));
    }
  }

  async function transcribe(sendAfter: boolean): Promise<void> {
    if (!recorded || !profileId) return;
    const token = epoch;
    const id = crypto.randomUUID();
    requestId = id;
    state.value = "transcribing";
    try {
      const result = await api().transcribe({
        requestId: id,
        profileId,
        ...recorded
      });
      if (!isCurrent(token)) return;
      if (result.requestId !== id || result.profileId !== profileId)
        throw new Error(t("theSpeechRecognitionResponseDoesNotMatchPleaseTry"));
      const text = result.text.trim();
      if (!text) throw new Error(t("noSpeechWasRecognizedTryAgainOrRecordA"));
      const currentDraft = options.draft();
      const unchanged = currentDraft === originalDraft;
      const startAt = unchanged ? selectionStart : currentDraft.length;
      const endAt = unchanged ? selectionEnd : currentDraft.length;
      options.updateDraft(
        `${currentDraft.slice(0, startAt)}${text}${currentDraft.slice(endAt)}`
      );
      requestId = undefined;
      recorded = undefined;
      state.value = "idle";
      if (cancelActiveInput === cancel) cancelActiveInput = undefined;
      options.onTranscribed?.(result);
      await nextTick();
      if (!isCurrent(token)) return;
      const caret = startAt + text.length;
      options.input.value?.focus();
      options.input.value?.setSelectionRange(caret, caret);
      if (sendAfter && options.canSend?.()) options.send?.();
    } catch (error) {
      if (!isCurrent(token)) return;
      requestId = undefined;
      state.value = "error";
      uiMessage.error(voiceError(error));
    }
  }

  async function finish(sendAfter: boolean): Promise<void> {
    if (state.value !== "recording" || !recorder) return;
    try {
      recorded = recorder.stop();
      releaseRecording();
    } catch (error) {
      cancel();
      uiMessage.error(voiceError(error));
      return;
    }
    await transcribe(sendAfter);
  }

  function stop(): Promise<void> {
    return finish(false);
  }
  function stopAndSend(): Promise<void> {
    return finish(true);
  }
  async function retry(): Promise<void> {
    if (canRetry.value) await transcribe(false);
  }

  watch(options.sessionKey, cancel, { flush: "sync" });
  watch(
    () => options.canStart?.() ?? true,
    (available) => {
      if (!available) cancel();
    },
    { flush: "sync" }
  );
  const cancelWhenHidden = (): void => {
    if (document.hidden) cancel();
  };
  if (typeof document !== "undefined")
    document.addEventListener("visibilitychange", cancelWhenHidden);
  if (typeof window !== "undefined")
    window.addEventListener("pagehide", cancel);
  onScopeDispose(() => {
    cancel();
    if (typeof document !== "undefined")
      document.removeEventListener("visibilitychange", cancelWhenHidden);
    if (typeof window !== "undefined")
      window.removeEventListener("pagehide", cancel);
  });
  return {
    state,
    active,
    elapsedMs,
    levels,
    canRetry,
    start,
    stop,
    stopAndSend,
    retry,
    cancel
  };
}
