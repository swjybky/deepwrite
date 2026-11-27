<script setup lang="ts">
import { deepwriteApi } from "../api/deepwrite";
import { createScopedTranslator } from "../i18n";
import { nextTick, onUnmounted, ref, useId, watch } from "vue";
import {
  MarketplaceBindEmailInputSchema,
  type MarketplaceSession
} from "@deepwrite/contracts/renderer";
import { uiMessage } from "../ui-feedback";
import { marketplaceAccountError } from "../utils/marketplaceAccountError";
import MarketplaceEmailFields from "./MarketplaceEmailFields.vue";

const t = createScopedTranslator("components.marketplaceBindEmail");
const props = defineProps<{ session: MarketplaceSession }>();
const emit = defineEmits<{ updated: [session: MarketplaceSession] }>();
const open = ref(false);
const email = ref(props.session.user?.email ?? "");
const emailCode = ref("");
const pending = ref(false);
const sending = ref(false);
const trigger = ref<HTMLButtonElement | null>(null);
const verified = ref<HTMLElement | null>(null);
const dialog = ref<HTMLElement | null>(null);
const dialogId = useId();
const titleId = `${dialogId}-title`;
const descriptionId = `${dialogId}-description`;
let alive = true;
onUnmounted(() => {
  alive = false;
});
watch(open, async (visible) => {
  await nextTick();
  if (!alive) return;
  if (visible) dialog.value?.querySelector<HTMLInputElement>("input")?.focus();
  else (trigger.value ?? verified.value)?.focus();
});
watch([pending, sending], async () => {
  await nextTick();
  const root = dialog.value;
  if (!alive || !open.value || !root) return;
  if (
    !root.contains(document.activeElement) ||
    document.activeElement === root
  ) {
    (
      root.querySelector<HTMLInputElement>("input:not(:disabled)") ?? root
    ).focus();
  }
});
function close(): void {
  if (!pending.value && !sending.value) open.value = false;
}
function trapFocus(event: KeyboardEvent): void {
  const controls = dialog.value?.querySelectorAll<HTMLElement>(
    "button:not(:disabled), input:not(:disabled)"
  );
  const first = controls?.[0];
  const last = controls?.[controls.length - 1];
  if (!first || !last) {
    event.preventDefault();
    dialog.value?.focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
async function bind(): Promise<void> {
  const api = deepwriteApi()?.marketplace;
  if (!api || pending.value || sending.value) return;
  const parsed = MarketplaceBindEmailInputSchema.safeParse({
    email: email.value,
    emailCode: emailCode.value
  });
  if (!parsed.success) {
    uiMessage.warning(t("enterAValidEmailAndSixDigitVerificationCode"));
    return;
  }
  pending.value = true;
  try {
    const session = await api.bindEmail(parsed.data);
    if (!alive) return;
    emailCode.value = "";
    open.value = false;
    emit("updated", session);
    uiMessage.success(t("emailVerifiedAndLinked"));
  } catch (error: unknown) {
    if (alive)
      uiMessage.error(
        marketplaceAccountError(error, t("couldNotLinkEmailTryAgainLater"))
      );
  } finally {
    if (alive) pending.value = false;
  }
}
</script>
<template>
  <span
    v-if="session.user?.emailVerifiedAt"
    ref="verified"
    class="verified"
    role="status"
    tabindex="-1"
    >{{ t("emailVerified") }}</span
  >
  <div v-else class="bind-entry">
    <button
      ref="trigger"
      type="button"
      aria-haspopup="dialog"
      :aria-controls="open ? dialogId : undefined"
      :aria-expanded="open"
      :disabled="pending || sending"
      @click="open = true"
    >
      {{ t("linkEmailOptional") }}
    </button>
    <Teleport to="body">
      <div
        v-if="open"
        class="bind-backdrop"
        @mousedown.self="close"
        @keydown.esc.stop.prevent="close"
        @keydown.tab="trapFocus"
      >
        <section
          :id="dialogId"
          ref="dialog"
          class="bind-dialog"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="titleId"
          :aria-describedby="descriptionId"
          tabindex="-1"
        >
          <header>
            <h2 :id="titleId">{{ t("linkEmail") }}</h2>
            <button
              class="bind-close"
              type="button"
              :aria-label="t('skipForNow')"
              :disabled="pending || sending"
              @click="close"
            >
              ×
            </button>
          </header>
          <form class="bind-form" @submit.prevent="bind">
            <p :id="descriptionId">
              {{ t("existingUsersMayLinkAnEmailVoluntarilyTheApp") }}
            </p>
            <MarketplaceEmailFields
              v-model:email="email"
              v-model:code="emailCode"
              purpose="account"
              :disabled="pending"
              @sending="sending = $event"
            />
            <div class="bind-actions">
              <button
                type="button"
                :disabled="pending || sending"
                @click="close"
              >
                {{ t("skipForNow") }}
              </button>
              <button
                class="primary-button"
                type="submit"
                :disabled="pending || sending"
              >
                {{ pending ? t("verifying") : t("verifyAndLink") }}
              </button>
            </div>
          </form>
        </section>
      </div>
    </Teleport>
  </div>
</template>
<style scoped src="./marketplace-account.css"></style>
