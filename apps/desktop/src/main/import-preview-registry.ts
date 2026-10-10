import { createId } from "@deepwrite/shared";

export interface ImportPreviewSource {
  webContentsId: number;
  sourcePath: string;
  sourceFingerprint: string;
}

/**
 * Keeps the source path of a scanned import preview in Main so the Renderer
 * only ever holds an opaque, expiring id scoped to its own window.
 */
export class ImportPreviewRegistry<Source extends ImportPreviewSource> {
  private readonly entries = new Map<string, Source & { expiresAt: number }>();

  constructor(
    private readonly options: {
      idPrefix: string;
      expiredMessage: string;
      ttlMs: number;
      now: () => number;
    }
  ) {}

  register(input: Source): { previewId: string; expiresAt: number } {
    const now = this.options.now();
    for (const [previewId, registration] of this.entries) {
      if (
        registration.expiresAt <= now ||
        registration.webContentsId === input.webContentsId
      ) {
        this.entries.delete(previewId);
      }
    }
    const previewId = createId(this.options.idPrefix);
    const expiresAt = now + this.options.ttlMs;
    this.entries.set(previewId, { ...input, expiresAt });
    return { previewId, expiresAt };
  }

  resolve(
    previewId: string,
    webContentsId: number
  ): Source & { expiresAt: number } {
    const registration = this.entries.get(previewId);
    if (!registration || registration.webContentsId !== webContentsId) {
      throw new Error(this.options.expiredMessage);
    }
    if (registration.expiresAt <= this.options.now()) {
      this.entries.delete(previewId);
      throw new Error(this.options.expiredMessage);
    }
    return registration;
  }

  consume(previewId: string): boolean {
    return this.entries.delete(previewId);
  }

  clearForWebContents(webContentsId: number): void {
    for (const [previewId, registration] of this.entries) {
      if (registration.webContentsId === webContentsId) {
        this.entries.delete(previewId);
      }
    }
  }
}
