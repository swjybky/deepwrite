import { mkdir, realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { withProjectTransactionLock } from "../utilities/project-transaction/lock";

/** Settings are shared by separate Main processes. Reuse Core's file identity,
 * owner checks and abandoned-lock recovery for each read/modify/write cycle.
 */
export async function withConfigurationLock<T>(
  settingsPath: string,
  operation: () => Promise<T>
): Promise<T> {
  const root = join(dirname(settingsPath), ".locks", basename(settingsPath));
  await mkdir(root, { recursive: true, mode: 0o700 });
  return withProjectTransactionLock(await realpath(root), operation);
}
