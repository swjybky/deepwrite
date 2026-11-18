import {
  CreateMysteryBookAtPathInputSchema,
  MysteryApplyOperationsInputSchema,
  MysteryDuplicateBookInputSchema,
  MysteryOpenBookAtPathInputSchema,
  MysteryOpenBookInputSchema,
  MysteryPreviewOperationsInputSchema,
  MysteryReadAgentsMdInputSchema,
  MysteryReadDocumentInputSchema,
  MysteryRemoveBookInputSchema,
  MysteryRemoveBookResultSchema,
  MysteryRenameBookInputSchema,
  MysteryRestoreOperationsInputSchema,
  MysterySearchInputSchema,
  MysteryUpdateBindingsInputSchema,
  MysteryWorkspaceIndexResultSchema,
  MysteryWorkspaceOperationError,
  MysteryWriteAgentsMdInputSchema,
  MysteryWriteDocumentInputSchema,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import { MysteryProjectCatalog } from "./catalog";
import { MysteryProjectStore } from "./project-store";
import { MysteryDocumentConflictError } from "./types";

export interface MysteryWorkspaceServiceOptions {
  userDataPath: string;
  now?: () => string;
}

export class MysteryWorkspaceService {
  readonly store: MysteryProjectStore;
  readonly catalog: MysteryProjectCatalog;

  constructor(options: MysteryWorkspaceServiceOptions) {
    this.store = new MysteryProjectStore({
      ...(options.now ? { now: options.now } : {})
    });
    this.catalog = new MysteryProjectCatalog(options.userDataPath, this.store);
  }

  async list() {
    return await this.catalog.list();
  }

  async createAtPath(parentDirectory: string, rawInput: unknown) {
    const input = CreateMysteryBookAtPathInputSchema.parse({
      parentDirectory,
      input: rawInput
    });
    return await this.catalog.create(input.parentDirectory, input.input);
  }

  async open(rawInput: { bookId: string }) {
    const input = MysteryOpenBookInputSchema.parse(rawInput);
    return await this.catalog.open(input.bookId);
  }

  async openAtPath(projectDirectory: string) {
    const input = MysteryOpenBookAtPathInputSchema.parse({ projectDirectory });
    return await this.catalog.openAtPath(input.projectDirectory);
  }

  async duplicateBook(bookId: string) {
    const input = MysteryDuplicateBookInputSchema.parse({ bookId });
    return await this.catalog.duplicate(input.bookId);
  }

  async rename(bookId: string, title: string) {
    const input = MysteryRenameBookInputSchema.parse({ bookId, title });
    const dir = await this.catalog.resolveProjectDirectory(input.bookId);
    const opened = await this.store.renameBook(dir, input.bookId, input.title);
    await this.catalog.updateSummary(input.bookId, opened.summary);
    return opened;
  }

  async updateBindings(rawInput: {
    bookId: string;
    linkedMaterialIds: string[];
    linkedSkillIds: string[];
  }) {
    const input = MysteryUpdateBindingsInputSchema.parse(rawInput);
    const dir = await this.catalog.resolveProjectDirectory(input.bookId);
    const opened = await this.store.updateBindings(
      dir,
      input.bookId,
      input.linkedMaterialIds,
      input.linkedSkillIds
    );
    await this.catalog.updateSummary(input.bookId, opened.summary);
    return opened;
  }

  async getWorkspaceIndex(bookId: string) {
    const input = MysteryOpenBookInputSchema.parse({ bookId });
    const opened = await this.catalog.open(input.bookId);
    return MysteryWorkspaceIndexResultSchema.parse({
      bookId: opened.book.id,
      workspaceIndex: opened.workspaceIndex
    });
  }

  async readDocument(rawInput: unknown) {
    const input = MysteryReadDocumentInputSchema.parse(rawInput);
    const dir = await this.catalog.resolveProjectDirectory(input.bookId);
    return await this.store.readDocument(dir, input);
  }

  async writeDocument(rawInput: unknown) {
    const input = MysteryWriteDocumentInputSchema.parse(rawInput);
    const dir = await this.catalog.resolveProjectDirectory(input.bookId);
    const result = await this.store.writeDocument(dir, input);
    await this.catalog.updateSummary(input.bookId, result.summary);
    return result;
  }

  async readAgentsMd(rawInput: unknown) {
    const input = MysteryReadAgentsMdInputSchema.parse(rawInput);
    const dir = await this.catalog.resolveProjectDirectory(input.bookId);
    return await this.store.readAgentsMd(dir, input.bookId);
  }

  async writeAgentsMd(rawInput: unknown) {
    const input = MysteryWriteAgentsMdInputSchema.parse(rawInput);
    const dir = await this.catalog.resolveProjectDirectory(input.bookId);
    return await this.store.writeAgentsMd(
      dir,
      input.bookId,
      input.content,
      input.expectedRevision
    );
  }

  async search(rawInput: unknown) {
    const input = MysterySearchInputSchema.parse(rawInput);
    const dir = await this.catalog.resolveProjectDirectory(input.bookId);
    return await this.store.search(dir, input);
  }

  async previewOperations(rawInput: unknown) {
    const input = MysteryPreviewOperationsInputSchema.parse(rawInput);
    const dir = await this.catalog.resolveProjectDirectory(input.bookId);
    return await this.store.previewOperations(dir, input.bookId, input.batch);
  }

  async applyOperations(rawInput: unknown) {
    const input = MysteryApplyOperationsInputSchema.parse(rawInput);
    const dir = await this.catalog.resolveProjectDirectory(input.bookId);
    const result = await this.store.applyOperations(dir, input);
    await this.catalog.updateSummary(input.bookId, result.summary);
    return result;
  }

  async restoreOperations(rawInput: unknown) {
    const input = MysteryRestoreOperationsInputSchema.parse(rawInput);
    const dir = await this.catalog.resolveProjectDirectory(input.bookId);
    const result = await this.store.restoreOperations(
      dir,
      input.bookId,
      input.restoreId
    );
    await this.catalog.updateSummary(input.bookId, result.summary);
    return result;
  }

  async unregister(rawInput: unknown) {
    const input = MysteryRemoveBookInputSchema.parse(rawInput);
    await this.catalog.unregister(input.bookId);
    return MysteryRemoveBookResultSchema.parse({
      bookId: input.bookId,
      removed: true
    });
  }

  async deleteBook(rawInput: unknown) {
    const input = MysteryRemoveBookInputSchema.parse(rawInput);
    await this.catalog.deleteBook(input.bookId);
    return MysteryRemoveBookResultSchema.parse({
      bookId: input.bookId,
      removed: true
    });
  }
}

export async function handleMysteryCoreCommand(
  service: MysteryWorkspaceService,
  command: CommandEnvelope
): Promise<CommandResult | undefined> {
  if (!command.type.startsWith("mystery.")) return undefined;
  try {
    switch (command.type) {
      case "mystery.list":
        return {
          status: "accepted",
          requestId: command.id,
          payload: await service.list()
        };
      case "mystery.createBookAtPath":
        return {
          status: "accepted",
          requestId: command.id,
          payload: await service.createAtPath(
            command.payload.parentDirectory,
            command.payload.input
          )
        };
      case "mystery.open":
        return {
          status: "accepted",
          requestId: command.id,
          payload: await service.open(command.payload)
        };
      case "mystery.openAtPath":
        return {
          status: "accepted",
          requestId: command.id,
          payload: await service.openAtPath(command.payload.projectDirectory)
        };
      case "mystery.duplicateBook":
        return {
          status: "accepted",
          requestId: command.id,
          payload: await service.duplicateBook(command.payload.bookId)
        };
      case "mystery.rename":
        return {
          status: "accepted",
          requestId: command.id,
          payload: await service.rename(
            command.payload.bookId,
            command.payload.title
          )
        };
      case "mystery.updateBindings":
        return {
          status: "accepted",
          requestId: command.id,
          payload: await service.updateBindings(command.payload)
        };
      case "mystery.getWorkspaceIndex":
        return {
          status: "accepted",
          requestId: command.id,
          payload: await service.getWorkspaceIndex(command.payload.bookId)
        };
      case "mystery.readDocument":
        return {
          status: "accepted",
          requestId: command.id,
          payload: await service.readDocument(command.payload)
        };
      case "mystery.writeDocument":
        return {
          status: "accepted",
          requestId: command.id,
          payload: await service.writeDocument(command.payload)
        };
      case "mystery.readAgentsMd":
        return {
          status: "accepted",
          requestId: command.id,
          payload: await service.readAgentsMd(command.payload)
        };
      case "mystery.writeAgentsMd":
        return {
          status: "accepted",
          requestId: command.id,
          payload: await service.writeAgentsMd(command.payload)
        };
      case "mystery.search":
        return {
          status: "accepted",
          requestId: command.id,
          payload: await service.search(command.payload)
        };
      case "mystery.previewOperations":
        return {
          status: "accepted",
          requestId: command.id,
          payload: await service.previewOperations(command.payload)
        };
      case "mystery.applyOperations":
        return {
          status: "accepted",
          requestId: command.id,
          payload: await service.applyOperations(command.payload)
        };
      case "mystery.restoreOperations":
        return {
          status: "accepted",
          requestId: command.id,
          payload: await service.restoreOperations(command.payload)
        };
      case "mystery.unregister":
        return {
          status: "accepted",
          requestId: command.id,
          payload: await service.unregister(command.payload)
        };
      case "mystery.delete":
        return {
          status: "accepted",
          requestId: command.id,
          payload: await service.deleteBook(command.payload)
        };
      default:
        return undefined;
    }
  } catch (error: unknown) {
    const code =
      error instanceof MysteryDocumentConflictError
        ? "mystery.conflict"
        : error instanceof MysteryWorkspaceOperationError
          ? `mystery.${error.code}`
          : "mystery.command_failed";
    return {
      status: "rejected",
      requestId: command.id,
      error: {
        code,
        message: error instanceof Error ? error.message : "剧本杀作品操作失败。"
      }
    };
  }
}
