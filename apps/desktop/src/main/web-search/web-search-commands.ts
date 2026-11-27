import {
  WebSearchKeyImportCandidatesSchema,
  WebSearchSettingsSchema,
  WebSearchTestResultSchema,
  type CommandEnvelope,
  type CommandResult
} from "@deepwrite/contracts";
import { safeWebSearchError } from "./web-search-errors";
import type { WebSearchService } from "./web-search-service";
import { rejectedResult } from "../ipc/errors";

export async function handleWebSearchCommands(
  command: CommandEnvelope,
  service: WebSearchService
): Promise<CommandResult | undefined> {
  if (!command.type.startsWith("webSearch.")) return undefined;
  try {
    let payload: unknown;
    switch (command.type) {
      case "webSearch.getSettings":
        payload = WebSearchSettingsSchema.parse(await service.getSettings());
        break;
      case "webSearch.saveSettings":
        payload = WebSearchSettingsSchema.parse(
          await service.saveSettings(command.payload)
        );
        break;
      case "webSearch.setEnabled":
        payload = WebSearchSettingsSchema.parse(
          await service.setEnabled(command.payload.enabled)
        );
        break;
      case "webSearch.test":
        payload = WebSearchTestResultSchema.parse(
          await service.test(command.payload)
        );
        break;
      case "webSearch.listKeyImportCandidates":
        payload = WebSearchKeyImportCandidatesSchema.parse(
          await service.listKeyImportCandidates(command.payload.providerId)
        );
        break;
      case "webSearch.importKey":
        payload = WebSearchSettingsSchema.parse(
          await service.importKey(command.payload)
        );
        break;
      default:
        return undefined;
    }
    return { status: "accepted", requestId: command.id, payload };
  } catch (error) {
    return rejectedResult(
      command.id,
      "web_search.operation_failed",
      safeWebSearchError(error)
    );
  }
}
