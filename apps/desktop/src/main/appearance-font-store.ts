import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile
} from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  APPEARANCE_CUSTOM_FONT_MAX_COUNT,
  APPEARANCE_CUSTOM_FONT_MAX_FILES_PER_INSTALL,
  APPEARANCE_CUSTOM_FONT_MAX_TOTAL_BYTES,
  AppearanceCustomFontIdSchema,
  AppearanceCustomFontSchema,
  AppearanceFontCatalogSnapshotSchema,
  AppearanceFontInstallResultSchema,
  type AppearanceCustomFont,
  type AppearanceCustomFontFormat,
  type AppearanceCustomFontId,
  type AppearanceFontCatalogSnapshot,
  type AppearanceFontInstallFailure,
  type AppearanceFontInstallResult
} from "@deepwrite/contracts";
import {
  disambiguateAppearanceFontName,
  readAppearanceFontCandidate,
  safeAppearanceFontFileName
} from "./appearance-font-file";
import { isNodeError } from "@deepwrite/shared/node";

interface DiskAppearanceFontCatalog {
  version: 1;
  fonts: AppearanceCustomFont[];
}

export interface ResolvedAppearanceFontAsset {
  byteSize: number;
  format: AppearanceCustomFontFormat;
  path: string;
}

async function removeIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error: unknown) {
    if (!isNodeError(error, "ENOENT")) throw error;
  }
}

export class AppearanceFontStore {
  readonly catalogPath: string;
  readonly filesDirectory: string;
  private operationChain: Promise<void> = Promise.resolve();

  constructor(
    userDataPath: string,
    private readonly now: () => Date = () => new Date()
  ) {
    const root = join(userDataPath, "fonts");
    this.catalogPath = join(root, "catalog.json");
    this.filesDirectory = join(root, "files");
  }

  list(): Promise<AppearanceFontCatalogSnapshot> {
    return this.enqueue(async () => this.loadCatalog());
  }

  install(
    sourcePaths: readonly string[]
  ): Promise<AppearanceFontInstallResult> {
    return this.enqueue(async () => {
      const catalog = await this.loadCatalog();
      const fonts = [...catalog.fonts];
      const fontsById = new Map(fonts.map((font) => [font.id, font]));
      const usedNames = new Set(fonts.map((font) => font.displayName));
      const installedIds: AppearanceCustomFontId[] = [];
      const duplicateIds: AppearanceCustomFontId[] = [];
      const rejected: AppearanceFontInstallFailure[] = [];
      const createdAssets: string[] = [];
      let totalBytes = fonts.reduce((total, font) => total + font.byteSize, 0);

      for (const [index, sourcePath] of sourcePaths.entries()) {
        if (index >= APPEARANCE_CUSTOM_FONT_MAX_FILES_PER_INSTALL) {
          rejected.push({
            displayName: safeAppearanceFontFileName(sourcePath),
            code: "catalog_limit"
          });
          continue;
        }
        const inspected = await readAppearanceFontCandidate(sourcePath);
        if (!inspected.ok) {
          rejected.push(inspected.failure);
          continue;
        }
        const { candidate } = inspected;
        const id = AppearanceCustomFontIdSchema.parse(`font_${candidate.hash}`);
        if (fontsById.has(id)) {
          duplicateIds.push(id);
          continue;
        }
        if (
          fonts.length >= APPEARANCE_CUSTOM_FONT_MAX_COUNT ||
          totalBytes + candidate.byteSize >
            APPEARANCE_CUSTOM_FONT_MAX_TOTAL_BYTES
        ) {
          rejected.push({
            displayName: safeAppearanceFontFileName(sourcePath),
            code: "catalog_limit"
          });
          continue;
        }

        const displayName = disambiguateAppearanceFontName(
          candidate.displayName,
          usedNames
        );
        const font = AppearanceCustomFontSchema.parse({
          id,
          displayName,
          format: candidate.format,
          byteSize: candidate.byteSize,
          installedAt: this.now().toISOString()
        });
        try {
          const assetPath = await this.writeAsset(font, candidate.bytes);
          createdAssets.push(assetPath);
        } catch {
          rejected.push({
            displayName: safeAppearanceFontFileName(sourcePath),
            code: "read_failed"
          });
          continue;
        }
        fonts.push(font);
        fontsById.set(id, font);
        usedNames.add(displayName);
        totalBytes += font.byteSize;
        installedIds.push(id);
      }

      if (installedIds.length > 0) {
        try {
          await this.writeCatalog({ fonts });
        } catch (error: unknown) {
          await Promise.allSettled(createdAssets.map(removeIfPresent));
          throw error;
        }
      }
      return AppearanceFontInstallResultSchema.parse({
        status: "completed",
        catalog: { fonts },
        installedIds,
        duplicateIds,
        rejected
      });
    });
  }

