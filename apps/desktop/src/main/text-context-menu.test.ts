import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ipcMain,
  Menu,
  type BrowserWindow,
  type ContextMenuParams,
  type MenuItemConstructorOptions
} from "electron";
import {
  createEnvelope,
  TEXT_CONTEXT_MENU_COMMAND_CHANNEL
} from "@deepwrite/contracts";
import { setNativeLanguage } from "./native-i18n";
import { installTextContextMenu } from "./text-context-menu";

vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    ipcMain: new EventEmitter(),
    clipboard: { readText: () => "sample clipboard" },
    Menu: { buildFromTemplate: vi.fn() }
  };
});

function fixture() {
  const contents = Object.assign(new EventEmitter(), {
    mainFrame: {},
    isDestroyed: vi.fn(() => false),
    send: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    cut: vi.fn(),
    copy: vi.fn(),
    pasteAndMatchStyle: vi.fn(),
    delete: vi.fn(),
    selectAll: vi.fn()
  });
  const window = Object.assign(new EventEmitter(), {
    webContents: contents,
    isDestroyed: () => false,
    isFocused: () => true
  });
  const menu = { popup: vi.fn(), closePopup: vi.fn() };
  vi.mocked(Menu.buildFromTemplate).mockReturnValue(menu as unknown as Menu);
  const dispose = installTextContextMenu(window as unknown as BrowserWindow);
  const context = {
    kind: "editable",
    password: false,
    hasSelection: true,
    hasText: true,
    canInsertReference: true,
    canInsertImage: false,
    history: { canUndo: true, canRedo: true }
  };
  function open() {
    contents.emit("context-menu", {}, {
      frame: contents.mainFrame,
      isEditable: true,
      selectionText: "sample",
      editFlags: {
        canUndo: true,
        canRedo: true,
        canCut: true,
        canCopy: true,
        canPaste: true,
        canDelete: true,
        canSelectAll: true
      }
    } as ContextMenuParams);
    return contents.send.mock.lastCall![1].id as string;
  }
  function reply(
    id: string,
    payload: unknown,
    sender = contents,
    senderFrame = contents.mainFrame
  ) {
    ipcMain.emit(
      TEXT_CONTEXT_MENU_COMMAND_CHANNEL,
      { sender, senderFrame },
      createEnvelope("textContextMenu.reply", payload, {
        id: "reply_test",
        correlationId: id
      })
    );
  }
  function click(label: string) {
    const template = vi.mocked(Menu.buildFromTemplate).mock.lastCall![0];
    const item = template.find(
      (item) => item.label === label
    ) as MenuItemConstructorOptions;
    (item.click as () => void)();
  }
  return { contents, window, menu, dispose, context, open, reply, click };
}

describe("text menu lifecycle", () => {
  let f: ReturnType<typeof fixture>;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    f = fixture();
  });
  afterEach(() => {
    setNativeLanguage("zh-CN", "zh-CN");
    f.dispose();
    vi.useRealTimers();
  });

  it("uses the current language for new menus and keeps actions stable", () => {
    setNativeLanguage("en-US", "zh-CN");
    const id = f.open();
    f.reply(id, { phase: "prepared", context: f.context });
    f.click("Copy");
    f.reply(id, {
      phase: "actionReady",
      action: "copy",
      allowed: true,
      handled: false
    });
    expect(f.contents.copy).toHaveBeenCalledOnce();
  });
  it("waits for target validation before pasting plain text", () => {
    const id = f.open();
    f.reply(id, { phase: "prepared", context: f.context });
    f.click("粘贴");
    expect(f.contents.pasteAndMatchStyle).not.toHaveBeenCalled();
    f.reply(id, {
      phase: "actionReady",
      action: "paste",
      allowed: true,
      handled: false
    });
    expect(f.contents.pasteAndMatchStyle).toHaveBeenCalledOnce();
  });
  it("does not execute an action after the target changes", () => {
    const id = f.open();
    f.reply(id, { phase: "prepared", context: f.context });
    f.click("删除");
    f.reply(id, {
      phase: "actionReady",
      action: "delete",
      allowed: false,
      handled: false
    });
    expect(f.contents.delete).not.toHaveBeenCalled();
  });
  it("does not duplicate renderer history actions", () => {
    const id = f.open();
    f.reply(id, { phase: "prepared", context: f.context });
    f.click("重做");
    f.reply(id, {
      phase: "actionReady",
      action: "redo",
      allowed: true,
      handled: true
    });
    expect(f.contents.redo).not.toHaveBeenCalled();
  });
  it("rejects foreign frames, stale replies and mismatched actions", () => {
    const stale = f.open();
    const id = f.open();
    f.reply(stale, { phase: "prepared", context: f.context });
    f.reply(id, { phase: "prepared", context: f.context }, f.contents, {});
    expect(Menu.buildFromTemplate).not.toHaveBeenCalled();
    f.reply(id, { phase: "prepared", context: f.context });
    f.click("复制");
    f.reply(id, {
      phase: "actionReady",
      action: "delete",
      allowed: true,
      handled: false
    });
    expect(f.contents.delete).not.toHaveBeenCalled();
    f.contents.emit("did-start-loading");
    f.reply(id, {
      phase: "actionReady",
      action: "copy",
      allowed: true,
      handled: false
    });
    expect(f.contents.copy).not.toHaveBeenCalled();
  });
  it("shows basic editing if the renderer cannot prepare context", () => {
    f.open();
    vi.advanceTimersByTime(250);
    const template = vi.mocked(Menu.buildFromTemplate).mock.lastCall![0];
    expect(template.some((item) => item.label === "复制")).toBe(true);
    expect(template.some((item) => item.label === "插入输入框")).toBe(false);
  });
  it("cleans up on cancellation, destruction and disposal", () => {
    const id = f.open();
    f.reply(id, { phase: "prepared", context: f.context });
    f.reply(id, { phase: "cancel" });
    expect(f.menu.closePopup).toHaveBeenCalledOnce();
    f.open();
    f.contents.emit("destroyed");
    vi.advanceTimersByTime(1000);
    expect(ipcMain.listenerCount(TEXT_CONTEXT_MENU_COMMAND_CHANNEL)).toBe(0);
    expect(f.contents.listenerCount("context-menu")).toBe(0);
  });
});
