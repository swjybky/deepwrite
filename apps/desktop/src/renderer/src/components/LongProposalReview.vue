<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import { computed } from "vue";
import type { LongWorkspaceIndexSnapshot } from "@deepwrite/contracts";
import type { LongWorkspaceProposalItem } from "../composables/useLongWorkspaceProposals";
import AppIcon from "./AppIcon.vue";
import LongLedgerFinalizationCard from "./LongLedgerFinalizationCard.vue";
import LongProposalImpactDetails from "./LongProposalImpactDetails.vue";
import {
  canDisplayContentFileDiff,
  contentFileTitle,
  contentProposalDiffStats,
  contentProposalStatusLabel,
  contentProposalVisualStatus,
  isContentFileProposalItem,
  isStructureProposalItem,
  longContentFileDiffs,
  proposalStatusText,
  proposalTitle
} from "./longProposalPresentation";

const t = createScopedTranslator("components.longProposalReview");

const props = withDefaults(
  defineProps<{
    items: LongWorkspaceProposalItem[];
    workspaceIndex?: LongWorkspaceIndexSnapshot | null;
    embedded?: boolean;
    conversationCard?: boolean;
    /** Body of a file-change summary row, whose header shows title and status. */
    rowBody?: boolean;
  }>(),
  {
    embedded: false,
    conversationCard: false,
    rowBody: false
  }
);

const emit = defineEmits<{
  approve: [eventId: string];
  reject: [eventId: string];
  retryPreview: [eventId: string];
  locate: [eventId: string];
}>();

const hasEditProposalSurfaceItems = computed(() =>
  props.items.some(
    (item) =>
      item.event.type === "long.mutation_proposal" ||
      isContentFileProposalItem(item)
  )
);

function showContentProposalActions(item: LongWorkspaceProposalItem): boolean {
  return (
    item.status !== "accepted" &&
    (item.approvalMode !== "auto-approve" || item.status === "error")
  );
}

function contentProposalStatusMessage(item: LongWorkspaceProposalItem): string {
  if (item.status === "accepted") {
    return item.approvalMode === "auto-approve"
      ? t("automaticallyApprovedAndSavedToLocalMarkdown")
      : t("changesAppliedAndSavedLocally");
  }
  if (item.status === "error") {
    if (item.errorPhase === "preview") {
      return item.error ?? t("couldNotReadTheChangeImpactContentHasNot");
    }
    return item.error ?? t("changesCouldNotBeSavedSaveAgainOrReject");
  }
  if (item.status === "waiting") {
    return t("waitingForPrecedingFileOperationsToFinishBeforeResuming");
  }
  if (item.status === "previewing") {
    return t("readingFilesAndChangeImpact");
  }
  if (item.status === "submitting") {
    return t("applyingAndSavingChanges");
  }
  return item.approvalMode === "auto-approve"
    ? t("addedToTheAutosaveQueue")
    : t("acceptToApplyToTheCorrespondingMarkdownFilesAnd");
}

function contentProposalAcceptDisabled(
  item: LongWorkspaceProposalItem
): boolean {
  return (
    item.status === "previewing" ||
    item.status === "submitting" ||
    item.status === "waiting" ||
    (item.status === "error" && item.errorRetryable === false) ||
    (item.status === "ready" && !item.preview)
  );
}

function contentProposalAcceptLabel(item: LongWorkspaceProposalItem): string {
  if (item.status === "submitting") return t("saving");
  if (item.status === "error" && item.errorRetryable === false) {
    return t("cannotSave");
  }
  return item.status === "error"
    ? item.errorPhase === "preview"
      ? t("reloadAndSave")
      : t("saveAgain")
    : t("acceptAndSave");
}

function usesEditProposalSurface(item: LongWorkspaceProposalItem): boolean {
  return isStructureProposalItem(item) || isContentFileProposalItem(item);
}

function showsContentDiff(item: LongWorkspaceProposalItem): boolean {
  return (
    isContentFileProposalItem(item) &&
    canDisplayContentFileDiff(item) &&
    contentProposalDiffStats(item).hunks > 0
  );
}

function structureProposalStatusMessage(
  item: LongWorkspaceProposalItem
): string {
  if (item.status === "waiting") {
    return t("waitingForPrecedingFileOperationsToFinishBeforeResuming");
  }
  if (item.status === "accepted")
    return t("structureChangesAppliedAndSavedLocally");
  if (item.status === "error") {
    if (item.errorPhase === "preview") {
      return item.error ?? t("couldNotReadStructuralImpactChangesHaveNotBeen");
    }
    return item.error ?? t("structureChangesCouldNotBeAppliedPreviewAgainTo");
  }
  if (item.status === "previewing") {
    return t("readingCurrentStructureAndImpact");
  }
  if (item.status === "submitting") {
    return t("applyingStructureChanges");
  }
  return item.approvalMode === "auto-approve"
    ? t("addedToTheAutosaveQueue")
    : t("acceptToApplyToThisBookSStructureAnd");
}

