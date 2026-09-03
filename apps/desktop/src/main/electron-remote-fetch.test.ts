import { describe, expect, it, vi } from "vitest";

const fetch = vi.fn(async () => new Response("ok"));

vi.mock("electron", () => ({
  net: { fetch }
}));

const { electronRemoteFetch } = await import("./electron-remote-fetch");

describe("electronRemoteFetch", () => {
  it("uses Chromium networking instead of Node fetch", async () => {
    const init = { method: "GET", cache: "no-store" as const };
    await electronRemoteFetch("https://gateway.example.test/v1/models", init);
    expect(fetch).toHaveBeenCalledWith(
      "https://gateway.example.test/v1/models",
      init
    );
  });
});
