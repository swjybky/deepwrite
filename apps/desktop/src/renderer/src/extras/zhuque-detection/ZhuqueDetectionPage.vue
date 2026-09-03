<script setup lang="ts">
import { ref } from "vue";

const ZHUQUE_DETECTION_URL = "https://matrix.tencent.com/ai-detect/";
const loading = ref(true);
</script>

<template>
  <section class="zhuque-detection-page" aria-label="朱雀检测网页">
    <div v-if="loading" class="zhuque-detection-loading" role="status">
      正在加载朱雀检测…
    </div>
    <webview
      class="zhuque-detection-webview"
      :src="ZHUQUE_DETECTION_URL"
      partition="persist:zhuque-detection"
      @did-finish-load="loading = false"
      @did-fail-load="loading = false"
    />
  </section>
</template>

<style scoped>
.zhuque-detection-page {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--surface-main);
}

.zhuque-detection-webview {
  display: flex;
  width: 100%;
  height: 100%;
}

.zhuque-detection-loading {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: grid;
  place-items: center;
  color: var(--text-secondary);
  background: var(--surface-main);
}
</style>
