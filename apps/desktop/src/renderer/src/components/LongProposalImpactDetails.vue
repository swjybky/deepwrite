<script setup lang="ts">
import { createScopedTranslator } from "../i18n";
import { computed } from "vue";
import type {
  LongWorkspaceEntityChange,
  LongWorkspaceIndexSnapshot,
  LongWorkspaceLedgerRecordEdit,
  LongWorkspaceRelationshipChange
} from "@deepwrite/contracts";
import type { LongWorkspaceProposalItem } from "../composables/useLongWorkspaceProposals";
import { longCharacterFiles } from "../utils/longCharacterFiles";
import { formatLongImpactSnapshot } from "../utils/longProposalChangePresentation";
import { longWorldbuildingFiles } from "../utils/longWorldbuildingFiles";

const t = createScopedTranslator("components.longProposalImpactDetails");

const props = defineProps<{
  item: LongWorkspaceProposalItem;
  workspaceIndex?: LongWorkspaceIndexSnapshot | null | undefined;
}>();

const preview = computed(() => props.item.preview);
const operationCount = computed(() =>
  props.item.event.type === "long.mutation_proposal"
    ? props.item.event.payload.batch.operations.length
    : 0
);
const workspaceFilePaths = computed(() => {
  const index = props.workspaceIndex;
  const entries: Array<readonly [string, string]> = [];
  if (!index) return new Map(entries);
  entries.push([index.bookLine.id, index.bookLine.path]);
  for (const file of longWorldbuildingFiles(index.worldbuilding)) {
    entries.push([file.id, file.path]);
  }
  for (const file of longCharacterFiles(index)) {
    entries.push([file.id, file.path]);
  }
  for (const chapter of index.chapters) {
    entries.push(
      [chapter.body.id, chapter.body.path],
      [chapter.card.id, chapter.card.path],
      [chapter.characterState.id, chapter.characterState.path],
      [chapter.handoff.id, chapter.handoff.path],
      [chapter.foreshadowingChanges.id, chapter.foreshadowingChanges.path]
    );
    if (chapter.worldReveals) {
      entries.push([chapter.worldReveals.id, chapter.worldReveals.path]);
    }
    for (const continuity of chapter.characterContinuity) {
      entries.push(
        [continuity.currentState.id, continuity.currentState.path],
        [continuity.history.id, continuity.history.path]
      );
    }
  }
  for (const commit of index.ledger.commits) {
    entries.push([commit.recordFile.id, commit.recordFile.path]);
  }
  return new Map(entries);
});

function structureImpactTotal(): number {
  const impact = preview.value?.impact;
  return impact
    ? impact.createdEntityIds.length +
        impact.updatedEntityIds.length +
        impact.deletedEntityIds.length
    : 0;
}

function proposalFilePath(fileId: string): string {
  const previewed = preview.value?.fileIntents.find(
    ({ file }) => file.id === fileId
  );
  return previewed?.file.path ?? workspaceFilePaths.value.get(fileId) ?? fileId;
}

const entityKindLabels: Record<string, string> = {
  get "worldbuilding-category"() {
    return t("worldbuildingCategory");
  },
  get "worldbuilding-item"() {
    return t("worldbuildingEntry");
  },
  get "character-type"() {
    return t("characterType");
  },
  get character() {
    return t("characters");
  },
  get volume() {
    return t("volumes");
  },
  get arc() {
    return t("plotArc");
  },
  get "chapter-card"() {
    return t("chapterCard");
  },
  get "story-event"() {
    return t("storyEvent");
  },
  get "story-plot"() {
    return t("storyEventLabel");
  },
  get "event-connection"() {
    return t("eventLink");
  },
  get "narrative-placement"() {
    return t("narrativeBeat");
  },
  get "foreshadowing-thread"() {
    return t("foreshadowingThread");
  },
  get "foreshadowing-beat"() {
    return t("foreshadowingBeat");
  }
};

function entityActionLabel(action: LongWorkspaceEntityChange["action"]) {
  if (action === "create") return t("createEntity");
  if (action === "delete") return t("deleteEntity");
  return t("updateEntity");
}

function snapshotText(value: unknown): string {
  return formatLongImpactSnapshot(
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null,
    props.workspaceIndex,
    t("missing")
  );
}

