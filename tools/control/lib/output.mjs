export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_ERROR = 2;

/** Every failure an agent can act on carries the commands to run next. */
export class CliError extends Error {
  constructor(code, message, { nextSteps = [], details, exitCode } = {}) {
    super(message);
    this.code = code;
    this.nextSteps = nextSteps;
    this.details = details;
    this.exitCode = exitCode ?? EXIT_ERROR;
  }
}

export function failureResult(command, error, startedAt) {
  const known = error instanceof CliError;
  return {
    ok: false,
    command,
    error: {
      code: known ? error.code : "cli.internal_error",
      message: error instanceof Error ? error.message : String(error),
      nextSteps: known
        ? error.nextSteps
        : ["这是 CLI 自身的缺陷，请把完整输出交给开发者修复"],
      ...(known && error.details !== undefined
        ? { details: error.details }
        : {})
    },
    durationMs: Date.now() - startedAt
  };
}

export function writeJson(value, stream = process.stdout) {
  stream.write(`${JSON.stringify(value, null, 2)}\n`);
}
