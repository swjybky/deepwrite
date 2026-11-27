import { formatError } from "../../i18n/errors";
import { createScopedTranslator } from "../../i18n";
import { onScopeDispose, watch } from "vue";
import { defineStore } from "pinia";
import { STYLE_COMPARISON_METHOD_LIMIT } from "@deepwrite/contracts/renderer";
import {
  DEFAULT_STYLE_COMPARISON_METHOD,
  PREVIOUS_DEFAULT_STYLE_COMPARISON_METHOD
} from "./method";
import { uiMessage } from "../../ui-feedback";
import { createPromptProfile } from "../agent-runtime/promptProfile";
import { createStyleComparisonController } from "./controller";
import { deepwriteApi } from "../../api/deepwrite";
import { uiStorage } from "../../utils/uiStorage";

const t = createScopedTranslator("extras.styleComparison");

/** Where the method lived before the unified extras agent settings. */
const LEGACY_METHOD_KEY = "deepwrite.style-comparison.method.v1";
const AUTO_SAVE_DELAY_MS = 800;

function runtimeApi() {
  return deepwriteApi();
}

function api() {
  const current = runtimeApi();
  if (!current) throw new Error(t("agentUnavailable"));
  return current;
}

function takeLegacyMethod(): string | null {
  try {
    const saved = uiStorage().getItem(LEGACY_METHOD_KEY);
    uiStorage().removeItem(LEGACY_METHOD_KEY);
    return saved;
  } catch {
    return null;
  }
}

export const useStyleComparisonStore = defineStore("style-comparison", () => {
  const method = createPromptProfile(api, "style-comparison");
  const controller = createStyleComparisonController({
    api: runtimeApi,
    method,
    notifyError: (message) => uiMessage.error(message)
  });
  let autoSave: ReturnType<typeof setTimeout> | undefined;
  let ready = false;

  async function saveMethod(): Promise<void> {
    try {
      if (method.dirty.value) await method.save();
    } catch (error) {
      uiMessage.error(formatError(error, t("saveComparisonMethodFailed")));
    }
  }

  async function initialize(): Promise<void> {
    if (!runtimeApi()) return;
    try {
      await method.load();
    } catch (error) {
      uiMessage.error(formatError(error, t("loadComparisonMethodFailed")));
      return;
    }
    const legacy = takeLegacyMethod();
    // A customized localStorage method is imported once, unless the saved
    // profile was already customized.
    if (
      legacy !== null &&
      legacy.length <= STYLE_COMPARISON_METHOD_LIMIT &&
      legacy.trim() !== PREVIOUS_DEFAULT_STYLE_COMPARISON_METHOD &&
      legacy.trim() !== DEFAULT_STYLE_COMPARISON_METHOD &&
      method.profile.value?.systemPrompt === DEFAULT_STYLE_COMPARISON_METHOD
    ) {
      method.systemPrompt.value = legacy;
      await saveMethod();
    }
    ready = true;
  }

  watch(method.systemPrompt, () => {
    if (!ready || !method.dirty.value) return;
    clearTimeout(autoSave);
    autoSave = setTimeout(() => void saveMethod(), AUTO_SAVE_DELAY_MS);
  });
  void initialize();
  onScopeDispose(() => {
    clearTimeout(autoSave);
    if (ready) void saveMethod();
    controller.dispose();
  });
  return controller;
});
