<script setup lang="ts">
import { deepwriteApi } from "../../api/deepwrite";
import { computed, onMounted } from "vue";
import type {
  AgentTeamCatalogSnapshot,
  AgentTeamMarketplaceSummary,
  MarketplaceSession
} from "@deepwrite/contracts";
import AppIcon from "../../components/AppIcon.vue";
import MarketplaceAuthForm from "../../components/MarketplaceAuthForm.vue";
import MarketplaceBindEmail from "../../components/MarketplaceBindEmail.vue";
import { createScopedTranslator } from "../../i18n";
import TeamPlazaBrowse from "./TeamPlazaBrowse.vue";
import TeamPlazaDetail from "./TeamPlazaDetail.vue";
import TeamPlazaMine from "./TeamPlazaMine.vue";
import TeamPlazaPublish from "./TeamPlazaPublish.vue";
import { useTeamPlaza, type TeamPlazaTab } from "./useTeamPlaza";
import { useTeamPlazaPublish } from "./useTeamPlazaPublish";

const t = createScopedTranslator("extras.agentTeamMarketplace");

const props = defineProps<{
  catalog: AgentTeamCatalogSnapshot | null;
  initialSession?: MarketplaceSession | null;
}>();
const emit = defineEmits<{
  sessionChange: [session: MarketplaceSession];
  catalogChange: [catalog: AgentTeamCatalogSnapshot];
}>();

const api = () => deepwriteApi();
const plaza = useTeamPlaza({
  api,
  catalog: () => props.catalog,
  initialSession: props.initialSession ?? null,
  onSessionChange: (session) => emit("sessionChange", session),
  onCatalogChange: (catalog) => emit("catalogChange", catalog)
});
const form = useTeamPlazaPublish({
  api,
  catalog: () => props.catalog,
  onSubmitted: async () => {
    await plaza.selectTab("mine");
    await plaza.loadMine(1);
  }
});
const { session, authenticated, tab, detail, deleteTarget, deletePending } =
  plaza;

const apiAvailable = computed(() =>
  Boolean(deepwriteApi()?.agentTeamMarketplace)
);
const tabs = computed<Array<{ id: TeamPlazaTab; label: string }>>(() => [
  { id: "browse", label: t("tabBrowse") },
  { id: "mine", label: t("tabMine") },
  { id: "publish", label: t("tabPublish") }
]);

function editPublished(item: AgentTeamMarketplaceSummary): void {
  form.startEdit(item);
  void plaza.selectTab("publish");
}

onMounted(() => {
  if (apiAvailable.value) void plaza.restoreSession();
});
</script>

<template>
  <section class="team-plaza-page" :aria-label="t('title')">
    <header class="page-header">
      <div>
        <span class="eyebrow">{{ t("eyebrow") }}</span>
        <h1>{{ t("title") }}</h1>
        <p>{{ t("description") }}</p>
      </div>
      <div v-if="authenticated && session" class="account">
        <span>{{ session.user?.displayName }}</span>
        <MarketplaceBindEmail
          :key="session.user?.id ?? 'account'"
          :session="session"
          @updated="plaza.applySession"
        />
        <button type="button" class="secondary-button" @click="plaza.logout()">
          {{ t("signOut") }}
        </button>
      </div>
    </header>

    <div v-if="session?.insecureTransport" class="insecure-warning" role="note">
      <AppIcon name="globe" :size="17" />
      <div>
        <strong>{{ t("insecureTitle") }}</strong>
        <span>{{ t("insecureDescription") }}</span>
      </div>
    </div>

    <div v-if="!apiAvailable" class="plaza-empty">
      <strong>{{ t("desktopUnavailable") }}</strong>
      <span>{{ t("openInDesktop") }}</span>
    </div>
    <div v-else-if="session === null" class="plaza-empty">
      <span>{{ t("restoringSession") }}</span>
    </div>
    <template v-else-if="!authenticated">
      <p class="plaza-muted shared-hint">{{ t("sharedAccountHint") }}</p>
      <MarketplaceAuthForm @authenticated="plaza.signedIn" />
    </template>

    <template v-else>
      <nav class="plaza-tabs" :aria-label="t('tabsLabel')">
        <button
          v-for="item in tabs"
          :key="item.id"
          type="button"
          :class="{ active: tab === item.id }"
          :aria-current="tab === item.id ? 'page' : undefined"
          @click="plaza.selectTab(item.id)"
        >
          {{ item.label }}
        </button>
      </nav>
      <div class="plaza-content">
        <TeamPlazaBrowse v-if="tab === 'browse'" :plaza="plaza" />
        <TeamPlazaMine
          v-else-if="tab === 'mine'"
          :plaza="plaza"
          @edit="editPublished"
          @publish="plaza.selectTab('publish')"
        />
        <TeamPlazaPublish
          v-else
          :form="form"
          :catalog-loaded="catalog !== null"
        />
      </div>
    </template>

    <TeamPlazaDetail
      v-if="detail"
      :detail="detail"
      :install-label="plaza.installAction(detail).label"
      :install-disabled="plaza.installAction(detail).disabled"
      @close="detail = null"
      @like="plaza.toggleLike(detail)"
      @install="plaza.install(detail)"
    />

    <Teleport to="body">
      <div
        v-if="deleteTarget"
        class="plaza-modal-backdrop"
        @mousedown.self="!deletePending && (deleteTarget = null)"
      >
        <section
          class="plaza-modal delete-modal"
          role="dialog"
          aria-modal="true"
          :aria-label="t('destructiveAction')"
        >
          <header>
            <div>
              <span>{{ t("destructiveAction") }}</span>
              <h2>{{ t("deleteTitle", { title: deleteTarget.title }) }}</h2>
            </div>
          </header>
          <p>{{ t("deleteDescription") }}</p>
          <footer>
            <button
              class="secondary-button"
              type="button"
              :disabled="deletePending"
              @click="deleteTarget = null"
            >
              {{ t("cancel") }}
            </button>
            <button
              class="danger-button"
              type="button"
              :disabled="deletePending"
              @click="plaza.confirmDelete()"
            >
              {{ deletePending ? t("deleting") : t("confirmDelete") }}
            </button>
          </footer>
        </section>
      </div>
    </Teleport>
  </section>
