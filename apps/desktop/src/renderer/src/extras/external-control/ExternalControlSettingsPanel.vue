<script setup lang="ts">
import type { ExternalControlOverview } from "@deepwrite/contracts/renderer";
import { computed, onMounted, ref } from "vue";
import DeleteLongDraftSectionDialog from "../../components/DeleteLongDraftSectionDialog.vue";
import { createScopedTranslator, locale } from "../../i18n";
import { getErrorPayload } from "../../i18n/errors";
import { uiMessage } from "../../ui-feedback";

import skillUrl from "../../../../extras/external-control/skill/SKILL.md?url";

const t = createScopedTranslator("extras.externalControl");
const foundation = createScopedTranslator("foundation");

const props = defineProps<{ externalControlEnabled: boolean }>();
const emit = defineEmits<{
  updateExternalControlEnabled: [enabled: boolean];
}>();

function toggleExternalControl(event: Event): void {
  const input = event.target as HTMLInputElement;
  emit("updateExternalControlEnabled", input.checked);
  input.checked = props.externalControlEnabled;
}

const overview = ref<ExternalControlOverview | null>(null);
/** Only the row that was clicked waits; the rest of the page stays usable. */
const pendingKey = ref<string | null>(null);
const confirmingEmpty = ref(false);
const selectedConfigId = ref("claude");

type TrashKind = ExternalControlOverview["trash"][number]["kind"];

const kindLabels: Record<TrashKind, () => string> = {
  section: () => t("kindSection"),
  entry: () => t("kindEntry"),
  team: () => t("kindTeam"),
  project: () => t("kindProject")
};

const trashCount = computed(() => overview.value?.trash.length ?? 0);
const selectedConfig = computed(() =>
  overview.value?.configs.find(({ id }) => id === selectedConfigId.value)
);

function formatTime(value: string): string {
  const time = new Date(value);
  return Number.isNaN(time.getTime())
    ? value
    : time.toLocaleString(locale.value, {
        dateStyle: "short",
        timeStyle: "short"
      });
}

function configHint(config: ExternalControlOverview["configs"][number]) {
  if (config.kind === "command") return t("commandHint");
  return config.file ? t("fileHint", { file: config.file }) : t("jsonHint");
}

async function run(
  key: string,
  action: () => Promise<ExternalControlOverview>,
  done?: string
): Promise<void> {
  if (pendingKey.value) return;
  pendingKey.value = key;
  try {
    overview.value = await action();
    if (done) uiMessage.success(done);
  } catch (cause: unknown) {
    uiMessage.error(getErrorPayload(cause)?.message ?? t("loadFailed"));
  } finally {
    pendingKey.value = null;
  }
}

function api() {
  const value = window.deepwrite?.externalControl;
  if (!value) throw new Error(t("loadFailed"));
  return value;
}

async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    uiMessage.success(t("copied"));
  } catch {
    uiMessage.error(t("copyFailed"));
  }
}

async function emptyTrash(): Promise<void> {
  await run("empty", () => api().emptyTrash(), t("emptied"));
  confirmingEmpty.value = false;
}

onMounted(() => void run("load", () => api().overview()));
</script>

