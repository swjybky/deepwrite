import { onScopeDispose, watch } from "vue";
import { defineStore } from "pinia";
import { STYLE_COMPARISON_METHOD_LIMIT } from "@deepwrite/contracts/renderer";
import {
  DEFAULT_STYLE_COMPARISON_METHOD,
  PREVIOUS_DEFAULT_STYLE_COMPARISON_METHOD
} from "./method";
import { uiMessage } from "../../ui-feedback";
import { createStyleComparisonController } from "./controller";

const METHOD_KEY = "deepwrite.style-comparison.method.v1";

export const useStyleComparisonStore = defineStore("style-comparison", () => {
  const controller = createStyleComparisonController({
    api: () => window.deepwrite,
    notifyError: (message) => uiMessage.error(message)
  });
  try {
    const saved = localStorage.getItem(METHOD_KEY);
    if (
      saved === null ||
      saved.trim() === PREVIOUS_DEFAULT_STYLE_COMPARISON_METHOD
    ) {
      localStorage.setItem(METHOD_KEY, DEFAULT_STYLE_COMPARISON_METHOD);
    } else if (saved.length <= STYLE_COMPARISON_METHOD_LIMIT) {
      controller.method.value = saved;
    }
  } catch {
    controller.method.value = DEFAULT_STYLE_COMPARISON_METHOD;
  }
  watch(controller.method, (method) => {
    try {
      localStorage.setItem(METHOD_KEY, method);
    } catch {
      /* In-memory editing remains available. */
    }
  });
  onScopeDispose(controller.dispose);
  return controller;
});
