import {
  resolveLocalizedText,
  type LocalizedText
} from "../analysis-ui/localized-text";
import { createScopedTranslator } from "../../i18n";
import { computed, ref, shallowRef } from "vue";
import type {
  DeepWriteApi,
  ExtrasAgentSettingsInputOf,
  ExtrasAgentSettingsOf,
  LongMaterialGuideProfile,
  RevisionAnalysisProfile,
  StyleComparisonProfile
} from "@deepwrite/contracts/renderer";

const t = createScopedTranslator("extras.agentRuntime");

type PromptAgentId =
  "revision-analysis" | "style-comparison" | "long-material-guide";
type PromptProfile =
  RevisionAnalysisProfile | StyleComparisonProfile | LongMaterialGuideProfile;

/**
 * Edits the single method prompt of an extras agent whose page exposes one
 * profile. Runs always use the saved profile, so unsaved edits are saved
 * first by `ensureSaved`.
 */
export function createPromptProfile(
  api: () => Pick<DeepWriteApi, "extrasAgents">,
  agentId: PromptAgentId,
  /** Rejects saving an empty prompt; omit when empty means "use default". */
  emptyMessage?: LocalizedText
) {
  const profiles = shallowRef<readonly PromptProfile[]>([]);
  const systemPrompt = ref("");
  const profile = computed(
    () =>
      profiles.value.find((candidate) => candidate.id === "default") ??
      profiles.value[0] ??
      null
  );
  const dirty = computed(
    () => systemPrompt.value.trim() !== (profile.value?.systemPrompt ?? "")
  );

  /** `submitted` keeps edits typed while that text was being saved. */
  function apply(
    settings: ExtrasAgentSettingsOf<PromptAgentId>,
    submitted?: string
  ): void {
    profiles.value = settings.profiles;
    if (submitted === undefined || systemPrompt.value === submitted)
      systemPrompt.value = profile.value?.systemPrompt ?? "";
  }

  async function load(): Promise<void> {
    apply(await api().extrasAgents.profiles.list(agentId));
  }

  async function save(): Promise<void> {
    const active = profile.value;
    if (!active) throw new Error(t("methodLoading"));
    if (emptyMessage && !systemPrompt.value.trim())
      throw new Error(resolveLocalizedText(emptyMessage));
    const submitted = systemPrompt.value;
    const next = profiles.value.map(({ builtin, ...stored }) => {
      void builtin;
      return stored.id === active.id
        ? { ...stored, systemPrompt: submitted }
        : stored;
    });
    apply(
      await api().extrasAgents.profiles.save({
        agentId,
        profiles: next
      } as ExtrasAgentSettingsInputOf<PromptAgentId>),
      submitted
    );
  }

  async function reset(): Promise<void> {
    apply(await api().extrasAgents.profiles.reset(agentId, profile.value?.id));
  }

  return {
    profiles,
    systemPrompt,
    profile,
    dirty,
    load,
    save,
    reset,
    /** The saved profile a run must use, saving pending edits first. */
    async ensureSaved(): Promise<PromptProfile> {
      if (!profile.value) await load();
      if (dirty.value) await save();
      if (!profile.value) throw new Error(t("methodLoading"));
      return profile.value;
    }
  };
}
