import type {
  LongBookSummary,
  LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import type { Ref } from "vue";
import type {
  LongChapterCardCreateTarget,
  LongCharacterCreateTarget,
  LongDraftSectionDeleteTarget,
  LongPlotPointCreateTarget,
  LongTreeItemDeleteTarget,
  LongVolumeCreateTarget,
  LongWorldbuildingItemCreateTarget
} from "../../stores/longWorkspaceStore";
import type {
  LongStructureMutationCompletion,
  LongWorkspaceRendererApi,
  LongWorkspaceSelection
} from "../../types/longWorkspace";
import type { ResourceTreeNode } from "../../types/workspace";
import type { LongWorkspaceEditorPort } from "../useLongWorkspaceSessionCoordinator";

export interface LongStructureTransactionsNotifications {
  error(message: string): void;
  info(message: string): void;
  success(message: string): void;
  warning(message: string): void;
}

export interface LongStructureTransactionsState {
  longBooks: Ref<readonly LongBookSummary[]>;
  activeBookId: Ref<string | null>;
  activeBookSummary: Readonly<Ref<LongBookSummary | null>>;
  workspaceIndex: Ref<LongWorkspaceIndexSnapshot | null>;
  selection: Ref<LongWorkspaceSelection | null>;
  mutationPending: Ref<boolean>;
  structureDialogOpen: Ref<boolean>;
  characterCreateTarget: Ref<LongCharacterCreateTarget | null>;
  worldbuildingItemCreateTarget: Ref<LongWorldbuildingItemCreateTarget | null>;
  plotPointCreateTarget: Ref<LongPlotPointCreateTarget | null>;
  chapterCardCreateTarget: Ref<LongChapterCardCreateTarget | null>;
  draftSectionDeleteTarget: Ref<LongDraftSectionDeleteTarget | null>;
  treeItemDeleteTarget: Ref<LongTreeItemDeleteTarget | null>;
  volumeCreateTarget: Ref<LongVolumeCreateTarget | null>;
  selectedResourceId: Ref<string>;
}

export interface LongStructureTransactionsSessionPort {
  saveActiveEditorChanges(): Promise<boolean>;
  saveActiveEditorBeforeLeaving(nextBookId?: string): Promise<boolean>;
  openBook(
    bookId: string,
    requestedSelection?: LongWorkspaceSelection | null
  ): Promise<void>;
  refreshActiveWorkspace(bookId: string): Promise<boolean>;
  refreshWorkspaceAfterProposal(bookId: string): Promise<boolean>;
  selectWorkspaceFile(selection: LongWorkspaceSelection): Promise<boolean>;
  editor: Readonly<Ref<LongWorkspaceEditorPort | null>>;
}

export interface LongStructureTransactionsResourcePort {
  node(resourceId: string): ResourceTreeNode | undefined;
  select(node: ResourceTreeNode): Promise<unknown>;
  synchronizeSelectedResourceForLayout(bookId: string): void;
  revealEditor(): void;
}

export interface LongStructureTransactionsCoordinatorOptions {
  api(): LongWorkspaceRendererApi | undefined;
  state: LongStructureTransactionsState;
  session: LongStructureTransactionsSessionPort;
  resources: LongStructureTransactionsResourcePort;
  notifications: LongStructureTransactionsNotifications;
}

export interface LongStructureMutationTargetSnapshot {
  readonly bookId: string;
  readonly index: LongWorkspaceIndexSnapshot;
}

export interface LongStructureMutationLease {
  readonly requestId: number;
  readonly target: LongStructureMutationTargetSnapshot;
  applied: boolean;
}

export interface LongTreeItemDetails {
  label: string;
  title: string;
  description: string;
  orderedIds: string[];
  parentResourceId: string;
  resourceIdForItem(id: string): string;
}

export const NOOP_COMPLETION: LongStructureMutationCompletion = {
  succeed: () => undefined,
  fail: () => undefined,
  appliedButRefreshFailed: () => undefined
};

export function booleanMutationCompletion(
  completion: (succeeded: boolean) => void
): LongStructureMutationCompletion {
  return {
    succeed: () => completion(true),
    fail: () => completion(false),
    appliedButRefreshFailed: () => completion(true)
  };
}
