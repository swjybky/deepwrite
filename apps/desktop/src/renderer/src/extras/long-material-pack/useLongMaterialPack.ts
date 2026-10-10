import { computed, onScopeDispose, ref, watch } from "vue";
import { defineStore } from "pinia";
import { createId } from "@deepwrite/shared";
import {
  DEFAULT_LONG_MATERIAL_PACK_OPTIONS,
  LONG_MATERIAL_DEFAULT_SAMPLE_CHAPTERS,
  type LongBookSummary,
  type LongMaterialConvertResult,
  type LongMaterialPackRequest,
  type LongMaterialPreview,
  type LongMaterialProgressPayload,
  type LongMaterialSection,
  type LongMaterialSourceStats,
  type ModelConfig,
  type SystemEventEnvelope
} from "@deepwrite/contracts/renderer";
import { packT } from "./pack-labels";
import { formatError } from "../../i18n/errors";
import { uiMessage } from "../../ui-feedback";
import {
  longMaterialPackLaunchBookId,
  longMaterialPackRunning
} from "../../stores/longMaterialPackActivity";
import { createMaterialGuideRun } from "./materialGuideRun";

const t = packT;

function api() {
  const value = globalThis.window?.deepwrite;
  if (!value) throw new Error(t("agentUnavailable"));
  return value;
}

export type PackDecision = "overwrite" | "remove" | "regenerate";

