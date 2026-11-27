import {
  BookIdentityRecordSchema,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import { safeImageError } from "../../main/image/image-http";
import type { CoverRenderService } from "./cover-render-service";
import { exportCover } from "./cover-export";
import type { IdentityCore } from "./core-client";
import { validateComposedCover } from "./composed-cover-validation";
import { rejectedResult } from "../../main/ipc/errors";

const publicCoreCommands = new Set<string>([
  "bookIdentity.get",
  "bookIdentity.inheritBook",
  "bookIdentity.addManualCandidate",
  "bookIdentity.updateCandidate",
  "bookIdentity.adopt",
  "bookIdentity.clearAdoption",
  "bookIdentity.deleteRound",
  "bookIdentity.pruneRounds",
  "bookIdentity.saveComposedCover"
]);

export async function handleBookIdentityCommands(
  command: CommandEnvelope,
  core: IdentityCore,
  renderer: CoverRenderService,
  ownerId: number
): Promise<CommandResult | undefined> {
  if (!command.type.startsWith("bookIdentity.")) return undefined;
  try {
    if (command.type === "bookIdentity.saveComposedCover")
      validateComposedCover(command.payload.pngBase64);
    if (publicCoreCommands.has(command.type)) {
      const result = await core(command);
      if (result.status === "rejected") return result;
      return {
        ...result,
        payload: BookIdentityRecordSchema.parse(result.payload)
      };
    }
    let payload: unknown;
    switch (command.type) {
      case "bookIdentity.renderCover":
        payload = await renderer.render(command.payload, ownerId);
        break;
      case "bookIdentity.cancelRender":
        payload = {
          cancelled: renderer.cancel(command.payload.requestId, ownerId)
        };
        break;
      case "bookIdentity.exportCover":
        payload = await exportCover(core, command.payload);
        break;
      default:
        return undefined;
    }
    return { status: "accepted", requestId: command.id, payload };
  } catch (error) {
    return rejectedResult(
      command.id,
      "book_identity.operation_failed",
      safeImageError(error)
    );
  }
}
