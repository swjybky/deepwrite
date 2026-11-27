import {
  ImageModelSettingsSchema,
  ImageModelTestResultSchema,
  ImageUsageSchema,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import type { ImageService } from "./image-service";
import { safeImageError } from "./image-http";
import { rejectedResult } from "../ipc/errors";

export async function handleImageCommands(
  command: CommandEnvelope,
  service: ImageService,
  ownerId: number
): Promise<CommandResult | undefined> {
  if (!command.type.startsWith("imageModels.")) return undefined;
  try {
    let payload: unknown;
    switch (command.type) {
      case "imageModels.getSettings":
        payload = ImageModelSettingsSchema.parse(await service.getSettings());
        break;
      case "imageModels.saveSettings":
        payload = ImageModelSettingsSchema.parse(
          await service.saveSettings(command.payload)
        );
        break;
      case "imageModels.getUsage":
        payload = ImageUsageSchema.parse(await service.getUsage());
        break;
      case "imageModels.test":
        payload = ImageModelTestResultSchema.parse(
          await service.test(command.payload, ownerId)
        );
        break;
      case "imageModels.cancel":
        payload = {
          cancelled: service.cancel(command.payload.requestId, ownerId)
        };
        break;
      default:
        return undefined;
    }
    return { status: "accepted", requestId: command.id, payload };
  } catch (error) {
    return rejectedResult(
      command.id,
      "image.operation_failed",
      safeImageError(error)
    );
  }
}
