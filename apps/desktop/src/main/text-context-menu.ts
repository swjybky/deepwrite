import {
  clipboard,
  ipcMain,
  Menu,
  type BrowserWindow,
  type ContextMenuParams,
  type IpcMainEvent
} from "electron";
import {
  createEnvelope,
  TEXT_CONTEXT_MENU_COMMAND_CHANNEL,
  TEXT_CONTEXT_MENU_EVENT_CHANNEL,
  TextContextMenuCommandSchema,
  TextContextMenuEventSchema,
  type TextContextMenuAction,
  type TextContextMenuContext,
  type TextContextMenuEvent
} from "@deepwrite/contracts";
import { createId } from "@deepwrite/shared";
import {
  buildTextMenuItems,
  fallbackTextContext,
  type TextMenuItem
} from "./text-context-menu-items";

interface PendingMenu {
  id: string;
  params: ContextMenuParams;
  context?: TextContextMenuContext;
  menu?: Menu;
  timer?: ReturnType<typeof setTimeout>;
  action?: TextContextMenuAction;
  fallback?: boolean;
}

/** Only the application window participates; guest webviews never get this bridge. */
export function installTextContextMenu(window: BrowserWindow): () => void {
  const contents = window.webContents;
  let pending: PendingMenu | undefined;

  function send(
    state: PendingMenu,
    payload: TextContextMenuEvent["payload"]
  ): void {
    if (contents.isDestroyed()) return;
    contents.send(
      TEXT_CONTEXT_MENU_EVENT_CHANNEL,
      TextContextMenuEventSchema.parse(
        createEnvelope("textContextMenu.event", payload, { id: state.id })
      )
    );
  }

  function cancel(): void {
    const state = pending;
    pending = undefined;
    if (!state) return;
    clearTimeout(state.timer);
    if (!window.isDestroyed()) state.menu?.closePopup(window);
    send(state, { phase: "closed" });
  }

  function execute(action: TextContextMenuAction): void {
    if (contents.isDestroyed() || window.isDestroyed() || !window.isFocused())
      return;
    switch (action) {
      case "undo":
        contents.undo();
        break;
      case "redo":
        contents.redo();
        break;
      case "cut":
        contents.cut();
        break;
      case "copy":
        contents.copy();
        break;
      case "paste":
        contents.pasteAndMatchStyle();
        break;
      case "delete":
        contents.delete();
        break;
      case "selectAll":
        contents.selectAll();
        break;
    }
  }

  function show(state: PendingMenu, context: TextContextMenuContext): void {
    if (pending !== state || contents.isDestroyed() || window.isDestroyed())
      return;
    clearTimeout(state.timer);
    state.context = context;
    const items = buildTextMenuItems(
      state.params,
      context,
      clipboard.readText().length > 0,
      process.platform
    );
    if (!items.length) {
      cancel();
      return;
    }
    const toNativeItem = ({
      action,
      submenu,
      ...item
    }: TextMenuItem): Electron.MenuItemConstructorOptions => ({
      ...item,
      registerAccelerator: false,
      ...(submenu ? { submenu: submenu.map(toNativeItem) } : {}),
      ...(action
        ? {
            click: () => {
              if (pending !== state || !item.enabled) return;
              if (state.fallback) {
                execute(action);
                cancel();
                return;
              }
              state.action = action;
              state.timer = setTimeout(cancel, 1000);
              send(state, { phase: "action", action });
            }
          }
        : {})
    });
    state.menu = Menu.buildFromTemplate(items.map(toNativeItem));
    state.menu.popup({
      window,
      // Omitting frame prevents macOS from appending writing/AI services.
      callback: () => {
        if (pending === state && !state.action) cancel();
      }
    });
  }

  function onContextMenu(
    _event: Electron.Event,
    params: ContextMenuParams
  ): void {
    cancel();
    if (!params.frame || params.frame !== contents.mainFrame) return;
    const state: PendingMenu = { id: createId("text_menu"), params };
    pending = state;
    state.timer = setTimeout(() => {
      state.fallback = true;
      show(state, fallbackTextContext(params));
    }, 250);
    send(state, { phase: "prepare" });
  }

  function onReply(event: IpcMainEvent, raw: unknown): void {
    if (event.sender !== contents || event.senderFrame !== contents.mainFrame)
      return;
    const parsed = TextContextMenuCommandSchema.safeParse(raw);
    const state = pending;
    if (
      !parsed.success ||
      !state ||
      parsed.data.context.correlationId !== state.id
    )
      return;
    const reply = parsed.data.payload;
    if (reply.phase === "cancel") {
      cancel();
      return;
    }
    if (reply.phase === "prepared" && !state.menu) {
      show(state, reply.context);
    } else if (reply.phase === "actionReady" && reply.action === state.action) {
      if (reply.allowed && !reply.handled) execute(reply.action);
      cancel();
    }
  }

  function dispose(): void {
    cancel();
    ipcMain.removeListener(TEXT_CONTEXT_MENU_COMMAND_CHANNEL, onReply);
    contents.removeListener("context-menu", onContextMenu);
    contents.removeListener("did-start-loading", cancel);
    contents.removeListener("destroyed", dispose);
    window.removeListener("blur", cancel);
    window.removeListener("hide", cancel);
    window.removeListener("closed", dispose);
  }
  ipcMain.on(TEXT_CONTEXT_MENU_COMMAND_CHANNEL, onReply);
  contents.on("context-menu", onContextMenu);
  contents.on("did-start-loading", cancel);
  contents.once("destroyed", dispose);
  window.on("blur", cancel);
  window.on("hide", cancel);
  window.once("closed", dispose);
  return dispose;
}