function structureProposalAcceptDisabled(
  item: LongWorkspaceProposalItem
): boolean {
  return (
    item.status === "previewing" ||
    item.status === "submitting" ||
    item.status === "waiting" ||
    (item.status === "error" && item.errorRetryable === false) ||
    (item.status === "ready" && !item.preview)
  );
}

function structureProposalAcceptLabel(item: LongWorkspaceProposalItem): string {
  if (item.status === "submitting") return t("applyingLabel");
  if (item.status === "error" && item.errorRetryable === false) {
    return t("cannotApply");
  }
  return item.status === "error"
    ? item.errorPhase === "preview"
      ? t("revalidateAndApply")
      : t("retryApplying")
    : t("acceptAndApply");
}

function diffLineMark(type: "context" | "addition" | "deletion"): string {
  if (type === "addition") return "+";
  if (type === "deletion") return "−";
  return " ";
}
</script>

<template>
  <section
    v-if="items.length"
    class="long-proposal-review"
    :class="{
      'is-embedded': embedded,
      'is-conversation-card': conversationCard,
      'is-row-body': rowBody,
      'has-edit-proposal-surface-items': hasEditProposalSurfaceItems
    }"
    :aria-label="t('novelProposalsAwaitingApproval')"
  >
    <div class="long-proposal-list">
      <article
        v-for="item in items"
        :key="item.event.id"
        :class="
          item.event.type === 'long.ledger_commit_proposal'
            ? 'long-ledger-finalization-item'
            : ['edit-proposal-card', `is-${contentProposalVisualStatus(item)}`]
        "
        :data-proposal-type="item.event.type"
        :aria-busy="item.status === 'submitting'"
      >
        <LongLedgerFinalizationCard
          v-if="item.event.type === 'long.ledger_commit_proposal'"
          :item="item"
          @approve="emit('approve', item.event.id)"
          @reject="emit('reject', item.event.id)"
        />

        <template v-if="usesEditProposalSurface(item)">
          <header v-if="!rowBody" class="edit-proposal-header">
            <span class="edit-proposal-icon" aria-hidden="true">
              <AppIcon
                :name="isStructureProposalItem(item) ? 'wand' : 'file'"
                :size="17"
              />
            </span>
            <div class="edit-proposal-heading">
              <div class="edit-proposal-title-row">
                <strong>{{ proposalTitle(item, workspaceIndex) }}</strong>
                <span
                  class="edit-proposal-status"
                  :class="`is-${contentProposalVisualStatus(item)}`"
                >
                  {{
                    isStructureProposalItem(item)
                      ? proposalStatusText(item)
                      : contentProposalStatusLabel(item)
                  }}
                </span>
                <button
                  v-if="item.status === 'accepted'"
                  class="approval-target-button"
                  type="button"
                  :title="t('goToTargetFile')"
                  :aria-label="t('goToTargetFile')"
                  @click.stop="emit('locate', item.event.id)"
                >
                  {{ t("goToTargetFile") }}
                </button>
              </div>
              <p>{{ item.event.payload.summary }}</p>
            </div>
            <div
              v-if="
                isContentFileProposalItem(item) &&
                canDisplayContentFileDiff(item)
              "
              class="edit-proposal-stats"
              :aria-label="
                t('valueLinesAddedValueLinesRemoved', {
                  arg0: contentProposalDiffStats(item).additions,
                  arg1: contentProposalDiffStats(item).deletions
                })
              "
            >
              <span class="is-addition">
                +{{ contentProposalDiffStats(item).additions }}
              </span>
              <span class="is-deletion">
                −{{ contentProposalDiffStats(item).deletions }}
              </span>
            </div>
          </header>
          <div v-else class="edit-proposal-row-toolbar">
            <p class="edit-proposal-row-summary">
              {{ item.event.payload.summary }}
            </p>
            <div
              v-if="item.status === 'accepted'"
              class="edit-proposal-actions"
            >
              <button
                class="approval-target-button"
                type="button"
                @click.stop="emit('locate', item.event.id)"
              >
                {{ t("goToTargetFile") }}
              </button>
            </div>
          </div>

          <component
            :is="rowBody ? 'div' : 'details'"
            v-if="showsContentDiff(item)"
            class="edit-proposal-diff"
            :class="{ 'is-inline': rowBody }"
          >
            <summary v-if="!rowBody">
              <span>{{ t("viewChanges") }}</span>
              <small>
                {{
                  t("changeBlocksMessage", {
                    arg0: contentProposalDiffStats(item).hunks ?? ""
                  })
                }}
              </small>
              <AppIcon name="chevron" :size="13" />
            </summary>
            <div class="edit-diff-content">
              <section
                v-for="card in longContentFileDiffs(item)"
                :key="card.file.fileId"
                class="long-edit-diff-file"
              >
                <div
                  v-if="longContentFileDiffs(item).length > 1"
                  class="long-edit-diff-file-label"
                >
                  {{ contentFileTitle(item, card.file, workspaceIndex) }}
                </div>
                <div
                  v-for="(hunk, hunkIndex) in card.diff.hunks"
                  :key="`${card.file.fileId}:hunk:${hunkIndex}`"
                  class="edit-diff-hunk"
                >
                  <div class="edit-diff-hunk-header">
                    @@ -{{ hunk.oldStart }},{{ hunk.oldLines }} +{{
                      hunk.newStart
                    }},{{ hunk.newLines }}
                    @@
                  </div>
                  <div
                    v-for="(line, lineIndex) in hunk.lines"
                    :key="`${card.file.fileId}:${hunkIndex}:${lineIndex}`"
                    class="edit-diff-line"
                    :class="`is-${line.type}`"
                  >
                    <span class="edit-diff-line-number">
                      {{ line.oldLineNumber ?? "" }}
                    </span>
                    <span class="edit-diff-line-number">
                      {{ line.newLineNumber ?? "" }}
                    </span>
                    <span class="edit-diff-line-mark" aria-hidden="true">
                      {{ diffLineMark(line.type) }}
                    </span>
                    <code>{{ line.text }}</code>
                  </div>
                </div>
                <p v-if="card.diff.truncated" class="edit-diff-truncated">
                  {{ t("thisDiffIsLargeSoOnlySomeChangesAre") }}
                </p>
              </section>
            </div>
          </component>
          <p
            v-else-if="
              isContentFileProposalItem(item) &&
              !canDisplayContentFileDiff(item)
            "
            class="edit-proposal-empty"
          >
            {{ t("fileIdentityAndSourceContentHaveNotPassedValidation") }}
          </p>
          <p
            v-else-if="isContentFileProposalItem(item)"
            class="edit-proposal-empty"
          >
            {{ t("aBlankMarkdownFileWasCreatedNoManuscriptLine") }}
          </p>

          <footer
            v-if="!rowBody || item.status !== 'accepted'"
            class="edit-proposal-footer"
          >
            <span class="edit-proposal-message">
              {{
                isStructureProposalItem(item)
                  ? structureProposalStatusMessage(item)
                  : contentProposalStatusMessage(item)
              }}
            </span>
            <div
              v-if="
                isStructureProposalItem(item)
                  ? item.status !== 'accepted' &&
                    (item.approvalMode !== 'auto-approve' ||
                      item.status === 'error')
                  : showContentProposalActions(item)
              "
              class="edit-proposal-actions"
            >
              <button
                class="edit-review-button is-reject"
                type="button"
                :disabled="item.status === 'submitting'"
                @click="emit('reject', item.event.id)"
              >
                {{ t("reject") }}
              </button>
              <button
                class="edit-review-button is-accept"
                type="button"
                :disabled="
                  isStructureProposalItem(item)
                    ? structureProposalAcceptDisabled(item)
                    : contentProposalAcceptDisabled(item)
                "
                @click="emit('approve', item.event.id)"
              >
                {{
                  isStructureProposalItem(item)
                    ? structureProposalAcceptLabel(item)
                    : contentProposalAcceptLabel(item)
                }}
              </button>
            </div>
          </footer>
        </template>

        <LongProposalImpactDetails
          v-if="item.event.type === 'long.mutation_proposal' && item.preview"
          :item="item"
          :workspace-index="workspaceIndex"
        />
      </article>
    </div>
  </section>
