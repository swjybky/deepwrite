import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  MysteryBookSummarySchema,
  MysteryListBooksResultSchema,
  type CreateMysteryBookInput,
  type MysteryBookSummary,
  type MysteryListBooksResult,
  type MysteryOpenBookResult,
  type MysteryProjectDiagnostic
} from "@deepwrite/contracts";
import { isNodeError, serializeJson } from "../long-project-store/io";
import type { MysteryProjectStore } from "./project-store";
import {
  MYSTERY_REGISTRY_FILE,
  MysteryProjectRegistrySchema,
  type MysteryProjectRegistration,
  type MysteryProjectRegistry
} from "./types";

export class MysteryProjectCatalog {
  readonly registryPath: string;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    userDataPath: string,
    private readonly store: MysteryProjectStore
  ) {
    this.registryPath = join(resolve(userDataPath), MYSTERY_REGISTRY_FILE);
  }

  private async queue<T>(operation: () => Promise<T>): Promise<T> {
    let result!: T;
    const pending = this.writeChain.then(async () => {
      result = await operation();
    });
    this.writeChain = pending.then(
      () => undefined,
      () => undefined
    );
    await pending;
    return result;
  }

  private async readRegistry(): Promise<MysteryProjectRegistry> {
    try {
      const raw = await readFile(this.registryPath, "utf8");
      return MysteryProjectRegistrySchema.parse(JSON.parse(raw) as unknown);
    } catch (error: unknown) {
      if (isNodeError(error, "ENOENT")) {
        return { version: 1, projects: [] };
      }
      throw error;
    }
  }

  private async writeRegistry(registry: MysteryProjectRegistry): Promise<void> {
    await mkdir(dirname(this.registryPath), { recursive: true });
    const temp = `${this.registryPath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(temp, serializeJson(registry), {
      encoding: "utf8",
      mode: 0o600
    });
    await rename(temp, this.registryPath);
  }

  private upsertRegistration(
    registry: MysteryProjectRegistry,
    entry: MysteryProjectRegistration
  ): MysteryProjectRegistry {
    const filtered = registry.projects.filter(
      (item) =>
        item.bookId !== entry.bookId &&
        item.projectDirectory !== entry.projectDirectory
    );
    return MysteryProjectRegistrySchema.parse({
      version: 1,
      projects: [...filtered, entry]
    });
  }

  async list(): Promise<MysteryListBooksResult> {
    return await this.queue(async () => {
      const registry = await this.readRegistry();
      const books: MysteryBookSummary[] = [];
      const diagnostics: MysteryProjectDiagnostic[] = [];
      let changed = false;
      const refreshed: MysteryProjectRegistration[] = [];

      for (const entry of registry.projects) {
        try {
          const inspected = await this.store.inspectBook(
            entry.projectDirectory
          );
          if (inspected.bookId !== entry.bookId) {
            diagnostics.push({
              bookId: entry.bookId,
              code: "invalid",
              message: "项目目录中的剧本杀标识与注册记录不一致。"
            });
            refreshed.push(entry);
            continue;
          }
          books.push(inspected.summary);
          if (
            JSON.stringify(inspected.summary) !== JSON.stringify(entry.summary)
          ) {
            changed = true;
          }
          refreshed.push({
            bookId: inspected.bookId,
            projectDirectory: entry.projectDirectory,
            summary: inspected.summary
          });
        } catch (error: unknown) {
          const code = isNodeError(error, "ENOENT") ? "unavailable" : "invalid";
          diagnostics.push({
            bookId: entry.bookId,
            code,
            message:
              error instanceof Error ? error.message : "读取剧本杀项目失败。"
          });
          refreshed.push(entry);
        }
      }

      if (changed) {
        await this.writeRegistry({ version: 1, projects: refreshed });
      }
      return MysteryListBooksResultSchema.parse({
        books,
        ...(diagnostics.length > 0 ? { diagnostics } : {})
      });
    });
  }

  async create(
    parentDirectory: string,
    input: CreateMysteryBookInput
  ): Promise<MysteryOpenBookResult> {
    return await this.queue(async () => {
      const opened = await this.store.createBook(parentDirectory, input);
      const registry = await this.readRegistry();
      await this.writeRegistry(
        this.upsertRegistration(registry, {
          bookId: opened.book.id,
          projectDirectory: opened.projectDirectory,
          summary: opened.summary
        })
      );
      return opened;
    });
  }

  async openAtPath(projectDirectory: string): Promise<MysteryOpenBookResult> {
    return await this.queue(async () => {
      const opened = await this.store.openBook(projectDirectory);
      const registry = await this.readRegistry();
      await this.writeRegistry(
        this.upsertRegistration(registry, {
          bookId: opened.book.id,
          projectDirectory: opened.projectDirectory,
          summary: opened.summary
        })
      );
      return opened;
    });
  }

  async resolveProjectDirectory(bookId: string): Promise<string> {
    return await this.queue(async () => {
      const registry = await this.readRegistry();
      const found = registry.projects.find((item) => item.bookId === bookId);
      if (!found) {
        throw new Error(`剧本杀作品未注册或已移除：${bookId}`);
      }
      return found.projectDirectory;
    });
  }

  async open(bookId: string): Promise<MysteryOpenBookResult> {
    const projectDirectory = await this.resolveProjectDirectory(bookId);
    const opened = await this.store.openBook(projectDirectory);
    await this.updateSummary(bookId, opened.summary);
    return opened;
  }

  async updateSummary(
    bookId: string,
    summary: MysteryBookSummary
  ): Promise<void> {
    await this.queue(async () => {
      const registry = await this.readRegistry();
      const target = registry.projects.find((item) => item.bookId === bookId);
      if (!target) return;
      const nextSummary = MysteryBookSummarySchema.parse(summary);
      if (JSON.stringify(target.summary) === JSON.stringify(nextSummary))
        return;
      await this.writeRegistry(
        this.upsertRegistration(registry, {
          ...target,
          summary: nextSummary
        })
      );
    });
  }

  async duplicate(
    bookId: string,
    fallbackParentDirectory?: string
  ): Promise<MysteryOpenBookResult> {
    return await this.queue(async () => {
      const registry = await this.readRegistry();
      const target = registry.projects.find((item) => item.bookId === bookId);
      if (!target) {
        throw new Error(`剧本杀作品未注册：${bookId}`);
      }
      const existingTitles = registry.projects.map(
        (item) => item.summary.title
      );
      const parentDirectory =
        fallbackParentDirectory ?? dirname(target.projectDirectory);
      const duplicated = await this.store.duplicateBook(
        target.projectDirectory,
        parentDirectory,
        existingTitles
      );
      await this.writeRegistry(
        this.upsertRegistration(registry, {
          bookId: duplicated.book.id,
          projectDirectory: duplicated.projectDirectory,
          summary: duplicated.summary
        })
      );
      return duplicated;
    });
  }

  async unregister(bookId: string): Promise<void> {
    await this.queue(async () => {
      const registry = await this.readRegistry();
      await this.writeRegistry({
        version: 1,
        projects: registry.projects.filter((item) => item.bookId !== bookId)
      });
    });
  }

  async deleteBook(bookId: string): Promise<void> {
    await this.queue(async () => {
      const registry = await this.readRegistry();
      const target = registry.projects.find((item) => item.bookId === bookId);
      if (!target) return;
      await this.store.deleteBook(target.projectDirectory, bookId, () =>
        this.writeRegistry({
          version: 1,
          projects: registry.projects.filter((item) => item.bookId !== bookId)
        })
      );
    });
  }
}
