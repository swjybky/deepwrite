import { formatError } from "../i18n/errors";
import { createScopedTranslator } from "../i18n";
import type {
  CatalogLibraryProjectDomain,
  DeepWriteApi
} from "@deepwrite/contracts";
import type { Ref } from "vue";
import { uiMessage } from "../ui-feedback";

const t = createScopedTranslator("workspace");

export async function openCatalogProjectAction(
  domain: "book" | CatalogLibraryProjectDomain,
  options: {
    api: DeepWriteApi | undefined;
    pending: Ref<boolean>;
    refresh(): Promise<void>;
    select(
      opened: NonNullable<
        Awaited<ReturnType<DeepWriteApi["catalog"]["openProject"]>>
      >
    ): Promise<void>;
  }
): Promise<void> {
  if (!options.api) {
    uiMessage.warning(
      t("catalogProjectActions.theBrowserPreviewCannotOpenLocalFoldersUseThe")
    );
    return;
  }
  if (options.pending.value) return;
  options.pending.value = true;
  try {
    const opened = await options.api.catalog.openProject(domain);
    if (!opened) return;
    await options.refresh();
    await options.select(opened);
    uiMessage.success(
      t("catalogProjectActions.opened", {
        value:
          opened.domain === "book"
            ? t("catalogProjectActions.book")
            : opened.domain === "material"
              ? t("catalogWorkspace.materialLibrary")
              : t("catalogWorkspace.skillLibrary"),
        title: opened.title
      })
    );
  } catch (error: unknown) {
    uiMessage.error(
      formatError(error, t("catalogProjectActions.failedToOpenLocalProject"))
    );
  } finally {
    options.pending.value = false;
  }
}
