import {
  LongResolveConflictsInputSchema,
  LongResolveConflictsResultSchema,
  type LongResolveConflictsInput,
  type LongResolveConflictsResult
} from "@deepwrite/contracts";
import type { LongWorkspaceService } from "./long-workspace-service";

export async function resolveLongWorkspaceConflicts(
  service: LongWorkspaceService,
  input: LongResolveConflictsInput
): Promise<LongResolveConflictsResult> {
  const { bookId } = LongResolveConflictsInputSchema.parse(input);
  const resolved = await service.catalog.withProjectDirectory(
    bookId,
    async (directory) => await service.store.resolveConflicts(directory, bookId)
  );
  await service.catalog.updateSummary(bookId, resolved.summary);
  return LongResolveConflictsResultSchema.parse(resolved);
}
