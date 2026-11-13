import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BOOK_IMAGE_MAX_BYTES } from "@deepwrite/contracts";
import { decodeWebpToPng } from "./webp";
import { IMAGE_PNG } from "../image/image-test-support";
const { createWindow } = vi.hoisted(() => ({ createWindow: vi.fn() }));
vi.mock("electron", () => ({ BrowserWindow: createWindow, nativeImage: {} }));
function fixture() {
  const contents = Object.assign(new EventEmitter(), {
    session: {
      setPermissionCheckHandler: vi.fn(),
      setPermissionRequestHandler: vi.fn(),
      webRequest: { onBeforeRequest: vi.fn() }
    },
    setWindowOpenHandler: vi.fn(),
    executeJavaScript: vi.fn().mockResolvedValue({
      png: IMAGE_PNG.toString("base64"),
      width: 1,
      height: 1
    })
  });
  const window = Object.assign(new EventEmitter(), {
    webContents: contents,
    loadURL: vi.fn().mockResolvedValue(undefined),
    isDestroyed: vi.fn(() => false),
    destroy: vi.fn()
  });
  window.destroy.mockImplementation(() => {
    window.isDestroyed.mockReturnValue(true);
    window.emit("closed");
  });
  return { window, contents };
}
let f: ReturnType<typeof fixture>;
const webp = Buffer.from("RIFFxxxxWEBP");
beforeEach(() => {
  vi.clearAllMocks();
  f = fixture();
  createWindow.mockImplementation(function () {
    return f.window;
  });
});
afterEach(() => {
  vi.useRealTimers();
});
describe("disposable WebP decoder", () => {
  it("uses a hidden isolated sandbox with no preload, Node, permissions or network", async () => {
    expect(await decodeWebpToPng(webp)).toEqual(IMAGE_PNG);
    expect(createWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        show: false,
        webPreferences: expect.objectContaining({
          sandbox: true,
          nodeIntegration: false,
          contextIsolation: true,
          webSecurity: true,
          devTools: false,
          webviewTag: false
        })
      })
    );
    const preferences = createWindow.mock.calls[0]?.[0].webPreferences;
    expect(preferences.preload).toBeUndefined();
    expect(preferences.partition).not.toMatch(/^persist:/u);
    const loaded = f.window.loadURL.mock.calls[0]?.[0] as string;
    expect(loaded).toMatch(/^data:text\/html;/u);
    const html = decodeURIComponent(loaded);
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("img-src data:");
    expect(html).toContain("connect-src 'none'");
    const allow =
      f.contents.session.setPermissionCheckHandler.mock.calls[0]?.[0];
    expect(allow()).toBe(false);
    const permissionCallback = vi.fn();
    f.contents.session.setPermissionRequestHandler.mock.calls[0]?.[0](
      null,
      "media",
      permissionCallback
    );
    expect(permissionCallback).toHaveBeenCalledWith(false);
    const network =
      f.contents.session.webRequest.onBeforeRequest.mock.calls[0]?.[1];
    const reply = vi.fn();
    network({ url: "https://example.test/image.webp" }, reply);
    expect(reply).toHaveBeenLastCalledWith({ cancel: true });
    network({ url: "file:///invalid/local-file" }, reply);
    expect(reply).toHaveBeenLastCalledWith({ cancel: true });
    network({ url: "data:image/webp;base64,invalid" }, reply);
    expect(reply).toHaveBeenLastCalledWith({ cancel: false });
    expect(f.contents.setWindowOpenHandler.mock.calls[0]?.[0]()).toEqual({
      action: "deny"
    });
    const navigation = { preventDefault: vi.fn() };
    f.contents.emit("will-navigate", navigation);
    expect(navigation.preventDefault).toHaveBeenCalledOnce();
    expect(f.contents.executeJavaScript.mock.calls[0]?.[0]).toContain(
      webp.toString("base64")
    );
    expect(f.window.destroy).toHaveBeenCalledOnce();
  });
  it.each([
    { error: "dimensions" },
    { png: IMAGE_PNG.toString("base64"), width: 8193, height: 1 },
    { png: IMAGE_PNG.toString("base64"), width: 2, height: 1 },
    { png: Buffer.from("invalid PNG").toString("base64"), width: 1, height: 1 }
  ])(
    "rejects invalid decoder output and always destroys its window: %j",
    async (output) => {
      f.contents.executeJavaScript.mockResolvedValue(output);
      await expect(decodeWebpToPng(webp)).rejects.toMatchObject({
        code: "book_image.invalid_dimensions"
      });
      expect(f.window.destroy).toHaveBeenCalledOnce();
    }
  );
  it("bounds the returned PNG before decoding base64", async () => {
    f.contents.executeJavaScript.mockResolvedValue({
      png: "A".repeat(Math.ceil(BOOK_IMAGE_MAX_BYTES / 3) * 4 + 4),
      width: 1,
      height: 1
    });
    await expect(decodeWebpToPng(webp)).rejects.toMatchObject({
      code: "book_image.too_large"
    });
    expect(f.window.destroy).toHaveBeenCalledOnce();
  });
  it("destroys the window if loading or script execution fails", async () => {
    f.window.loadURL.mockRejectedValueOnce(new Error("failed load"));
    await expect(decodeWebpToPng(webp)).rejects.toMatchObject({
      code: "book_image.invalid_dimensions"
    });
    expect(f.window.destroy).toHaveBeenCalledOnce();
    f = fixture();
    f.contents.executeJavaScript.mockRejectedValueOnce(
      new Error("decode failed")
    );
    await expect(decodeWebpToPng(webp)).rejects.toMatchObject({
      code: "book_image.invalid_dimensions"
    });
    expect(f.window.destroy).toHaveBeenCalledOnce();
  });
  it("bounds stalled decoders and renderer crashes, cleaning up event listeners", async () => {
    vi.useFakeTimers();
    f.contents.executeJavaScript.mockImplementation(
      () => new Promise(() => {})
    );
    const decoding = decodeWebpToPng(webp);
    const rejected = expect(decoding).rejects.toMatchObject({
      code: "book_image.invalid_dimensions"
    });
    await vi.advanceTimersByTimeAsync(20_000);
    await rejected;
    expect(f.window.destroy).toHaveBeenCalledOnce();
    expect(f.contents.listenerCount("render-process-gone")).toBe(0);
    f = fixture();
    f.contents.executeJavaScript.mockImplementation(
      () => new Promise(() => {})
    );
    const crashed = decodeWebpToPng(webp);
    const failed = expect(crashed).rejects.toMatchObject({
      code: "book_image.invalid_dimensions"
    });
    f.contents.emit("render-process-gone");
    await failed;
    expect(f.window.destroy).toHaveBeenCalledOnce();
  });
  it("rejects non-WebP bytes before opening a window", async () => {
    await expect(decodeWebpToPng(IMAGE_PNG)).rejects.toMatchObject({
      code: "book_image.unsupported_format"
    });
    expect(createWindow).not.toHaveBeenCalled();
  });
});
