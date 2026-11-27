import { createHash } from "node:crypto";
import { posix, win32 } from "node:path";

export interface ExternalControlPaths {
  directory: string;
  stateFile: string;
  endpoint: string;
}

interface ResolvePathsInput {
  homeDirectory: string;
  packaged: boolean;
  platform?: NodeJS.Platform;
  /** Development only: lets an isolated test instance run beside `pnpm dev`. */
  developmentDirectory?: string | undefined;
}

export const DEVELOPMENT_CONTROL_DIRECTORY_ENV = "DEEPWRITE_CONTROL_DIR";

/**
 * Lives under the home directory rather than user data: users can relocate
 * user data, the bridge cannot know where to, and macOS caps socket paths.
 * Development and packaged builds never share an endpoint.
 */
export function resolveExternalControlPaths(
  input: ResolvePathsInput
): ExternalControlPaths {
  const platform = input.platform ?? process.platform;
  const path = platform === "win32" ? win32 : posix;
  const override = input.packaged
    ? undefined
    : input.developmentDirectory?.trim();
  const directory = override
    ? path.resolve(override)
    : path.join(
        input.homeDirectory,
        ".deepwrite",
        input.packaged ? "control" : "control-dev"
      );
  const stateFile = path.join(directory, "control.json");
  if (platform !== "win32") {
    return {
      directory,
      stateFile,
      endpoint: path.join(directory, "control.sock")
    };
  }
  const user = createHash("sha256")
    .update((override ? directory : input.homeDirectory).toLowerCase())
    .digest("hex")
    .slice(0, 16);
  const suffix = input.packaged ? "" : override ? "-test" : "-dev";
  return {
    directory,
    stateFile,
    endpoint: `\\\\.\\pipe\\deepwrite-control-${user}${suffix}`
  };
}
