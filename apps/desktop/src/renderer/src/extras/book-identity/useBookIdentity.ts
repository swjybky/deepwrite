import { identityApi } from "./book-identity-utils";
import { computed, onBeforeUnmount, ref, watch, type Ref } from "vue";
import {
  chatAssistantProjectKey,
  type BookIdentityRecord,
  type BookIdentityField,
  type BookIdentityRound,
  type BookIdentityCandidate,
  type BookIdentityUpdateCandidateInput,
  type BookIdentityAddManualCandidateInput,
  type ChatAssistantProjectRef
} from "@deepwrite/contracts/renderer";
import { formatError } from "../../i18n/errors";
import { uiMessage } from "../../ui-feedback";
import { identityT as t } from "./book-identity-utils";
import { deepwriteApi } from "../../api/deepwrite";
import { uiConfirm } from "../../ui-confirm";
export function useBookIdentity(
  book: Readonly<Ref<ChatAssistantProjectRef | null>>
) {
  const record = ref<BookIdentityRecord | null>(null);
  const loading = ref(false),
    saving = ref(false),
    ignored = ref(false);
  let generation = 0;
  function belongs(target: ChatAssistantProjectRef) {
    return (
      !!book.value &&
      chatAssistantProjectKey(target) === chatAssistantProjectKey(book.value)
    );
  }
  function accept(target: ChatAssistantProjectRef, result: BookIdentityRecord) {
    if (
      belongs(target) &&
      (!record.value || result.revision > record.value.revision)
    )
      record.value = result;
  }
  async function load() {
    const target = book.value ? { ...book.value } : null;
    const current = ++generation;
    if (!target) {
      record.value = null;
      loading.value = false;
      return;
    }
    loading.value = true;
    try {
      const result = await identityApi().bookIdentity.get({ book: target });
      if (current === generation) accept(target, result);
    } catch (error) {
      if (current === generation)
        uiMessage.error(formatError(error, t("failed")));
    } finally {
      if (current === generation) loading.value = false;
    }
  }
  async function mutate(
    operation: (target: ChatAssistantProjectRef) => Promise<BookIdentityRecord>,
    targetBook = book.value
  ) {
    const target = targetBook ? { ...targetBook } : null;
    if (!target || saving.value) return;
    saving.value = true;
    try {
      const result = await operation(target);
      accept(target, result);
      return result;
    } catch (error) {
      uiMessage.error(formatError(error, t("failed")));
      return undefined;
    } finally {
      saving.value = false;
    }
  }
  const unsubscribe = deepwriteApi()?.events.subscribe((event) => {
    if (
      event.type === "book_identity.updated" &&
      book.value &&
      event.payload.bookKey === chatAssistantProjectKey(book.value) &&
      event.payload.revision > (record.value?.revision ?? -1)
    )
      void load();
  });
  watch(
    book,
    () => {
      record.value = null;
      ignored.value = false;
      void load();
    },
    { immediate: true }
  );
  onBeforeUnmount(() => {
    generation++;
    unsubscribe?.();
  });
  watch(
    () => record.value?.diagnostics?.corruptFile,
    (file) => {
      if (file) uiMessage.warning(t("corrupt"));
    }
  );
  const writable = computed(
    () =>
      !!record.value &&
      !record.value.diagnostics?.foreignBookId &&
      !ignored.value
  );
  const visibleRecord = computed(() =>
    ignored.value && record.value?.diagnostics?.foreignBookId
      ? null
      : record.value
  );
  const counts = computed(() => ({
    title:
      visibleRecord.value?.rounds
        .filter((r) => r.field === "title")
        .reduce((sum, r) => sum + r.candidates.length, 0) ?? 0,
    synopsis:
      visibleRecord.value?.rounds
        .filter((r) => r.field === "synopsis")
        .reduce((sum, r) => sum + r.candidates.length, 0) ?? 0,
    cover:
      visibleRecord.value?.rounds
        .filter((r) => r.field === "cover")
        .reduce(
          (sum, r) =>
            sum + r.candidates.reduce((n, c) => n + c.images.length, 0),
          0
        ) ?? 0
  }));
  function adopt(
    round: BookIdentityRound,
    candidate: BookIdentityCandidate,
    imageId?: string,
    targetBook = book.value
  ) {
    return mutate(
      (book) =>
        identityApi().bookIdentity.adopt({
          book,
          field: round.field,
          roundId: round.id,
          candidateId: candidate.id,
          ...(imageId ? { imageId } : {})
        }),
      targetBook
    );
  }
  function update(
    roundId: string,
    candidateId: string,
    patch: BookIdentityUpdateCandidateInput["patch"]
  ) {
    return mutate((book) =>
      identityApi().bookIdentity.updateCandidate({
        book,
        roundId,
        candidateId,
        patch
      })
    );
  }
  function add(
    input:
      | Omit<
          Extract<BookIdentityAddManualCandidateInput, { field: "title" }>,
          "book"
        >
      | Omit<
          Extract<BookIdentityAddManualCandidateInput, { field: "synopsis" }>,
          "book"
        >
  ) {
    return mutate((book) =>
      identityApi().bookIdentity.addManualCandidate({ ...input, book })
    );
  }
  function clear(field: BookIdentityField) {
    return mutate((book) =>
      identityApi().bookIdentity.clearAdoption({ book, field })
    );
  }
  function protectedRound(round: BookIdentityRound) {
    return round.candidates.some((c) =>
      Object.values(record.value?.adopted ?? {}).some(
        (a) => a?.candidateId === c.id
      )
    );
  }
  async function remove(round: BookIdentityRound) {
    if (
      !protectedRound(round) &&
      (await uiConfirm({ message: t("deleteConfirm"), danger: true }))
    )
      await mutate((book) =>
        identityApi().bookIdentity.deleteRound({ book, roundId: round.id })
      );
  }
  async function prune(field: BookIdentityField) {
    if (await uiConfirm({ message: t("pruneConfirm"), danger: true }))
      await mutate((book) =>
        identityApi().bookIdentity.pruneRounds({ book, field })
      );
  }
  async function inherit() {
    const target = book.value ? { ...book.value } : null;
    if (!target) return;
    const saved = await mutate((book) =>
      identityApi().bookIdentity.inheritBook({ book })
    );
    if (saved && belongs(target) && !saved.diagnostics?.foreignBookId)
      ignored.value = false;
  }
  async function exportCover(size: "original" | "600x800" | "1080x1440") {
    if (!book.value) return;
    try {
      await identityApi().bookIdentity.exportCover({
        book: { ...book.value },
        size
      });
    } catch (error) {
      uiMessage.error(formatError(error, t("failed")));
    }
  }
  return {
    record,
    visibleRecord,
    loading,
    saving,
    ignored,
    writable,
    counts,
    load,
    mutate,
    adopt,
    update,
    add,
    clear,
    protectedRound,
    remove,
    prune,
    inherit,
    exportCover
  };
}
export type BookIdentityController = ReturnType<typeof useBookIdentity>;
