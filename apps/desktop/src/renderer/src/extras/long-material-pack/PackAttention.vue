<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from "vue";
import { packT as t, statusLabel } from "./pack-labels";
import {
  useLongMaterialPackStore,
  type PackDecision
} from "./useLongMaterialPack";

const store = useLongMaterialPackStore();
const items = computed(() =>
  (store.result?.entries ?? []).flatMap((entry) =>
    entry.status === "conflict" ||
    entry.status === "stale" ||
    entry.status === "deleted"
      ? [{ ...entry, status: entry.status }]
      : []
  )
);
const choices = ref<Record<string, PackDecision>>({});
const removals = ref<string[]>([]);
watch(
  () => store.result,
  () => {
    choices.value = {};
    removals.value = [];
  }
);
const pending = computed(() => Object.keys(choices.value).length);
function choose(key: string, decision: PackDecision | null) {
  const next = { ...choices.value };
  if (decision) next[key] = decision;
  else delete next[key];
  choices.value = next;
}
function chooseAll(decision: "overwrite" | null) {
  for (const item of items.value)
    if (item.status === "conflict") choose(item.key, decision);
}
function toggleRemoval(key: string, checked: boolean) {
  removals.value = checked
    ? [...removals.value, key]
    : removals.value.filter((value) => value !== key);
}
const hint = (status: string) =>
  status === "conflict"
    ? t("conflictHint")
    : status === "stale"
      ? t("staleHint")
      : t("deletedHint");

const confirming = ref(false);
const cancelButton = ref<HTMLButtonElement | null>(null);
const titleId = useId();
async function askRemove() {
  confirming.value = true;
  await nextTick();
  cancelButton.value?.focus();
}
async function remove() {
  const decisions = Object.fromEntries(
    removals.value.map((key) => [key, "remove" as const])
  );
  confirming.value = false;
  await store.resolve(decisions);
}
</script>

<template>
  <section
    v-if="items.length"
    class="analysis-card pack-card"
    :aria-label="t('attentionTitle')"
  >
    <div class="analysis-card-heading pack-heading">
      <h2>{{ t("attentionTitle") }}</h2>
    </div>
    <ul class="pack-attention">
      <li v-for="item in items" :key="item.key">
        <span class="pack-status" :class="`is-${item.status}`">{{
          statusLabel(item.status)
        }}</span>
        <span class="pack-attention-text">
          <strong>{{ item.title }}</strong>
          <span class="pack-muted">{{ hint(item.status) }}</span>
        </span>
        <span
          v-if="item.status === 'conflict'"
          class="pack-segmented"
          role="group"
        >
          <button
            type="button"
            :class="{ 'is-active': !choices[item.key] }"
            :disabled="store.busy"
            @click="choose(item.key, null)"
          >
            {{ t("keepMine") }}
          </button>
          <button
            type="button"
            :class="{ 'is-active': choices[item.key] === 'overwrite' }"
            :disabled="store.busy"
            @click="choose(item.key, 'overwrite')"
          >
            {{ t("overwrite") }}
          </button>
        </span>
        <label v-else-if="item.status === 'stale'" class="pack-radio">
          <input
            type="checkbox"
            :checked="removals.includes(item.key)"
            :disabled="store.busy"
            @change="
              toggleRemoval(
                item.key,
                ($event.target as HTMLInputElement).checked
              )
            "
          />
          {{ t("select") }}
        </label>
        <button
          v-else
          type="button"
          :class="{ 'is-active': choices[item.key] === 'regenerate' }"
          :disabled="store.busy"
          @click="choose(item.key, choices[item.key] ? null : 'regenerate')"
        >
          {{ t("regenerate") }}
        </button>
      </li>
    </ul>
    <div class="pack-actions">
      <button
        type="button"
        class="pack-link"
        :disabled="store.busy"
        @click="chooseAll(null)"
      >
        {{ t("keepMine") }}
      </button>
      <button
        type="button"
        class="pack-link"
        :disabled="store.busy"
        @click="chooseAll('overwrite')"
      >
        {{ t("overwrite") }}
      </button>
      <span class="pack-spacer" />
      <button
        v-if="removals.length"
        type="button"
        class="pack-danger-button"
        :disabled="store.busy"
        @click="askRemove"
      >
        {{ t("removeSelected", { count: removals.length }) }}
      </button>
      <button
        type="button"
        class="analysis-primary-button"
        :disabled="store.busy || !pending"
        @click="store.resolve(choices)"
      >
        {{ t("applyDecisions") }}
      </button>
    </div>
    <Teleport to="body">
      <div
        v-if="confirming"
        class="analysis-refresh-backdrop"
        @mousedown.self="confirming = false"
      >
        <section
          class="analysis-refresh-dialog"
          role="alertdialog"
          aria-modal="true"
          :aria-labelledby="titleId"
          @keydown.esc="confirming = false"
        >
          <h2 :id="titleId">
            {{ t("removeTitle", { count: removals.length }) }}
          </h2>
          <p>{{ t("removeDescription") }}</p>
          <div class="analysis-refresh-dialog-actions">
            <button
              ref="cancelButton"
              type="button"
              @click="confirming = false"
            >
              {{ t("cancel") }}
            </button>
            <button type="button" class="pack-danger-button" @click="remove">
              {{ t("confirmRemove") }}
            </button>
          </div>
        </section>
      </div>
    </Teleport>
  </section>
</template>
