import { nextTick, type Ref } from "vue";
import type { ChatMessage } from "../../src/renderer/src/types/conversation";
import { createDefaultAppearanceSettings } from "@deepwrite/contracts/renderer";
import { applyAppearanceThemeToDocument } from "../../src/renderer/src/composables/appearanceThemeRuntime";
const frame = () => new Promise(requestAnimationFrame);

export async function verifyVueInteractions(
  messages: Ref<ChatMessage[]>,
  responding: Ref<boolean>
) {
  getSelection()!.removeAllRanges();
  document.dispatchEvent(new Event("selectionchange"));
  await nextTick();
  await frame();
  await frame();
  const activeGroupExempt = !document
    .querySelector("[data-conversation-message-id='assistant-999']")
    ?.closest(".conversation-message-group")
    ?.classList.contains("is-deferred");
  responding.value = false;
  messages.value.at(-1)!.status = "completed";
  await nextTick();
  await frame();
  const scroller = document.querySelector<HTMLElement>(".conversation-scroll")!;
  const target = document.querySelector<HTMLElement>(
    "[data-conversation-message-id='user-10']"
  )!;
  document
    .querySelector<HTMLElement>("[data-conversation-turn-id='user-10']")!
    .click();
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const anchorDeltas: {
    size: number;
    delta: number;
    active: string | undefined;
    before: number;
    after: number;
  }[] = [];
  for (let size = 10; size <= 24; size += 1) {
    const before =
      target.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    document.documentElement.style.setProperty("--ui-font-size", `${size}px`);
    await frame();
    await frame();
    const after =
      target.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    anchorDeltas.push({
      size,
      delta: after - before,
      before,
      after,
      active: document.querySelector<HTMLElement>(
        ".conversation-turn-marker.is-active"
      )?.dataset.conversationTurnId
    });
  }
  document.documentElement.style.setProperty("--ui-font-size", "14px");
  await frame();
  await frame();
  const widthDeltas = [];
  const host = document.querySelector<HTMLElement>("#app")!;
  for (const width of [700, 950, 1100]) {
    const before =
      target.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    host.style.width = `${width}px`;
    await frame();
    await frame();
    await frame();
    await frame();
    widthDeltas.push({
      width,
      delta:
        target.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top -
        before
    });
  }
  const group = target.closest<HTMLElement>(".conversation-message-group")!;
  document
    .querySelector<HTMLElement>(
      "[data-conversation-message-id='assistant-10'] summary"
    )!
    .focus();
  await nextTick();
  await frame();
  const focusExempt = getComputedStyle(group).contentVisibility === "visible";
  const focusDiagnostic = {
    hasFocus: document.hasFocus(),
    focusedTag: document.activeElement?.tagName,
    containsFocus: group.contains(document.activeElement),
    className: group.className
  };
  target
    .querySelector<HTMLElement>(".user-message-copy")!
    .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  await nextTick();
  await frame();
  const editingExempt =
    !group.classList.contains("is-deferred") &&
    !!target.querySelector("textarea");
  target
    .querySelector<HTMLElement>(".conversation-message-editor-actions button")!
    .click();
  await nextTick();
  const response = document.querySelector<HTMLElement>(
    "[data-assistant-response-message-id='assistant-10']"
  )!;
  const range = document.createRange();
  range.selectNodeContents(response);
  getSelection()!.removeAllRanges();
  getSelection()!.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
  await nextTick();
  const selectionExempt = !response
    .closest<HTMLElement>(".conversation-message-group")!
    .classList.contains("is-deferred");
  response.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 200,
      clientY: 200
    })
  );
  await nextTick();
  document.querySelector<HTMLElement>(".editor-selection-menu button")?.click();
  await nextTick();
  const referenceInserted = !!document.querySelector(
    ".composer-editor-reference"
  );
  const themeChecks = [];
  const settings = createDefaultAppearanceSettings();
  for (const scheme of ["light", "dark"] as const) {
    for (const custom of [false, true]) {
      applyAppearanceThemeToDocument({
        scheme,
        theme: {
          ...settings[scheme],
          ...(custom ? { accent: "#8B5CF6" } : {})
        },
        uiFontFamily: settings.uiFontFamily,
        editorFontFamily: settings.editorFontFamily
      });
      await frame();
      const pane = getComputedStyle(
        document.querySelector(".conversation-pane")!
      );
      const root = getComputedStyle(document.documentElement);
      themeChecks.push({
        scheme,
        custom,
        background: pane.backgroundColor,
        foreground: pane.color,
        accent: root.getPropertyValue("--accent").trim(),
        horizontalOverflow: scroller.scrollWidth > scroller.clientWidth
      });
    }
  }
  return {
    themeChecks,
    widthDeltas,
    anchorDeltas,
    focusExempt,
    focusDiagnostic,
    editingExempt,
    selectionExempt,
    referenceInserted,
    activeGroupExempt
  };
}
