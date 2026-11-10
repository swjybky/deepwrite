import { basename, dirname, join, resolve } from "node:path";

interface DevelopmentProfileApplication {
  readonly isPackaged: boolean;
  getName(): string;
  getPath(name: "userData" | "appData"): string;
  setPath(name: "userData", path: string): void;
}

/** Points a development run at another profile, such as a copy of real data. */
export const DEVELOPMENT_USER_DATA_ENV = "DEEPWRITE_DEV_USER_DATA";

/**
 * Development and packaged builds share one Electron name, hence one profile
 * and one single-instance lock: `pnpm dev` beside the installed app would only
 * focus the installed window, or worse, write the same data concurrently.
 * Development gets a sibling `<name>-dev` runtime with its own lock, storage
 * pointer, sessions and diagnostics. The return value identifies the installed
 * profile whose user configuration is shared. Explicitly chosen profiles
 * (`--user-data-dir`, smoke fixtures calling `setPath`) are left untouched.
 */
export function resolveDevelopmentUserData(
  application: DevelopmentProfileApplication,
  environment: NodeJS.ProcessEnv
): string | undefined {
  if (application.isPackaged) return undefined;
  const current = resolve(application.getPath("userData"));
  const electronDefault = resolve(
    join(application.getPath("appData"), application.getName())
  );
  if (current !== electronDefault) return undefined;
  const configured = environment[DEVELOPMENT_USER_DATA_ENV]?.trim();
  if (configured) return resolve(configured);
  return join(dirname(current), `${basename(current)}-dev`);
}

/** Call before the single-instance lock; explicit test profiles stay isolated. */
export function applyDevelopmentProfile(
  application: DevelopmentProfileApplication,
  environment: NodeJS.ProcessEnv = process.env
): string | undefined {
  const path = resolveDevelopmentUserData(application, environment);
  if (!path) return undefined;
  const sharedProfile = environment[DEVELOPMENT_USER_DATA_ENV]?.trim()
    ? undefined
    : application.getPath("userData");
  application.setPath("userData", path);
  return sharedProfile;
}
