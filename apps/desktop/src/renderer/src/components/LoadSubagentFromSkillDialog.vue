<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import {
  SUBAGENT_AUTHORING_MAX_SKILLS,
  type ModelConfig,
  type SkillLibrary,
  type SubagentAuthoringDraft,
  type SubagentAuthoringOutputMode,
  type SubagentAuthoringParentAgentId,
  type SubagentAuthoringRuntimeContext
} from "@deepwrite/contracts";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useId,
  watch
} from "vue";
import { buildSubagentAuthoringSkillOptions } from "../utils/subagentAuthoringSkillTree";
import { uiMessage } from "../ui-feedback";
import { buildModelSelectOptions } from "../utils/modelSelectOptions";
import SkillTreeSelect from "./SkillTreeSelect.vue";
import SubagentAuthoringDraftFields from "./SubagentAuthoringDraftFields.vue";
import SubagentAuthoringGenerateControls from "./SubagentAuthoringGenerateControls.vue";
import SubagentAuthoringOutputModeField from "./SubagentAuthoringOutputModeField.vue";

const t = createScopedTranslator("components.loadSubagentFromSkillDialog");

const props = defineProps<{
  open: boolean;
  parentAgentId: SubagentAuthoringParentAgentId;
  parentAgentLabel: string;
  existingSubagentNames: readonly string[];
  skills: readonly SkillLibrary[];
  models: readonly ModelConfig[];
  preferredModelId: string | null;
  generating: boolean;
  draft: SubagentAuthoringDraft | null;
  statusText: string | null;
  error: string | null;
}>();

const emit = defineEmits<{
  close: [];
  generate: [
    payload: {
      context: SubagentAuthoringRuntimeContext;
      modelId: string;
    }
  ];
  stop: [];
  confirm: [draft: SubagentAuthoringDraft];
}>();

const selectedSkillIds = ref<string[]>([]);
const outputMode = ref<SubagentAuthoringOutputMode>("handoff");
const modelId = ref("");
const draftName = ref("");
const draftDescription = ref("");
const draftSystemPrompt = ref("");
const titleId = useId();
const draftSection = ref<HTMLElement | null>(null);

watch(
  () => [props.open, props.error] as const,
  ([open, error], previous) => {
    if (open && error && (!previous || !previous[0] || previous[1] !== error)) {
      uiMessage.error(error);
    }
  }
);

const skillOptions = computed(() =>
  buildSubagentAuthoringSkillOptions(props.skills)
);

const modelOptions = computed(() => buildModelSelectOptions(props.models));

// Follows the order the skills were picked in, which is the order of the
// sections in the generated prompt.
const selectedSkills = computed(() => {
  const byId = new Map(skillOptions.value.map((skill) => [skill.id, skill]));
  return selectedSkillIds.value.flatMap((id) => byId.get(id) ?? []);
});

const canGenerate = computed(
  () =>
    !props.generating &&
    selectedSkills.value.length > 0 &&
    Boolean(modelId.value) &&
    Boolean(outputMode.value)
);

const canConfirm = computed(
  () =>
    !props.generating &&
    draftName.value.trim() &&
    draftDescription.value.trim() &&
    draftSystemPrompt.value.trim()
);

function toggleSkill(skillId: string): void {
  if (props.generating) return;
  const index = selectedSkillIds.value.indexOf(skillId);
  if (index >= 0) {
    selectedSkillIds.value = selectedSkillIds.value.filter(
      (id) => id !== skillId
    );
    return;
  }
  if (selectedSkillIds.value.length >= SUBAGENT_AUTHORING_MAX_SKILLS) {
    uiMessage.warning(
      t("selectUpToValueSkillsAtOnce", {
        arg0: SUBAGENT_AUTHORING_MAX_SKILLS
      })
    );
    return;
  }
  selectedSkillIds.value = [...selectedSkillIds.value, skillId];
}

function requestClose(): void {
  if (props.generating) {
    uiMessage.warning(t("generationIsRunningStopItBeforeClosing"));
    return;
  }
  emit("close");
}

function generate(): void {
  if (!canGenerate.value) {
    if (!selectedSkills.value.length)
      uiMessage.warning(t("selectAtLeastOneSkill"));
    else if (!modelId.value) uiMessage.warning(t("selectAGenerationModel"));
    return;
  }
  emit("generate", {
    modelId: modelId.value,
    context: {
      parentAgentId: props.parentAgentId,
      parentAgentLabel: props.parentAgentLabel,
      outputMode: outputMode.value,
      skills: selectedSkills.value.map((skill) => ({
        id: skill.id,
        libraryId: skill.libraryId,
        entryId: skill.entryId,
        title: skill.title,
        libraryTitle: skill.libraryTitle,
        body: skill.body
      })),
      existingSubagentNames: [...props.existingSubagentNames]
    }
  });
}

