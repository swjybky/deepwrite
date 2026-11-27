import type {
  CreateMysteryBookInput,
  MysteryApplyOperationsResult,
  MysteryBookManifest,
  MysteryBookSummary,
  MysteryDocumentTarget,
  MysteryMutationProposalPayload,
  MysteryOperationBatch,
  MysteryProjectDiagnostic,
  MysteryRestoreOperationsResult,
  MysteryStageId,
  MysteryWorkspaceIndexSnapshot
} from "@deepwrite/contracts";
import { defineStore } from "pinia";
import { ref, shallowRef, watch } from "vue";
import { mysteryDocumentTargetKey } from "@deepwrite/contracts/renderer";
import { bindCreatedBookAgentTeams } from "../composables/useBookAgentTeamBinding";
import { deepwriteApi } from "../api/deepwrite";
import { jsonClone } from "@deepwrite/shared";
import { formatError } from "../i18n/errors";

export interface MysteryProposalItem {
  id: string;
  bookId: string;
  sessionId: string;
  runId: string;
  toolCallId: string;
  summary: string;
  batch: MysteryOperationBatch;
  fileChanges: MysteryMutationProposalPayload["fileChanges"];
  structureChanges: string[];
  status: "pending" | "applying" | "accepted" | "rejected";
  errorMessage?: string;
}

export interface MysteryRestoreNotice {
  restorePointId: string;
  summary: string;
}

export function mysteryBookResourceId(bookId: string): string {
  return `mystery-book:${bookId}`;
}

export function mysteryDocumentResourceId(
  bookId: string,
  target: MysteryDocumentTarget
): string {
  return `mystery-document:${encodeURIComponent(bookId)}:${mysteryDocumentTargetKey(target)}`;
}

export function mysteryStageResourceId(
  bookId: string,
  stage: MysteryStageId
): string {
  return `mystery-stage:${encodeURIComponent(bookId)}:${stage}`;
}

export function mysteryConversationKey(bookId: string): string {
  return `mystery:${encodeURIComponent(bookId)}:chat`;
}

