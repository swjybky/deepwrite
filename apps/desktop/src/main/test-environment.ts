export const TEST_ENVIRONMENT_ENV = "DEEPWRITE_TEST_ENV";

const READ_METHODS = new Set(["GET", "HEAD"]);

/** Set only by tools/control for its isolated instance; packaged builds ignore it. */
export function isTestEnvironment(
  packaged: boolean,
  environment: NodeJS.ProcessEnv = process.env
): boolean {
  return !packaged && environment[TEST_ENVIRONMENT_ENV] === "1";
}

/**
 * A test instance reuses the developer's real login and keys, so writes to
 * online services are answered locally. A 403 response instead of a thrown
 * error keeps each caller's own HTTP error handling and message.
 */
export function readOnlyOnlineFetch<
  T extends (input: string, init: RequestInit) => Promise<Response>
>(fetcher: T, readMethods: ReadonlySet<string> = READ_METHODS): T {
  return (async (input: string, init: RequestInit = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    if (readMethods.has(method)) return fetcher(input, init);
    let path = input;
    try {
      path = new URL(input).pathname;
    } catch {
      // Keep the raw input; it is only used in the message.
    }
    const message = `测试环境不向线上服务写入（${method} ${path}）。`;
    return new Response(
      JSON.stringify({
        error: { code: "test_environment.read_only", message }
      }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }) as T;
}

export interface RendererConsoleMessage {
  level: string;
  message: string;
  lineNumber: number;
  sourceId: string;
}

/**
 * Renderer console output never reaches the terminal; a test instance copies
 * it into `pnpm dev` output, the log the verification CLI reads.
 */
export function forwardRendererConsole(
  contents: {
    on(
      event: "console-message",
      listener: (event: RendererConsoleMessage) => void
    ): unknown;
  },
  write: (line: string) => void = (line) => process.stderr.write(line)
): void {
  contents.on("console-message", ({ level, message, lineNumber, sourceId }) => {
    const source = sourceId ? ` (${sourceId}:${lineNumber})` : "";
    write(`[renderer:${level}] ${message}${source}\n`);
  });
}
