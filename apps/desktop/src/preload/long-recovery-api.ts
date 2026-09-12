import {
  LongResolveConflictsInputSchema,
  LongResolveConflictsResultSchema,
  createEnvelope,
  type LongResolveConflictsInput,
  type LongResolveConflictsResult
} from "@deepwrite/contracts";
import { browserId, invokeCommand } from "./invoke";

export async function resolveLongConflicts(
  rawInput: LongResolveConflictsInput
): Promise<LongResolveConflictsResult> {
  const input = LongResolveConflictsInputSchema.parse(rawInput);
  const id = browserId("cmd_long_resolve_conflicts");
  return LongResolveConflictsResultSchema.parse(
    await invokeCommand<LongResolveConflictsResult>(
      createEnvelope("long.resolveConflicts", input, {
        id,
        correlationId: id,
        context: { resourceId: input.bookId }
      })
    )
  );
}
