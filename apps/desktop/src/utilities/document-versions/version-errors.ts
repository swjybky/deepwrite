export class DocumentVersionError extends Error {
  constructor(
    readonly code: "version.conflict" | "version.unavailable",
    message: string
  ) {
    super(message);
    this.name = "DocumentVersionError";
  }
}