function confirmDraft(): void {
  if (!canConfirm.value) {
    uiMessage.warning(t("generateAndCompleteTheSubagentDraftFirst"));
    return;
  }
  emit("confirm", {
    name: draftName.value.trim(),
    description: draftDescription.value.trim(),
    systemPrompt: draftSystemPrompt.value.trim()
  });
}

function handleKeydown(event: KeyboardEvent): void {
  if (props.open && event.key === "Escape") requestClose();
}

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    selectedSkillIds.value = [];
    outputMode.value = "handoff";
    modelId.value =
      (props.preferredModelId &&
      props.models.some((model) => model.id === props.preferredModelId)
        ? props.preferredModelId
        : props.models[0]?.id) ?? "";
    draftName.value = "";
    draftDescription.value = "";
    draftSystemPrompt.value = "";
  }
);

watch(
  () => props.draft,
  (draft) => {
    if (!draft) return;
    draftName.value = draft.name;
    draftDescription.value = draft.description;
    draftSystemPrompt.value = draft.systemPrompt;
    void nextTick(() =>
      draftSection.value?.scrollIntoView({
        block: "start",
        behavior: "smooth"
      })
    );
  }
);

onMounted(() => document.addEventListener("keydown", handleKeydown));
onBeforeUnmount(() => document.removeEventListener("keydown", handleKeydown));
</script>
<template>
  <Teleport to="body">
    <div v-if="open" class="dialog-backdrop" @mousedown.self="requestClose">
      <section
        class="workspace-dialog load-subagent-skill-dialog"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
      >
        <header>
          <div>
            <span class="dialog-eyebrow">{{
              t("agentTeamsSkillsToSubagent")
            }}</span>
            <h2 :id="titleId">{{ t("loadFromSkillLibrary") }}</h2>
            <p class="dialog-lede">
              {{
                t("generateASubagentDraftForFromSkillsMessage", {
                  arg0: parentAgentLabel ?? ""
                })
              }}
            </p>
          </div>
          <button
            class="dialog-close"
            type="button"
            :aria-label="t('close')"
            :disabled="generating"
            @click="requestClose"
          >
            ×
          </button>
        </header>

        <div class="dialog-content authoring-body">
          <div class="authoring-columns">
            <section class="authoring-section">
              <h3 class="section-title">
                <span class="step-number">1</span>{{ t("selectSkills") }}
              </h3>
              <p class="section-hint">
                {{
                  t("selectSkillsHint", { arg0: SUBAGENT_AUTHORING_MAX_SKILLS })
                }}
              </p>
              <p v-if="!skillOptions.length" class="empty-skills">
                {{ t("noSkillEntriesAvailableAddSkillsToTheLibrary") }}
              </p>
              <SkillTreeSelect
                v-else
                :options="skillOptions"
                :selected-ids="selectedSkillIds"
                :max="SUBAGENT_AUTHORING_MAX_SKILLS"
                :disabled="generating"
                @toggle="toggleSkill"
              />
            </section>

            <div class="authoring-side">
              <section class="authoring-section">
                <h3 class="section-title">
                  <span class="step-number">2</span
                  >{{ t("confirmOutputMethod") }}
                </h3>
                <p class="section-hint">{{ t("outputMethodHint") }}</p>
                <SubagentAuthoringOutputModeField
                  v-model="outputMode"
                  name="subagent-output-mode"
                  :disabled="generating"
                />
              </section>

              <section class="authoring-section">
                <h3 class="section-title">
                  <span class="step-number">3</span>{{ t("generateDraft") }}
                </h3>
                <SubagentAuthoringGenerateControls
                  v-model="modelId"
                  :model-options="modelOptions"
                  :generating="generating"
                  :can-generate="canGenerate"
                  :status-text="statusText"
                  :error="error"
                  @generate="generate"
                  @stop="emit('stop')"
                />
              </section>
            </div>
          </div>

          <section
            v-if="draft || draftName"
            ref="draftSection"
            class="authoring-section"
          >
            <h3 class="section-title">
              <span class="step-number">4</span>{{ t("reviewDraft") }}
            </h3>
            <SubagentAuthoringDraftFields
              v-model:name="draftName"
              v-model:description="draftDescription"
              v-model:system-prompt="draftSystemPrompt"
              :disabled="generating"
            />
          </section>
        </div>

        <footer class="dialog-actions">
          <button
            type="button"
            class="dialog-secondary-button"
            :disabled="generating"
            @click="requestClose"
          >
            {{ t("cancel") }}
          </button>
          <button
            type="button"
            class="dialog-primary-button"
            :disabled="!canConfirm"
            @click="confirmDraft"
          >
            {{ t("addToTeamDraft") }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped src="./LoadSubagentFromSkillDialog.css"></style>
