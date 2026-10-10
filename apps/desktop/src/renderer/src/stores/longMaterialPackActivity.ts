import { ref } from "vue";

/** Lightweight status imported by the sidebar without loading the feature. */
export const longMaterialPackRunning = ref(false);
/** A long book another feature asked this page to open with. */
export const longMaterialPackLaunchBookId = ref<string | null>(null);
