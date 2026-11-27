import { formatError } from "../i18n/errors";
import { createScopedTranslator } from "../i18n";
import { onMounted, ref, shallowRef } from "vue";
import type {
  BookTemplate,
  CatalogIndexSnapshot,
  SaveBookTemplateInput
} from "@deepwrite/contracts";
import { uiMessage } from "../ui-feedback";
import { deepwriteApi } from "../api/deepwrite";

const t = createScopedTranslator("workspace.bookTemplates");
export function useBookTemplates() {
  const templates = ref<BookTemplate[]>([]);
  const catalog = shallowRef<CatalogIndexSnapshot | null>(null);
  const loading = ref(false);
  const saving = ref(false);
  const failed = ref(false);
  async function load() {
    const desktopApi = deepwriteApi();
    if (!desktopApi || loading.value) return;
    loading.value = true;
    failed.value = false;
    try {
      const [items, index] = await Promise.all([
        desktopApi.bookTemplates.list(),
        desktopApi.catalog.index()
      ]);
      templates.value = items;
      catalog.value = index;
    } catch (error) {
      failed.value = true;
      uiMessage.error(formatError(error, t("failedToLoadTemplates")));
    } finally {
      loading.value = false;
    }
  }
  async function save(input: SaveBookTemplateInput): Promise<boolean> {
    const desktopApi = deepwriteApi();
    if (!desktopApi || saving.value) return false;
    saving.value = true;
    try {
      const saved = await desktopApi.bookTemplates.save(input);
      templates.value = [
        ...templates.value.filter((item) => item.id !== saved.id),
        saved
      ];
      uiMessage.success(t("templateSaved"));
      return true;
    } catch (error) {
      uiMessage.error(formatError(error, t("failedToSaveTemplate")));
      return false;
    } finally {
      saving.value = false;
    }
  }
  async function remove(id: string): Promise<boolean> {
    const desktopApi = deepwriteApi();
    if (!desktopApi || saving.value) return false;
    saving.value = true;
    try {
      await desktopApi.bookTemplates.delete({ id });
      templates.value = templates.value.filter((item) => item.id !== id);
      uiMessage.success(t("templateDeleted"));
      return true;
    } catch (error) {
      uiMessage.error(formatError(error, t("failedToDeleteTemplate")));
      return false;
    } finally {
      saving.value = false;
    }
  }
  onMounted(load);
  return { templates, catalog, loading, saving, failed, load, save, remove };
}