export const useMysteryWorkspaceStore = defineStore("mysteryWorkspace", () => {
  const books = shallowRef<readonly MysteryBookSummary[]>([]);
  const diagnostics = shallowRef<readonly MysteryProjectDiagnostic[]>([]);
  const loadingList = ref(false);

  const activeBookId = ref<string | null>(null);
  const overviewStage = ref<MysteryStageId | null>(null);
  const selectedTarget = shallowRef<MysteryDocumentTarget>({
    kind: "truth_doc",
    docId: "core_truth"
  });
  watch(
    activeBookId,
    () => {
      selectedTarget.value = { kind: "truth_doc", docId: "core_truth" };
      overviewStage.value = null;
    },
    { flush: "sync" }
  );
  const activeBook = shallowRef<MysteryBookManifest | null>(null);
  const activeWorkspaceIndex = shallowRef<MysteryWorkspaceIndexSnapshot | null>(
    null
  );
  const openLoading = ref(false);
  let openRequest = 0;
  const revisionBump = ref(0);

  const proposalsByBookId = shallowRef<Record<string, MysteryProposalItem[]>>(
    {}
  );
  const lastRestoreByBookId = shallowRef<Record<string, MysteryRestoreNotice>>(
    {}
  );

  function upsertSummary(summary: MysteryBookSummary): void {
    const existing = books.value.some((b) => b.id === summary.id);
    books.value = existing
      ? books.value.map((b) => (b.id === summary.id ? summary : b))
      : [summary, ...books.value];
  }

  function applyWorkspaceResult(
    result: Pick<
      MysteryApplyOperationsResult,
      "book" | "summary" | "workspaceIndex"
    >
  ): void {
    upsertSummary(result.summary);
    if (activeBookId.value === result.book.id) {
      activeBook.value = result.book;
      activeWorkspaceIndex.value = result.workspaceIndex;
      revisionBump.value += 1;
    }
  }

  async function loadBooks(): Promise<void> {
    const api = deepwriteApi()?.mystery;
    if (!api) return;
    loadingList.value = true;
    try {
      const result = await api.list();
      books.value = result.books;
      diagnostics.value = result.diagnostics ?? [];
      if (
        activeBookId.value &&
        !result.books.some((b) => b.id === activeBookId.value)
      ) {
        activeBookId.value = null;
        activeBook.value = null;
        activeWorkspaceIndex.value = null;
      }
    } finally {
      loadingList.value = false;
    }
  }

  async function openBook(bookId: string, current = () => true): Promise<void> {
    const api = deepwriteApi()?.mystery;
    if (!api) return;
    const request = ++openRequest;
    openLoading.value = true;
    try {
      const result = await api.open({ bookId });
      if (request !== openRequest || !current()) return;
      activeBookId.value = bookId;
      activeBook.value = result.book;
      activeWorkspaceIndex.value = result.workspaceIndex;
      upsertSummary(result.summary);
      revisionBump.value += 1;
    } finally {
      if (request === openRequest) openLoading.value = false;
    }
  }

  async function refreshActiveBook(bookId?: string): Promise<void> {
    const targetId = bookId ?? activeBookId.value;
    if (!targetId) return;
    const api = deepwriteApi()?.mystery;
    if (!api) return;
    const result = await api.open({ bookId: targetId });
    upsertSummary(result.summary);
    if (activeBookId.value === targetId) {
      activeBook.value = result.book;
      activeWorkspaceIndex.value = result.workspaceIndex;
      revisionBump.value += 1;
    }
  }

  function deactivateBook(): void {
    openRequest += 1;
    openLoading.value = false;
    activeBookId.value = null;
    activeBook.value = null;
    activeWorkspaceIndex.value = null;
  }

  async function createBook(
    input: CreateMysteryBookInput,
    linkedAgentTeamIds?: readonly string[]
  ): Promise<MysteryBookSummary | null> {
    const api = deepwriteApi()?.mystery;
    if (!api) return null;
    const result = await api.createBook(input);
    if (!result) return null;
    await bindCreatedBookAgentTeams(
      result.summary.id,
      "mystery",
      linkedAgentTeamIds
    );
    upsertSummary(result.summary);
    openRequest += 1;
    openLoading.value = false;
    activeBookId.value = result.book.id;
    activeBook.value = result.book;
    activeWorkspaceIndex.value = result.workspaceIndex;
    revisionBump.value += 1;
    return result.summary;
  }

  function updateProposalsForBook(
    bookId: string,
    updater: (items: MysteryProposalItem[]) => MysteryProposalItem[]
  ): void {
    proposalsByBookId.value = {
      ...proposalsByBookId.value,
      [bookId]: updater(proposalsByBookId.value[bookId] ?? [])
    };
  }

  async function applyProposal(
    bookId: string,
    proposalId: string
  ): Promise<void> {
    const api = deepwriteApi()?.mystery;
    if (!api) return;
    const current = (proposalsByBookId.value[bookId] ?? []).find(
      (p) => p.id === proposalId
    );
    if (current?.status !== "pending") return;
    updateProposalsForBook(bookId, (items) =>
      items.map((item) => {
        if (item.id !== proposalId) return item;
        const { errorMessage: _removed, ...rest } = item;
        return { ...rest, status: "applying" };
      })
    );
    try {
      const result = await api.applyOperations({
        bookId,
        batch: jsonClone(current.batch)
      });
      applyWorkspaceResult(result);
      if (result.restorePoint) {
        lastRestoreByBookId.value = {
          ...lastRestoreByBookId.value,
          [bookId]: {
            restorePointId: result.restorePoint.restoreId,
            summary: current.summary
          }
        };
      }
      updateProposalsForBook(bookId, (items) =>
        items.map((item) =>
          item.id === proposalId ? { ...item, status: "accepted" } : item
        )
      );
    } catch (error: unknown) {
      const message = formatError(
        error,
        typeof error === "string" ? error : "Apply failed"
      );
      updateProposalsForBook(bookId, (items) =>
        items.map((item) =>
          item.id === proposalId
            ? { ...item, status: "pending", errorMessage: message }
            : item
        )
      );
      throw error;
    }
  }

  function rejectProposal(bookId: string, proposalId: string): void {
    updateProposalsForBook(bookId, (items) =>
      items.map((item) =>
        item.id === proposalId && item.status === "pending"
          ? { ...item, status: "rejected" }
          : item
      )
    );
  }

  async function handleProposalEvent(
    payload: MysteryMutationProposalPayload,
    shouldAutoApply: boolean
  ): Promise<void> {
    const proposalId = `${payload.sessionId}:${payload.runId}:${payload.toolCallId}`;
    const existing = proposalsByBookId.value[payload.bookId] ?? [];
    if (existing.some((item) => item.id === proposalId)) return;
    const nextItem: MysteryProposalItem = {
      id: proposalId,
      bookId: payload.bookId,
      sessionId: payload.sessionId,
      runId: payload.runId,
      toolCallId: payload.toolCallId,
      summary: payload.summary,
      batch: payload.batch,
      fileChanges: payload.fileChanges,
      structureChanges: payload.structureChanges,
      status: "pending"
    };
    updateProposalsForBook(payload.bookId, (items) => [nextItem, ...items]);
    if (shouldAutoApply) {
      await applyProposal(payload.bookId, proposalId);
    }
  }

  async function undoLastProposal(
    bookId: string
  ): Promise<MysteryRestoreOperationsResult | null> {
    const api = deepwriteApi()?.mystery;
    const restore = lastRestoreByBookId.value[bookId];
    if (!api || !restore) return null;
    const result = await api.restoreOperations({
      bookId,
      restoreId: restore.restorePointId
    });
    applyWorkspaceResult(result);
    const nextMap = { ...lastRestoreByBookId.value };
    delete nextMap[bookId];
    lastRestoreByBookId.value = nextMap;
    return result;
  }

  return {
    books,
    diagnostics,
    loadingList,
    activeBookId,
    selectedTarget,
    overviewStage,
    activeBook,
    activeWorkspaceIndex,
    openLoading,
    revisionBump,
    proposalsByBookId,
    lastRestoreByBookId,
    upsertSummary,
    applyWorkspaceResult,
    loadBooks,
    openBook,
    refreshActiveBook,
    deactivateBook,
    createBook,
    applyProposal,
    rejectProposal,
    handleProposalEvent,
    undoLastProposal
  };
});
