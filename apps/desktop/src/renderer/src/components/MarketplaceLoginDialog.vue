<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";
import type { MarketplaceSession } from "@deepwrite/contracts";
import { createScopedTranslator } from "../i18n";
import {
  completeMarketplaceLogin,
  dismissMarketplaceLogin
} from "../stores/marketplaceLoginPrompt";
import MarketplaceAuthForm from "./MarketplaceAuthForm.vue";

const t = createScopedTranslator("components.marketplaceLoginDialog");
const emit = defineEmits<{ sessionChange: [session: MarketplaceSession] }>();
let alive = true;

function signedIn(session: MarketplaceSession): void {
  alive = false; // A slower startup check must not undo this sign-in.
  emit("sessionChange", session);
  completeMarketplaceLogin();
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") dismissMarketplaceLogin();
}

onMounted(async () => {
  document.addEventListener("keydown", handleKeydown);
  // The shell may not know yet that Main already holds a valid sign-in.
  try {
    const session = await window.deepwrite?.marketplace.session();
    if (!alive || !session) return;
    emit("sessionChange", session);
    if (session.authenticated) completeMarketplaceLogin();
  } catch {
    // An unreachable session check still lets the user sign in again.
  }
});

onBeforeUnmount(() => {
  alive = false;
  document.removeEventListener("keydown", handleKeydown);
});
</script>

<template>
  <Teleport to="body">
    <div class="dialog-backdrop" @mousedown.self="dismissMarketplaceLogin">
      <section
        class="marketplace-login-dialog"
        role="dialog"
        aria-modal="true"
        :aria-label="t('title')"
      >
        <button
          class="dialog-close"
          type="button"
          :aria-label="t('close')"
          @click="dismissMarketplaceLogin"
        >
          ×
        </button>
        <MarketplaceAuthForm @authenticated="signedIn" />
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.marketplace-login-dialog {
  position: relative;
  width: min(400px, calc(100vw - 48px));
  max-height: calc(100vh - 60px);
  overflow-y: auto;
  border-radius: 16px;
}
.marketplace-login-dialog :deep(.auth-shell) {
  padding: 0;
}
.marketplace-login-dialog .dialog-close {
  position: absolute;
  top: 14px;
  right: 14px;
  z-index: 1;
}
</style>
