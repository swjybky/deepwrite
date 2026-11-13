import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEnvelope } from "@deepwrite/contracts";
import type { TextContextMenuEvent } from "@deepwrite/contracts";
import { captureTextMenuTarget } from "./textContextMenuTarget";
import {
  installNativeTextContextMenu,
  registerTextMenuExtension
} from "./nativeTextContextMenu";

vi.mock("./textContextMenuTarget", () => ({ captureTextMenuTarget: vi.fn() }));

describe("renderer native menu coordination", () => {
  let dispatch: (event: TextContextMenuEvent) => void;
  let dispose: () => void;
  let documentEvents: EventTarget;
  const reply = vi.fn();
  const valid = vi.fn(() => true);
  beforeEach(() => {
    vi.clearAllMocks();
    valid.mockReturnValue(true);
    documentEvents = new EventTarget();
    vi.stubGlobal("document", documentEvents);
    vi.stubGlobal("addEventListener", vi.fn());
    vi.stubGlobal("removeEventListener", vi.fn());
    vi.mocked(captureTextMenuTarget).mockReturnValue({
      target: { contains: () => false } as unknown as HTMLElement,
      context: {
        kind: "editable",
        password: false,
        hasText: true,
        hasSelection: true,
        canInsertReference: false,
        canInsertImage: false
      },
      valid
    });
    dispose = installNativeTextContextMenu({
      reply,
      subscribe(listener) {
        dispatch = listener;
        return vi.fn();
      }
    });
  });
  afterEach(() => {
    dispose();
    vi.unstubAllGlobals();
  });
  function send(id: string, payload: TextContextMenuEvent["payload"]) {
    dispatch(createEnvelope("textContextMenu.event", payload, { id }));
  }
  function contextEvent() {
    const event = new Event("contextmenu") as MouseEvent;
    documentEvents.dispatchEvent(event);
    return event;
  }

  it("adds a local reference without sending manuscript contents across IPC", () => {
    const event = contextEvent();
    const insert = vi.fn();
    registerTextMenuExtension(event, { valid: () => true, insert });
    send("menu_one", { phase: "prepare" });
    expect(reply.mock.lastCall![0].payload.context.canInsertReference).toBe(
      true
    );
    expect(JSON.stringify(reply.mock.calls)).not.toContain("reference");
    send("menu_one", { phase: "action", action: "insertReference" });
    expect(insert).toHaveBeenCalledOnce();
    expect(reply.mock.lastCall![0].payload).toEqual({
      phase: "actionReady",
      action: "insertReference",
      allowed: true,
      handled: true
    });
  });

  it("uses the same custom undo/redo history as the editor toolbar", () => {
    const history = {
      canUndo: () => false,
      canRedo: () => true,
      undo: vi.fn(),
      redo: vi.fn()
    };
    registerTextMenuExtension(contextEvent(), { valid: () => true, history });
    send("menu_history", { phase: "prepare" });
    expect(reply.mock.lastCall![0].payload.context.history).toEqual({
      canUndo: false,
      canRedo: true
    });
    send("menu_history", { phase: "action", action: "redo" });
    expect(history.redo).toHaveBeenCalledOnce();
    expect(reply.mock.lastCall![0].payload.handled).toBe(true);
  });

  it("rejects an action after content, selection or target identity changes", () => {
    contextEvent();
    send("menu_stale", { phase: "prepare" });
    valid.mockReturnValue(false);
    send("menu_stale", { phase: "action", action: "delete" });
    expect(reply.mock.lastCall![0].payload.allowed).toBe(false);
  });

  it("captures Chromium's settled right-click selection before opening the menu", () => {
    const settled = captureTextMenuTarget(
      new Event("contextmenu") as MouseEvent
    );
    vi.mocked(captureTextMenuTarget).mockReturnValueOnce({
      ...settled!,
      valid: (checkSelection = true) => !checkSelection
    });
    contextEvent();
    send("menu_settled", { phase: "prepare" });
    expect(reply.mock.lastCall![0].payload.context.kind).toBe("editable");
    send("menu_settled", { phase: "action", action: "copy" });
    expect(reply.mock.lastCall![0].payload.allowed).toBe(true);
  });

  it("cancels the old menu when right-clicking a different field", () => {
    const insert = vi.fn();
    registerTextMenuExtension(contextEvent(), { valid: () => true, insert });
    send("menu_old", { phase: "prepare" });
    contextEvent();
    expect(reply.mock.lastCall![0]).toMatchObject({
      context: { correlationId: "menu_old" },
      payload: { phase: "cancel" }
    });
    send("menu_new", { phase: "prepare" });
    send("menu_old", { phase: "action", action: "insertReference" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("releases references on owner unmount or document switch", () => {
    const insert = vi.fn();
    const release = registerTextMenuExtension(contextEvent(), {
      valid: () => true,
      insert
    });
    send("menu_unmount", { phase: "prepare" });
    release();
    expect(reply.mock.lastCall![0].payload.phase).toBe("cancel");
    send("menu_unmount", { phase: "action", action: "insertReference" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("suppresses excluded targets and cancels on new input", () => {
    vi.mocked(captureTextMenuTarget).mockReturnValueOnce(undefined);
    contextEvent();
    send("menu_disabled", { phase: "prepare" });
    expect(reply.mock.lastCall![0].payload.context.kind).toBe("none");
    contextEvent();
    send("menu_input", { phase: "prepare" });
    documentEvents.dispatchEvent(new Event("input"));
    expect(reply.mock.lastCall![0].payload.phase).toBe("cancel");
  });
  it("merges image insertion with the existing selection-reference action", () => {
    const event = contextEvent();
    const insert = vi.fn();
    const insertImage = vi.fn();
    registerTextMenuExtension(event, { valid: () => true, insert });
    registerTextMenuExtension(event, { valid: () => true, insertImage });
    send("menu_image", { phase: "prepare" });
    expect(reply.mock.lastCall![0].payload.context).toMatchObject({
      canInsertReference: true,
      canInsertImage: true
    });
    send("menu_image", { phase: "action", action: "insertImage" });
    expect(insertImage).toHaveBeenCalledOnce();
    expect(insert).not.toHaveBeenCalled();
    expect(reply.mock.lastCall![0].payload).toMatchObject({
      allowed: true,
      handled: true
    });
  });
  it("recaptures an unselected readonly preview when it has an image extension", () => {
    vi.mocked(captureTextMenuTarget).mockReturnValueOnce(undefined);
    const event = contextEvent();
    registerTextMenuExtension(event, {
      valid: () => true,
      insertImage: vi.fn()
    });
    send("menu_preview", { phase: "prepare" });
    expect(captureTextMenuTarget).toHaveBeenLastCalledWith(event, true);
    expect(reply.mock.lastCall![0].payload.context.canInsertImage).toBe(true);
  });
});