const relationshipKindLabels: Record<string, string> = {
  get "worldbuilding-category-item"() {
    return t("worldbuildingCategoriesAndEntries");
  },
  get "character-type-member"() {
    return t("characterTypeAssignments");
  },
  get "arc-volume"() {
    return t("plotPointsAndVolumes");
  },
  get "chapter-volume"() {
    return t("chapterCardsAndVolumes");
  },
  get "chapter-primary-arc"() {
    return t("chapterCardsAndPrimaryPlotPoints");
  },
  get "story-plot-arc"() {
    return t("storyEventsAndPlotPoints");
  },
  get "story-event-arc"() {
    return t("storyEventsAndPlotPointsLabel");
  },
  get "story-event-character"() {
    return t("storyEventsAndCharacters");
  },
  get "event-connection-source"() {
    return t("eventLinkSource");
  },
  get "event-connection-target"() {
    return t("eventLinkDestination");
  },
  get "narrative-placement-event"() {
    return t("narrativeBeatsAndEvents");
  },
  get "narrative-placement-chapter"() {
    return t("narrativeBeatsAndChapterCards");
  },
  get "narrative-placement-commit"() {
    return t("narrativeBeatsAndContinuityRecords");
  },
  get "foreshadowing-truth-event"() {
    return t("foreshadowingThreadsAndTruthEvents");
  },
  get "foreshadowing-thread-beat"() {
    return t("foreshadowingThreadsAndTouchpoints");
  },
  get "foreshadowing-beat-volume"() {
    return t("foreshadowingTouchpointsAndVolumes");
  },
  get "foreshadowing-beat-arc"() {
    return t("foreshadowingTouchpointsAndPlotPoints");
  },
  get "foreshadowing-beat-event"() {
    return t("foreshadowingTouchpointsAndEvents");
  },
  get "foreshadowing-beat-placement"() {
    return t("foreshadowingTouchpointsAndNarrativeBeats");
  },
  get "foreshadowing-beat-chapter"() {
    return t("foreshadowingTouchpointsAndChapterCards");
  },
  get "foreshadowing-beat-commit"() {
    return t("foreshadowingTouchpointsAndContinuityRecords");
  },
  get "character-files"() {
    return t("charactersAndFiles");
  },
  get "chapter-files"() {
    return t("chaptersAndFiles");
  },
  get "ledger-commit"() {
    return t("continuityCommit");
  },
  get "ledger-state"() {
    return t("continuityLedgerState");
  },
  get "continuity-projection"() {
    return t("continuityProjection");
  }
};

function relationshipActionLabel(
  action: LongWorkspaceRelationshipChange["action"]
) {
  if (action === "create") return t("createLink");
  if (action === "delete") return t("removeLink");
  return t("updateLink");
}

function ledgerRecordEditCount(edit: LongWorkspaceLedgerRecordEdit): number {
  return (
    edit.removePlacementIds.length +
    edit.removeForeshadowingBeatIds.length +
    edit.reconcileForeshadowingThreadIds.length +
    edit.removeSubjectIds.length +
    edit.removeKnowledgeAudienceIds.length +
    edit.removeFactIds.length +
    edit.removeFactKeys.length +
    edit.removeKnowledgeKeys.length +
    edit.removeOpenLoopIds.length +
    (edit.replaceHandoff ? 1 : 0)
  );
}
</script>

