import type { LongAgentToolDetails } from "./index";

export function isLongAgentToolDetails(
  value: unknown
): value is LongAgentToolDetails {
  if (!value || typeof value !== "object" || !("kind" in value)) return false;
  const kind = (value as { kind?: unknown }).kind;
  return (
    kind === "none" ||
    kind === "long-mutation-proposal" ||
    kind === "long-worldbuilding-file-proposal" ||
    kind === "long-character-file-proposal" ||
    kind === "long-continuity-file-proposal" ||
    kind === "long-chapter-write-proposal" ||
    kind === "long-ledger-commit-proposal" ||
    kind === "long-continuity-commit-proposal"
  );
}
