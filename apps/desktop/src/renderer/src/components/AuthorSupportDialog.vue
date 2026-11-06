<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import { onMounted, ref } from "vue";
import wechatCode from "../assets/author-support/wechat.jpg";

const t = createScopedTranslator("components.authorSupportDialog");

const emit = defineEmits<{ close: [] }>();
const closeButton = ref<HTMLButtonElement | null>(null);
const doneButton = ref<HTMLButtonElement | null>(null);

function handleTab(event: KeyboardEvent): void {
  if (event.shiftKey && document.activeElement === closeButton.value) {
    event.preventDefault();
    doneButton.value?.focus();
  } else if (!event.shiftKey && document.activeElement === doneButton.value) {
    event.preventDefault();
    closeButton.value?.focus();
  }
}

onMounted(() => closeButton.value?.focus());
</script>

<template>
  <Teleport to="body">
    <div
      class="dialog-backdrop"
      @mousedown.self="emit('close')"
      @keydown.esc.stop="emit('close')"
      @keydown.tab="handleTab"
    >
      <section
        class="workspace-dialog author-support-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="author-support-title"
        aria-describedby="author-support-description"
      >
        <header>
          <div>
            <span class="dialog-eyebrow">DeepWrite</span>
            <h2 id="author-support-title">
              {{ t("supportTheAuthor") }}
            </h2>
          </div>
          <button
            ref="closeButton"
            class="dialog-close"
            type="button"
            :aria-label="t('closeSupportDialog')"
            @click="emit('close')"
          >
            ×
          </button>
        </header>

        <div class="dialog-content author-support-content">
          <div class="author-support-copy">
            <p id="author-support-description" class="dialog-description">
              {{
                t(
                  "donationsSupportDeepWriteSServersMaintenanceDevelopmentAndUsability"
                )
              }}
            </p>
            <p class="author-support-thanks">
              {{
                t("thankYouForSupportingDeepWriteDonationsAreOptionalChoose")
              }}
            </p>
          </div>

          <figure class="author-support-method">
            <figcaption>
              <strong>{{ t("weChatDonation") }}</strong>
              <span>{{ t("scanWithWeChat") }}</span>
            </figcaption>
            <img
              :src="wechatCode"
              :alt="
                t('valuePaymentCode', {
                  arg0: t('weChatDonation')
                })
              "
            />
          </figure>

          <div class="dialog-actions">
            <button
              ref="doneButton"
              class="dialog-primary-button"
              type="button"
              @click="emit('close')"
            >
              {{ t("close") }}
            </button>
          </div>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.author-support-dialog {
  width: min(440px, calc(100vw - 60px));
}

.author-support-content {
  min-height: 0;
  overflow-y: auto;
}

.author-support-copy {
  margin-bottom: 20px;
}

.author-support-thanks {
  margin-top: 8px;
  color: var(--text-secondary);
  font-size: 0.857143rem;
  line-height: 1.7;
}

.author-support-method {
  width: min(100%, 320px);
  min-width: 0;
  margin: 0 auto;
  padding: 12px;
  border: 1px solid var(--theme-line);
  border-radius: 12px;
  background: var(--surface-raised);
}

.author-support-method figcaption {
  display: grid;
  gap: 5px;
  margin-bottom: 12px;
  text-align: center;
}

.author-support-method strong {
  color: var(--text-primary);
  font-size: 1rem;
}

.author-support-method span {
  color: var(--text-secondary);
  font-size: 0.857143rem;
}

.author-support-method img {
  display: block;
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  object-position: center bottom;
  border-radius: 8px;
}
</style>