<template>
  <template v-if="preview">
    <div class="proposal-impact">
      <span>
        <strong>{{ operationCount }}</strong>
        {{ t("structureOperations") }}
      </span>
      <span
        ><strong>{{ structureImpactTotal() }}</strong>
        {{ t("affectedEntities") }}</span
      >
      <span
        ><strong>{{ preview.fileIntents.length }}</strong>
        {{ t("fileAdditionsAndDeletions") }}</span
      >
      <span>
        <strong>{{ preview.relationshipChanges.length }}</strong>
        {{ t("linkChanges") }}
      </span>
      <span>
        <strong>{{ preview.ledgerRecordEdits.length }}</strong>
        {{ t("ledgerRecords") }}
      </span>
      <span
        ><strong>{{ preview.documentWrites.length }}</strong>
        {{ t("documentWrites") }}</span
      >
    </div>
    <details
      class="proposal-details"
      :open="
        preview.impact.deletedEntityIds.length > 0 ||
        preview.impact.deletedFileIds.length > 0 ||
        preview.relationshipChanges.length > 0 ||
        preview.ledgerRecordEdits.length > 0
      "
    >
      <summary>
        {{ t("viewDetailedImpact") }}
      </summary>
      <div v-if="preview.entityChanges.length" class="detail-group entity-list">
        <strong>{{
          t("completeEntitySnapshotsMessage", {
            arg0: preview.entityChanges.length ?? ""
          })
        }}</strong>
        <details
          v-for="change in preview.entityChanges"
          :key="`${change.action}:${change.kind}:${change.id}`"
          class="entity-change"
          :class="{ 'is-danger': change.action === 'delete' }"
        >
          <summary>
            {{ entityActionLabel(change.action) }} ·
            {{ entityKindLabels[change.kind] }} · {{ change.id }}
          </summary>
          <div class="entity-diff">
            <section>
              <strong>{{ t("before") }}</strong>
              <pre>{{ snapshotText(change.before) }}</pre>
            </section>
            <section>
              <strong>{{ t("after") }}</strong>
              <pre>{{ snapshotText(change.after) }}</pre>
            </section>
          </div>
        </details>
      </div>
      <div
        v-if="preview.relationshipChanges.length"
        class="detail-group entity-list"
      >
        <strong>{{
          t("linkChangesMessage", {
            arg0: preview.relationshipChanges.length ?? ""
          })
        }}</strong>
        <details
          v-for="change in preview.relationshipChanges"
          :key="`${change.action}:${change.kind}:${change.id}`"
          class="entity-change"
          :class="{ 'is-danger': change.action === 'delete' }"
        >
          <summary>
            {{ relationshipActionLabel(change.action) }} ·
            {{ relationshipKindLabels[change.kind] }} · {{ change.id }}
          </summary>
          <div class="entity-diff">
            <section>
              <strong>{{ t("before") }}</strong>
              <pre>{{ snapshotText(change.before) }}</pre>
            </section>
            <section>
              <strong>{{ t("after") }}</strong>
              <pre>{{ snapshotText(change.after) }}</pre>
            </section>
          </div>
        </details>
      </div>
      <div
        v-if="preview.ledgerRecordEdits.length"
        class="detail-group ledger-list"
      >
        <strong>
          {{
            t("continuityLedgerRecordImpactMessage", {
              arg0: preview.ledgerRecordEdits.length ?? ""
            })
          }}
        </strong>
        <details
          v-for="edit in preview.ledgerRecordEdits"
          :key="edit.commitId"
          class="entity-change is-danger"
        >
          <summary>
            {{
              t("updateRecordItemsMessage", {
                arg0: edit.commitId ?? "",
                arg1: edit.recordFile.id ?? "",
                arg2: ledgerRecordEditCount(edit) ?? ""
              })
            }}
          </summary>
          <div class="ledger-edit">
            <code>{{ edit.recordFile.path }}</code>
            <span v-if="edit.removePlacementIds.length">{{
              t("unlinkNarrativeBeatsMessage", {
                arg0: edit.removePlacementIds.join("、") ?? ""
              })
            }}</span>
            <span v-if="edit.removeForeshadowingBeatIds.length">{{
              t("unlinkForeshadowingTouchpointsMessage", {
                arg0: edit.removeForeshadowingBeatIds.join("、") ?? ""
              })
            }}</span>
            <span v-if="edit.reconcileForeshadowingThreadIds.length">{{
              t("recalculateForeshadowingThreadsMessage", {
                arg0: edit.reconcileForeshadowingThreadIds.join("、") ?? ""
              })
            }}</span>
            <span v-if="edit.removeSubjectIds.length">{{
              t("removeSubjectReferencesMessage", {
                arg0: edit.removeSubjectIds.join("、") ?? ""
              })
            }}</span>
            <span v-if="edit.removeKnowledgeAudienceIds.length">{{
              t("removeKnowledgeAudiencesMessage", {
                arg0: edit.removeKnowledgeAudienceIds.join("、") ?? ""
              })
            }}</span>
            <span v-if="edit.removeFactIds.length">{{
              t("removeFactsMessage", {
                arg0: edit.removeFactIds.join("、") ?? ""
              })
            }}</span>
            <span v-if="edit.removeOpenLoopIds.length">{{
              t("removeOpenThreadsMessage", {
                arg0: edit.removeOpenLoopIds.join("、") ?? ""
              })
            }}</span>
            <span v-if="edit.removeFactKeys.length">{{
              t("factKeysToRemoveMessage", {
                arg0: edit.removeFactKeys.length ?? ""
              })
            }}</span>
            <span v-if="edit.removeKnowledgeKeys.length">{{
              t("knowledgeKeysToRemoveMessage", {
                arg0: edit.removeKnowledgeKeys.length ?? ""
              })
            }}</span>
            <span v-if="edit.replaceHandoff">{{
              t("updateHandoffPackage")
            }}</span>
          </div>
        </details>
      </div>
      <div
        v-if="preview.impact.deletedFileIds.length"
        class="detail-group is-danger"
      >
        <strong>{{
          t("deleteFileReferencesMessage", {
            arg0: preview.impact.deletedFileIds.length ?? ""
          })
        }}</strong>
        <code v-for="id in preview.impact.deletedFileIds" :key="id">{{
          id
        }}</code>
      </div>
      <div v-if="preview.fileIntents.length" class="detail-group">
        <strong>{{ t("fileOperations") }}</strong>
        <span
          v-for="intent in preview.fileIntents"
          :key="`${intent.action}:${intent.file.id}`"
          :class="{ 'is-danger': intent.action === 'delete' }"
        >
          {{ intent.action === "delete" ? t("deleteReference") : t("new") }}
          · {{ intent.file.path }} · {{ intent.reason }}
        </span>
      </div>
      <div v-if="preview.documentWrites.length" class="detail-group write-list">
        <strong>{{ t("documentContentToWrite") }}</strong>
        <details
          v-for="write in preview.documentWrites"
          :key="write.proposalId"
          class="proposal-content"
        >
          <summary>
            {{ proposalFilePath(write.fileId) }} · {{ write.mode }}
          </summary>
          <span>{{ write.reason }}</span>
          <textarea
            readonly
            spellcheck="false"
            :aria-label="
              t('proposedValueContent', {
                arg0: proposalFilePath(write.fileId)
              })
            "
            :value="write.content"
          />
        </details>
      </div>
    </details>
  </template>