export const useLongMaterialPackStore = defineStore(
  "long-material-pack",
  () => {
    const books = ref<LongBookSummary[]>([]);
    const bookId = ref("");
    const stats = ref<LongMaterialSourceStats | null>(null);
    const loadingSource = ref(false);
    const sections = ref<LongMaterialSection[]>([
      ...DEFAULT_LONG_MATERIAL_PACK_OPTIONS.sections
    ]);
    const characterScope = ref<"grouped" | "individual">("grouped");
    const chapterGrouping = ref<"auto" | "20" | "50">("auto");
    const sampleChapterIds = ref<string[]>([]);
    const targetMode = ref<"create" | "update">("create");
    const groupTitle = ref("");
    const packId = ref("");
    const runGuideAfter = ref(false);
    const preview = ref<LongMaterialPreview | null>(null);
    const previewKey = ref("");
    const previewing = ref(false);
    const converting = ref(false);
    const progress = ref<LongMaterialProgressPayload | null>(null);
    const result = ref<LongMaterialConvertResult | null>(null);
    const resolving = ref(false);
    // A failed create keeps its id, so a retry reuses the libraries it made.
    let operationId = "";

    const guide = createMaterialGuideRun({
      api,
      onApplied(next) {
        result.value = next;
        void refreshStats();
      }
    });

    const request = computed<LongMaterialPackRequest | null>(() => {
      if (!bookId.value) return null;
      return {
        bookId: bookId.value,
        options: {
          sections: [...sections.value],
          characterScope: characterScope.value,
          chapterGrouping: chapterGrouping.value,
          sampleChapterIds: [...sampleChapterIds.value]
        },
        target:
          targetMode.value === "update" && packId.value
            ? { action: "update", packId: packId.value }
            : {
                action: "create",
                title:
                  groupTitle.value.trim() ||
                  t("groupNameDefault", { title: stats.value?.title ?? "" })
              }
      };
    });
    const requestKey = computed(() => JSON.stringify(request.value));
    const previewStale = computed(
      () => Boolean(preview.value) && previewKey.value !== requestKey.value
    );
    const busy = computed(
      () => converting.value || resolving.value || guide.busy.value
    );
    watch(busy, (value) => (longMaterialPackRunning.value = value), {
      immediate: true
    });

    function handleEvent(event: SystemEventEnvelope) {
      if (event.type === "long_material_pack.progress") {
        if (event.payload.operationId === operationId)
          progress.value = event.payload;
        return;
      }
      guide.handleEvent(event);
    }
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = globalThis.window?.deepwrite?.events.subscribe(handleEvent);
    } catch {
      unsubscribe = undefined;
    }

    async function refreshStats() {
      if (!bookId.value) return;
      stats.value = await api().longMaterialPack.inspect({
        bookId: bookId.value
      });
    }

    async function selectBook(id: string) {
      if (busy.value || !id) return;
      bookId.value = id;
      stats.value = null;
      preview.value = null;
      result.value = null;
      operationId = "";
      loadingSource.value = true;
      try {
        await refreshStats();
        const loaded = stats.value!;
        sampleChapterIds.value = loaded.chapters
          .filter(({ written }) => written)
          .slice(0, LONG_MATERIAL_DEFAULT_SAMPLE_CHAPTERS)
          .map(({ id: chapterId }) => chapterId);
        groupTitle.value = t("groupNameDefault", { title: loaded.title });
        packId.value = loaded.packs[0]?.id ?? "";
        targetMode.value = packId.value ? "update" : "create";
      } catch (error) {
        uiMessage.error(formatError(error, t("loadFailed")));
      } finally {
        loadingSource.value = false;
      }
    }

    async function loadBooks() {
      try {
        books.value = [...(await api().long.list()).books].sort((a, b) =>
          b.updatedAt.localeCompare(a.updatedAt)
        );
      } catch (error) {
        uiMessage.error(formatError(error, t("loadFailed")));
        return;
      }
      const launch = longMaterialPackLaunchBookId.value;
      longMaterialPackLaunchBookId.value = null;
      const wanted =
        launch ??
        (books.value.some(({ id }) => id === bookId.value)
          ? ""
          : books.value[0]?.id);
      if (wanted && wanted !== bookId.value) await selectBook(wanted);
    }

    async function runPreview() {
      const current = request.value;
      if (!current || previewing.value) return;
      if (!current.options.sections.length)
        return uiMessage.error(t("chooseContent"));
      previewing.value = true;
      try {
        preview.value = await api().longMaterialPack.preview(current);
        previewKey.value = JSON.stringify(current);
      } catch (error) {
        uiMessage.error(formatError(error, t("previewFailed")));
      } finally {
        previewing.value = false;
      }
    }

    async function convert(model: ModelConfig | undefined) {
      const current = request.value;
      if (!current || busy.value) return;
      if (!current.options.sections.length)
        return uiMessage.error(t("chooseContent"));
      operationId ||= createId("long_material_convert");
      converting.value = true;
      progress.value = null;
      try {
        result.value = await api().longMaterialPack.convert({
          ...current,
          operationId
        });
        operationId = "";
        const written = result.value.counts.new + result.value.counts.updated;
        uiMessage.success(t("converted", { count: written }));
        await refreshStats();
        packId.value = result.value.pack.id;
        targetMode.value = "update";
        preview.value = null;
      } catch (error) {
        uiMessage.error(formatError(error, t("convertFailed")));
        return;
      } finally {
        converting.value = false;
        progress.value = null;
      }
      const converted = result.value;
      if (runGuideAfter.value && converted)
        await guide.start(converted.pack.id, model);
    }

    async function resolve(decisions: Record<string, PackDecision>) {
      const pack = result.value?.pack.id;
      const list = Object.entries(decisions).map(([key, action]) => ({
        key,
        action
      }));
      if (!pack || !list.length || busy.value) return;
      resolving.value = true;
      try {
        result.value = await api().longMaterialPack.resolve({
          packId: pack,
          decisions: list
        });
        await refreshStats();
      } catch (error) {
        uiMessage.error(formatError(error, t("resolveFailed")));
      } finally {
        resolving.value = false;
      }
    }

    if (globalThis.window?.deepwrite) guide.loadFocus();
    onScopeDispose(() => {
      unsubscribe?.();
      guide.dispose();
      longMaterialPackRunning.value = false;
    });

    return {
      books,
      bookId,
      stats,
      loadingSource,
      sections,
      characterScope,
      chapterGrouping,
      sampleChapterIds,
      targetMode,
      groupTitle,
      packId,
      runGuideAfter,
      preview,
      previewStale,
      previewing,
      converting,
      progress,
      result,
      resolving,
      busy,
      guideStatus: guide.status,
      guideBusy: guide.busy,
      guideModelId: guide.modelId,
      guideThinkingLevel: guide.thinkingLevel,
      guideFocus: guide.profile.systemPrompt,
      guideUsable: guide.usable,
      startGuide: guide.start,
      stopGuide: guide.stop,
      loadBooks,
      selectBook,
      refreshStats,
      runPreview,
      convert,
      resolve
    };
  }
);
