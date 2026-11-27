import { createScopedTranslator } from "../i18n";
import type { LongWorkspaceImpactConfirmation } from "@deepwrite/contracts";

const t = createScopedTranslator("workspace");

const ENTITY_LABELS: Record<string, string> = {
  get "worldbuilding-category"() {
    return t("longImpactConfirmation.worldbuildingCategory");
  },
  get "worldbuilding-item"() {
    return t("longImpactConfirmation.worldbuildingEntry");
  },
  get "character-type"() {
    return t("longImpactConfirmation.characterType");
  },
  get character() {
    return t("catalogWorkspace.characters");
  },
  get volume() {
    return t("longImpactConfirmation.volume");
  },
  get arc() {
    return t("longImpactConfirmation.plotPoint");
  },
  get "chapter-card"() {
    return t("longImpactConfirmation.chapterCard");
  },
  get "story-event"() {
    return t("longImpactConfirmation.storyEvent");
  },
  get "story-plot"() {
    return t("longImpactConfirmation.storyPlot");
  },
  get "event-connection"() {
    return t("longImpactConfirmation.eventConnection");
  },
  get "narrative-placement"() {
    return t("longImpactConfirmation.narrativeAnchor");
  },
  get "foreshadowing-thread"() {
    return t("longImpactConfirmation.foreshadowingThread");
  },
  get "foreshadowing-beat"() {
    return t("longImpactConfirmation.foreshadowingBeat");
  }
};

const RELATIONSHIP_LABELS: Record<string, string> = {
  get "worldbuilding-category-item"() {
    return t("longImpactConfirmation.worldbuildingCategoriesAndEntries");
  },
  get "character-type-member"() {
    return t("longImpactConfirmation.characterTypeAssignments");
  },
  get "arc-volume"() {
    return t("longImpactConfirmation.plotPointsAndVolumes");
  },
  get "chapter-volume"() {
    return t("longImpactConfirmation.chapterCardsAndVolumes");
  },
  get "chapter-primary-arc"() {
    return t("longImpactConfirmation.chapterCardsAndMainPlotPoints");
  },
  get "story-plot-arc"() {
    return t("longImpactConfirmation.storyPlotsAndPlotPoints");
  },
  get "story-event-arc"() {
    return t("longImpactConfirmation.storyEventsAndPlotPoints");
  },
  get "story-event-character"() {
    return t("longImpactConfirmation.storyEventsAndCharacters");
  },
  get "event-connection-source"() {
    return t("longImpactConfirmation.eventConnectionSources");
  },
  get "event-connection-target"() {
    return t("longImpactConfirmation.eventConnectionTargets");
  },
  get "narrative-placement-event"() {
    return t("longImpactConfirmation.narrativeAnchorsAndEvents");
  },
  get "narrative-placement-chapter"() {
    return t("longImpactConfirmation.narrativeAnchorsAndChapterCards");
  },
  get "narrative-placement-commit"() {
    return t("longImpactConfirmation.narrativeAnchorsAndContinuityRecords");
  },
  get "foreshadowing-truth-event"() {
    return t("longImpactConfirmation.foreshadowingThreadsAndTruthEvents");
  },
  get "foreshadowing-thread-beat"() {
    return t("longImpactConfirmation.foreshadowingThreadsAndBeats");
  },
  get "foreshadowing-beat-volume"() {
    return t("longImpactConfirmation.foreshadowingBeatsAndVolumes");
  },
  get "foreshadowing-beat-arc"() {
    return t("longImpactConfirmation.foreshadowingBeatsAndPlotPoints");
  },
  get "foreshadowing-beat-event"() {
    return t("longImpactConfirmation.foreshadowingBeatsAndEvents");
  },
  get "foreshadowing-beat-placement"() {
    return t("longImpactConfirmation.foreshadowingBeatsAndNarrativeAnchors");
  },
  get "foreshadowing-beat-chapter"() {
    return t("longImpactConfirmation.foreshadowingBeatsAndChapterCards");
  },
  get "foreshadowing-beat-commit"() {
    return t("longImpactConfirmation.foreshadowingBeatsAndContinuityRecords");
  },
  get "character-files"() {
    return t("longImpactConfirmation.characterProfileMappings");
  },
  get "chapter-files"() {
    return t("longImpactConfirmation.chapterFileMappings");
  },
  get "ledger-commit"() {
    return t("longImpactConfirmation.continuityCommitRecords");
  },
  get "ledger-state"() {
    return t("longImpactConfirmation.continuityState");
  },
  get "continuity-projection"() {
    return t("longImpactConfirmation.continuityProjections");
  }
};

