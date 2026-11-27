import { createScopedTranslator } from "../i18n";
import type { Ref } from "vue";
import type { LongWorkspaceRendererApi } from "../types/longWorkspace";
import {
  createLongManuscriptExportInput,
  type LongManuscriptExportRequest
} from "../utils/longManuscriptExport";
import type {
  LongBookLifecycleManuscriptPort,
  LongBookLifecycleNotifications,
  LongBookLifecycleSessionPort,
  LongBookLifecycleState,
  PendingLane
} from "./longBookLifecycleTypes";
import { formatError } from "../i18n/errors";

const t = createScopedTranslator("workspace.longManuscriptExportFlow");

export interface LongManuscriptExportLease {
  readonly lane: PendingLane;
  readonly requestId: number;
  readonly pending: Ref<boolean>;
}

export interface LongManuscriptExportFlowContext {
  api(): LongWorkspaceRendererApi | undefined;
  state: Pick<
    LongBookLifecycleState,
    "exportTarget" | "activeBookId" | "manuscriptExportPending"
  >;
  session: Pick<LongBookLifecycleSessionPort, "saveActiveEditorChanges">;
  manuscript: LongBookLifecycleManuscriptPort;
  notifications: LongBookLifecycleNotifications;
  isDisposed(): boolean;
  beginDialogRequest(): number | null;
  markDialogTarget<Value extends object>(
    target: Value,
    requestId: number
  ): Value;
  requestForTarget(target: object): number;
  dialogRequestIsCurrent(requestId: number): boolean;
  targetIsCurrent<Value extends object>(
    targetRef: Ref<Value | null>,
    target: Value,
    requestId?: number
  ): boolean;
  cancelDialogRequests(): void;
  acquirePendingLease(
    lane: "manuscript-export"
  ): LongManuscriptExportLease | null;
  leaseIsCurrent(lease: LongManuscriptExportLease): boolean;
  replaceOwnedLease(lease: LongManuscriptExportLease): void;
  getOwnedExportLease(): LongManuscriptExportLease | undefined;
  runWithLease(
    lease: LongManuscriptExportLease,
    task: () => Promise<void>
  ): Promise<void>;
}

function clearExportSelection(
  state: LongManuscriptExportFlowContext["state"]
): void {
  state.exportTarget.value = null;
}

export function createLongManuscriptExportFlow(
  context: LongManuscriptExportFlowContext
) {
  const { state, session, manuscript, notifications: uiMessage } = context;

  function openExportDialog(bookId: string, title: string): void {
    const requestId = context.beginDialogRequest();
    if (requestId === null) return;
    state.exportTarget.value = context.markDialogTarget(
      { bookId, title },
      requestId
    );
  }

  function closeLongExportDialog(): void {
    if (context.isDisposed()) return;
    const target = state.exportTarget.value;
    const ownedLease = context.getOwnedExportLease();
    if (
      target &&
      ownedLease &&
      context.requestForTarget(target) === ownedLease.requestId
    ) {
      return;
    }
    if (state.manuscriptExportPending.value && !ownedLease) return;
    context.cancelDialogRequests();
    clearExportSelection(state);
  }

  function exportLongBookManuscript(
    request: LongManuscriptExportRequest
  ): Promise<void> {
    const api = context.api();
    const target = state.exportTarget.value;
    if (!api || !target || !manuscript.available()) return Promise.resolve();
    const lease = context.acquirePendingLease("manuscript-export");
    if (!lease) return Promise.resolve();
    const requestId = context.requestForTarget(target);
    const exportLease: LongManuscriptExportLease = {
      ...lease,
      requestId
    };
    context.replaceOwnedLease(exportLease);
    return context.runWithLease(exportLease, async () => {
      try {
        if (
          state.activeBookId.value === target.bookId &&
          !(await session.saveActiveEditorChanges())
        ) {
          return;
        }
        if (
          !context.leaseIsCurrent(exportLease) ||
          !context.targetIsCurrent(state.exportTarget, target, requestId)
        ) {
          return;
        }
        const snapshot = await api.getWorkspaceIndex({ bookId: target.bookId });
        if (
          !context.leaseIsCurrent(exportLease) ||
          !context.targetIsCurrent(state.exportTarget, target, requestId)
        ) {
          return;
        }
        const exportInput = {
          ...(await (manuscript.createInput ?? createLongManuscriptExportInput)(
            {
              api,
              bookId: target.bookId,
              title: target.title,
              workspace: snapshot.workspaceIndex,
              sections: request.sections,
              ...(request.sections.includes("manuscript")
                ? {
                    manuscriptChapterCardIds: request.manuscriptChapterCardIds
                  }
                : {})
            }
          )),
          mode: request.mode ?? "folder",
          ...(request.format ? { format: request.format } : {})
        };
        if (
          !context.leaseIsCurrent(exportLease) ||
          !context.targetIsCurrent(state.exportTarget, target, requestId)
        ) {
          return;
        }
        const result = await manuscript.exportLong(exportInput);
        if (!context.leaseIsCurrent(exportLease) || result.status !== "saved") {
          return;
        }
        if (context.targetIsCurrent(state.exportTarget, target, requestId)) {
          clearExportSelection(state);
          if (result.missingImages > 0) {
            uiMessage.warning(
              t("exportedWithMissingImages", { count: result.missingImages })
            );
            return;
          }
          const format = request.format === "md" ? "Markdown" : "TXT";
          uiMessage.success(
            "filePath" in result
              ? t("exportedAsSingleFile", { title: target.title, format })
              : t("exportedAsFiles", {
                  title: target.title,
                  fileCount: result.fileCount,
                  format
                })
          );
        }
      } catch (error: unknown) {
        if (
          context.leaseIsCurrent(exportLease) &&
          context.dialogRequestIsCurrent(requestId)
        ) {
          uiMessage.error(
            formatError(error, t("couldNotExportTheLongFormProject"))
          );
        }
      }
    });
  }

  return {
    openExportDialog,
    closeLongExportDialog,
    exportLongBookManuscript
  };
}
