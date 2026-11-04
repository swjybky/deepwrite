import { EXTERNAL_CONTROL_LAUNCH_FLAG } from "@deepwrite/contracts/external-control";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface AppLaunchCommand {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

interface ResolveLaunchInput {
  execPath: string;
  moduleUrl: string;
  env: NodeJS.ProcessEnv;
}

export function isPackagedBridge(moduleUrl: string): boolean {
  return fileURLToPath(moduleUrl).includes("app.asar");
}

/**
 * The bridge runs on the app's own binary, so the same binary reopens the app
 * once run-as-node is removed. An unpackaged build needs its app directory.
 */
export function resolveAppLaunchCommand(
  input: ResolveLaunchInput
): AppLaunchCommand {
  const { ELECTRON_RUN_AS_NODE: _runAsNode, ...env } = input.env;
  // Only unpackaged builds honor the data override used by desktop tests.
  if (isPackagedBridge(input.moduleUrl)) {
    return {
      command: input.execPath,
      args: [EXTERNAL_CONTROL_LAUNCH_FLAG],
      env
    };
  }
  const bridgeDirectory = dirname(fileURLToPath(input.moduleUrl));
  const userData = env.DEEPWRITE_EXTERNAL_CONTROL_USER_DATA;
  return {
    command: input.execPath,
    args: [
      resolve(bridgeDirectory, "../../../.."),
      ...(userData ? [`--user-data-dir=${userData}`] : []),
      EXTERNAL_CONTROL_LAUNCH_FLAG
    ],
    env
  };
}

export interface AppLaunch {
  /** Set when the process could not start or died from a signal. */
  failure(): string | undefined;
}

export function launchApp(command: AppLaunchCommand): AppLaunch {
  let failure: string | undefined;
  const child = spawn(command.command, command.args, {
    detached: true,
    stdio: "ignore",
    env: command.env
  });
  child.once("error", (error) => {
    failure = error.message;
  });
  child.once("exit", (code, signal) => {
    // Exit code 0 is a second instance handing over to the running app.
    if (signal || code) failure = signal ?? `exit code ${code}`;
  });
  child.unref();
  return { failure: () => failure };
}
