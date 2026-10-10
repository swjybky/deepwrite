<script setup lang="ts">
import { packT as t } from "./pack-labels";
import { useLongMaterialPackStore } from "./useLongMaterialPack";

defineProps<{ modelReady: boolean }>();
const store = useLongMaterialPackStore();
</script>

<template>
  <section
    v-if="store.stats"
    class="analysis-card pack-card"
    :aria-label="t('guideTitle')"
  >
    <div class="analysis-card-heading pack-heading">
      <h2>{{ t("guideTitle") }}</h2>
      <label class="pack-switch">
        <input
          v-model="store.runGuideAfter"
          type="checkbox"
          role="switch"
          :disabled="store.busy"
        />
        <span>{{ t("guideToggle") }}</span>
      </label>
    </div>
    <p class="pack-muted">{{ t("guideDescription") }}</p>
    <label class="setup-field pack-focus">
      <span class="setup-field-label">{{ t("guideFocus") }}</span>
      <textarea
        v-model="store.guideFocus"
        rows="3"
        maxlength="8000"
        :placeholder="t('guideFocusPlaceholder')"
        :disabled="store.guideBusy"
      />
    </label>
    <p class="pack-note">
      {{ modelReady ? t("guideOutbound") : t("guideNeedsModel") }}
    </p>
  </section>
</template>
