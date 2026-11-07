import { nextTick, watch, type Ref } from "vue";
import type { ResourceTreeSection } from "../types/workspace";
import { resourceTreeContainsResource } from "../utils/resourceTreeLookup";
import { scrollSelectedIntoView } from "../utils/scrollSelectedIntoView";

const SELECTED_ROW_SELECTOR = ".tree-row.is-selected";
/** Cascading tree disclosure can take several mount ticks before the row exists. */
const REVEAL_ATTEMPTS = 8;

export function useSidebarSelectionReveal(options: {
  selectedId(): string;
  sections(): readonly ResourceTreeSection[];
  selectionActive: Readonly<Ref<boolean>>;
  scroller: Readonly<Ref<HTMLElement | null>>;
}) {
  let revealGeneration = 0;
  let centerRevealPreferred = false;

  function preferCenteredReveal(prefer = true): void {
    centerRevealPreferred = prefer;
    if (prefer) revealGeneration += 1;
  }

  async function revealSelection(
    block: "center" | "nearest" = "center"
  ): Promise<void> {
    const selectedId = options.selectedId();
    if (!selectedId || !options.selectionActive.value) {
      if (block === "center") centerRevealPreferred = false;
      return;
    }

    const effectiveBlock =
      block === "center" || centerRevealPreferred ? "center" : "nearest";
    if (effectiveBlock === "center") centerRevealPreferred = true;

    const generation = ++revealGeneration;

    for (let attempt = 0; attempt < REVEAL_ATTEMPTS; attempt += 1) {
      await nextTick();
      if (
        generation !== revealGeneration ||
        options.selectedId() !== selectedId ||
        !options.selectionActive.value
      ) {
        return;
      }
      const scroller = options.scroller.value;
      const selected = scroller?.querySelector<HTMLElement>(
        SELECTED_ROW_SELECTOR
      );
      if (!selected) continue;
      scrollSelectedIntoView(scroller, selected, { block: effectiveBlock });
      if (generation === revealGeneration) centerRevealPreferred = false;
      return;
    }

    if (generation === revealGeneration) centerRevealPreferred = false;
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
      await revealSelection(
        centerRevealPreferred || !wasActive ? "center" : "nearest"
      );
    },
    { flush: "post" }
  );

  return { revealSelection, preferCenteredReveal };
}
