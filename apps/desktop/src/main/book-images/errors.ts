import type { BookImageErrorCode } from "@deepwrite/contracts";

export class BookImageError extends Error {
  constructor(
    readonly code: BookImageErrorCode,
    message: string
  ) {
    super(message);
  }
}