function snapshotTitle(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const snapshot = value as Record<string, unknown>;
  for (const key of ["title", "name", "label"]) {
    const candidate = snapshot[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return undefined;
}

function quotedTitle(value: unknown): string {
  const title = snapshotTitle(value);
  return title ? `“${title}”` : "";
}

export function longImpactConfirmationLines(
  confirmation: LongWorkspaceImpactConfirmation
): string[] {
  const lines: string[] = [];
  for (const change of confirmation.entityChanges) {
    const label = ENTITY_LABELS[change.kind] ?? change.kind;
    const title = quotedTitle(change.before ?? change.after);
    const action =
      change.action === "delete"
        ? t("longImpactConfirmation.delete")
        : change.action === "create"
          ? t("longImpactConfirmation.add")
          : t("longImpactConfirmation.update");
    lines.push(`${action}${label}${title}（${change.id}）`);
  }
  for (const change of confirmation.relationshipChanges) {
    const label = RELATIONSHIP_LABELS[change.kind] ?? change.kind;
    const action =
      change.action === "delete"
        ? t("longImpactConfirmation.unlink")
        : change.action === "create"
          ? t("longImpactConfirmation.add")
          : t("longImpactConfirmation.update");
    lines.push(`${action}${label}（${change.id}）`);
  }
  for (const intent of confirmation.fileIntents) {
    lines.push(
      t("longImpactConfirmation.file", {
        value:
          intent.action === "delete"
            ? t("longImpactConfirmation.delete")
            : t("longImpactConfirmation.create"),
        path: intent.file.path
      })
    );
  }
  for (const edit of confirmation.ledgerRecordEdits) {
    const parts = [
      edit.removePlacementIds.length
        ? t("longImpactConfirmation.unlinkNarrativeAnchors", {
            length: edit.removePlacementIds.length
          })
        : "",
      edit.removeForeshadowingBeatIds.length
        ? t("longImpactConfirmation.unlinkForeshadowingBeatRecords", {
            length: edit.removeForeshadowingBeatIds.length
          })
        : "",
      edit.removeSubjectIds.length
        ? t("longImpactConfirmation.removeSubjectReferences", {
            length: edit.removeSubjectIds.length
          })
        : "",
      edit.removeKnowledgeAudienceIds.length
        ? t("longImpactConfirmation.removeKnowledgeAudiences", {
            length: edit.removeKnowledgeAudienceIds.length
          })
        : "",
      edit.removeFactIds.length
        ? t("longImpactConfirmation.removeFacts", {
            length: edit.removeFactIds.length
          })
        : "",
      edit.removeFactKeys.length
        ? t("longImpactConfirmation.removeFactKeys", {
            length: edit.removeFactKeys.length
          })
        : "",
      edit.removeKnowledgeKeys.length
        ? t("longImpactConfirmation.removeKnowledgeKeys", {
            length: edit.removeKnowledgeKeys.length
          })
        : "",
      edit.removeOpenLoopIds.length
        ? t("longImpactConfirmation.removeOpenThreads", {
            length: edit.removeOpenLoopIds.length
          })
        : "",
      edit.reconcileForeshadowingThreadIds.length
        ? t("longImpactConfirmation.recalculateForeshadowingThreads", {
            length: edit.reconcileForeshadowingThreadIds.length
          })
        : "",
      edit.replaceHandoff
        ? t("longImpactConfirmation.rebuildTheContinuationPack")
        : ""
    ].filter(Boolean);
    lines.push(
      t("longImpactConfirmation.updateContinuityRecord", {
        path: edit.recordFile.path,
        join:
          parts.join("、") ||
          t("longImpactConfirmation.syncRelatedCleanupResults")
      })
    );
  }
  return lines;
}

export function longImpactConfirmationDescription(
  confirmation: LongWorkspaceImpactConfirmation,
  fallback = t("longImpactConfirmation.thisContentWillBeRemovedFromYourDevice")
): string {
  const lines = longImpactConfirmationLines(confirmation);
  return lines.length ? lines.join("；") + "。" : fallback;
}
