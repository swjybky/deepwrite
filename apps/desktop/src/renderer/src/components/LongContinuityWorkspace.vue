<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import type {
  LongLedgerCommitRecord,
  LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import { useBookImageResolver } from "../composables/bookImageContext";
import MarkdownContent from "./MarkdownContent.vue";

const resolveImage = useBookImageResolver();
const t = createScopedTranslator("components.longContinuityWorkspace");

/**
 * Compatibility-only shell for callers kept across a rolling renderer update.
 * The active editor now opens each chapter continuity Markdown file through
 * its normal read-only file tabs; no projection dashboard lives here anymore.
 */
withDefaults(
  defineProps<{
    bookId: string;
    snapshot: LongWorkspaceIndexSnapshot;
    activeChapterId?: string;
    evidenceContent?: string | null;
    currentRecord?: LongLedgerCommitRecord | null;
  }>(),
  {
    evidenceContent: null,
    currentRecord: null
  }
);
</script>

<template>
  <section
    class="continuity-text-preview"
    :aria-label="t('continuityChapterTextPreview')"
  >
    <MarkdownContent
      v-if="evidenceContent?.trim()"
      :content="evidenceContent"
      :resolve-image="resolveImage"
    />
    <p v-else>
      {{ t("selectAMarkdownFileFromPendingChaptersOrChapter") }}
    </p>
  </section>
</template>

<style scoped>
.continuity-text-preview {
  height: 100%;
  min-height: 0;
  padding: clamp(18px, 3vw, 32px);
  overflow: auto;
  background: var(--surface-main);
  color: var(--text-primary);
}

.continuity-text-preview p {
  margin: 0;
  color: var(--text-tertiary);
}
</style>
