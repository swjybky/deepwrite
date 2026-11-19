import { computed, onBeforeUnmount, ref, type Ref, type ShallowRef } from "vue";
import type {
  AcademicReferenceCardType,
  Book,
  DeepWriteApi
} from "@deepwrite/contracts/renderer";
import type {
  DraftFileKind,
  EditorDraftState,
  ResourceTreeNode,
  WorkspaceDocument
} from "../types/workspace";

export type AcademicFrameworkDialogTab = "stages" | "settings" | "context";

export type AcademicDialogTarget =
  | {
      kind: "framework";
      bookId: string;
      initialTab?: AcademicFrameworkDialogTab | undefined;
    }
  | {
      kind: "card";
      mode: "create" | "edit" | "delete";
      bookId: string;
      cardId?: string | undefined;
      citeKey?: string | undefined;
      cardType?: AcademicReferenceCardType | undefined;
      title?: string | undefined;
    }
  | {
      kind: "import-cards";
      bookId: string;
    }
  | {
      kind: "chapter";
      mode: "create" | "rename" | "delete";
      bookId: string;
      chapterId?: string | undefined;
      title?: string | undefined;
      sectionCount?: number | undefined;
    }
  | {
      kind: "section";
      mode: "create" | "edit" | "delete";
      bookId: string;
      sectionId?: string | undefined;
      title?: string | undefined;
      wordCountRequirement?: string | undefined;
      chapterId?: string | undefined;
      afterSectionId?: string | undefined;
    }
  | {
      kind: "export";
      bookId: string;
      bookTitle?: string | undefined;
    };

export interface AcademicLifecyclePort {
  api(): DeepWriteApi["catalog"] | undefined;
  manuscriptApi?(): DeepWriteApi["manuscript"] | undefined;
  book(bookId: string): Book | undefined;
  openBookRename?(book: ResourceTreeNode): void;
  refresh(): Promise<boolean>;
  prepareBookMutation(bookId: string): Promise<boolean>;
  ensureDocumentsLoaded?(
    documents: readonly WorkspaceDocument[]
  ): Promise<boolean>;
  documents?: ShallowRef<WorkspaceDocument[]> | undefined;
  drafts?: ShallowRef<Record<string, EditorDraftState>> | undefined;
  selectedResourceId: Ref<string>;
  activeCreationResourceId: Ref<string>;
  selectedExpertSectionIds: Ref<Record<string, string>>;
  selectedDraftFileKinds: Ref<Record<string, DraftFileKind>>;
  catalogMutationPending: Ref<boolean>;
  manuscriptExportPending?: Ref<boolean> | undefined;
  notifications: {
    error(message: string): void;
    info(message: string): void;
    success(message: string): void;
    warning(message: string): void;
  };
}

export const academicDialogTarget = ref<AcademicDialogTarget | null>(null);
export const academicMutationPending = ref(false);
export const academicExportPending = ref(false);

let registeredPort: AcademicLifecyclePort | null = null;
const hostClaims = ref<symbol[]>([]);

export function registerAcademicLifecyclePort(
  port: AcademicLifecyclePort
): () => void {
  registeredPort = port;
  return () => {
    if (registeredPort === port) {
      registeredPort = null;
    }
  };
}

export function getAcademicLifecyclePort(): AcademicLifecyclePort | null {
  return registeredPort;
}

export function useAcademicDialogHostClaim() {
  const token = Symbol("academic-dialog-host");
  hostClaims.value = [...hostClaims.value, token];
  onBeforeUnmount(() => {
    hostClaims.value = hostClaims.value.filter((item) => item !== token);
  });
  return computed(() => hostClaims.value[0] === token);
}

export function closeAcademicDialog(): void {
  if (academicMutationPending.value || academicExportPending.value) return;
  academicDialogTarget.value = null;
}

export function openExportAcademicManuscriptDialog(
  bookId: string,
  bookTitle?: string
): void {
  academicDialogTarget.value = {
    kind: "export",
    bookId,
    ...(bookTitle ? { bookTitle } : {})
  };
}

export function openAcademicFrameworkDialog(
  bookId: string,
  initialTab: AcademicFrameworkDialogTab = "stages"
): void {
  academicDialogTarget.value = { kind: "framework", bookId, initialTab };
}

