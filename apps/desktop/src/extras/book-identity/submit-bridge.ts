import { randomUUID } from "node:crypto";
import {
  BookIdentityRoundSchema,
  BookIdentityRoundReceiptSchema,
  CommandEnvelopeSchema,
  createEnvelope,
  chatAssistantProjectKey,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import {
  authorizeMainInternalCommand,
  type MainInternalCommandActiveRun
} from "../../main/internal-command-authorizer";
import type { UtilityInternalCommandAuthorizationContext } from "../../main/supervisor";
import { rejectedResult } from "../../main/ipc/errors";

/** Executes only the semantic round append authorized for this accepted run. */
export async function handleBookIdentitySubmission(
  context: UtilityInternalCommandAuthorizationContext,
  activeRuns: ReadonlyMap<string, MainInternalCommandActiveRun>,
  core: (command: CommandEnvelope) => Promise<CommandResult>
): Promise<CommandResult | undefined> {
  const command = context.message.command;
  if (command.type !== "bookIdentity.submitRound") return undefined;
  const registration = command.context.runId
    ? activeRuns.get(command.context.runId)?.bookIdentity
    : undefined;
  let claimed = false;
  try {
    const authorization = authorizeMainInternalCommand(context, activeRuns);
    if (authorization !== true)
      throw new Error("设计提交没有通过当前运行授权。");
    if (!registration || registration.submitted || registration.submitting)
      throw new Error("本轮已经提交或不在授权运行中。");
    if (
      command.payload.roundId !== registration.roundId ||
      command.payload.field !== registration.field ||
      command.payload.candidates.length !== registration.candidateCount ||
      chatAssistantProjectKey(command.payload.book) !==
        chatAssistantProjectKey(registration.book)
    )
      throw new Error("提交范围与 Main 登记不一致。");
    registration.submitting = true;
    claimed = true;
    const candidates = command.payload.candidates.map((candidate) => ({
      ...candidate,
      id: `cand_${randomUUID().replaceAll("-", "")}`,
      starred: false,
      edited: false,
      ...(command.payload.field === "synopsis" && "text" in candidate
        ? { wordCount: Array.from(candidate.text).length }
        : {}),
      ...(command.payload.field === "cover"
        ? { images: [], lastRenderError: null }
        : {})
    }));
    const round = BookIdentityRoundSchema.parse({
      id: registration.roundId,
      field: registration.field,
      source: "agent",
      createdAt: new Date().toISOString(),
      profile: registration.profile,
      ...(registration.model ? { model: registration.model } : {}),
      request: registration.request,
      candidates
    });
    const result = await core(
      CommandEnvelopeSchema.parse(
        createEnvelope(
          "bookIdentity.appendRound",
          { book: registration.book, round },
          { id: `${command.id}-append`, context: command.context }
        )
      )
    );
    if (result.status === "rejected")
      return { ...result, requestId: command.id };
    const receipt = BookIdentityRoundReceiptSchema.parse(result.payload);
    if (receipt.roundId !== registration.roundId)
      throw new Error("Core 保存回执与本轮不一致。");
    registration.submitted = true;
    return { status: "accepted", requestId: command.id, payload: receipt };
  } catch (error) {
    return rejectedResult(
      command.id,
      "book_identity.submit_failed",
      error instanceof Error ? error.message : "保存设计候选失败。"
    );
  } finally {
    if (registration && claimed) registration.submitting = false;
  }
}
