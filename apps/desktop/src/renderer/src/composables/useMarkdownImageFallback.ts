import { onBeforeUnmount, watch } from "vue";
import { createScopedTranslator, locale } from "../i18n";

const t = createScopedTranslator("components.bookImages");

export function useMarkdownImageFallback(): (event: Event) => void {
  const missing = new Map<HTMLElement, string>();
  const show = (figure: HTMLElement, path: string) => {
    figure.replaceChildren(document.createTextNode(t("missing", { path })));
  };
  watch(locale, () => {
    for (const [figure, path] of missing) {
      if (figure.isConnected) show(figure, path);
      else missing.delete(figure);
    }
  });
  onBeforeUnmount(() => missing.clear());
  return (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement)) return;
    const figure = image.closest<HTMLElement>(".markdown-image");
    if (!figure) return;
    figure.classList.add("is-missing");
    const path = figure.dataset.imagePath ?? "";
    for (const previous of missing.keys()) {
      if (!previous.isConnected) missing.delete(previous);
    }
    missing.set(figure, path);
    show(figure, path);
  };
}

export function handleMarkdownImageLoad(event: Event): void {
  const image = event.target;
  if (image instanceof HTMLImageElement)
    image.closest(".markdown-image")?.classList.add("is-loaded");
}
