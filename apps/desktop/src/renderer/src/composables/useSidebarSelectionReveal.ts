import { nextTick, watch, type Ref } from "vue";
import type { ResourceTreeSection } from "../types/workspace";
import { resourceTreeContainsResource } from "../utils/resourceTreeLookup";
import { scrollSelectedIntoView } from "../utils/scrollSelectedIntoView";

export function useSidebarSelectionReveal(options: {
  selectedId(): string;
  sections(): readonly ResourceTreeSection[];
  selectionActive: Readonly<Ref<boolean>>;
  scroller: Readonly<Ref<HTMLElement | null>>;
}) {
  async function revealSelection(
    block: "center" | "nearest" = "center"
  ): Promise<void> {
    const selectedId = options.selectedId();
    if (!selectedId || !options.selectionActive.value) return;
    await nextTick();
    if (options.selectedId() !== selectedId || !options.selectionActive.value)
      return;
    scrollSelectedIntoView(
      options.scroller.value,
      options.scroller.value?.querySelector<HTMLElement>(
        ".tree-row.is-selected"
      ),
      { block }
    );
  }

  watch(
    [options.selectedId, options.selectionActive],
    async ([selectedId, active], [previousId, wasActive]) => {
      if (!selectedId || !active) return;
      // A fallback after deletion is passive reconciliation, not navigation.
      if (
        wasActive &&
        previousId &&
        previousId !== selectedId &&
        !options
          .sections()
          .some(({ nodes }) => resourceTreeContainsResource(nodes, previousId))
      )
        return;
      await revealSelection(wasActive ? "nearest" : "center");
    },
    { flush: "post" }
  );

  return { revealSelection };
}