  remove(
    rawId: AppearanceCustomFontId
  ): Promise<{ removed: boolean; catalog: AppearanceFontCatalogSnapshot }> {
    return this.enqueue(async () => {
      const id = AppearanceCustomFontIdSchema.parse(rawId);
      const catalog = await this.loadCatalog();
      const font = catalog.fonts.find((entry) => entry.id === id);
      if (!font) return { removed: false, catalog };

      const next = { fonts: catalog.fonts.filter((entry) => entry.id !== id) };
      await this.writeCatalog(next);
      try {
        await removeIfPresent(this.assetPath(font));
      } catch (error: unknown) {
        try {
          await this.writeCatalog(catalog);
        } catch (rollbackError: unknown) {
          throw new AggregateError(
            [error, rollbackError],
            "Failed to remove the private font copy and restore its catalog entry."
          );
        }
        throw error;
      }
      return { removed: true, catalog: next };
    });
  }

  resolveAsset(rawId: string): Promise<ResolvedAppearanceFontAsset | null> {
    return this.enqueue(async () => {
      const parsedId = AppearanceCustomFontIdSchema.safeParse(rawId);
      if (!parsedId.success) return null;
      const catalog = await this.loadCatalog();
      const font = catalog.fonts.find((entry) => entry.id === parsedId.data);
      if (!font || !(await this.assetIsValid(font))) return null;
      return {
        byteSize: font.byteSize,
        format: font.format,
        path: this.assetPath(font)
      };
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationChain.then(operation);
    this.operationChain = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private assetPath(font: AppearanceCustomFont): string {
    return join(this.filesDirectory, `${font.id}.${font.format}`);
  }

  private async assetIsValid(font: AppearanceCustomFont): Promise<boolean> {
    try {
      const info = await lstat(this.assetPath(font));
      return (
        !info.isSymbolicLink() && info.isFile() && info.size === font.byteSize
      );
    } catch {
      return false;
    }
  }

  private async loadCatalog(): Promise<AppearanceFontCatalogSnapshot> {
    let parsed: AppearanceFontCatalogSnapshot;
    try {
      const raw = JSON.parse(await readFile(this.catalogPath, "utf8")) as {
        version?: unknown;
        fonts?: unknown;
      };
      if (raw.version !== 1) return this.recoverCorruptCatalog();
      parsed = AppearanceFontCatalogSnapshotSchema.parse({ fonts: raw.fonts });
      if (
        parsed.fonts.reduce((total, font) => total + font.byteSize, 0) >
        APPEARANCE_CUSTOM_FONT_MAX_TOTAL_BYTES
      ) {
        return this.recoverCorruptCatalog();
      }
    } catch (error: unknown) {
      if (isNodeError(error, "ENOENT")) {
        await this.cleanupOrphanAssets({ fonts: [] });
        return { fonts: [] };
      }
      if (
        error instanceof SyntaxError ||
        (error instanceof Error && error.name === "ZodError")
      ) {
        return this.recoverCorruptCatalog();
      }
      throw error;
    }

    const validFlags = await Promise.all(
      parsed.fonts.map((font) => this.assetIsValid(font))
    );
    const fonts = parsed.fonts.filter((_, index) => validFlags[index]);
    if (fonts.length !== parsed.fonts.length)
      await this.writeCatalog({ fonts });
    await this.cleanupOrphanAssets({ fonts });
    return { fonts };
  }

  private async recoverCorruptCatalog(): Promise<AppearanceFontCatalogSnapshot> {
    const empty = { fonts: [] };
    await this.cleanupOrphanAssets(empty);
    await this.writeCatalog(empty);
    return empty;
  }

  private async cleanupOrphanAssets(
    snapshot: AppearanceFontCatalogSnapshot
  ): Promise<void> {
    let entries;
    try {
      entries = await readdir(this.filesDirectory, { withFileTypes: true });
    } catch (error: unknown) {
      if (isNodeError(error, "ENOENT")) return;
      throw error;
    }
    const expected = new Set(
      snapshot.fonts.map((font) => `${font.id}.${font.format}`)
    );
    await Promise.all(
      entries.map(async (entry) => {
        if (expected.has(entry.name)) return;
        if (!entry.isFile() && !entry.isSymbolicLink()) return;
        await removeIfPresent(join(this.filesDirectory, entry.name));
      })
    );
  }

  private async writeAsset(
    font: AppearanceCustomFont,
    bytes: Buffer
  ): Promise<string> {
    await mkdir(this.filesDirectory, { recursive: true, mode: 0o700 });
    const target = this.assetPath(font);
    const temporary = join(this.filesDirectory, `.font-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
      try {
        await rename(temporary, target);
      } catch (error: unknown) {
        if (!isNodeError(error, "EEXIST") && !isNodeError(error, "EPERM")) {
          throw error;
        }
        await removeIfPresent(target);
        await rename(temporary, target);
      }
      return target;
    } finally {
      await Promise.allSettled([removeIfPresent(temporary)]);
    }
  }

  private async writeCatalog(
    snapshot: AppearanceFontCatalogSnapshot
  ): Promise<void> {
    const parsed = AppearanceFontCatalogSnapshotSchema.parse(snapshot);
    const disk: DiskAppearanceFontCatalog = { version: 1, fonts: parsed.fonts };
    await mkdir(dirname(this.catalogPath), { recursive: true, mode: 0o700 });
    const temporary = `${this.catalogPath}.tmp-${process.pid}-${randomUUID()}`;
    try {
      await writeFile(temporary, `${JSON.stringify(disk, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600
      });
      await rename(temporary, this.catalogPath);
    } finally {
      await Promise.allSettled([removeIfPresent(temporary)]);
    }
  }
}
