<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useAppearance } from "../composables/useAppearance";
import AppearanceFontSettings from "./AppearanceFontSettings.vue";
import AppearanceThemeSettings from "./AppearanceThemeSettings.vue";

import StartupWindowSettings from "./StartupWindowSettings.vue";

const appearance = useAppearance();
const ready = ref(false);

onMounted(() => {
  void appearance.whenReady().finally(() => {
    ready.value = true;
  });
});
</script>

<template>
  <section class="appearance-settings-panel">
    <fieldset
      class="appearance-settings-content"
      :disabled="!ready"
      :aria-busy="!ready"
    >
      <AppearanceThemeSettings />
      <AppearanceFontSettings />
      <StartupWindowSettings />
    </fieldset>
  </section>
</template>

<style scoped>
.appearance-settings-panel {
  width: 100%;
}

.appearance-settings-content {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
</style>
