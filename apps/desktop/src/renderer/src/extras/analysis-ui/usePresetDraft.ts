import { computed, ref, watch, type Ref } from "vue";
import { createScopedTranslator } from "../../i18n";
import { formatError } from "../../i18n/errors";
import { uiMessage } from "../../ui-feedback";
import { jsonClone } from "@deepwrite/shared";

const t = createScopedTranslator("extras.longBookAnalysis");

function fingerprint(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.fromEntries(
      Object.entries(item).sort(([left], [right]) => left.localeCompare(right))
    );
  });
}

/** Editing is isolated from authoritative settings until the user saves. */
export function usePresetDraft<T extends { id: string }>(options: {
  open: () => boolean;
  presets: () => readonly T[];
  loadDefaults: () => Promise<T[]>;
}) {
  const clone = (value: readonly T[]): T[] => jsonClone([...value]);
  const draft = ref<T[]>([]) as Ref<T[]>;
  const baseline = ref("");
  const resetting = ref(false);
  watch(
    options.open,
    (open) => {
      if (!open) return;
      draft.value = clone(options.presets());
      baseline.value = fingerprint(draft.value);
    },
    { immediate: true }
  );

  async function reset(id?: string): Promise<void> {
    if (resetting.value) return;
    resetting.value = true;
    try {
      const defaults = clone(await options.loadDefaults());
      if (id) {
        const replacement = defaults.find((preset) => preset.id === id);
        const index = draft.value.findIndex((preset) => preset.id === id);
        if (replacement && index >= 0)
          draft.value.splice(index, 1, replacement);
      } else {
        draft.value = defaults;
      }
    } catch (error) {
      uiMessage.error(formatError(error, t("restorePresetsFailed")));
    } finally {
      resetting.value = false;
    }
  }

  return {
    draft,
    dirty: computed(() => fingerprint(draft.value) !== baseline.value),
    resetting,
    reset,
    snapshot: () => clone(draft.value)
  };
}