</template>

<style scoped src="./team-plaza.css"></style>
<style scoped>
.team-plaza-page {
  min-width: 0;
  height: 100%;
  overflow: auto;
  padding: 30px clamp(22px, 4vw, 54px) 48px;
  color: var(--text-primary);
  background: var(--surface-main);
}
.page-header,
.account {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.page-header h1 {
  margin: 3px 0 5px;
  font-size: 25px;
}
.page-header p {
  max-width: 720px;
  margin: 0;
  color: var(--text-secondary);
  line-height: 1.55;
}
.eyebrow {
  color: var(--text-tertiary);
  font-size: 12px;
  letter-spacing: 0.08em;
}
.page-header {
  align-items: flex-start;
  flex-wrap: wrap;
}
.page-header > div:first-child {
  flex: 1 1 320px;
  min-width: 0;
}
.account {
  min-width: 0;
  max-width: 100%;
  flex-wrap: wrap;
  align-self: flex-start;
  justify-content: flex-start;
  padding-top: 8px;
}
.account > span {
  min-width: 0;
  overflow-wrap: anywhere;
}
.insecure-warning {
  display: flex;
  gap: 11px;
  margin: 20px 0;
  padding: 13px 15px;
  border: 1px solid color-mix(in srgb, var(--danger) 42%, var(--theme-line));
  border-radius: 12px;
  color: color-mix(in srgb, var(--danger) 78%, var(--text-primary));
  background: color-mix(in srgb, var(--danger) 9%, var(--surface-raised));
}
.insecure-warning div {
  display: grid;
  gap: 3px;
}
.insecure-warning span {
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.55;
}
.shared-hint {
  margin-top: 20px;
  text-align: center;
}
.plaza-tabs {
  display: flex;
  margin-top: 20px;
  border: 1px solid var(--theme-line);
  border-radius: 12px 12px 0 0;
  background: var(--surface-raised);
  overflow: hidden;
}
.plaza-tabs button {
  flex: 1;
  border: 0;
  border-bottom: 2px solid transparent;
  padding: 13px 18px;
  color: var(--text-secondary);
  background: transparent;
  cursor: pointer;
}
.plaza-tabs button.active {
  border-bottom-color: var(--accent);
  color: var(--text-primary);
  background: var(--surface-selected);
}
.plaza-content {
  border: 1px solid var(--theme-line);
  border-top: 0;
  border-radius: 0 0 14px 14px;
  padding: 20px;
  background: var(--surface-raised);
}
.delete-modal {
  width: min(500px, 94vw);
  grid-template-rows: auto auto auto;
}
.delete-modal > p {
  margin: 0;
  padding: 20px;
  color: var(--text-secondary);
  line-height: 1.6;
}
@media (max-width: 820px) {
  .team-plaza-page {
    padding-inline: 16px;
  }
  .page-header {
    align-items: flex-start;
    flex-direction: column;
  }
  .page-header > div:first-child {
    flex: initial;
  }
}
</style>
