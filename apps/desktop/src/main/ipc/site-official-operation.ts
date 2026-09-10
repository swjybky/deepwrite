import { randomUUID } from "node:crypto";
import type { CommandEnvelope, CommandResult } from "@deepwrite/contracts";
import { SiteQuotaMergeError } from "../deepwrite-site-quota-merge";

interface SiteOfficialOperationState {
  revision: string;
  busy: boolean;
}
const states = new WeakMap<object, SiteOfficialOperationState>();

export function siteOfficialOperationState(store: object) {
  let state = states.get(store);
  if (!state) {
    state = { revision: randomUUID(), busy: false };
    states.set(store, state);
  }
  return state;
}

export function rejectSiteOfficialOperation(
  command: CommandEnvelope,
  error: unknown
): CommandResult {
  const safe =
    error instanceof SiteQuotaMergeError
      ? error
      : new SiteQuotaMergeError("merge_result_unknown");
  return {
    status: "rejected",
    requestId: command.id,
    error: { code: safe.code, message: safe.message }
  };
}

// All IPC routes capable of replacing the new-site key share this lock,
// including the generic model settings save used outside the site panel.
export async function runSiteOfficialOperation(
  store: object,
  command: CommandEnvelope,
  run: () => Promise<CommandResult | undefined>
): Promise<CommandResult | undefined> {
  const merge = command.type === "models.mergeSiteOfficialQuota";
  const mutation = [
    "models.save",
    "models.saveSiteOfficialToken",
    "models.clearSiteOfficialToken",
    "models.refreshSiteOfficial",
    "models.setSiteOfficialModelEnabled"
  ].includes(command.type);
  if (!merge && !mutation) return run();
  const state = siteOfficialOperationState(store);
  if (state.busy)
    return rejectSiteOfficialOperation(
      command,
      new SiteQuotaMergeError("models_busy")
    );
  state.busy = true;
  if (mutation) state.revision = randomUUID();
  try {
    return await run();
  } finally {
    state.busy = false;
  }
}
