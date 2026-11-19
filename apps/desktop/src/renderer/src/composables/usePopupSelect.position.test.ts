import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { usePopupSelect } from "./usePopupSelect";
import type { PopupSelectProps } from "../types/popupSelect";

vi.mock("vue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue")>()),
  onMounted: (callback: () => void) => callback(),
  onBeforeUnmount: vi.fn()
}));

afterEach(() => vi.unstubAllGlobals());

function fixture(height = 40, inDialog = true) {
  const documentEvents = new EventTarget();
  vi.stubGlobal(
    "window",
    Object.assign(new EventTarget(), { innerWidth: 1200, innerHeight: 900 })
  );
  vi.stubGlobal("document", documentEvents);
  const dialog = {
    getBoundingClientRect: () => ({ top: 90, bottom: 810 }),
    querySelector: () => ({
      contains: () => false,
      getBoundingClientRect: () => ({ top: 780 })
    })
  };
  const scroller = {
    parentElement: null,
    getBoundingClientRect: () => ({ top: 170, bottom: 810 })
  };
  const rect = { top: 730, bottom: 768, left: 260, right: 540, width: 280 };
  vi.stubGlobal("getComputedStyle", () => ({
    overflowY: "auto",
    overflowX: "hidden"
  }));
  const select = usePopupSelect(
    {
      options: [{ value: "", label: "不绑定" }],
      modelValue: "",
      selectedValues: [],
      menuMinWidth: 260,
      menuMaxHeight: 320,
      menuZIndex: 1000,
      align: "start"
    } as unknown as PopupSelectProps,
    vi.fn()
  );
  select.trigger.value = {
    parentElement: scroller,
    closest: () => (inDialog ? dialog : null),
    getBoundingClientRect: () => rect
  } as unknown as HTMLButtonElement;
  select.menu.value = { scrollHeight: height } as HTMLElement;
  return { select, rect, documentEvents };
}

describe("PopupSelect dialog positioning", () => {
  it("keeps using viewport space for menus outside dialogs", async () => {
    const { select } = fixture(54, false);
    await select.openMenu();
    expect(select.menuStyle.value.top).toBe("775px");
    expect(select.menuStyle.value.transformOrigin).toBe("top");
  });

  it("opens a short menu upward instead of outside the dialog", async () => {
    const { select } = fixture(54);
    await select.openMenu();
    expect(parseFloat(String(select.menuStyle.value.top))).toBeLessThan(730);
    expect(select.menuStyle.value.transformOrigin).toBe("bottom");
  });

  it("closes a menu when scrolling hides its trigger", async () => {
    const { select, rect, documentEvents } = fixture();
    await select.openMenu();
    rect.top = 100;
    rect.bottom = 138;
    documentEvents.dispatchEvent(new Event("scroll"));
    await nextTick();
    expect(select.open.value).toBe(false);
  });

  it("keeps a visible trigger anchored while scrolling", async () => {
    const { select, rect, documentEvents } = fixture(200);
    await select.openMenu();
    const previousTop = parseFloat(String(select.menuStyle.value.top));
    rect.top -= 20;
    rect.bottom -= 20;
    documentEvents.dispatchEvent(new Event("scroll"));
    expect(select.open.value).toBe(true);
    expect(parseFloat(String(select.menuStyle.value.top))).toBe(
      previousTop - 20
    );
  });
});
