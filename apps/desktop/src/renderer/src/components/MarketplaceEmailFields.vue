<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import { computed, onMounted, onUnmounted, ref } from "vue";
import { MarketplaceEmailSchema } from "@deepwrite/contracts/renderer";
import { uiMessage } from "../ui-feedback";
import { marketplaceAccountError } from "../utils/marketplaceAccountError";

const t = createScopedTranslator("components.marketplaceEmailFields");
const props = defineProps<{
  purpose: "register" | "account" | "login";
  disabled: boolean;
}>();
const email = defineModel<string>("email", { required: true });
const code = defineModel<string>("code", { required: true });
const emit = defineEmits<{ sending: [value: boolean] }>();
const deadlines = ref<Record<string, number>>({});
const now = ref(Date.now());
const sending = ref(false);
let alive = true;
let timer: ReturnType<typeof setInterval> | undefined;
const remaining = computed(() =>
  Math.max(
    0,
    Math.ceil(
      ((deadlines.value[email.value.trim().toLowerCase()] ?? 0) - now.value) /
        1000
    )
  )
);
onMounted(() => {
  timer = setInterval(() => {
    now.value = Date.now();
  }, 1000);
});
onUnmounted(() => {
  alive = false;
  clearInterval(timer);
});
function changeEmail(event: Event): void {
  if (event.target instanceof HTMLInputElement)
    email.value = event.target.value;
  code.value = "";
}
async function send(): Promise<void> {
  const api = window.deepwrite?.marketplace;
  if (!api || props.disabled || sending.value || remaining.value > 0) return;
  const parsed = MarketplaceEmailSchema.safeParse(email.value);
  if (!parsed.success) {
    uiMessage.warning(t("enterAValidEmailFirst"));
    return;
  }
  sending.value = true;
  emit("sending", true);
  try {
    const result = await api.sendEmailCode({
      email: parsed.data,
      purpose: props.purpose
    });
    if (!alive) return;
    now.value = Date.now();
    deadlines.value[parsed.data] = now.value + result.retryAfter * 1000;
    uiMessage.success(t("verificationCodeSentCheckYourInboxAndSpamFolder"));
  } catch (error: unknown) {
    if (alive)
      uiMessage.error(
        marketplaceAccountError(
          error,
          t("couldNotSendVerificationCodeTryAgainLater")
        )
      );
  } finally {
    if (alive) {
      sending.value = false;
      emit("sending", false);
    }
  }
}
</script>
<template>
  <div class="email-fields">
    <label
      ><span>{{ t("email") }}</span
      ><input
        :value="email"
        type="email"
        autocomplete="email"
        maxlength="320"
        :disabled="disabled || sending"
        required
        @input="changeEmail"
    /></label>
    <div class="code-row">
      <label
        ><span>{{ t("emailVerificationCode") }}</span
        ><input
          v-model="code"
          inputmode="numeric"
          autocomplete="one-time-code"
          maxlength="6"
          pattern="[0-9]{6}"
          :disabled="disabled || sending"
          required
      /></label>
      <button
        class="send-code"
        type="button"
        :disabled="disabled || sending || remaining > 0"
        @click="send"
      >
        {{
          sending
            ? t("sending")
            : remaining > 0
              ? t("resendInValueS", {
                  arg0: remaining
                })
              : t("sendCode")
        }}
      </button>
    </div>
    <small>{{ t("enterTheSixDigitEmailCodeItExpiresIn") }}</small>
  </div>
</template>
<style scoped src="./marketplace-account.css"></style>