</template>

<style scoped>
.proposal-impact {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.proposal-impact span {
  display: inline-flex;
  align-items: baseline;
  gap: 3px;
  padding: 4px 6px;
  border-radius: 7px;
  background: var(--surface-main);
  color: var(--text-tertiary);
  font-size: 0.607143rem;
}
.proposal-impact strong {
  color: var(--text-primary);
  font-size: 0.678571rem;
}
.proposal-details {
  padding: 6px 8px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 8px;
  background: var(--surface-main);
  font-size: 0.642857rem;
}
.proposal-details summary {
  color: var(--text-secondary);
  cursor: pointer;
}
.proposal-details[open] > summary {
  margin-bottom: 7px;
}
.detail-group {
  display: grid;
  gap: 4px;
  max-height: 150px;
  padding: 6px;
  overflow: auto;
  border-radius: 7px;
  background: var(--surface-muted);
  color: var(--text-secondary);
}
.detail-group + .detail-group {
  margin-top: 5px;
}
.detail-group strong {
  color: var(--text-primary);
}
.detail-group code,
.detail-group span {
  overflow-wrap: anywhere;
  color: var(--text-tertiary);
  font-family: var(--code-font);
  font-size: var(--code-font-size);
}
.write-list {
  max-height: none;
}
.entity-list,
.ledger-list {
  max-height: 360px;
}
.entity-change,
.proposal-content {
  padding: 5px 6px;
  border: 1px solid var(--theme-line-soft);
  border-radius: 6px;
  background: var(--surface-main);
}
.entity-change > summary,
.proposal-content > summary {
  overflow-wrap: anywhere;
  color: var(--text-secondary);
  cursor: pointer;
  font-family: var(--code-font);
  font-size: var(--code-font-size);
}
.entity-change.is-danger > summary,
.detail-group.is-danger strong,
.detail-group .is-danger {
  color: var(--danger);
}
.entity-diff {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}
.entity-diff section {
  min-width: 0;
}
.entity-diff pre {
  max-height: 240px;
  margin: 4px 0 0;
  padding: 6px;
  overflow: auto;
  border: 1px solid var(--theme-line-soft);
  border-radius: 6px;
  background: var(--surface-raised);
  color: var(--text-primary);
  font-family: var(--code-font);
  font-size: var(--code-font-size);
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.ledger-edit {
  display: grid;
  gap: 4px;
}
.proposal-content[open] summary {
  margin-bottom: 5px;
}
.proposal-content textarea {
  display: block;
  width: 100%;
  min-height: 132px;
  max-height: 320px;
  resize: vertical;
  padding: 7px;
  overflow: auto;
  border: 1px solid var(--theme-line-soft);
  border-radius: 6px;
  background: var(--surface-raised);
  color: var(--text-primary);
  font-family: var(--code-font);
  font-size: var(--code-font-size);
  line-height: 1.55;
}
@media (max-width: 42rem) {
  .entity-diff {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
