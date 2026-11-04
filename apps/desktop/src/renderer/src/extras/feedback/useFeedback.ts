import { computed, getCurrentScope, nextTick, onScopeDispose, ref } from "vue";
import type {
  DeepWriteApi,
  FeedbackItem,
  FeedbackPage,
  MarketplaceSession
} from "@deepwrite/contracts";
import { FEEDBACK_MAX_IMAGES } from "@deepwrite/contracts/renderer";
import { createScopedTranslator } from "../../i18n";
import { uiMessage } from "../../ui-feedback";
import { marketplaceAccountError } from "../../utils/marketplaceAccountError";
import {
  base64ToBlob,
  compressFeedbackImage,
  type FeedbackDraftImage
} from "./feedbackImage";
import { feedbackDraft } from "./feedbackDraft";

export type FeedbackTab = "compose" | "history";

function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

export function useFeedback(options: {
  api(): DeepWriteApi | undefined;
  onSessionChange(session: MarketplaceSession): void;
  /** The session could not be read at all, so there is nothing to show. */
  onUnavailable(): void;
  compress?(source: Blob): Promise<FeedbackDraftImage>;
  waitForHiddenDialog?(): Promise<void>;
}) {
  const t = createScopedTranslator("extras.feedback");
  const compress = options.compress ?? compressFeedbackImage;
  const session = ref<MarketplaceSession | null>(null);
  const authenticated = computed(() => session.value?.authenticated === true);
  const tab = ref<FeedbackTab>("compose");
  const { submitting, processingImages, capturing } = feedbackDraft;
  const history = ref<FeedbackPage | null>(null);
  const historyLoading = ref(false);
  const imageSources = ref<Record<string, string>>({});
  const openImageSets = ref<ReadonlySet<string>>(new Set());
  let historyRequest = 0;
  let historyPage = 1;
  let active = true;
  if (getCurrentScope())
    onScopeDispose(() => {
      active = false;
      historyRequest++;
    });

  const imagesFull = computed(
    () => feedbackDraft.images.value.length >= FEEDBACK_MAX_IMAGES
  );
  const canSubmit = computed(
    () =>
      Boolean(feedbackDraft.content.value.trim()) &&
      !submitting.value &&
      !capturing.value &&
      !processingImages.value
  );

  function applySession(next: MarketplaceSession): void {
    if (!active) return;
    session.value = next;
    options.onSessionChange(next);
    if (next.authenticated && tab.value === "history") void loadHistory();
  }

  async function restoreSession(): Promise<void> {
    try {
      const api = options.api();
      if (!api) throw new Error(t("loadFailed"));
      applySession(await api.marketplace.session());
    } catch (error: unknown) {
      if (!active) return;
      uiMessage.error(marketplaceAccountError(error, t("loadFailed")));
      options.onUnavailable();
    }
  }

  /** A rejected token clears the login, which brings the form back. */
  async function recheckSession(): Promise<void> {
    const next = await options
      .api()
      ?.marketplace.session()
      .catch(() => undefined);
    if (next && !next.authenticated) applySession(next);
  }

  async function loadHistory(page = 1): Promise<void> {
    const api = options.api();
    if (!api || !active) return;
    historyPage = page;
    const request = ++historyRequest;
    historyLoading.value = true;
    try {
      const result = await api.feedback.list({ page });
      if (request === historyRequest) history.value = result;
    } catch (error: unknown) {
      if (request !== historyRequest) return;
      uiMessage.error(marketplaceAccountError(error, t("loadFailed")));
      await recheckSession();
    } finally {
      if (request === historyRequest) historyLoading.value = false;
    }
  }

  function selectTab(next: FeedbackTab): void {
    tab.value = next;
    if (next === "history") void loadHistory(history.value?.page);
  }

  async function submit(): Promise<void> {
    const api = options.api();
    if (!api || !canSubmit.value) return;
    const snapshot = feedbackDraft.snapshot();
    submitting.value = true;
    try {
      await api.feedback.submit({
        ...(snapshot.tag ? { tag: snapshot.tag } : {}),
        content: snapshot.content,
        images: snapshot.images.map((image) => image.data)
      });
      const cleared =
        !capturing.value && feedbackDraft.clearIfUnchanged(snapshot);
      uiMessage.success(t("submitted"));
      if (active) {
        history.value = null;
        if (cleared) selectTab("history");
        else if (tab.value === "history") void loadHistory();
      }
    } catch (error: unknown) {
      uiMessage.error(marketplaceAccountError(error, t("submitFailed")));
      await recheckSession();
    } finally {
      submitting.value = false;
    }
  }

  async function addImages(sources: readonly Blob[]): Promise<void> {
    if (processingImages.value || !sources.length) return;
    const room = FEEDBACK_MAX_IMAGES - feedbackDraft.images.value.length;
    if (sources.length > room) {
      uiMessage.warning(t("imageLimit", { max: FEEDBACK_MAX_IMAGES }));
    }
    processingImages.value = true;
    try {
      for (const source of sources.slice(0, Math.max(room, 0))) {
        try {
          const image = await compress(source);
          feedbackDraft.images.value = [...feedbackDraft.images.value, image];
        } catch {
          uiMessage.error(t("imageUnreadable"));
        }
      }
    } finally {
      processingImages.value = false;
    }
  }

  function removeImage(id: string): void {
    feedbackDraft.images.value = feedbackDraft.images.value.filter(
      (image) => image.id !== id
    );
  }

  /** The dialog steps aside for the capture so the shot shows the workspace. */
  async function captureWindow(): Promise<void> {
    const api = options.api();
    if (!api || capturing.value || processingImages.value) return;
    if (imagesFull.value) {
      uiMessage.warning(t("imageLimit", { max: FEEDBACK_MAX_IMAGES }));
      return;
    }
    capturing.value = true;
    let captured: Blob | undefined;
    try {
      await (
        options.waitForHiddenDialog ?? (() => nextTick().then(nextPaint))
      )();
      const image = await api.feedback.captureWindow();
      captured = base64ToBlob(image.data, image.contentType);
    } catch (error: unknown) {
      uiMessage.error(marketplaceAccountError(error, t("captureFailed")));
    } finally {
      capturing.value = false;
    }
    if (captured) await addImages([captured]);
  }

  async function toggleImages(item: FeedbackItem): Promise<void> {
    const open = new Set(openImageSets.value);
    if (open.delete(item.id)) {
      openImageSets.value = open;
      return;
    }
    open.add(item.id);
    openImageSets.value = open;
    const api = options.api();
    if (!api) return;
    try {
      await Promise.all(
        item.images
          .filter((image) => !imageSources.value[image.id])
          .map(async ({ id }) => {
            const image = await api.feedback.image({
              feedbackId: item.id,
              imageId: id
            });
            imageSources.value = {
              ...imageSources.value,
              [id]: `data:${image.contentType};base64,${image.data}`
            };
          })
      );
    } catch (error: unknown) {
      uiMessage.error(marketplaceAccountError(error, t("imageLoadFailed")));
      await recheckSession();
    }
  }

  return {
    session,
    authenticated,
    tab,
    submitting,
    processingImages,
    capturing,
    imagesFull,
    canSubmit,
    history,
    historyLoading,
    retryHistory: () => loadHistory(historyPage),
    imageSources,
    openImageSets,
    applySession,
    restoreSession,
    loadHistory,
    selectTab,
    submit,
    addImages,
    removeImage,
    captureWindow,
    toggleImages
  };
}