</template>

<style scoped>
.long-proposal-review {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  max-height: min(43%, 360px);
  min-height: 0;
  border-top: 1px solid var(--theme-line);
  background: var(--surface-muted);
  color: var(--text-primary);
}

.long-proposal-review.is-embedded {
  max-height: none;
  border-top: 0;
  background: transparent;
}

.long-proposal-review.is-embedded .long-proposal-list {
  padding: 10px 0 0;
  overflow: visible;
}

.long-proposal-review.is-embedded.has-edit-proposal-surface-items
  .long-proposal-list {
  gap: 12px;
  padding: 0;
  margin: 14px 0 20px;
}

.long-proposal-review.is-embedded.is-conversation-card .long-proposal-list,
.long-proposal-review.is-row-body .long-proposal-list {
  padding: 0;
  margin: 0;
}

.long-proposal-list {
  display: grid;
  gap: 7px;
  min-height: 0;
  padding: 8px;
  overflow: auto;
}

.long-edit-diff-file + .long-edit-diff-file {
  border-top: 1px solid var(--theme-line-soft);
}

.long-edit-diff-file-label {
  padding: 6px 12px;
  border-bottom: 1px solid var(--theme-line-soft);
  background: var(--surface-muted);
  color: var(--text-secondary);
  font-size: 0.75rem;
  font-weight: 600;
}
</style>
