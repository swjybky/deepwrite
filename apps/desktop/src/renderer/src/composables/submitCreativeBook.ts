import type { CreateCreativeBookPayload } from "../components/WorkspaceDialogLayer.types";
import type { CreativeBookCreationOptions } from "./useCreativeBookCreation";
import { withShortBookDefaultPlotStages } from "../utils/shortBookDefaultPlotStages";
export async function submitCreativeBook(
  input: CreateCreativeBookPayload,
  options: CreativeBookCreationOptions
) {
  // Creation inputs are JSON data, but dialog refs wrap nested bindings in
  // Vue proxies. Snapshot them before contextBridge copies the arguments;
  // Preload's schema validation runs after that boundary and cannot fix this.
  input = JSON.parse(JSON.stringify(input)) as CreateCreativeBookPayload;
  if (input.workspaceType === "long") {
    const { workspaceType: _workspaceType, ...book } = input;
    await options.createLong(book);
    return;
  }
  if (input.workspaceType === "academic") {
    await options.createShort(input);
    return;
  }
  if (input.workspaceType === "mystery") {
    const { workspaceType: _workspaceType, ...book } = input;
    await options.createMystery?.(book);
    return;
  }
  await options.createShort(
    input.templateId
      ? input
      : withShortBookDefaultPlotStages(
          input,
          options.settings.value,
          options.catalog.value?.creativePlotStages ?? []
        )
  );
}
