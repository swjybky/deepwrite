import type { LocalBackupErrorCode } from "@deepwrite/contracts";

/** Structured Core error mapped by Main IPC and translated by Renderer i18n. */
export class LocalBackupError extends Error {
  constructor(
    readonly code: LocalBackupErrorCode,
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "LocalBackupError";
  }
}
