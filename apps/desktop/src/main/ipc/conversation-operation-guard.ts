import type { ActiveRun } from "./command-types";

type SessionOperation = { prompts: number; management: boolean };
const states = new WeakMap<
  Map<string, ActiveRun>,
  Map<string, SessionOperation>
>();

function scope(runs: Map<string, ActiveRun>) {
  let sessions = states.get(runs);
  if (!sessions) {
    sessions = new Map();
    states.set(runs, sessions);
  }
  return sessions;
}

/** Main owns the gap between receiving a prompt and receiving Agent acceptance. */
export function acquireConversationOperation(
  runs: Map<string, ActiveRun>,
  sessionId: string,
  operation: "prompt" | "management"
): (() => void) | undefined {
  const sessions = scope(runs);
  const current = sessions.get(sessionId) ?? { prompts: 0, management: false };
  if (
    current.management ||
    (operation === "management" &&
      (current.prompts > 0 ||
        [...runs.values()].some((run) => run.sessionId === sessionId)))
  )
    return undefined;
  if (operation === "prompt") current.prompts += 1;
  else current.management = true;
  sessions.set(sessionId, current);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (operation === "prompt") current.prompts -= 1;
    else current.management = false;
    if (current.prompts === 0 && !current.management)
      sessions.delete(sessionId);
  };
}
