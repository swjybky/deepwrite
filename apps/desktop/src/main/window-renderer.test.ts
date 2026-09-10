import { describe, expect, it, vi } from "vitest";
import { loadWindowRenderer } from "./window-renderer";

function windowStub() {
  return {
    loadURL: vi.fn(async () => undefined),
    loadFile: vi.fn(async () => undefined),
    isDestroyed: vi.fn(() => false)
  };
}

describe("window renderer loading", () => {
  it("uses the development server when available", async () => {
    const window = windowStub();
    await loadWindowRenderer(
      window,
      "/test/index.html",
      "https://example.test"
    );
    expect(window.loadURL).toHaveBeenCalledWith("https://example.test");
    expect(window.loadFile).not.toHaveBeenCalled();
  });

  it("falls back to the built renderer when the development server is gone", async () => {
    const window = windowStub();
    window.loadURL.mockRejectedValue(new Error("ERR_CONNECTION_REFUSED"));
    await loadWindowRenderer(
      window,
      "/test/index.html",
      "https://example.test"
    );
    expect(window.loadFile).toHaveBeenCalledExactlyOnceWith("/test/index.html");
  });

  it("loads the local build without a development URL", async () => {
    const window = windowStub();
    await loadWindowRenderer(window, "/test/index.html");
    expect(window.loadURL).not.toHaveBeenCalled();
    expect(window.loadFile).toHaveBeenCalledWith("/test/index.html");
  });

  it("does not load a fallback after the window is destroyed", async () => {
    const window = windowStub();
    window.loadURL.mockRejectedValue(new Error("ERR_ABORTED"));
    window.isDestroyed.mockReturnValue(true);
    await loadWindowRenderer(
      window,
      "/test/index.html",
      "https://example.test"
    );
    expect(window.loadFile).not.toHaveBeenCalled();
  });

  it("reports a missing local build to the startup error handler", async () => {
    const window = windowStub();
    window.loadFile.mockRejectedValue(new Error("ERR_FILE_NOT_FOUND"));
    await expect(
      loadWindowRenderer(window, "/test/index.html")
    ).rejects.toThrow("ERR_FILE_NOT_FOUND");
  });
});
