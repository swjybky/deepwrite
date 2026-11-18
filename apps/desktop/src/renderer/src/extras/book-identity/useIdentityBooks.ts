import { genreLabel } from "../../components/catalogLabels";
import {
  academicSubtypeLabel,
  academicTreeT
} from "../../components/academic/academicTreeLabels";
import { identityApi } from "./book-identity-utils";
import { computed, ref, watch } from "vue";
import {
  chatAssistantProjectKey,
  ChatAssistantProjectRefSchema,
  type ChatAssistantProjectRef
} from "@deepwrite/contracts/renderer";
import { formatError } from "../../i18n/errors";
import { uiMessage } from "../../ui-feedback";
import { identityT as t } from "./book-identity-utils";
export interface IdentityBookChoice {
  key: string;
  title: string;
  book: ChatAssistantProjectRef;
  updatedAt: string;
  description: string;
}
const storageKey = "deepwrite:book-identity:selection:v1";
function read(): ChatAssistantProjectRef | null {
  try {
    const result = ChatAssistantProjectRefSchema.safeParse(
      JSON.parse(localStorage.getItem(storageKey) ?? "null")
    );
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
export function useIdentityBooks() {
  const books = ref<IdentityBookChoice[]>([]),
    book = ref<ChatAssistantProjectRef | null>(read());
  const selected = computed(() =>
    books.value.find(
      (choice) =>
        book.value && choice.key === chatAssistantProjectKey(book.value)
    )
  );
  async function load() {
    try {
      const [catalog, longs] = await Promise.all([
        identityApi().catalog.index(),
        identityApi().long.list()
      ]);
      books.value = [
        ...catalog.books.map((b) => {
          const book = { projectType: b.bookType, projectId: b.id };
          const description =
            b.bookType === "academic"
              ? `${academicTreeT("academicWork")} · ${academicSubtypeLabel(b.subtype)} · ${t(b.status)} · ${t("sections", { count: b.manuscript.sections.length })}`
              : `${t(b.bookType)} · ${genreLabel(b.genre)} · ${t(b.status)} · ${t("sections", { count: b.draft.sections.length })}`;
          return {
            key: chatAssistantProjectKey(book),
            title: b.title,
            book,
            updatedAt: b.updatedAt,
            description
          };
        }),
        ...longs.books.map((b) => {
          const book = { projectType: "long" as const, projectId: b.id };
          return {
            key: chatAssistantProjectKey(book),
            title: b.title,
            book,
            updatedAt: b.updatedAt,
            description: `${t("long")} · ${genreLabel(b.genre)} · ${t(b.status)} · ${t("chapters", { count: b.navigation.counts.committedChapters })}`
          };
        })
      ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      if (!selected.value) book.value = books.value[0]?.book ?? null;
    } catch (error) {
      uiMessage.error(formatError(error, t("failed")));
    }
  }
  function select(key: string) {
    book.value = books.value.find((b) => b.key === key)?.book ?? null;
  }
  watch(book, (value) => {
    try {
      if (value) localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      /* Optional UI preference. */
    }
  });
  async function rename(title: string) {
    if (!book.value) return;
    try {
      if (book.value.projectType === "long")
        await identityApi().long.rename({
          bookId: book.value.projectId,
          title
        });
      else
        await identityApi().catalog.updateBook({
          bookId: book.value.projectId,
          title
        });
      await load();
      uiMessage.success(t("saved"));
    } catch (error) {
      uiMessage.error(formatError(error, t("failed")));
    }
  }
  return { books, book, selected, load, select, rename };
}
