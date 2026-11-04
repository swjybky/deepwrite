import { t } from "../i18n";
import { ref, type Ref } from "vue";
import type {
  CatalogIndexSnapshot,
  CreateLongBookInput,
  WorkspaceAgentSettings
} from "@deepwrite/contracts";
import type {
  BookAgentTeamChoice,
  CreateCreativeBookPayload
} from "../components/WorkspaceDialogLayer.types";
import type { CreateShortOrScriptBookInput } from "./useShortBookLifecycleCoordinator";
import { uiMessage } from "../ui-feedback";
export interface CreativeBookCreationOptions {
  open: Ref<boolean>;
  pending(): boolean;
  settings: Ref<WorkspaceAgentSettings[]>;
  catalog: Ref<CatalogIndexSnapshot | null>;
  createShort(input: CreateShortOrScriptBookInput): Promise<void>;
  createLong(input: CreateLongBookInput & BookAgentTeamChoice): Promise<void>;
  openSettings(category: string): Promise<void>;
}
export function useCreativeBookCreation(options: CreativeBookCreationOptions) {
  const createFromTemplate = ref(false);
  function closeCreateBookDialog() {
    if (!options.pending()) options.open.value = false;
  }
  function openCreateBookDialog(fromTemplate = false) {
    if (!window.deepwrite) {
      uiMessage.warning(
        t(
          "workspace.creativeBookCreation.theBrowserPreviewCannotSaveProjectsCreateProjectsIn"
        )
      );
      return;
    }
    createFromTemplate.value = fromTemplate;
    options.open.value = true;
  }
  async function createCreativeBook(input: CreateCreativeBookPayload) {
    const { submitCreativeBook } = await import("./submitCreativeBook");
    await submitCreativeBook(input, options);
  }
  async function openTemplateSettings() {
    closeCreateBookDialog();
    await options.openSettings("short-agents");
  }
  return {
    createFromTemplate,
    closeCreateBookDialog,
    openCreateBookDialog,
    createCreativeBook,
    openTemplateSettings
  };
}
