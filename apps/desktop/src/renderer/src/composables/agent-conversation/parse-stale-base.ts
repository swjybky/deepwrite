import type { AgentEditProposal } from "../../types/conversation";
import { isRecord, validDate } from "./shared";

const SHA256 = /^[0-9a-f]{64}$/u;

/**
 * An unreadable marker is dropped rather than rejecting the proposal: accept
 * re-checks the base anyway and flags the proposal again if it is stale.
 */
export function parseStoredStaleBase(
  value: unknown
): AgentEditProposal["staleBase"] | undefined {
  if (!isRecord(value) || !validDate(value.detectedAt)) return undefined;
  const { currentRevision, currentSha256ByFileId, resolution } = value;
  if (currentRevision !== undefined && typeof currentRevision !== "string") {
    return undefined;
  }
  if (
    currentSha256ByFileId !== undefined &&
    (!isRecord(currentSha256ByFileId) ||
      !Object.values(currentSha256ByFileId).every(
        (sha) => typeof sha === "string" && SHA256.test(sha)
      ))
  ) {
    return undefined;
  }
  if (
    resolution !== undefined &&
    resolution !== "kept-user" &&
    resolution !== "overwrote"
  ) {
    return undefined;
  }
  return {
    detectedAt: value.detectedAt,
    ...(currentRevision === undefined ? {} : { currentRevision }),
    ...(currentSha256ByFileId === undefined
      ? {}
      : {
          currentSha256ByFileId: { ...currentSha256ByFileId } as Record<
            string,
            string
          >
        }),
    ...(resolution === undefined ? {} : { resolution })
  };
}