<template>
  <section class="settings-group external-control-panel">
    <p class="external-control-intro">{{ t("intro") }}</p>
    <div class="settings-card">
      <label class="settings-item"
        ><span class="settings-item-text"
          ><strong>{{ foundation("externalControl") }}</strong
          ><small>{{ foundation("externalControlDescription") }}</small></span
        ><span class="settings-toggle"
          ><input
            type="checkbox"
            :checked="externalControlEnabled"
            :aria-label="foundation('externalControl')"
            @change="toggleExternalControl" /></span
      ></label>
    </div>

    <template v-if="overview">
      <h2 class="settings-group-title">{{ t("connectTitle") }}</h2>
      <div class="settings-card">
        <div class="settings-item external-control-config">
          <div class="external-control-tabs" role="tablist">
            <button
              v-for="config in overview.configs"
              :key="config.id"
              class="external-control-tab"
              :class="{ 'is-active': config.id === selectedConfigId }"
              type="button"
              role="tab"
              :aria-selected="config.id === selectedConfigId"
              @click="selectedConfigId = config.id"
            >
              {{ config.id === "generic" ? t("other") : config.label }}
            </button>
          </div>
          <template v-if="selectedConfig">
            <div class="external-control-row">
              <small class="external-control-hint">{{
                configHint(selectedConfig)
              }}</small>
              <button
                class="external-control-button"
                type="button"
                @click="copy(selectedConfig.text)"
              >
                {{ t("copy") }}
              </button>
            </div>
            <pre class="external-control-code">{{ selectedConfig.text }}</pre>
          </template>
        </div>
      </div>

      <h2 class="settings-group-title">{{ t("skillTitle") }}</h2>
      <div class="settings-card">
        <div
          v-for="target in overview.skillTargets"
          :key="target.id"
          class="settings-item external-control-row"
        >
          <span class="settings-item-text">
            <strong>{{ target.label }}</strong>
            <small>{{ t("skillHint") }}</small>
          </span>
          <button
            class="external-control-button"
            type="button"
            :disabled="pendingKey === `skill:${target.id}`"
            @click="
              run(
                `skill:${target.id}`,
                () => api().installSkill(target.id),
                t('installed', { name: target.label })
              )
            "
          >
            {{ target.installed ? t("update") : t("install") }}
          </button>
        </div>
        <div class="settings-item external-control-row">
          <span class="settings-item-text"
            ><strong>{{ t("other") }}</strong></span
          >
          <a
            class="external-control-button"
            :href="skillUrl"
            download="SKILL.md"
            >{{ t("download") }}</a
          >
        </div>
      </div>

      <h2 class="settings-group-title">{{ t("clientsTitle") }}</h2>
      <div class="settings-card">
        <p v-if="!overview.clients.length" class="external-control-empty">
          {{ t("clientsEmpty") }}
        </p>
        <div
          v-for="client in overview.clients"
          :key="client.name"
          class="settings-item external-control-row"
        >
          <span class="settings-item-text">
            <strong>{{ client.name }}</strong>
            <small>{{
              t("approvedAt", { time: formatTime(client.approvedAt) })
            }}</small>
          </span>
          <button
            class="external-control-button"
            type="button"
            :disabled="pendingKey === `client:${client.name}`"
            @click="
              run(
                `client:${client.name}`,
                () => api().revokeClient(client.name),
                t('revoked')
              )
            "
          >
            {{ t("revoke") }}
          </button>
        </div>
      </div>

      <div class="external-control-heading">
        <h2 class="settings-group-title">{{ t("trashTitle") }}</h2>
        <button
          v-if="trashCount"
          class="external-control-button"
          type="button"
          @click="confirmingEmpty = true"
        >
          {{ t("emptyTrash") }}
        </button>
      </div>
      <p class="external-control-intro">{{ t("trashHint") }}</p>
      <div class="settings-card">
        <p v-if="!trashCount" class="external-control-empty">
          {{ t("trashEmpty") }}
        </p>
        <div
          v-for="item in overview.trash"
          :key="item.trashId"
          class="settings-item external-control-row"
        >
          <span class="settings-item-text">
            <strong>{{ item.title }}</strong>
            <small>
              {{ kindLabels[item.kind]() }} ·
              {{ t("deletedAt", { time: formatTime(item.deletedAt) }) }}
              <template v-if="item.expiresAt">
                · {{ t("expiresAt", { time: formatTime(item.expiresAt) }) }}
              </template>
            </small>
          </span>
          <button
            class="external-control-button"
            type="button"
            :disabled="pendingKey === `trash:${item.trashId}`"
            @click="
              run(
                `trash:${item.trashId}`,
                () => api().restoreTrash(item.trashId),
                t('restored')
              )
            "
          >
            {{ t("restore") }}
          </button>
        </div>
      </div>

      <h2 class="settings-group-title">{{ t("activityTitle") }}</h2>
      <div class="settings-card external-control-activity">
        <p v-if="!overview.activity.length" class="external-control-empty">
          {{ t("activityEmpty") }}
        </p>
        <div
          v-for="(entry, index) in overview.activity"
          :key="`${entry.time}-${index}`"
          class="external-control-log"
        >
          <span>{{ formatTime(entry.time) }}</span>
          <span>{{ entry.client }}</span>
          <code>{{ entry.tool }}</code>
          <span>{{ entry.result }}</span>
        </div>
      </div>

      <DeleteLongDraftSectionDialog
        :open="confirmingEmpty"
        :section-title="t('emptyTrashCount', { count: trashCount })"
        :eyebrow="t('trashTitle')"
        :item-label="t('emptyTrashItem')"
        :description="t('emptyTrashDescription')"
        :pending="pendingKey === 'empty'"
        @close="confirmingEmpty = false"
        @confirm="emptyTrash"
      />
    </template>
  </section>
</template>

<style scoped src="../../components/settings-page.css"></style>
<style scoped src="./external-control-settings.css"></style>