export function openCreateAcademicCardDialog(bookId: string): void {
  academicDialogTarget.value = { kind: "card", mode: "create", bookId };
}

export function openEditAcademicCardDialog(
  item: NonNullable<ResourceTreeNode["academicCardItem"]>
): void {
  academicDialogTarget.value = {
    kind: "card",
    mode: "edit",
    bookId: item.bookId,
    cardId: item.cardId,
    citeKey: item.citeKey,
    cardType: item.cardType,
    title: item.title
  };
}

export function openDeleteAcademicCardDialog(
  item: NonNullable<ResourceTreeNode["academicCardItem"]>
): void {
  academicDialogTarget.value = {
    kind: "card",
    mode: "delete",
    bookId: item.bookId,
    cardId: item.cardId,
    citeKey: item.citeKey,
    cardType: item.cardType,
    title: item.title
  };
}

export function openImportAcademicCardsDialog(bookId: string): void {
  academicDialogTarget.value = { kind: "import-cards", bookId };
}

export function openCreateAcademicChapterDialog(bookId: string): void {
  academicDialogTarget.value = { kind: "chapter", mode: "create", bookId };
}

export function openRenameAcademicChapterDialog(
  item: Pick<
    NonNullable<ResourceTreeNode["academicChapterItem"]>,
    "bookId" | "chapterId" | "title"
  >
): void {
  academicDialogTarget.value = {
    kind: "chapter",
    mode: "rename",
    bookId: item.bookId,
    chapterId: item.chapterId,
    title: item.title
  };
}

export function openDeleteAcademicChapterDialog(
  item: Pick<
    NonNullable<ResourceTreeNode["academicChapterItem"]>,
    "bookId" | "chapterId" | "title"
  >
): void {
  academicDialogTarget.value = {
    kind: "chapter",
    mode: "delete",
    bookId: item.bookId,
    chapterId: item.chapterId,
    title: item.title
  };
}

export function openCreateAcademicSectionDialog(
  bookId: string,
  chapterId?: string,
  afterSectionId?: string
): void {
  academicDialogTarget.value = {
    kind: "section",
    mode: "create",
    bookId,
    ...(chapterId ? { chapterId } : {}),
    ...(afterSectionId ? { afterSectionId } : {})
  };
}

export function openEditAcademicSectionDialog(
  item: Pick<
    NonNullable<ResourceTreeNode["academicSectionItem"]>,
    "bookId" | "sectionId" | "title" | "wordCountRequirement" | "chapterId"
  >
): void {
  academicDialogTarget.value = {
    kind: "section",
    mode: "edit",
    bookId: item.bookId,
    sectionId: item.sectionId,
    title: item.title,
    wordCountRequirement: item.wordCountRequirement,
    ...(item.chapterId ? { chapterId: item.chapterId } : {})
  };
}

export function openDeleteAcademicSectionDialog(
  item: Pick<
    NonNullable<ResourceTreeNode["academicSectionItem"]>,
    "bookId" | "sectionId" | "title" | "wordCountRequirement" | "chapterId"
  >
): void {
  academicDialogTarget.value = {
    kind: "section",
    mode: "delete",
    bookId: item.bookId,
    sectionId: item.sectionId,
    title: item.title,
    wordCountRequirement: item.wordCountRequirement,
    ...(item.chapterId ? { chapterId: item.chapterId } : {})
  };
}

export async function runAcademicChapterMove(
  item: NonNullable<ResourceTreeNode["academicChapterItem"]>,
  direction: "up" | "down"
): Promise<void> {
  const { executeAcademicManuscriptMutation } =
    await import("../composables/useAcademicBookLifecycleCoordinator");
  await executeAcademicManuscriptMutation(item.bookId, {
    type: "move-chapter",
    chapterId: item.chapterId,
    direction
  });
}

export async function runAcademicSectionMove(
  item: NonNullable<ResourceTreeNode["academicSectionItem"]>,
  direction: "up" | "down"
): Promise<void> {
  const { executeAcademicManuscriptMutation } =
    await import("../composables/useAcademicBookLifecycleCoordinator");
  await executeAcademicManuscriptMutation(item.bookId, {
    type: "move-section",
    sectionId: item.sectionId,
    direction
  });
}
