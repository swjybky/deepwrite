<script setup lang="ts">
import type { AgentUserInputDraw } from "@deepwrite/contracts/renderer";
import { computed, onBeforeUnmount, onMounted, ref, useId } from "vue";
import { createScopedTranslator, locale } from "../i18n";
import StreamedContent from "./StreamedContent.vue";
import {
  drawCandidateLength,
  drawCandidateNumber
} from "./subagentDrawCandidates";

const t = createScopedTranslator("components.subagentDrawPicker");

const props = defineProps<{
  draw: AgentUserInputDraw;
  initialId: string;
  submitting: boolean;
}>();
const note = defineModel<string>("note", { required: true });
const emit = defineEmits<{
  adopt: [candidateId: string];
  close: [];
}>();

const titleId = useId();
const candidates = computed(() => props.draw.candidates);
/** The left pane starts on the card's candidate, the right on the next. */
function initialPanes(): [string, string] {
  const index = Math.max(
    0,
    candidates.value.findIndex((item) => item.id === props.initialId)
  );
  const next = candidates.value[(index + 1) % candidates.value.length]!;
  return [candidates.value[index]!.id, next.id];
}
const panes = ref<[string, string]>(initialPanes());

function candidateOf(id: string) {
  return (
    candidates.value.find((item) => item.id === id) ?? candidates.value[0]!
  );
}

function lengthLabel(text: string): string {
  return t("valueCharacters", {
    arg0: drawCandidateLength(text).toLocaleString(locale.value)
  });
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") emit("close");
}
onMounted(() => document.addEventListener("keydown", handleKeydown));
onBeforeUnmount(() => document.removeEventListener("keydown", handleKeydown));
</script>

<template>
  <Teleport to="body">
    <div class="dialog-backdrop" @mousedown.self="emit('close')">
      <section
        class="workspace-dialog draw-compare-dialog"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
      >
        <header>
          <div>
            <h2 :id="titleId">{{ t("compareSideBySide") }}</h2>
            <p class="draw-compare-subtitle">
              {{ draw.name }} ·
              {{ t("valueCandidates", { arg0: candidates.length }) }}
            </p>
          </div>
          <button
            class="dialog-close"
            type="button"
            :aria-label="t('close')"
            @click="emit('close')"
          >
            ×
          </button>
        </header>

        <div class="draw-compare-panes">
          <section
            v-for="(paneId, paneIndex) in panes"
            :key="paneIndex"
            class="draw-compare-pane"
            :aria-label="t(paneIndex === 0 ? 'leftPane' : 'rightPane')"
          >
            <div class="draw-compare-tabs" role="tablist">
              <button
                v-for="candidate in candidates"
                :key="candidate.id"
                type="button"
                role="tab"
                class="draw-compare-tab"
                :class="{ 'is-active': candidate.id === paneId }"
                :aria-selected="candidate.id === paneId"
                :title="candidate.variant"
                @click="panes[paneIndex] = candidate.id"
              >
                {{ drawCandidateNumber(candidate) }}
              </button>
            </div>
            <div class="draw-compare-meta">
              <strong>{{
                t("candidateValue", {
                  arg0: drawCandidateNumber(candidateOf(paneId))
                })
              }}</strong>
              <span>{{ lengthLabel(candidateOf(paneId).text) }}</span>
              <button
                type="button"
                class="dialog-primary-button"
                :disabled="submitting"
                @click="emit('adopt', paneId)"
              >
                {{ t("adoptThisOne") }}
              </button>
            </div>
            <p
              v-if="candidateOf(paneId).variant"
              class="draw-compare-variant"
              :title="candidateOf(paneId).variant"
            >
              {{
                t("variantValue", { arg0: candidateOf(paneId).variant ?? "" })
              }}
            </p>
            <div class="draw-compare-preview" role="tabpanel">
              <StreamedContent
                :content="candidateOf(paneId).text"
                format="markdown"
              />
            </div>
          </section>
        </div>

        <footer class="draw-compare-footer">
          <input
            v-model="note"
            type="text"
            :maxlength="4000"
            :placeholder="t('noteForThePrimaryAgentOptional')"
            :aria-label="t('noteForThePrimaryAgent')"
            :disabled="submitting"
          />
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.draw-compare-dialog {
  width: min(1120px, calc(100vw - 48px));
  height: min(820px, calc(100vh - 60px));
}

.draw-compare-subtitle {
  margin: 2px 0 0;
  color: var(--text-tertiary);
  font-size: 0.785714rem;
}

.draw-compare-panes {
  display: grid;
  flex: 1;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  min-height: 0;
  padding: 0 20px;
}

/* A column, so the optional focus line never takes the preview's row. */
.draw-compare-pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  min-height: 0;
}

.draw-compare-tabs,
.draw-compare-meta,
.draw-compare-variant {
  flex: 0 0 auto;
}

.draw-compare-variant {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 0.785714rem;
  line-height: 1.5;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.draw-compare-tabs {
  display: flex;
  gap: 5px;
  overflow-x: auto;
}

.draw-compare-tab {
  flex: none;
  min-width: 30px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 8px;
  background: var(--surface-main);
  color: var(--text-secondary);
  font: inherit;
  font-size: 0.785714rem;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}

.draw-compare-tab:hover {
  background: var(--surface-hover);
}

.draw-compare-tab.is-active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--text-primary);
  font-weight: 650;
}

.draw-compare-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.draw-compare-meta span {
  flex: 1;
  color: var(--text-tertiary);
  font-size: 0.75rem;
}

.draw-compare-preview {
  flex: 1 1 auto;
  min-height: 0;
  padding: 12px 14px;
  overflow: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--theme-line-soft);
  border-radius: 12px;
  background: var(--surface-raised);
  font-size: 0.892857rem;
  line-height: 1.7;
}

.draw-compare-footer {
  padding: 14px 20px 18px;
}

.draw-compare-footer input {
  width: 100%;
  min-height: 34px;
  box-sizing: border-box;
  padding: 6px 10px;
  border: 1px solid var(--theme-line);
  border-radius: 9px;
  outline: 0;
  background: var(--surface-main);
  color: var(--text-primary);
  font: inherit;
}

.draw-compare-footer input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}

@media (max-width: 760px) {
  .draw-compare-panes {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: repeat(2, minmax(0, 1fr));
  }
}
</style>
