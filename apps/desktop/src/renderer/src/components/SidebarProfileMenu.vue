<script setup lang="ts">
import { formatError } from "../i18n/errors";
import { createScopedTranslator } from "../i18n";
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref
} from "vue";
import type { MarketplaceSession, UpdateState } from "@deepwrite/contracts";
import AppIcon from "./AppIcon.vue";
import { useAnnouncedVersion } from "../composables/useAnnouncedVersion";
import { AuthorSupportDialog, FeedbackDialog } from "./lazyAppComponents";
import { uiMessage } from "../ui-feedback";

const t = createScopedTranslator("components.sidebarProfileMenu");
const VersionUpdateDialog = defineAsyncComponent(
  () => import("./VersionUpdateDialog.vue")
);
const AnnouncementDialog = defineAsyncComponent(
  () => import("./AnnouncementDialog.vue")
);
const props = defineProps<{ marketplaceDisplayName?: string | undefined }>();
const emit = defineEmits<{
  openSettings: [];
  marketplaceSessionChange: [session: MarketplaceSession];
}>();

const accountMenuRoot = ref<HTMLElement | null>(null);
const accountMenuOpen = ref(false);
const profileDialog = ref<
  "announcement" | "contact" | "update" | "support" | "feedback" | null
>(null);
const displayedUserName = computed(
  () => props.marketplaceDisplayName?.trim() || t("author")
);
const avatarInitial = computed(
  () => Array.from(displayedUserName.value.trim())[0] ?? t("a")
);
const updateState = ref<UpdateState>({
  status: "idle",
  currentVersion: "—",
  releaseNotes: [],
  mandatory: false,
  canDownload: false,
  canInstall: false
});
let unsubscribeUpdates: (() => void) | undefined;

const {
  announcedVersion,
  officialDocsUrl,
  hasVersionNotice,
  manualUpdateRequired,
  refreshAnnouncedVersion
} = useAnnouncedVersion(updateState);
const updateInstalling = computed(
  () => updateState.value.status === "installing"
);

function showUpdateError(state: UpdateState): void {
  if (state.status === "error") {
    uiMessage.error(state.message ?? t("updateFailedTryAgainLater"));
  }
}

function toggleAccountMenu(): void {
  accountMenuOpen.value = !accountMenuOpen.value;
}

function openContactDialog(): void {
  accountMenuOpen.value = false;
  profileDialog.value = "contact";
}

function openSupportDialog(): void {
  accountMenuOpen.value = false;
  profileDialog.value = "support";
}

function openFeedbackDialog(): void {
  accountMenuOpen.value = false;
  profileDialog.value = "feedback";
}

function openAnnouncementDialog(): void {
  accountMenuOpen.value = false;
  profileDialog.value = "announcement";
}

async function openUpdateDialog(): Promise<void> {
  void refreshAnnouncedVersion();
  accountMenuOpen.value = false;
  profileDialog.value = "update";
  if (!window.deepwrite?.updates) {
    updateState.value = {
      ...updateState.value,
      status: "unsupported",
      message: t("thisEnvironmentDoesNotSupportDesktopUpdateChecks")
    };
    return;
  }
  try {
    updateState.value = await window.deepwrite.updates.getState();
    if (
      !["downloading", "downloaded", "installing"].includes(
        updateState.value.status
      )
    ) {
      updateState.value = await window.deepwrite.updates.check();
    }
  } catch (error: unknown) {
    uiMessage.error(formatError(error, t("couldNotCheckForUpdates")));
  }
}

async function checkUpdate(): Promise<void> {
  void refreshAnnouncedVersion();
  try {
    updateState.value = await window.deepwrite!.updates.check();
  } catch (error: unknown) {
    uiMessage.error(formatError(error, t("couldNotCheckForUpdates")));
  }
}

async function downloadUpdate(): Promise<void> {
  if (manualUpdateRequired.value) return;
  try {
    updateState.value = await window.deepwrite!.updates.download();
  } catch (error: unknown) {
    uiMessage.error(formatError(error, t("couldNotDownloadUpdate")));
  }
}

async function installUpdate(): Promise<void> {
  if (manualUpdateRequired.value) return;
  try {
    await window.deepwrite!.updates.install();
  } catch (error: unknown) {
    if (updateState.value.status !== "error") {
      uiMessage.error(formatError(error, t("couldNotStartUpdateInstallation")));
    }
  }
}

function closeProfileDialog(): void {
  if (profileDialog.value === "update" && updateInstalling.value) return;
  const restoreFocus =
    profileDialog.value === "support" ||
    profileDialog.value === "announcement" ||
    profileDialog.value === "feedback";
  profileDialog.value = null;
  if (restoreFocus) {
    void nextTick(() => {
      accountMenuRoot.value
        ?.querySelector<HTMLButtonElement>("button")
        ?.focus();
    });
  }
}

function openSettings(): void {
  accountMenuOpen.value = false;
  emit("openSettings");
}

function handleDocumentPointerDown(event: PointerEvent): void {
  if (
    accountMenuOpen.value &&
    event.target instanceof Node &&
    !accountMenuRoot.value?.contains(event.target)
  ) {
    accountMenuOpen.value = false;
  }
}

function handleDocumentKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  if (profileDialog.value) {
    closeProfileDialog();
    return;
  }
  accountMenuOpen.value = false;
}

onMounted(() => {
  document.addEventListener("pointerdown", handleDocumentPointerDown);
  document.addEventListener("keydown", handleDocumentKeydown);
  unsubscribeUpdates = window.deepwrite?.updates?.subscribe((state) => {
    updateState.value = state;
    showUpdateError(state);
  });
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", handleDocumentPointerDown);
  document.removeEventListener("keydown", handleDocumentKeydown);
  unsubscribeUpdates?.();
});
</script>

<template>
  <footer class="sidebar-footer">
    <div class="account-controls">
      <div ref="accountMenuRoot" class="account-profile">
        <button
          class="account-row account-identity-button"
          type="button"
          aria-haspopup="menu"
          :aria-expanded="accountMenuOpen"
          aria-controls="account-menu"
          @click="toggleAccountMenu"
        >
          <span class="avatar account-avatar">
            {{ avatarInitial }}
            <span
              v-if="hasVersionNotice"
              class="version-notice-dot avatar-version-notice"
              role="img"
              :aria-label="t('updateNotification')"
            />
          </span>
          <span class="account-copy">
            <strong :title="displayedUserName">{{ displayedUserName }}</strong>
          </span>
        </button>

        <div
          v-if="accountMenuOpen"
          id="account-menu"
          class="account-menu"
          role="menu"
        >
          <button type="button" role="menuitem" @click="openSettings">
            <AppIcon name="settings" :size="16" />
            <span>{{ t("settings") }}</span>
          </button>
          <button type="button" role="menuitem" @click="openAnnouncementDialog">
            <AppIcon name="bell" :size="16" />
            <span>{{ t("announcements") }}</span>
          </button>
          <button type="button" role="menuitem" @click="openUpdateDialog">
            <AppIcon name="download" :size="16" />
            <span>{{ t("updates") }}</span>
            <span
              v-if="hasVersionNotice"
              class="version-notice-dot menu-version-notice"
              role="img"
              :aria-label="t('updateNotification')"
            />
          </button>
          <button type="button" role="menuitem" @click="openContactDialog">
            <AppIcon name="message" :size="16" />
            <span>{{ t("contactAuthor") }}</span>
          </button>
          <button type="button" role="menuitem" @click="openSupportDialog">
            <AppIcon name="sparkles" :size="16" />
            <span>{{ t("supportTheAuthor") }}</span>
          </button>
          <button
            class="account-feedback-button"
            type="button"
            role="menuitem"
            @click="openFeedbackDialog"
          >
            <AppIcon name="message" :size="16" />
            <span>{{ t("feedback") }}</span>
          </button>
        </div>
      </div>
    </div>
  </footer>
  <AnnouncementDialog
    v-if="profileDialog === 'announcement'"
    @close="closeProfileDialog"
  />
  <AuthorSupportDialog
    v-if="profileDialog === 'support'"
    @close="closeProfileDialog"
  />
  <FeedbackDialog
    v-if="profileDialog === 'feedback'"
    @close="closeProfileDialog"
    @session-change="emit('marketplaceSessionChange', $event)"
  />
  <Teleport to="body">
    <div
      v-if="profileDialog === 'contact'"
      class="dialog-backdrop"
      @mousedown.self="closeProfileDialog"
    >
      <section
        class="workspace-dialog profile-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="contact-author-dialog-title"
      >
        <header>
          <div>
            <span class="dialog-eyebrow">DeepWrite</span>
            <h2 id="contact-author-dialog-title">
              {{ t("contactAuthor") }}
            </h2>
          </div>
          <button
            class="dialog-close"
            type="button"
            :aria-label="t('close')"
            @click="closeProfileDialog"
          >
            ×
          </button>
        </header>

        <div class="dialog-content">
          <p class="dialog-description contact-author-description">
            {{ t("forFeedbackOrEarlyAccessToNewVersionsAdd") }}
          </p>
          <div class="author-contact-card">
            <span>{{ t("weChatID") }}</span>
            <strong>deepseekwrite</strong>
          </div>
          <div class="dialog-actions">
            <button
              class="dialog-primary-button"
              type="button"
              @click="closeProfileDialog"
            >
              {{ t("gotIt") }}
            </button>
          </div>
        </div>
      </section>
    </div>

    <VersionUpdateDialog
      v-if="profileDialog === 'update'"
      :update-state="updateState"
      :announced-version="announcedVersion"
      :official-docs-url="officialDocsUrl"
      :manual-update-required="manualUpdateRequired"
      @close="closeProfileDialog"
      @check="checkUpdate"
      @download="downloadUpdate"
      @install="installUpdate"
    />
  </Teleport>
</template>

<style scoped>
.account-avatar {
  position: relative;
}
.version-notice-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--danger, #dc3545);
  box-shadow: 0 0 0 2px var(--surface-raised);
}
.avatar-version-notice {
  position: absolute;
  top: 0;
  right: 0;
}
.account-menu button:has(.menu-version-notice) {
  grid-template-columns: 22px minmax(0, 1fr) 8px;
}
</style>
