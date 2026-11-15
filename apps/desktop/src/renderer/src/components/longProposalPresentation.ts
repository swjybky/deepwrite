import { toRaw } from "vue";
import type {
  LongContinuityFileChange,
  LongContinuityFileRole,
  LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import { createScopedTranslator } from "../i18n";
import type { LongWorkspaceProposalItem } from "../composables/useLongWorkspaceProposals";
import { buildAgentTextDiff } from "../utils/agentTextDiff";

const t = createScopedTranslator("components.longProposalReview");

type LongWorkspaceIndex = LongWorkspaceIndexSnapshot | null | undefined;

export type LongContentFileChange = Extract<
  LongWorkspaceProposalItem["event"],
  {
    type:
      | "long.worldbuilding_file_proposal"
      | "long.character_file_proposal"
      | "long.continuity_file_proposal";
  }
>["payload"]["files"][number];

export interface LongContentFileDiff {
  file: LongContentFileChange;
  diff: ReturnType<typeof buildAgentTextDiff>;
}

export type LongProposalVisualStatus =
  "pending" | "accepting" | "accepted" | "error";

export function isContentFileProposalItem(
  item: LongWorkspaceProposalItem
): boolean {
  return (
    item.event.type === "long.worldbuilding_file_proposal" ||
    item.event.type === "long.character_file_proposal" ||
    item.event.type === "long.continuity_file_proposal"
  );
}

export function isStructureProposalItem(
  item: LongWorkspaceProposalItem
): boolean {
  return item.event.type === "long.mutation_proposal";
}

// Proposal events are immutable envelopes, so a diff is computed once per
// event for both the approval card and the conversation's file summary.
const contentDiffCache = new WeakMap<object, LongContentFileDiff[]>();

export function longContentFileDiffs(
  item: LongWorkspaceProposalItem
): LongContentFileDiff[] {
  const event = item.event;
  if (
    event.type !== "long.worldbuilding_file_proposal" &&
    event.type !== "long.character_file_proposal" &&
    event.type !== "long.continuity_file_proposal" &&
    !(event.type === "long.ledger_commit_proposal" && event.payload.files)
  ) {
    return [];
  }
  const key = toRaw(event);
  let diffs = contentDiffCache.get(key);
  if (!diffs) {
    diffs = event.payload.files!.map((file) => ({
      file,
      diff: buildAgentTextDiff(file.beforeText, file.afterText)
    }));
    contentDiffCache.set(key, diffs);
  }
  return diffs;
}

export function contentProposalDiffStats(item: LongWorkspaceProposalItem): {
  additions: number;
  deletions: number;
  hunks: number;
} {
  return longContentFileDiffs(item).reduce(
    (total, card) => ({
      additions: total.additions + card.diff.additions,
      deletions: total.deletions + card.diff.deletions,
      hunks: total.hunks + card.diff.hunks.length
    }),
    { additions: 0, deletions: 0, hunks: 0 }
  );
}

export function canDisplayContentFileDiff(
  item: LongWorkspaceProposalItem
): boolean {
  return (
    (item.event.type !== "long.continuity_file_proposal" &&
      item.event.type !== "long.ledger_commit_proposal") ||
    (Boolean(item.preview) &&
      (item.status === "ready" ||
        item.status === "submitting" ||
        item.status === "accepted"))
  );
}

const continuityRoleLabels: Record<LongContinuityFileRole, string> = {
  get foreshadowing_changes() {
    return t("foreshadowingChanges");
  },
  get world_reveals() {
    return t("worldbuildingReveals");
  },
  get character_current_state() {
    return t("currentCharacterState");
  },
  get character_history() {
    return t("characterHistory");
  },
  get chapter_end_state() {
    return t("endOfChapterState");
  },
  get handoff() {
    return t("handoffPackage");
  }
};

function trustedContinuityIdentity(
  index: LongWorkspaceIndex,
  fileId: string
): {
  chapterCardId: string;
  role: LongContinuityFileRole;
  characterId: string | null;
} | null {
  if (!index) return null;
  for (const chapter of index.chapters) {
    const chapterRole = (role: LongContinuityFileRole) => ({
      chapterCardId: chapter.chapterCardId,
      role,
      characterId: null
    });
    if (chapter.characterState.id === fileId) {
      return chapterRole("chapter_end_state");
    }
    if (chapter.handoff.id === fileId) return chapterRole("handoff");
    if (chapter.foreshadowingChanges.id === fileId) {
      return chapterRole("foreshadowing_changes");
    }
    if (chapter.worldReveals?.id === fileId) {
      return chapterRole("world_reveals");
    }
    for (const continuity of chapter.characterContinuity) {
      if (continuity.currentState.id === fileId) {
        return {
          chapterCardId: chapter.chapterCardId,
          role: "character_current_state",
          characterId: continuity.characterId
        };
      }
      if (continuity.history.id === fileId) {
        return {
          chapterCardId: chapter.chapterCardId,
          role: "character_history",
          characterId: continuity.characterId
        };
      }
    }
  }
  return null;
}

function continuityFileTitle(
  item: LongWorkspaceProposalItem,
  file: LongContinuityFileChange,
  index: LongWorkspaceIndex
): string {
  const identity = trustedContinuityIdentity(index, file.fileId);
  const trusted =
    identity ??
    (item.preview
      ? {
          chapterCardId: file.chapterCardId,
          role: file.role,
          characterId: file.characterId
        }
      : null);
  if (!index || !trusted) return t("continuityFilesPendingValidation");
  const chapter = index.plot.chapterCards.find(
    ({ id }) => id === trusted.chapterCardId
  );
  const character =
    trusted.characterId === null
      ? null
      : index.characters.find(({ id }) => id === trusted.characterId);
  if (!chapter || (trusted.characterId !== null && !character)) {
    return t("continuityFilesPendingValidation");
  }
  return `${chapter.title} / ${
    character ? `${character.name} / ` : ""
  }${continuityRoleLabels[trusted.role]}`;
}

export function contentFileTitle(
  item: LongWorkspaceProposalItem,
  file: LongContentFileChange,
  index: LongWorkspaceIndex
): string {
  return item.event.type === "long.continuity_file_proposal" ||
    item.event.type === "long.ledger_commit_proposal"
    ? continuityFileTitle(item, file as LongContinuityFileChange, index)
    : file.title;
}

export function proposalTitle(
  item: LongWorkspaceProposalItem,
  index: LongWorkspaceIndex
): string {
  switch (item.event.type) {
    case "long.mutation_proposal":
      return t("structureChanges");
    case "long.worldbuilding_file_proposal":
      return item.event.payload.files.length === 1
        ? item.event.payload.files[0]!.title
        : t("valueWorldbuildingFiles", {
            arg0: item.event.payload.files.length
          });
    case "long.character_file_proposal":
      return item.event.payload.files.length === 1
        ? item.event.payload.files[0]!.title
        : t("valueFilesForValue", {
            arg0: item.event.payload.files[0]?.characterName ?? t("characters"),
            arg1: item.event.payload.files.length
          });
    case "long.continuity_file_proposal":
      return item.event.payload.files.length === 1
        ? contentFileTitle(item, item.event.payload.files[0]!, index)
        : t("valueContinuityFiles", {
            arg0: item.event.payload.files.length
          });
    case "long.ledger_commit_proposal":
      return t("continuityLedgerArchive");
  }
}

export function proposalStatusText(item: LongWorkspaceProposalItem): string {
  if (item.status === "waiting" && item.blockedByError) {
    return t("precedingChangeFailed");
  }
  if (item.event.type === "long.ledger_commit_proposal") {
    if (item.status === "accepted") return t("archived");
    if (item.status === "waiting") return t("waitingForPrerequisiteFiles");
    if (item.status === "submitting") return t("archiving");
    if (item.status === "error") return t("archiveFailed");
    return t("awaitingArchive");
  }
  if (item.status === "accepted") return t("accepted");
  if (item.status === "waiting") return t("waitingForPrerequisiteFiles");
  if (item.status === "previewing") {
    return item.approvalMode === "auto-approve"
      ? t("automaticPreview")
      : t("previewing");
  }
  if (item.status === "submitting") {
    return item.approvalMode === "auto-approve"
      ? t("autosaving")
      : t("processingLabel");
  }
  if (item.status === "error") {
    if (item.errorPhase === "preview") return t("validationFailed");
    return item.approvalMode === "auto-approve"
      ? t("autosaveFailed")
      : item.errorRetryable === false
        ? t("cannotApply")
        : t("failedToApply");
  }
  return item.approvalMode === "auto-approve"
    ? t("awaitingAutosave")
    : t("awaitingConfirmation");
}

export function contentProposalVisualStatus(
  item: LongWorkspaceProposalItem
): LongProposalVisualStatus {
  if (item.status === "accepted") return "accepted";
  if (item.status === "error") return "error";
  if (item.status === "previewing" || item.status === "submitting") {
    return "accepting";
  }
  return "pending";
}

export function contentProposalStatusLabel(
  item: LongWorkspaceProposalItem
): string {
  if (item.status === "waiting" && item.blockedByError) {
    return t("precedingChangeFailed");
  }
  if (item.status === "accepted") return t("accepted");
  if (item.status === "error") {
    return item.errorPhase === "preview"
      ? t("validationFailed")
      : t("failedToApply");
  }
  if (item.status === "waiting") return t("waitingForPrerequisiteFiles");
  if (item.status === "previewing") return t("validating");
  if (item.status === "submitting") return t("applying");
  return item.approvalMode === "auto-approve"
    ? t("awaitingAutosaveLabel")
    : t("awaitingReview");
}

/** The short status shown beside a long proposal's title. */
export function longProposalStatusLabel(
  item: LongWorkspaceProposalItem
): string {
  return isContentFileProposalItem(item)
    ? contentProposalStatusLabel(item)
    : proposalStatusText(item);
}
