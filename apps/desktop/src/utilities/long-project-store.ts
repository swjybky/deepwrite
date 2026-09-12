import { resolveLongProjectConflicts } from "./long-project-store/resolve-conflicts";
import type { LongWorkspaceOperationBatch } from "@deepwrite/contracts";
import { commitChapter } from "./long-project-store/commit-chapter";
import { deleteLedgerCommit } from "./long-project-store/delete-ledger-commit";
import { deriveLongForeshadowingStatus } from "./long-project-store/continuity";
import {
  inspectBookManifest,
  openBook,
  readAgentsMd,
  readDocument,
  renameBook,
  updateBindings,
  writeAgentsMd,
  writeDocument
} from "./long-project-store/documents";
import {
  importContinuationBook,
  importPortableBundle,
  importWriteClawBook,
  previewContinuationImport
} from "./long-project-store/imports";
import { createBook, duplicateBook } from "./long-project-store/lifecycle";
import {
  applyWorkspaceOperations,
  previewWorkspaceOperations
} from "./long-project-store/operations";
import { search } from "./long-project-store/search-api";
import { createLongProjectStoreContext } from "./long-project-store/store-context";
import type {
  ApplyLongWorkspaceOperationsInput,
  CreateLongBookInput,
  ImportContinuationLongBookInput,
  ImportWriteClawLongBookOptions,
  LongProjectStoreOptions,
  ReadLongDocumentInput,
  RenameLongBookInput,
  SearchLongProjectInput,
  StoreCommitLongChapterInput,
  StoreDeleteLongLedgerCommitInput,
  StoreWriteLongChapterInput,
  UpdateLongBookBindingsInput,
  WriteLongDocumentInput
} from "./long-project-store/types";
import { writeChapter } from "./long-project-store/write-chapter";

export { deriveLongForeshadowingStatus };
export * from "./long-project-store/types";

/**
 * Public facade for the long-form project store. Implementations are grouped
 * by responsibility and share one project queue and document cache.
 */
export class LongProjectStore {
  private readonly context;

  constructor(options: LongProjectStoreOptions = {}) {
    this.context = createLongProjectStoreContext(options);
  }

  async createBook(parentDirectory: string, input: CreateLongBookInput) {
    return await createBook(this.context, parentDirectory, input);
  }

  async duplicateBook(
    parentDirectory: string,
    sourceProjectDirectory: string,
    title: string
  ) {
    return await duplicateBook(
      this.context,
      parentDirectory,
      sourceProjectDirectory,
      title
    );
  }

  async importWriteClawBook(
    parentDirectory: string,
    sourcePath: string,
    options: ImportWriteClawLongBookOptions = {}
  ) {
    return await importWriteClawBook(
      this.context,
      parentDirectory,
      sourcePath,
      options
    );
  }

  async previewContinuationImport(sourcePath: string) {
    return await previewContinuationImport(this.context, sourcePath);
  }

  async importContinuationBook(
    parentDirectory: string,
    input: ImportContinuationLongBookInput
  ) {
    return await importContinuationBook(this.context, parentDirectory, input);
  }

  async importPortableBundle(parentDirectory: string, sourcePath: string) {
    return await importPortableBundle(
      this.context,
      parentDirectory,
      sourcePath
    );
  }

  async resolveConflicts(projectDirectory: string, bookId: string) {
    return await resolveLongProjectConflicts(
      this.context,
      projectDirectory,
      bookId
    );
  }

  async openBook(projectDirectory: string) {
    return await openBook(this.context, projectDirectory);
  }

  async inspectBookManifest(projectDirectory: string) {
    return await inspectBookManifest(this.context, projectDirectory);
  }

  async updateBindings(
    projectDirectory: string,
    input: UpdateLongBookBindingsInput
  ) {
    return await updateBindings(this.context, projectDirectory, input);
  }

  async renameBook(projectDirectory: string, input: RenameLongBookInput) {
    return await renameBook(this.context, projectDirectory, input);
  }

  async readDocument(projectDirectory: string, input: ReadLongDocumentInput) {
    return await readDocument(this.context, projectDirectory, input);
  }

  async readAgentsMd(projectDirectory: string) {
    return await readAgentsMd(this.context, projectDirectory);
  }

  async writeAgentsMd(projectDirectory: string, content: string) {
    return await writeAgentsMd(this.context, projectDirectory, content);
  }

  async search(projectDirectory: string, input: SearchLongProjectInput) {
    return await search(this.context, projectDirectory, input);
  }

  async writeDocument(projectDirectory: string, input: WriteLongDocumentInput) {
    return await writeDocument(this.context, projectDirectory, input);
  }

  async previewWorkspaceOperations(
    projectDirectory: string,
    batch: LongWorkspaceOperationBatch
  ) {
    return await previewWorkspaceOperations(
      this.context,
      projectDirectory,
      batch
    );
  }

  async applyWorkspaceOperations(
    projectDirectory: string,
    input: ApplyLongWorkspaceOperationsInput
  ) {
    return await applyWorkspaceOperations(
      this.context,
      projectDirectory,
      input
    );
  }

  async writeChapter(
    projectDirectory: string,
    input: StoreWriteLongChapterInput
  ) {
    return await writeChapter(this.context, projectDirectory, input);
  }

  async commitChapter(
    projectDirectory: string,
    input: StoreCommitLongChapterInput
  ) {
    return await commitChapter(this.context, projectDirectory, input);
  }

  async deleteLedgerCommit(
    projectDirectory: string,
    input: StoreDeleteLongLedgerCommitInput
  ) {
    return await deleteLedgerCommit(this.context, projectDirectory, input);
  }
}
