import type {
  ExportLongManuscriptInput,
  ExportLongManuscriptResult,
  LinkedMaterialIdsByKind,
  LinkedSkillIdsByKind,
  LongLinkedResourceStageScopes,
  LongApplyLegacySyncResult,
  LongBookSummary,
  LongChooseContinuationImportSourceResult,
  LongChooseLegacySyncSourceResult,
  LongManuscriptExportSection,
  LongOpenBookResult,
  LongWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import type { Ref } from "vue";
import type { ConversationDisposalOptions } from "./book-removal-runtime";
import type {
  LongBookRemovalTarget,
  LongBookRenameTarget,
  LongWorkspaceRefreshStatus
} from "../stores/longWorkspaceStore";

import {
  type LongWorkspaceRendererApi,
  type LongWorkspaceSelection
} from "../types/longWorkspace";

export type MaybePromise<Value> = Value | Promise<Value>;
export type PendingLane = "mutation" | "book-action" | "manuscript-export";
export type LongBindingsDialogMode = "skill" | "material";

export interface LongBookLifecycleNotifications {
  error(message: string): void;
  info(message: string): void;
  success(message: string): void;
  warning(message: string): void;
}

export interface LongBookLifecycleState {
  longBooks: Ref<readonly LongBookSummary[]>;
  activeBookId: Ref<string | null>;
  activeBookSummary: Readonly<Ref<LongBookSummary | null>>;
  workspaceIndex: Ref<LongWorkspaceIndexSnapshot | null>;
  refreshStatus: Ref<LongWorkspaceRefreshStatus | null>;
  mutationPending: Ref<boolean>;
  bookActionPending: Ref<boolean>;
  manuscriptExportPending: Ref<boolean>;
  continuationImportPreview: Ref<LongChooseContinuationImportSourceResult | null>;
  legacySyncPreview: Ref<LongChooseLegacySyncSourceResult | null>;
  legacySyncResult: Ref<LongApplyLegacySyncResult | null>;
  structureDialogOpen: Ref<boolean>;
  structureAgentsMd: Ref<string | null>;
  structureAgentsMdPending: Ref<boolean>;
  bindingsDialogMode: Ref<LongBindingsDialogMode | null>;
  exportTarget: Ref<LongBookRenameTarget | null>;
  bookRenameTarget: Ref<LongBookRenameTarget | null>;
  bookRemovalTarget: Ref<LongBookRemovalTarget | null>;
  createBookDialogOpen: Ref<boolean>;
  selectedResourceId: Ref<string>;
}

export interface LongBookLifecycleSessionPort {
  activateOpenedBook(opened: LongOpenBookResult): void;
  loadAgentSettings(): MaybePromise<unknown>;
  saveActiveEditorChanges(): Promise<boolean>;
  saveActiveEditorBeforeLeaving(nextBookId?: string): Promise<boolean>;
  openBook(bookId: string): Promise<void>;
  refreshActiveWorkspace(bookId: string): Promise<boolean>;
  clearActiveBook(bookId: string): Promise<void>;
  invalidateWorkspaceRefresh(bookId: string): void;
  selectWorkspaceFile(selection: LongWorkspaceSelection): Promise<boolean>;
}

export interface LongBookLifecycleWorkflowPort {
  stopBookAgentRuns(bookId: string): Promise<void>;
  quarantineBook(bookId: string): MaybePromise<void>;
  reactivateBook(bookId: string): MaybePromise<void>;
  disposeBookProposalState(bookId: string): MaybePromise<void>;
}

export interface LongBookLifecycleConversationPort {
  disposeBookConversations(
    bookId: string,
    options: ConversationDisposalOptions
  ): MaybePromise<void>;
}

export interface LongBookLifecycleCatalogPort {
  loadBookList(options?: {
    readonly force?: boolean;
    readonly notify?: boolean;
  }): Promise<void>;
  refreshWorkspaceDirectory(): Promise<void>;
}

export interface LongBookLifecycleResourcePort {
  selectBook(bookId: string): Promise<unknown>;
  showConversation(): void;
  revealEditor(): void;
}

export interface LongBookLifecycleManuscriptPort {
  available(): boolean;
  createInput(input: {
    readonly api: LongWorkspaceRendererApi;
    readonly bookId: string;
    readonly title: string;
    readonly workspace: LongWorkspaceIndexSnapshot;
    readonly sections: readonly LongManuscriptExportSection[];
  }): Promise<ExportLongManuscriptInput>;
  exportLong(
    input: ExportLongManuscriptInput
  ): Promise<ExportLongManuscriptResult>;
}

export interface LongBookLifecycleSchedulerPort {
  settleUi(): Promise<void>;
}

export interface LongBookLifecycleCoordinatorOptions {
  api(): LongWorkspaceRendererApi | undefined;
  state: LongBookLifecycleState;
  session: LongBookLifecycleSessionPort;
  workflow: LongBookLifecycleWorkflowPort;
  conversations: LongBookLifecycleConversationPort;
  catalog: LongBookLifecycleCatalogPort;
  resources: LongBookLifecycleResourcePort;
  manuscript: LongBookLifecycleManuscriptPort;
  scheduler: LongBookLifecycleSchedulerPort;
  notifications: LongBookLifecycleNotifications;
}

export interface LongBookBindingsUpdate {
  readonly linkedMaterialIdsByKind: LinkedMaterialIdsByKind;
  readonly linkedSkillIdsByKind: LinkedSkillIdsByKind;
  readonly linkedResourceStageScopes?: LongLinkedResourceStageScopes;
}
