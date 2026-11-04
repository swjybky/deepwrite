<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import { onUnmounted, ref } from "vue";
import {
  MarketplaceLoginInputSchema,
  MarketplaceEmailLoginInputSchema,
  MarketplaceRegisterInputSchema,
  type MarketplaceSession
} from "@deepwrite/contracts/renderer";
import { uiMessage } from "../ui-feedback";
import { marketplaceAccountError } from "../utils/marketplaceAccountError";
import MarketplaceEmailFields from "./MarketplaceEmailFields.vue";

const t = createScopedTranslator("components.marketplaceAuthForm");
const emit = defineEmits<{ authenticated: [session: MarketplaceSession] }>();
const authMode = ref<"login" | "register">("login");
const loginMethod = ref<"username-password" | "email-password" | "email-code">(
  "username-password"
);
const pending = ref(false);
const sending = ref(false);
const username = ref("");
const password = ref("");
const displayName = ref("");
const email = ref("");
const emailCode = ref("");
const loginEmail = ref("");
const loginCode = ref("");
let alive = true;
onUnmounted(() => {
  alive = false;
});
async function submitAuth(): Promise<void> {
  const api = window.deepwrite;
  if (!api || pending.value || sending.value) return;
  const login = MarketplaceLoginInputSchema.safeParse(
    loginMethod.value === "email-password"
      ? { email: loginEmail.value, password: password.value }
      : { username: username.value, password: password.value }
  );
  const codeLogin = MarketplaceEmailLoginInputSchema.safeParse({
    email: loginEmail.value,
    emailCode: loginCode.value
  });
  const registration = MarketplaceRegisterInputSchema.safeParse({
    username: username.value.trim(),
    password: password.value,
    displayName: displayName.value.trim() || undefined,
    email: email.value,
    emailCode: emailCode.value
  });
  if (
    authMode.value === "register"
      ? !registration.success
      : loginMethod.value === "email-code"
        ? !codeLogin.success
        : !login.success
  ) {
    uiMessage.warning(
      authMode.value === "register"
        ? t("enterAUsernameAPasswordOfAtLeast8")
        : loginMethod.value === "email-code"
          ? t("enterAValidEmailAndCode")
          : t("enterAValidAccountAndPassword")
    );
    return;
  }
  pending.value = true;
  try {
    let session: MarketplaceSession;
    if (authMode.value === "register" && registration.success) {
      session = await api.marketplace.register(registration.data);
    } else if (loginMethod.value === "email-code" && codeLogin.success) {
      session = await api.marketplace.loginWithEmailCode(codeLogin.data);
    } else if (login.success) {
      session = await api.marketplace.login(login.data);
    } else {
      return;
    }
    if (!alive) return;
    password.value = "";
    emailCode.value = "";
    loginCode.value = "";
    uiMessage.success(
      authMode.value === "login" ? t("signedIn") : t("registeredAndSignedIn")
    );
    emit("authenticated", session);
  } catch (error: unknown) {
    if (alive)
      uiMessage.error(
        marketplaceAccountError(
          error,
          t("couldNotSignInOrRegisterTryAgainLater")
        )
      );
  } finally {
    if (alive) pending.value = false;
  }
}
</script>
<template>
  <section class="auth-shell">
    <div class="auth-card">
      <header class="auth-head">
        <h2>
          {{ authMode === "login" ? t("welcomeBack") : t("createAccount") }}
        </h2>
        <p>{{ authMode === "login" ? t("signInLead") : t("registerLead") }}</p>
      </header>
      <form class="auth-form" novalidate @submit.prevent="submitAuth">
        <div
          v-if="authMode === 'login'"
          class="auth-methods"
          role="group"
          :aria-label="t('signInMethod')"
        >
          <button
            v-for="method in [
              'username-password',
              'email-password',
              'email-code'
            ] as const"
            :key="method"
            type="button"
            :aria-pressed="loginMethod === method"
            :class="{ active: loginMethod === method }"
            :disabled="pending || sending"
            @click="loginMethod = method"
          >
            {{
              method === "username-password"
                ? t("usernamePassword")
                : method === "email-password"
                  ? t("emailPassword")
                  : t("emailCodeLogin")
            }}
          </button>
        </div>
        <div
          v-if="authMode === 'register' || loginMethod === 'username-password'"
          class="auth-pair"
        >
          <label
            ><span>{{ t("username") }}</span
            ><input
              v-model="username"
              autocomplete="username"
              maxlength="120"
              required
              :disabled="pending"
          /></label>
          <label v-if="authMode === 'register'"
            ><span>{{ t("displayNameOptional") }}</span
            ><input
              v-model="displayName"
              autocomplete="nickname"
              maxlength="120"
              :disabled="pending"
          /></label>
        </div>
        <label v-if="authMode === 'login' && loginMethod === 'email-password'">
          <span>{{ t("email") }}</span>
          <input
            v-model="loginEmail"
            type="email"
            autocomplete="email"
            maxlength="320"
            required
            :disabled="pending"
          />
        </label>
        <label v-if="authMode === 'register' || loginMethod !== 'email-code'"
          ><span>{{ t("password") }}</span
          ><input
            v-model="password"
            type="password"
            :autocomplete="
              authMode === 'login' ? 'current-password' : 'new-password'
            "
            maxlength="128"
            required
            :disabled="pending"
        /></label>
        <MarketplaceEmailFields
          v-if="authMode === 'register'"
          v-model:email="email"
          v-model:code="emailCode"
          purpose="register"
          :disabled="pending"
          @sending="sending = $event"
        />
        <MarketplaceEmailFields
          v-if="authMode === 'login' && loginMethod === 'email-code'"
          v-model:email="loginEmail"
          v-model:code="loginCode"
          purpose="login"
          :disabled="pending"
          @sending="sending = $event"
        />
        <button
          class="primary-button"
          type="submit"
          :disabled="pending || sending"
        >
          {{
            pending
              ? t("pleaseWait")
              : authMode === "login"
                ? t("signIn")
                : t("registerAndSignIn")
          }}
        </button>
        <p class="auth-switch">
          <span>{{
            authMode === "login" ? t("noAccountYet") : t("alreadyHaveAccount")
          }}</span>
          <button
            type="button"
            :disabled="pending || sending"
            @click="authMode = authMode === 'login' ? 'register' : 'login'"
          >
            {{ authMode === "login" ? t("register") : t("signIn") }}
          </button>
        </p>
      </form>
    </div>
  </section>
</template>
<style scoped src="./marketplace-account.css"></style>
